# Technical plan — PDF lesson-planning & quiz agent

This restructures the finalized system-design decisions into an implementation-facing plan: architecture, data flow, agent phases, and decision points. No code.

Where this doc adds structure beyond what the source decisions doc specifies — node names, a draft Postgres schema, retry logic — it's marked **[proposed]**. Those still need an explicit decision before or during build; treat them as a starting point, not a confirmed spec. See §6 for the full list of open questions.

---

## 1. System overview

A single-user flow: upload a PDF → an agent reads it and drafts a lesson plan → the user reviews and edits that plan before it's accepted → the agent runs the user through an MCQ quiz, one question per learning objective, giving hints (not answers) on wrong attempts → a final score/recap. The system is built around two pauses (plan approval, quiz answer) that are structural properties of the LangGraph graph, not behaviors the model can choose to skip.

The "agent" is not a single implicit identity reused across nodes — it's three agents with distinct system-prompt identities and distinct visibility into state, described in §2.2.

---

## 2. Architecture

### 2.1 Components

| Component | Responsibility |
|---|---|
| **Browser** | Next.js + React, CopilotKit client speaking the AG-UI protocol, `useInterrupt` hooks rendering the plan-edit UI and the MCQ UI |
| **Backend** (single Node process) | CopilotKit runtime (the AG-UI server), the LangGraph graph itself — hosting three distinct agents (§2.2) across its nodes — PDF text extraction via `unpdf` |
| **Postgres** (single instance, single shared `pg.Pool`) | Two jobs on one connection pool: LangGraph checkpoints via `PostgresSaver`, and application tables (parsed PDF text, quiz attempts, scores) |
| **Neo4j** (single instance, e.g. Aura free tier — see §2.4) | One narrow job: a per-document objective/prerequisite graph, written once after plan approval, read twice (quiz ordering, study tips). Never on the critical path — see §2.4 for the fallback contract |

No queue, no Redis, no vector DB, no worker pool — see §7.

### 2.2 Agent identities — three agents, not one

Each node in the graph is owned by one of three agents. Each agent has its own system prompt and, critically, its own restricted view of state — an agent never sees more than its job requires. This isn't a cosmetic renaming of the nodes; the visibility boundaries are what make decision #7 (hint isolation) and the self-eval loop (§4) actually enforceable rather than just intended.

| Agent | Owns | Sees | Never sees |
|---|---|---|---|
| **Planner Agent** | Plan-generation node | Full extracted PDF text | Quiz attempts, answer keys |
| **Quiz Agent** | Present-question node, self-eval node, grading node | The approved plan, the current objective, the answer key it writes | — (this is the agent that holds the answer key) |
| **Tutor Agent** | Hint node, completion node | The question, the objective, the user's incorrect attempt, attempt count so far | The answer key — structurally excluded, not just instructed not to use it |

The Quiz Agent both writes and grades the question for a given objective — it's the natural owner of the answer key, since it authored it. The Tutor Agent owns both hinting *and* the final summary/study-tips generation, since both are "review and feedback" jobs that must never leak or rely on having seen the answer key directly — the recap is built from the *scored attempt records* Postgres holds, not from the Tutor Agent re-deriving correctness itself.

### 2.3 Why this shape, in one line each

- **LangGraph over Mastra** — the hard part is durable, resumable, interruptible execution, which is LangGraph's lane.
- **CopilotKit/AG-UI over a custom socket layer** — it's the purpose-built agent-to-UI bridge with first-party LangGraph support; a hand-rolled WebSocket layer would reinvent it.
- **`useInterrupt` over `useHumanInTheLoop`** — the pause has to be a property of the graph's structure, not a tool call the model decides to make, because that's what makes the quiz un-skippable (decision #8 depends on this).
- **Postgres only, no Redis** — sub-50ms resume latency isn't a real constraint at this scale; Postgres gives durability and queryability a reviewer can inspect.
- **`unpdf` over raw `pdfjs-dist`** — purpose-built for TypeScript, async-native, no need to hand-roll OCR/layout extraction the assignment doesn't call for.
- **Full-context stuffing over RAG** — one bounded document needing whole-document reasoning is exactly the case where RAG's complexity isn't earned.
- **Three named agents over one implicit agent reused across nodes** — distinct system-prompt identities and distinct state visibility per role, so isolation guarantees (decision #7) are structural rather than a naming convention.
- **A self-eval node after MCQ generation, not a single generate-and-render call** — a generated question can be malformed (ambiguous correct answer, weak distractors, drift from the objective) before a human ever sees it; catching that before render is cheaper than catching it in the recap.
- **A minimal Neo4j concept graph, scoped to one document and never on the critical path** — the brief's final step (study tips) implies relationships between objectives that a flat list doesn't capture; the graph adds that without becoming a second source of truth or a cross-session memory system (out of scope — see §2.4).

(Full rationale for all decisions is in §5.)

---

### 2.4 Concept graph (Neo4j) — scope and fallback contract

This is the one new stateful dependency beyond Postgres, added deliberately narrow. Full design and rationale is decision #13 in the design-decisions doc; this section is the implementation-facing summary.

**Schema [proposed]:**

```
(:Objective {id, documentId, title, difficulty})
(:Objective)-[:PREREQUISITE_FOR]->(:Objective)
```

`documentId` scopes every node and every query to the current upload — there is no cross-document or cross-user traversal anywhere in this design. This is *not* the cross-session learner-memory feature the job description describes elsewhere; it's intentionally bounded to a single document's internal structure. See decision #13's "what this is explicitly not" for the boundary stated plainly.

**Write:** the Planner Agent's existing plan-generation call (decision #6 — still one LLM call) is extended to emit a `prerequisites: [{from, to}]` list alongside the objectives. The actual Neo4j write happens *after* the plan-approval interrupt resumes (§3, after step 8) — not before — so that any prerequisite edge referencing an objective the user removed during editing is filtered out first. One write, once per session.

**Read 1 (quiz ordering):** at the top of each quiz-loop iteration, query for the unresolved objective with the fewest unresolved prerequisites, instead of always taking the next item in plan-list order.

**Read 2 (study tips):** in the completion node, after the baseline Postgres-only recap is built, one read checks whether any `revealed` (struggled) objective has another `revealed` objective as a prerequisite, and names that relationship in the tip if so.

**Fallback contract, stated once so it doesn't need repeating per call site:** every Neo4j call is wrapped with a short timeout **[proposed: ~1.5s]**. On timeout, error, *or* a cycle in the prerequisite edges (possible since they're LLM-authored and not validated at write time — see §6), both read paths fall back to behavior that doesn't need Neo4j at all: plan-list order for ordering, the flat per-objective Postgres recap for study tips. This is what makes "off the critical path" a code-level guarantee rather than a claim in a decisions doc — the quiz loop and the completion node are both correct, just less specific, with Neo4j entirely absent.

**Driver:** `neo4j-driver` (official JS/TS driver, requires Node 18+). Pattern: one `neo4j.driver(...)` instance for the app's lifetime (mirrors the shared `pg.Pool` in §2.1), a `driver.session()` per operation, `session.executeRead(...)` / `session.executeWrite(...)` per call, session closed after each. Hosting: Aura free tier rather than a third self-hosted service — confirm current free-tier limits at build time.

---

## 3. Data flow

1. User uploads a PDF in the browser → request to backend.
2. Backend extracts text via `unpdf`; the raw extracted text is stored in a Postgres app table **[proposed: `documents`]**.
3. The full extracted text (no chunking, no embeddings) is stuffed into the **Planner Agent**'s prompt.
4. The LangGraph graph instance starts, checkpointed against Postgres from the first node — this is what makes "refresh mid-quiz and resume" possible.
5. **Plan-generation node** (Planner Agent): produces a draft lesson plan (objectives + structure).
6. Graph reaches the **plan-approval node**, calls `interrupt({ type: "approval", content: plan })`, pauses.
7. Frontend's `useInterrupt` (discriminated on `type === "approval"`) renders the plan as editable; user edits and submits.
8. Frontend resumes with `Command({ resume: editedPlan })` — the graph continues with the *user's* edited plan, not the original draft.
8a. **Concept-graph write step** (no LLM call): the Planner Agent's `prerequisites` list from step 5 is filtered against the edited plan (drop any edge referencing an objective the user removed), then written to Neo4j as `(:Objective)-[:PREREQUISITE_FOR]->(:Objective)` (§2.4). Wrapped in the same timeout/fallback discipline as the reads below — if this write fails, the quiz loop simply proceeds with no graph to read from later, falling back to plan-list order and the flat recap as if Neo4j were never added.
9. Graph enters the **quiz loop**: at the top of each iteration, a **select-next-objective step** queries Neo4j for the unresolved objective with the fewest unresolved prerequisites; on timeout, error, or a cycle in the edges, falls back to plain plan-list order. The **Quiz Agent** then generates one MCQ for the selected objective.
   - **9a. Self-eval node** (Quiz Agent): scores the just-generated MCQ against a small rubric (unambiguous correct answer, plausible-but-wrong distractors, alignment to the stated objective). Below the confidence threshold → regenerate, feeding the critique back in as context. Capped at **[proposed: 2 regenerations, 3 attempts total]** — past the cap, proceed with the best-scored attempt and flag it in the attempt record rather than blocking the user indefinitely. This loop needs its own cap for the same reason decision #8 needed one for retries — an unbounded "keep regenerating until perfect" loop is just the same failure mode one layer up.
10. The self-eval-passed question reaches the **present-question node**, calls `interrupt({ type: "quizAnswer", objective, question, choices })`, pauses.
11. User's answer resumes the graph.
12. **Grading node** (Quiz Agent, holds the answer key) evaluates the response.
13. Branch:
    - Correct → graph-structural edge to the next objective (no agent decision involved — see decision #8).
    - Incorrect → attempt count increments. If attempt count < cap **[proposed: 3]** → **hint node** (Tutor Agent, context explicitly excludes the answer key) generates a hint, re-fires the same `quizAnswer` interrupt for another attempt. If attempt count reaches the cap → Tutor Agent instead returns the full explanation/correct answer, the attempt record is marked `revealed` rather than `correct`, and the graph advances to the next objective via the same structural edge as a correct answer.
14. Quiz attempts and scores are written to Postgres as each objective resolves — **[proposed: `quiz_attempts(objective_id, question, choices, selected, correct, attempt_number, resolution)`]**, where `resolution` is one of `correct` / `revealed`, so the recap can distinguish "got it" from "needed it shown."
15. Once every objective is resolved, the **completion node** (Tutor Agent) finalizes state and returns a summary/score to the frontend, built from the Postgres attempt records — not from the Tutor Agent's own memory of the session, since it never held the answer keys to begin with. One additional Neo4j read checks for prerequisite relationships among `revealed` (struggled) objectives, to make the study tips name a specific relationship rather than just list weak objectives flatly; on failure, the recap ships using only the Postgres-derived version.

---

## 4. Agent phases (graph structure)

**Plan generation** (Planner Agent) — single LLM call over the full document text. No interrupt here; this is the one phase that runs without a pause.

**Plan approval** — `interrupt()` inside the node, guarded by a state check (`state.planApproved ?? interrupt(...)`) so re-entering the node on retries doesn't re-fire the prompt. Resume value is the edited plan object, via `Command({ resume: editedPlan })`. On the frontend, this pairs with `useInterrupt`, not `useHumanInTheLoop` — the `agentId` passed to the hook has to exactly match the runtime-registered agent ID, or the interrupt silently never fires. Immediately after resume, the concept-graph write step (§2.4, §3 step 8a) persists the filtered prerequisite edges to Neo4j — no interrupt here, no LLM call, just a write with the same fallback discipline as the reads.

**Quiz loop** (Quiz Agent + Tutor Agent) — per objective, six steps:
- *Select-next-objective* step: Neo4j read for the unresolved objective with fewest unresolved prerequisites; falls back to plan-list order on timeout, error, or a cycle.
- *Generate MCQ* node (Quiz Agent): builds the structured question output `{ question, choices[4], correctIndex, explanation }`.
- *Self-eval* node (Quiz Agent): scores the just-generated MCQ before it's ever shown to the user; below threshold, loops back to regenerate (capped — see §3, step 9a).
- *Present question* node (Quiz Agent): calls `interrupt({ type: "quizAnswer", objective, question, choices })` — only reached after self-eval passes.
- *Grade* node (Quiz Agent): has the answer key, evaluates the resumed answer.
- *Hint* node (Tutor Agent): triggered only on incorrect, structurally cannot see the answer key (decision #7 — this is an isolation guarantee, not a prompt instruction). On the final allowed attempt, this node reveals the answer with explanation instead of another hint (decision #12 in the design-decisions doc).

Because CopilotKit is being streamed to anyway, use `graph.stream()` and read the `__interrupt__` key from the chunk rather than `graph.invoke()`, which doesn't surface interrupts in its return value. If `invoke()` is used for any reason, pair it with `graph.getState(config)` and read `state.tasks[0].interrupts[0].value`.

**Completion** (Tutor Agent) — finalizes score/recap once all objectives have a `correct` or `revealed` attempt, reading from the Postgres attempt records rather than from in-session memory, then attempting one Neo4j read to enrich the study tips with prerequisite relationships among struggled objectives (falls back to the flat Postgres-only version on failure).

The progression between objectives has no agent-callable "skip" action — there's no graph edge for it. The agent can chat, explain, and hint freely *within* a node, but it can't transition state without a valid answer submission *or* hitting the attempt cap. That's decision #8's enforcement mechanism, concretely — now with a defined exit on the "infinite retry" side too.

---

## 5. Decision points reference

| # | Decision | Core rationale |
|---|---|---|
| 1 | LangGraph for orchestration | Explicit interrupts + durable, resumable execution is the actual hard part; CopilotKit has first-party support for it |
| 2 | CopilotKit + AG-UI as the UI bridge, `useInterrupt` not `useHumanInTheLoop` | Pause must be graph-structural, not a model-chosen tool call — load-bearing for decision #8 |
| 3 | Editable resume, not boolean approve/reject | Costs nothing extra architecturally; demonstrates HITL actually correcting the agent, not rubber-stamping it |
| 4 | Single Postgres (checkpoints + app data, shared pool) | Durable and queryable at a scale where Redis's latency advantage isn't needed |
| 5 | `unpdf` for PDF parsing | TypeScript-native, async, no OCR/layout complexity the assignment doesn't require |
| 6 | Full-context stuffing, no RAG | One bounded document needing whole-document reasoning — RAG would solve a scale problem that doesn't exist here |
| 7 | Hint node architecturally excludes the answer key | Prompt-only "don't reveal the answer" is an exploitable surface once the user knows the rule exists |
| 8 | Quiz progression is state-machine enforced, with a bounded retry cap | No agent tool/edge to skip a question — structural guarantee beats conversational steering; cap prevents the same fragility reappearing as an unbounded retry loop |
| 9 | Build for assessment scale, document the scaling path | Over-building infra for a take-home is itself a negative signal; the brief is a working single-user flow |
| 10 | Three named agents (Planner, Quiz, Tutor), not one agent reused across nodes | Distinct identities + distinct state visibility make the answer-key isolation in decision #7 a structural property of *who can see what*, not just a node boundary |
| 11 | Self-eval node on generated MCQs, with a bounded regeneration cap | Catches malformed questions (ambiguous answer, weak distractors, objective drift) before a human sees them, without becoming its own unbounded loop |
| 12 | Retry cap on quiz answers (3 attempts, reveal-and-advance past the cap) | Closes the non-termination risk and the unbounded latency/cost risk left open under decision #8 |
| 13 | Minimal Neo4j concept/prerequisite graph, never on the critical path | Improves an acceptance-criteria item (study tips) the brief already implies, without building the cross-session learner-memory feature the brief doesn't ask for |

---

## 6. Open questions — not yet decided

These aren't gaps in the source design doc's reasoning; they're points the doc itself flags as needing a hands-on check or simply doesn't address yet:

- **Self-eval threshold and rubric, concretely.** §3/§4 propose scoring on unambiguous-answer / plausible-distractors / objective-alignment, capped at 2 regenerations — the actual pass/fail threshold (e.g. 4/5) and whether the rubric is a single composite score or three separate gates is not yet decided.
- **Whether the Planner Agent's plan also gets a self-eval pass before the HITL approval step.** Deliberately scoped out of the first build — the user already reviews and edits the plan, so a self-eval pass there is redundant with a human gate in a way the MCQ self-eval isn't (no human ever reviews individual MCQs before they're shown). Worth revisiting if time allows; not core scope.
- **Whether `interrupt()`/resume values get appended to `state.messages`.** The doc notes this explicitly: `interrupt()` updates whichever state key the resume value is assigned to, but does **not** automatically inject the exchange into the conversational message history. If the agent needs to refer back to the approved plan or a past answer later in the session, that append has to be done manually on resume. Flagged in the source doc as something to verify hands-on early, not yet confirmed.
- **Exact Postgres schema.** The doc specifies *categories* of app data (parsed PDF content, quiz attempts, scores) but not table/column names. The `documents` / `quiz_attempts` names above are proposed, not decided.
- **Graph node names and exact edge topology.** "Plan generation," "plan approval," "quiz loop," "completion" are phases described in the doc; the concrete node/edge names in §4 are this document's proposal for organizing them, not a finalized graph spec.
- **Quiz content granularity.** How many objectives, how many MCQs per objective — this is a content/pedagogy decision rather than a system-architecture one, and is out of scope for this doc.
- **No authentication layer is planned**, consistent with the single-user assessment scope in decision #9 — worth stating explicitly rather than leaving implicit.
- **Neo4j timeout duration and Aura free-tier limits.** §2.4 proposes ~1.5s as the timeout before falling back; not load-tested. Aura's current free-tier quotas should be confirmed at build time rather than assumed from this doc.
- **Whether to validate/break prerequisite cycles at write time.** The current design relies entirely on the runtime fallback (§2.4) — if the Planner Agent's edge list contains a cycle, ordering just falls back to plan-list order rather than detecting and repairing the cycle in the data itself. Cheaper to build, and arguably fine since the fallback is already correct, but worth flagging as a deliberate "don't fix the data, just don't trust it" choice rather than an oversight.
- ~~**Retry behavior on a wrong answer.**~~ Resolved — see decision #12 in the design-decisions doc and §3/§4 above (cap at 3 attempts, reveal-and-advance past the cap, each attempt scored individually with a `resolution` field).

---

## 7. Explicit non-goals (decision #9)

Documented as the scaling path, not built:
- No queues, no horizontal worker pools, no caching layer
- Scaling considerations that *are* already satisfied directionally: stateless compute is possible because state lives in Postgres via the checkpointer, not in process memory
- PDF-processing queue and prompt caching for the repeated lesson-plan context: documented as where the system would need to change at scale, not implemented

**Also explicitly out of scope:** cross-session learner memory in Neo4j — a persistent mastery model spanning multiple documents or multiple users. The concept graph in §2.4 is scoped to a single document's objectives for the duration of one session; it doesn't read or write anything once that session's quiz is complete, and nothing in the schema (`documentId`-scoped nodes, no user identifier) supports a cross-session query even accidentally. This is a deliberate boundary, not a missing feature — see decision #13 for the full reasoning.

---

## 8. Implementation watchpoints (carry-forward risks)

- `graph.invoke()` does not surface `__interrupt__` — use `graph.stream()`, or pair `invoke()` with `graph.getState(config)`.
- `useInterrupt`'s `agentId` must exactly match the runtime-registered agent ID — a mismatch fails silently, with no error.
- `interrupt()`/resume does not auto-append to `state.messages` — manually append the Q&A exchange on resume if later turns need to reference it. Verify this hands-on early; it directly affects whether the agent can coherently discuss the approved plan later in the session.
- `PostgresSaver.setup()` must run once before first use — it provisions the checkpoint tables.
- CopilotKit's own docs are inconsistent about `await`-ing `interrupt()`. Match the non-`await`ed form — per LangGraph.js's type signature, `interrupt()` returns synchronously or throws `GraphInterrupt`, so `await` is a no-op either way, but the non-awaited form matches the actual contract.
- The "make your agent aware of interruptions" anchor in CopilotKit's docs is a dead link on both doc paths — don't build against it; the manual `state.messages` append pattern above is the verified fallback.
- Guard every `interrupt()` call with a state check (`state.x ?? interrupt(...)`) before calling it — without the guard, re-entering a node on retry re-prompts the user instead of resuming cleanly.
- **New:** the self-eval regeneration loop needs the same re-entry guard discipline as the interrupt pattern above — track regeneration count explicitly in state, don't infer it from node call count, or an unrelated retry elsewhere could silently reset it.
- **New:** the retry cap (decision #12) and the self-eval regeneration cap (decision #11) are two different counters on two different loops — don't conflate them in state or in the Postgres schema. An MCQ that took 2 regenerations to write is a separate fact from a user needing 3 attempts to answer it.
- **New:** `neo4j-driver` requires Node 18+. Confirmed `executeRead`/`executeWrite` as the current recommended transaction pattern on the session object — but the docs show both this and an older `readTransaction`/`writeTransaction` naming across different versions/examples, so confirm which is current against the installed driver version before building.
- **New:** numeric properties (e.g. an objective's `id` if it's an integer) come back from Neo4j as the driver's internal Integer type, not a plain JS number — confirm the current conversion approach before using a Neo4j-returned numeric value in a comparison or as a Postgres foreign key lookup.
- **New:** keep one `neo4j.driver(...)` instance for the process lifetime (mirrors the shared `pg.Pool` pattern), one `driver.session()` per operation, closed after each — don't open a new driver per request.