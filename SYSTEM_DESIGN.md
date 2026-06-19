# System Design Decisions

Each ambiguous point in the assessment was researched against current (2026) production practice rather than left to the client to clarify. One decision per item, with rationale and sources. Three items were initially flagged `[VERIFY]` pending a direct API check — all three are now resolved below, marked `[RESOLVED]`, with the concrete finding and the decision it drove.

Decisions 10–13 were added in a second pass, after reviewing the plan against the kind of system this build is meant to demonstrate fluency in (multi-agent coordination, introspective evaluation, bounded state machines, scoped use of a graph database) rather than just satisfying the acceptance criteria literally.

---

### 1. Agent framework: LangGraph (not Mastra)

**Decision:** Use LangGraph for the agent/orchestration layer.

**Why:** The core technical challenge here is explicit interrupts (HITL plan approval) and durable, resumable execution (a user should be able to refresh mid-quiz and resume). Current framework comparisons draw the line precisely on this axis: LangGraph wins when the hard part is "explicit graph control, durable execution, interrupts, and stateful workflow debugging," while Mastra wins when the hard part is general TypeScript agent/tool/memory logic. Our requirements sit squarely in LangGraph's lane. CopilotKit has first-party, dedicated documentation for LangGraph's `interrupt()` flow specifically — this is a well-trodden pairing, not a custom integration we'd be inventing.
**[RESOLVED]** `interrupt()` + `Command({resume: ...})` is current, documented, and stable in `@langchain/langgraph` for a standard Node backend — confirmed against the official `docs.langchain.com/oss/javascript/langgraph/interrupts` reference. One concrete gotcha to build around, not just verify: **`graph.invoke()` does not surface `__interrupt__` in its return value** — only `graph.stream()` does. This is a known, currently-open behavior (langgraphjs#1422) confirmed by a LangChain maintainer as expected, not a bug being fixed. Two ways to handle it:
- Use `graph.stream()` and read the `__interrupt__` key from the chunk, **or**
- If using `invoke()`, follow it with `graph.getState(config)` and read `state.tasks[0].interrupts[0].value`.
Given we're streaming agent output to CopilotKit anyway, use `stream()` for the plan-approval and quiz nodes — it's the lower-friction path and avoids this gotcha entirely. The edge-runtime checkpointer issues I'd originally flagged are specific to Cloudflare Workers deployments; irrelevant for a standard Node server, so no action needed there.

**See also: decision #10.** This decision establishes the graph; #10 establishes that the graph's nodes are owned by three distinct named agents rather than one implicit agent reused across them.

---

### 2. UI/agent bridge: CopilotKit + AG-UI (CoAgents), not a custom socket layer

**Decision:** Use CopilotKit as the frontend agent runtime, communicating via the AG-UI protocol.

**Why:** AG-UI is CopilotKit's protocol specifically for the "agent-to-UI interaction layer" — streaming responses, dynamic UI component generation, bidirectional state sync, and HITL pauses where the agent waits for user confirmation. It has first-party SDK support for LangGraph specifically. Building a custom WebSocket/SSE bridge to hand-roll this would be reinventing a layer the assignment's own tooling list (CopilotKit) is pointing at.
**[RESOLVED — corrected from a prior draft of this doc]** CopilotKit v2 has two distinct HITL hooks that are easy to conflate, and an earlier version of this document recommended the wrong one. Confirmed directly against CopilotKit's official docs (`docs.showcase.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop` and `.../langgraph-python/human-in-the-loop/interrupt-flow`):

- **`useHumanInTheLoop`** — pairs with a CopilotKit **frontend tool**. The agent (LLM) decides to *call* a named tool (e.g. `confirmDeletion`); CopilotKit pauses that tool call until your component invokes `respond(value)`. Framework-agnostic over AG-UI; the pause exists because the model chose to invoke it.
- **`useInterrupt`** — pairs with LangGraph's native `interrupt()` call **inside a graph node**. The node hits `interrupt(payload)`, execution pauses at that exact point in the graph, the frontend renders via `useInterrupt({ agentId, render: ({event, resolve}) => ... })`, and `resolve(value)` resumes the graph (this is the `Command({resume: value})` pattern from the LangGraph research above, surfaced through CopilotKit). The pause is a property of the graph's structure, not a model decision.

**Decision: use `useInterrupt`, not `useHumanInTheLoop`, for both the plan-approval step (#3) and the MCQ question/answer step.** This isn't just the technically-correct pairing for our LangGraph backend — it's load-bearing for decision #8 below. If quiz questions were rendered via a `useHumanInTheLoop` tool, presenting the next question would be something the LLM *chooses* to do, which is exactly the conversational-trust model #8 rejects. Hardcoding `interrupt()` into the node the graph always traverses means the pause can't be skipped, argued around, or omitted by the model — it's a graph-structural guarantee, not a behavioral one.

Two concrete operational details confirmed from the docs, worth keeping in mind during implementation:
- `useInterrupt`'s `agentId` must exactly match the runtime-registered agent ID. If omitted, it defaults to `"default"` — a mismatch means the interrupt silently never fires (no error, just nothing happens).
- Multiple interrupt types in one graph (plan-approval, quiz-answer, hint-request) are distinguished by including a `type` field in the interrupt payload (e.g. `interrupt({ type: "quizAnswer", ... })`), with separate `useInterrupt` calls in the frontend differentiated by an `enabled: ({eventValue}) => eventValue.type === "..."` discriminator.

**[RESOLVED — TypeScript `interrupt()` syntax]** Confirmed directly from CopilotKit's docs (cross-checked against two URL aliases serving identical content: `docs.showcase.copilotkit.ai/langgraph-python/...` and `docs.copilotkit.ai/langgraph-typescript/...`):
```ts
// Single interrupt, guarded by a state check (the standard idiom —
// only fires interrupt() if this state key hasn't been resolved yet)
const agentName = state.agentName ?? interrupt("Before we start, what would you like to call me?");

// Object payload, used to differentiate multiple interrupt types in one node
state.approval = await interrupt({ type: "approval", content: "please approve" });
```
Note: the docs' own examples are inconsistent about `await`-ing `interrupt()` — one omits it, the other includes it. This is a real inconsistency in the source material, not a misread. It's harmless either way: LangGraph.js's API reference describes `interrupt()` as synchronously returning the resume value (or throwing `GraphInterrupt`) rather than returning a Promise, so `await` on it is a no-op. Match the non-awaited form for accuracy against the actual type signature.

A related production gotcha (CopilotKit GitHub issue #2315, "interrupt fails due to extra null-state turn between trigger and resume") confirms the same guard pattern matters for correctness, not just style — explicitly checking `state.someValue` before calling `interrupt()` again (rather than calling it unconditionally on every node re-entry) is what prevents the node from re-prompting the user on retries/re-invocations after it's already been resolved once.

**[CLOSED — not resolvable from public docs]** The "make your agent aware of interruptions" reference: checked both the `langgraph-python` and `langgraph-typescript` doc paths (identical content, confirmed word-for-word) — the prose links to a `#make-your-agent-aware-of-interruptions` anchor, but no section with that content exists on either page. This is a stub/dead link in CopilotKit's current docs, not a gap in research. **Practical fallback (general LangGraph pattern, not a CopilotKit-specific citation — treat as informed inference):** `interrupt()`/`Command(resume=...)` updates whichever state key you assign the resume value to, but does not automatically inject the exchange into `state.messages`. If the agent's own conversational context needs to reference what happened during a pause (e.g. referring back to the user's edited lesson plan in a later turn), manually append a message pair representing the Q&A exchange into `state.messages` when the node resumes, before returning. Verify this hands-on early — it directly affects whether the agent can coherently discuss the approved plan later in the session, or whether the plan only exists as inert state.

**See also: decision #11.** The same `type`-discriminated interrupt pattern used here for `approval` / `quizAnswer` is reused, conceptually, for the self-eval regeneration loop — though that loop is internal to the graph (Quiz Agent re-prompting itself) and never surfaces as a `useInterrupt` to the user.

---

### 3. HITL plan approval: editable resume, not boolean approve/reject

**Decision:** The plan-approval interrupt returns an editable plan object via `Command(resume=editedPlan)`, not a simple yes/no.

**Why:** A boolean approval gate technically satisfies "user reviews and confirms" but doesn't demonstrate the actual value of HITL — correcting the agent's course, not rubber-stamping it. LangGraph's interrupt/resume pattern passes arbitrary data back into the graph on resume, so an editable plan costs no more architecturally than a boolean. Given a senior-level assessment is likely also evaluating whether the HITL pattern is understood (not just present), the richer implementation is the lower-risk choice.

**See also: decision #11.** This is the only human-reviewed checkpoint in the system. The MCQs generated downstream have no equivalent human gate before being shown — which is the gap #11's self-eval node is meant to partially cover, at the model level rather than the human level.

---

### 4. Persistence: PostgreSQL only — no Redis

**Decision:** Single PostgreSQL instance for both LangGraph checkpointing (`PostgresSaver`) and application data (parsed PDF content, quiz attempts, scores).

**Why:** Current guidance treats Postgres as "the standard path" for LangGraph checkpointing — durable, queryable, debuggable, which matters for an assessment a reviewer may want to inspect. Redis is the documented choice for high-throughput production systems needing sub-50ms resume latency; that constraint doesn't exist here. A team running 120k+ conversations/week chose Postgres specifically because they needed HITL and time-travel debugging — the same reasons apply at our (much smaller) scale, and running two stateful backends for a single-PDF assessment would be unjustified complexity.
**[RESOLVED]** Package is `@langchain/langgraph-checkpoint-postgres` (currently at v1.0.1), confirmed against the official LangChain.js reference and npm. `.setup()` **is** required exactly once before first use — it provisions the checkpoint tables. Two valid construction patterns, both current:
```ts
// Simple — let the saver manage its own connection
const checkpointer = PostgresSaver.fromConnString(
  "postgresql://user:password@localhost:5432/db",
  { schema: "custom_schema" } // optional, defaults to "public"
);
await checkpointer.setup();

// Or — reuse an existing pg Pool (preferred if the app already has one
// for the application tables, so checkpointing and app data share a pool)
const checkpointer = new PostgresSaver(pool, undefined, { schema: "custom_schema" });
await checkpointer.setup();
```
**Decision:** use the `new PostgresSaver(pool, ...)` form, reusing a single `pg.Pool` for both the checkpointer and the application's own tables (parsed PDF content, quiz attempts) — one connection pool, one source of truth, consistent with decision #4 above.

**Note on Neo4j:** added in decision #13, scoped to a single narrow job (a per-document objective/prerequisite graph). Postgres remains the only stateful dependency on the critical (HITL/checkpoint) path regardless — Neo4j is additive, not a replacement for anything decided here.

---

### 5. PDF parsing: unpdf

**Decision:** Use `unpdf` for text extraction.

**Why:** It's purpose-built for TypeScript (async/await native, ESM, edge-compatible), built on Mozilla's pdf.js under the hood for correctness. Given the language constraint is TypeScript and the assignment doesn't call for scanned-document OCR or complex layout/table extraction, the simpler modern wrapper is the right fit over hand-rolling against `pdfjs-dist` directly.

**Assumption stated explicitly:** This assumes the test PDF is a standard text-based document, not a scanned image requiring OCR. If that assumption is wrong, this is the one component that would need to change (to a Textract/OCR pipeline) — flagging this risk rather than guessing silently.

---

### 6. Content strategy: full-context stuffing, not RAG

**Decision:** Pass the full extracted PDF text directly into the planning/quiz-generation prompts. No vector DB, no chunking/embedding pipeline.

**Why:** Current 2026 guidance is consistent across sources: RAG earns its complexity for large or frequently-changing corpora needing access control and citation tracking. For a single, bounded document needing whole-document reasoning (exactly what lesson planning requires — understanding the document's overall structure, not retrieving isolated facts), long-context stuffing is the documented correct default for solo/small-scale use. Building a RAG pipeline here would be solving a scale problem the assignment doesn't have, at the cost of time better spent on the agent/HITL/UI logic that's actually being evaluated.

---

### 7. "Don't give away the answer": architectural isolation, not prompt instruction alone

**Decision:** The hint-generation LLM call's context does not include the correct answer. The node that generates hints receives only the question, the objective, and the user's incorrect attempt — never the answer key.

**Why:** Research into Socratic tutoring system failures is explicit that prompt-only constraints ("don't reveal the answer") are an exploitable attack surface — once a user knows the rule exists, they can manipulate the conversation to extract it anyway. The robust pattern used in production tutoring contexts is to remove the sensitive information from what the model can see in that call, not to trust instruction-following under adversarial pressure. This is a deliberate two-call design: one node has the answer (grading), a separate node generates the hint and structurally cannot leak what it was never given.

**See also: decision #10.** This isolation is now framed as an agent-identity boundary, not just a node boundary — the Tutor Agent is defined, at the prompt-assembly level, as an agent that is never constructed with the answer key in context. The grading logic lives entirely with the Quiz Agent.

---

### 8. Quiz progression: state-machine enforced, not conversation-enforced

**Decision:** "Steer the user to continue the lesson" is enforced structurally — there is no agent tool/action that skips or bypasses a question. Progression through objectives is a property of the graph state, not something the agent decides conversationally.

**Why:** Relying on the agent to politely decline off-task requests via prompting alone is the same class of fragility as point 7 — conversational steering can be argued with. Making "skip the quiz" structurally unavailable (no corresponding graph edge or tool) is a stronger and simpler guarantee, consistent with how LangGraph's explicit graph-control model is meant to be used. The agent can still chat, explain, and give hints freely *within* a node — it just can't transition state without a valid answer submission.

**Confirmed mechanism (see decision #2's correction above):** this is now a concrete implementation detail, not just a principle. Each MCQ is presented via LangGraph's `interrupt({ type: "quizAnswer", objective, question, choices })` called inside the quiz node — never as a `useHumanInTheLoop` frontend tool the model could choose to skip. The frontend's `useInterrupt` hook (discriminated on `type`) is the only path back into the graph for that node; there is no agent-callable action that advances the lesson without it.

**Open question at time of original drafting, resolved below:** this decision establishes that progression can't be *skipped*, but originally left open whether progression could *fail to terminate* — i.e., whether an incorrect-answer loop has an exit. See decision #12.

---

### 9. Scope: build for correctness at assessment scale, document the scaling path — don't implement it

**Decision:** No queues, no horizontal worker pools, no caching layer in the actual build. Scaling considerations (stateless workers behind the Postgres checkpointer, PDF-processing queue, prompt caching for the repeated lesson-plan context) are documented here, not built.

**Why:** Over-building infrastructure for a take-home is itself a negative signal — it suggests poor judgment about what the exercise is testing rather than technical depth. The acceptance criteria describe a working single-user flow; the job description's "scales to millions" is evaluated by demonstrating the team understands *where* the system would need to change to scale (stateless compute, externalized state in Postgres already satisfies most of this directionally), not by building that infrastructure for a one-PDF demo.

**This is also the governing logic behind decision #13's Neo4j scope** — the same judgment that says "don't build a queue for a one-PDF demo" is the test the Neo4j usage in #13 was scoped against before being added to this build.

---

### 10. Agent identity: three named agents, not one implicit agent across nodes

**Decision:** Split the single implicit agent into three explicitly named agents — **Planner Agent**, **Quiz Agent**, **Tutor Agent** — each with its own system prompt and its own restricted view of state. See plan.md §2.2 for the full ownership/visibility table.

**Why:** The original node-based design (plan-generation, present-question, grade, hint, completion) already had an implicit division of labor, but treating it as one agent wearing different hats across nodes undersells what decision #7 actually buys. The isolation guarantee in #7 — the hint node structurally cannot see the answer key — is much clearer to build and to verify correct when it's framed as "the Tutor Agent never has the answer key in its prompt" than as "this particular node call happens not to include it." One agent, one prompt template reused with different context per call is an easy thing to accidentally regress (a refactor that consolidates prompt-building logic could silently leak the answer key into the hint call); three separately defined agents with their own system prompts and explicit context-assembly functions make the boundary a code-structure fact rather than a runtime convention. This also maps the build directly onto the brief's own Plan / Quiz / Feedback-Summarize sections, which is useful for anyone reviewing the code against the assignment.

**Note:** this doesn't change the underlying graph topology decided in #1, #2, and #8 — it's a naming and prompt-isolation decision layered on top of the same nodes, not a new set of nodes or a new orchestration pattern.

---

### 11. Self-evaluation loop on generated MCQs, with bounded regeneration

**Decision:** After the Quiz Agent generates an MCQ and before it's shown to the user, a self-eval node scores the question against a rubric (unambiguous correct answer, plausible-but-wrong distractors, alignment to the stated objective). Below threshold, regenerate with the critique fed back in as context, capped at 2 regenerations (3 attempts total). Past the cap, proceed with the best-scored attempt and flag the attempt record rather than blocking.

**Why:** Decision #3 (editable plan resume) gives the user a human checkpoint on the *plan*, but there's no equivalent check on individual MCQs before they're rendered — a single bad question (ambiguous correct answer, a distractor that's arguably also correct, a question that's drifted from its stated objective) reaches the user with no gate at all. A self-eval pass is cheap relative to the cost of a user hitting a broken question mid-quiz, and it's a generally-applicable pattern — "agent checks its own output, escalates or retries on low confidence" — rather than something specific to this one node.

**Explicit guard against the obvious failure mode:** an unbounded "keep regenerating until it's perfect" loop is the same fragility as the original (pre-#12) unbounded retry loop, one layer earlier in the pipeline. The cap exists for the same reason decision #12's cap does — see plan.md §8 for the state-tracking discipline this requires (track regeneration count explicitly in state; don't infer it from node re-entry count, which can be perturbed by unrelated retries).

**Open / not yet decided:** the concrete pass/fail threshold and whether the rubric is a single composite score or three separate gates (see plan.md §6). Also explicitly *not* applied to the Planner Agent's lesson plan in this build — that already has a human review gate (decision #3), so a self-eval pass there is lower-priority and currently out of scope.

---

### 12. Retry cap on quiz answers — resolves the open question under decision #8

**Decision:** Cap incorrect attempts at 3 per question. On the 3rd incorrect attempt, the Tutor Agent reveals the correct answer with explanation instead of issuing another hint, and the graph advances to the next objective via the same structural edge used for a correct answer. Each attempt is scored individually and stored with a `resolution` field (`correct` or `revealed`) so the final recap can distinguish "solved it" from "needed it shown."

**Why:** Decision #8 correctly removes the agent's ability to *skip* a question, but as originally written left "does retry ever end?" fully open — which means an unbounded retry loop was structurally possible, just not yet decided against. That's a real gap for two reasons: it's a literal non-termination risk (no terminal state for a user who keeps answering wrong), and every retry triggers another hint-generation LLM call, which is a real and avoidable latency/cost cost at the architecture level, not just a UX nicety. A fixed cap with a defined terminal behavior (reveal-and-advance) closes both. The brief's "retry without penalty" requirement is preserved — penalty here would mean a score deduction or being blocked from continuing, neither of which happens; revealing the answer after a bounded number of genuine attempts is a completion mechanism, not a penalty.

---

### 13. Neo4j: a minimal concept/prerequisite graph for objectives — never on the critical path, explicitly not cross-session memory

**Decision:** Add Neo4j as a single additional stateful dependency, scoped to exactly one thing: a per-document graph of objectives and their prerequisite relationships, written once after plan approval and read twice — once to order the quiz sensibly, once to enrich the final study tips. Every Neo4j call is wrapped with a short timeout and a defined fallback; Postgres remains the only dependency the HITL/checkpoint/quiz-state machinery needs, by construction.

**What this is explicitly not:** cross-session learner memory, a mastery model, or anything that persists across different PDF uploads or different users. That's a real, larger feature — and it's the one the job description's "personalized memory using Neo4j across sessions" bullet actually describes — but the brief in front of us has no returning-user flow and no second document in its acceptance criteria. Building that here would be inventing scope decision #9 already argues against. The schema below is deliberately shaped so it *can't* support that query even by accident: nodes are scoped by `documentId`, not by a user identifier, and nothing is read or written once a session's quiz completes.

**Schema [proposed]:**
```
(:Objective {id, documentId, title, difficulty})
(:Objective)-[:PREREQUISITE_FOR]->(:Objective)
```

**Write — when and what.** The Planner Agent's existing plan-generation call (decision #6 — still one LLM call) is extended to also emit a `prerequisites: [{from, to}]` list alongside the objectives, as part of the same structured output. The Neo4j write itself happens after the plan-approval interrupt resumes (decision #3), not before — the user's edits during HITL review can add, remove, or reorder objectives, so any prerequisite edge referencing an objective that didn't survive the edit is filtered out first. This keeps the graph consistent with what the user actually approved.

**Read 1 (quiz ordering).** At the top of each quiz-loop iteration, query for the unresolved objective with the fewest unresolved prerequisites, instead of always taking the next item in plan-list order. If the query times out, errors, or every remaining objective is mutually blocked (a cycle — possible since the edges are LLM-authored and not validated at write time), fall back to plain list order. An infra failure and a data-quality failure share one fallback path deliberately: the correct user-facing behavior (use the approved plan's order) is the same either way.

**Read 2 (study tips).** In the completion node, after the baseline recap is built from Postgres attempt records (decision #12's `resolution` field), one read checks whether any `revealed` (struggled) objective has another `revealed` objective as a prerequisite, and names that relationship in the tip if so. On failure, the recap still ships — just the flatter, per-objective version it would have been without this decision.

**Driver and hosting. [RESOLVED]** confirmed against the official driver manual and the `neo4j/neo4j-javascript-driver` GitHub repository: `neo4j-driver` is the official JS/TypeScript driver, requires Node 18+, and exposes `neo4j.driver(uri, neo4j.auth.basic(user, password))` → `driver.session()` → `session.executeRead(tx => tx.run(cypher, params))` / `session.executeWrite(...)`, with one driver instance per application (mirroring the shared `pg.Pool` pattern in decision #4) and a session per operation, closed after. One driver-specific gotcha worth flagging rather than discovering mid-build: numeric properties come back from the driver as its internal Integer type, not a plain JS number — confirm the current conversion approach before using a Neo4j-returned id or difficulty value in a comparison. For hosting, use Aura — Neo4j's own managed cloud offering, which has a free tier — rather than standing up a third self-hosted stateful service for an assessment; confirm current free-tier limits at build time, since those terms can change and weren't independently verified beyond confirming the free tier exists.

**Fallback discipline, stated once so it governs every call site:** every Neo4j call is wrapped with a short timeout **[proposed: ~1.5s, not load-tested]**. On timeout, error, or a detected cycle, both read paths fall back to behavior that doesn't need Neo4j at all. This is what makes "off the critical path" a code-level guarantee rather than a claim in this document — the quiz loop and the completion node are both correct, just less specific, with Neo4j entirely absent. This is also the honest answer to "what if this dependency fails": nothing in the acceptance criteria breaks.