# AI Learning Agent

Build an AI learning agent that transforms a PDF into an interactive lesson.

---

## The Problem

Single-LLM quiz apps have three structural problems:

**1. No enforcement.** The AI can be talked into skipping questions, replaying hints, or revealing answers. "Be strict" is a prompt instruction, not a guarantee.

**2. No isolation.** The same context that knows the answer also gives the hint. One prompt injection is enough to leak it.

**3. No ordering.** Questions are generated in list order, not dependency order. A student gets tested on advanced concepts before foundational ones.

---

## What this does differently

This system is an **agent** — a stateful process that pauses for human input, resumes, makes decisions across multiple steps, and enforces rules structurally (not just by prompting).

What it guarantees structurally:

- **Quiz cannot be skipped** — no graph edge exists for it. There is no action the AI or user can take to skip a question without submitting an answer.
- **Answer key cannot leak to the hint path** — the hint stage is constructed without it in context, not just instructed to avoid it.
- **Questions follow prerequisite order** — Neo4j graph with `PREREQUISITE_FOR` edges; degrades to list order if DB is cold.
- **Questions self-evaluate before a student sees them** — deterministic structural checks run first (no LLM), then a four-criteria binary evaluation; max 3 regeneration attempts.

---

## Design decisions

### Why three isolated stages, not one

A single model context can't structurally isolate the answer key from the hint path. With three role-isolated stages, the Tutor stage is constructed without `answerKey` ever in its context — not a prompt instruction, a construction guarantee. The stage that gives hints literally cannot see what it was never given.

| Stage | What it does | What it never sees |
|---|---|---|
| **Planner** | Reads the PDF, builds the lesson plan | Quiz answers, answer keys |
| **Quiz** | Writes questions, self-evaluates, grades answers | — (holds the answer key) |
| **Tutor** | Gives hints on wrong answers, writes the final recap | The answer key — by design |

### Why Neo4j for prerequisites

Prerequisite relationships are a graph, not a list. `PREREQUISITE_FOR` edges let `selectObjective` pick the question with fewest unresolved dependencies — a topological sort. The system degrades gracefully: if Neo4j is cold (8s timeout), it falls back to list-order without blocking the quiz. A flat list in Postgres couldn't express or query this ordering.

### Why structural enforcement over prompting

Prompts can be argued around. Graph edges can't. There is no action the AI or user can take to skip a question without submitting an answer — no edge exists for it. The Tutor stage has no code path to the answer key. These are construction guarantees, not behavioral instructions.

---

## Architecture

The system is a Next.js app with a LangGraph agent backend and CopilotKit runtime. The frontend communicates with the LangGraph graph via a Next.js HTTP adapter route; interrupts (plan approval, quiz answers) are handled by posting `command.resume` directly to the LangGraph streaming endpoint and syncing state back to React.

### System architecture

```mermaid
graph LR
    Browser["Browser\n(Next.js UI)"] -->|HTTP + SSE| CK["CopilotKit Runtime\n/api/copilotkit"]
    CK -->|"LangGraph HTTP\n(LANGGRAPH_DEPLOYMENT_URL)"| Graph["LangGraph Agent\n/api/langgraph"]
    Graph -->|checkpoints| PG[("Postgres\nSupabase")]
    Graph -->|concept edges| Neo4j[("Neo4j Aura")]
    Graph -->|LLM calls| Claude["Anthropic Claude"]
    Graph -->|traces · optional| LS["LangSmith\n(LANGSMITH_API_KEY)"]
    Browser -->|PDF upload| Upload["/api/upload"]
    Upload --> PG
    Browser -->|objective validation| VObjAPI["/api/validate-objective"]
    VObjAPI --> Claude
    VObjAPI --> PG
    Browser -->|quiz chat| Chat["/api/chat\n(answer-guarded)"]
    Chat --> Claude
```

### Agent graph flow

Nodes are color-coded by stage:

```mermaid
flowchart TD
    A([PDF Upload]) --> B[generatePlan]
    B --> C{planApproval\ninterrupt}
    C -->|user edits + approves| D[writeConceptGraph\nNeo4j]
    D --> E[selectObjective\nNeo4j ordering]
    E --> F[generateMCQ]
    F --> G[selfEval\nstructural + 4-criteria]
    G -->|eval fail · max 3x| F
    G -->|pass| H{presentQuestion\ninterrupt}
    H -->|answer submitted| I[grading]
    I -->|correct| J[resultNode]
    J -->|more objectives| E
    J -->|all done| K([completion · recap\nNeo4j prereq enrichment])
    I -->|wrong| L[hintNode]
    L --> H

    style B fill:#4a6fa5,color:#fff,stroke:#2d4f7c
    style C fill:#f0f,color:#fff,stroke:#c0c
    style D fill:#4a6fa5,color:#fff,stroke:#2d4f7c

    style E fill:#e07b39,color:#fff,stroke:#b05a1a
    style F fill:#e07b39,color:#fff,stroke:#b05a1a
    style G fill:#e07b39,color:#fff,stroke:#b05a1a
    style H fill:#f0f,color:#fff,stroke:#c0c
    style I fill:#e07b39,color:#fff,stroke:#b05a1a
    style J fill:#e07b39,color:#fff,stroke:#b05a1a

    style L fill:#2e7d52,color:#fff,stroke:#1a5c38
    style K fill:#2e7d52,color:#fff,stroke:#1a5c38
```

**Legend:** 🔵 Planner stage — 🟠 Quiz stage — 🟢 Tutor stage — 🟣 Interrupt (user pause)

### Key components

| Path | Purpose |
|---|---|
| `src/agent/graph.ts` | Compiled LangGraph state graph with PostgresSaver checkpointer |
| `src/agent/planner.ts` | Planner stage — plan generation + plan approval interrupt node |
| `src/agent/quiz.ts` | Quiz stage — MCQ generation, `critiqueMessages` self-eval loop, grading |
| `src/agent/tutor.ts` | Tutor stage — hint node (no answer key in context) + completion/recap |
| `src/agent/conceptGraph.ts` | Neo4j prerequisite edge writer (runs after plan approval) |
| `src/app/page.tsx` (route `/`) | Main app page — state-based interrupt detection, `resume()` via LangGraph HTTP |
| `src/app/api/chat/route.ts` | StudySidebar chat endpoint — separate from agent hints; answer-key isolated, quiz-only gate |
| `src/app/api/copilotkit/[[...slug]]/route.ts` | CopilotKit runtime endpoint (multi-route mode) |
| `src/app/api/langgraph/[...path]/route.ts` | LangGraph HTTP adapter — exposes local compiled graph |
| `src/app/api/test-db/route.ts` | DB + Neo4j connectivity health-check |
| `src/app/api/upload/route.ts` | PDF upload, text extraction, word-count + junk-doc validation |
| `src/app/api/validate-objective/route.ts` | Validates user-typed objectives against document content via Claude Haiku; returns `{ valid, hint }` |
| `src/components/CopilotProvider.tsx` | Client-side CopilotKit context provider — keyed per session so "Start new lesson" forces a fresh CopilotKit thread |
| `src/components/PlanApproval.tsx` | Plan review UI — editable objectives, inline edit, semantic validation of new objectives against source PDF, approve resumes graph |
| `src/components/QuizQuestion.tsx` | MCQ UI — wrong-answer panel, hint display, progress bar |
| `src/components/StudySidebar.tsx` | Chat sidebar — independent from agent hint path; withholds answers until quiz completion |
| `src/components/UploadForm.tsx` | PDF upload form with passcode gate and validation feedback |

### Data flow

1. User uploads PDF → `/api/upload` validates (word count: min 100, max 15,000 words; junk-doc heuristic), extracts text, stores in Postgres, returns `documentId`
2. Frontend sends `documentId` to CopilotKit → agent starts, loads `extractedText` from Postgres
3. **Planner stage** runs `generatePlan` — one LLM call over full PDF text → structured output: `objectives[]` + `prerequisites[]`
4. Graph hits `planApproval` interrupt → frontend detects via state poll, renders `PlanApproval` modal — user edits objectives inline; newly typed or edited objectives are validated against the document via `/api/validate-objective` before approval is allowed
5. User approves → frontend POSTs `command.resume` to LangGraph HTTP stream, drains SSE, syncs state
6. `writeConceptGraph` filters prerequisites against edited plan, writes `(:Objective)-[:PREREQUISITE_FOR]->(:Objective)` to Neo4j (8s timeout + fallback to list order)
7. **Quiz loop** per objective: `selectObjective` (Neo4j prereq ordering, list-order fallback) → **Quiz stage** `generateMCQ` → `selfEval` (deterministic structural checks first, then four-criteria binary LLM eval — unambiguous answer / plausible distractors / objective alignment / source grounding; injects `critiqueMessages` and regenerates if any criterion fails, max 3 attempts) → `presentQuestion` interrupt
8. User answers → frontend resumes graph → **Quiz stage** `grading` node evaluates against `answerKey` in state → writes `quiz_attempts` row to Postgres
9. Wrong answer → **Tutor stage** `hintNode` (answer key structurally excluded from context) → re-fires `presentQuestion` interrupt
10. Correct → `resultNode` → advance to next objective or `completion`
11. **Tutor stage** `completionNode` reads `quiz_attempts` from Postgres, splits `firstTry` vs `struggled`, enriches study tips via Neo4j prerequisite query (falls back to flat recap on failure)
12. **StudySidebar** chat (`/api/chat`) runs in parallel throughout — separate from the agent's hint path; uses LangChain `ChatAnthropic` directly; withholds answer keys until `quizComplete` state is true, enforced server-side

---

## Security properties

| Property | Guarantee | Mechanism |
|----------|-----------|-----------|
| Answer key cannot be extracted via chat | Sidebar `/api/chat` withholds answer until `quizComplete: true` | Server-side state check, not prompt instruction |
| Answer key not in client-visible state | `answerKey` stored in graph state but never serialised into `currentQuestion` | Structural separation at write time in `generateMCQNode` |
| Quiz cannot be skipped | No graph edge from `presentQuestion` to next objective without `grading` | LangGraph graph topology |
| Hint stage cannot see answer key | `hintNode` receives state with `answerKey` field present but never uses it in its prompt | Construction guarantee — field excluded from prompt context |
| MCQ structural flaws caught pre-LLM | Deterministic validator runs before self-eval LLM call | Pure TypeScript checks, no model dependency |

---

## Evaluation

### Self-eval quality gate

Every MCQ passes through two layers before a student sees it:

**Layer 1 — Deterministic structural checks (no LLM, no cost):**
- Exactly 4 distinct choices
- Question ≥ 10 words, ends with `?`
- Each choice ≥ 3 words
- No meta-options ("All of the above", "None of the above", "Both A and B")
- No answer leak (distractor text doesn't contain the correct choice as substring)

If any check fails → immediate regeneration with a specific critique. No LLM call spent.

**Layer 2 — Four-criteria binary LLM eval (`claude-haiku-4-5`):**
1. `unambiguous_answer` — exactly one correct answer
2. `plausible_distractors` — no obviously wrong choices
3. `tests_objective` — directly targets the stated learning objective
4. `grounded_in_passage` — correct answer derivable from source passage

All four must pass (`overallPass: true`). One weak distractor = regenerate with targeted critique. Max 3 total attempts. MCQs that hit the cap proceed with a `console.warn` — the quiz never blocks on quality.

Using binary per-criterion judgment (rather than a holistic 0–5 score) reduces correlated failure between generator and evaluator: each axis is evaluated independently, so a subtly flawed question can't average its way past a fatal weakness.

### Runtime metrics tracked (Postgres)

| Metric | Table |
|--------|-------|
| First-try correct rate per objective | `quiz_attempts` |
| Avg attempts per objective | `quiz_attempts` |
| Self-eval rounds per question | `mcq_eval_log` |
| Questions that hit eval cap | `mcq_eval_log.passed_cap` |

### Known eval gaps

- Citation grounding: `sourcePassage` is verified to appear verbatim in `extractedText` (normalised match) before the MCQ passes `selfEval`; if absent, triggers regeneration with critique. No byte-match against the raw PDF binary — `extractedText` is the extracted plain text
- Self-eval judge uses the same model family as the generator — correlated failures reduced (deterministic pre-checks + per-criterion binary judgment) but not eliminated
- No cross-session aggregate dashboard (future: LangSmith custom evals)

---

## Failure modes

| Failure | Behaviour |
|---------|-----------|
| Neo4j cold-start / timeout (~8s) | Falls back to list-order objective selection; quiz continues |
| `selfEval` cap reached (3 attempts) | Proceeds with best available MCQ; logs warning |
| PDF < 100 words or > 15,000 words | Rejected at upload with user-facing message |
| Junk / non-educational PDF | Heuristic rejection at upload |
| User types off-domain objective | Blocked at plan approval — `/api/validate-objective` checks against document content and shows a hint |
| Page refresh mid-quiz | Session resumes at same question via `localStorage` thread ID persistence |
| Page refresh before plan approval | Session resumes at plan approval screen if thread ID is stored |
| LangGraph checkpoint missing | Thread starts fresh; no recovery path |

---

## Why this is hard

**Stateful interrupts across process restarts.** LangGraph graphs pause mid-execution waiting for human input. The state must survive process restarts, deployments, and cold starts. Postgres checkpointer handles this — but it means every interrupt value must be serialisable and every resume must reconstruct exact graph position.

**Answer-key isolation without a trust boundary.** The answer key exists in graph state that all nodes can technically read. Keeping it away from the Tutor stage required routing it through a path the tutor node never reaches — verified by construction (the node never receives the key in its arguments) not just by instruction.

**Self-eval termination guarantee.** A quality loop that can run forever is a production incident. The cap at 3 attempts is a hard ceiling: if the LLM judge keeps failing, the quiz proceeds rather than blocks. Getting this wrong in either direction — too strict (blocks) or too loose (no cap) — breaks the user flow.

**Graceful graph degradation.** Two external databases (Postgres, Neo4j) can fail or time out mid-quiz. Every external call has a defined fallback — list-order for Neo4j, error propagation for Postgres. The graph never silently hangs.

**Streaming state to React without framework support.** CopilotKit's standard polling doesn't fit LangGraph's interrupt model. Resume requires posting `Command({ resume: value })` directly to the LangGraph HTTP stream and draining SSE until the next interrupt — implemented in `page.tsx` as a custom streaming loop.

---

### Environment variables

Create `.env.local` at `ai-lesson-agent/.env.local`:

```
# Supabase session pooler (port 5432) — Settings → Database → Connection string → Session pooler
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres

# Neo4j Aura
NEO4J_URI=neo4j+s://[id].databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-neo4j-password
NEO4J_DATABASE=neo4j
AURA_INSTANCEID=[id]
AURA_INSTANCENAME=Instance01

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# CopilotKit Cloud
COPILOT_CLOUD_PUBLIC_API_KEY=cpk-...

# Access Code to proceed with the lesson plan and quiz
ACCESS_CODE=anything-you-want

# LangGraph deployment URL (defaults to local /api/langgraph when unset)
LANGGRAPH_DEPLOYMENT_URL=http://localhost:3000/api/langgraph

# LangSmith — optional, enables agent tracing and eval dashboards
LANGSMITH_API_KEY=lsv2_...
```

### Observability

Set `LANGSMITH_API_KEY` to enable two things: agent traces (token costs, latency, per-node inputs/outputs visible per run) and MCQ eval dataset logging. After each self-eval pass, the question, choices, objective, and per-criterion results are logged to a `mcq-eval` dataset in LangSmith for offline analysis. Optional; the app runs without it (both features silently disabled).

`LANGGRAPH_DEPLOYMENT_URL` defaults to `http://localhost:3000/api/langgraph` (the local Next.js adapter). Point it at a LangGraph Cloud deployment URL to run the graph remotely instead.

### Installation & Setup

**Prerequisites:** Node.js 18+, a Supabase project, a Neo4j Aura instance, an Anthropic API key, and a CopilotKit Cloud account.

1. **Clone and install**
   ```bash
   git clone <repo-url>
   cd ai-lesson-agent
   npm install
   ```

2. **Get a CopilotKit Cloud key** — sign up at [cloud.copilotkit.ai](https://cloud.copilotkit.ai), create a project, and copy the public API key (`cpk-...`).

3. **Configure environment** — copy the variables above into `ai-lesson-agent/.env.local` and fill in your credentials:
   ```
   COPILOT_CLOUD_PUBLIC_API_KEY=cpk-<your-key>
   ```

4. **Run database migrations** — provisions Postgres tables and LangGraph checkpoint tables (run once):
   ```bash
   npx tsx scripts/migrate.ts
   ```

5. **Start the dev server**
   ```bash
   npm run dev
   ```
   App runs at [http://localhost:3000](http://localhost:3000).

6. **Run tests**
   ```bash
   npm test
   ```

---

## Known Issues & Future Improvements

### Page refresh mid-quiz (resolved)

Page refresh now resumes the session at the same question. The CopilotKit thread ID and minimal UI state (`documentId`, `phase`, `objectives`, `currentObjectiveIndex`) are persisted to `localStorage` on session start. On mount, the app reads the stored thread ID and restores state without re-uploading. Starting a new lesson clears the stored entry.

Expired or missing threads (e.g. after a server restart) fall through to the upload screen gracefully.

### Domain / learner history view

No history of past uploads is surfaced in the UI. A future improvement would add a `topic` column to the `documents` table, populate it after plan generation, and render a lightweight history panel on the homepage showing past document titles, topics, and timestamps.

---

## Credits

### Tooling & Plugins

- **[claude-mem](https://github.com/thedotmack/claude-mem)** — cross-session memory and observation tracking for Claude Code; used for session context, `/make-plan`, and `/do` workflows throughout this project
- **[caveman](https://github.com/juliusbrussee/caveman)** — token-efficient communication mode for Claude Code sessions
- **[ponytail](https://github.com/DietrichGebert/ponytail)** — lazy/minimal code generation discipline for Claude Code
- **[superpowers](https://github.com/super-superpowers/superpowers)** — structured skill system for Claude Code; used throughout for parallel subagent dispatch (`dispatching-parallel-agents`), systematic debugging, verification-before-completion, and plan execution workflows

### Scaffolding Approach

Project structure, governance docs (`PLAN.md`, `CONSTITUTION.md`), and the phased task breakdown in `tasks.md` were modelled on the **spec-kit** methodology — a structured planning approach used to produce implementation-ready specs before writing code. See: [https://github.com/github/spec-kit](https://github.com/github/spec-kit)
