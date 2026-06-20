# tasks.md — Implementation Checklist

Each task has a one-liner on what to install, create, or do. Work top-to-bottom; later tasks assume earlier ones are done.

> **Session close rule (every phase):** Before ending any session, append an entry to `AI_USAGE.md` (format in CLAUDE.md) and update `README.md` if the phase added/changed a feature, dependency, or setup step.

---

## Phase 0 — Accounts & Services

- [x] **Neo4j Aura** — free-tier instance created at [console.neo4j.io](https://console.neo4j.io); copy URI, username, password to `.env.local`
- [x] **Supabase (Postgres)** — project created at [supabase.com](https://supabase.com); use the **session pooler** connection string: `Settings → Database → Connection string → Session pooler` (port 5432); copy to `.env.local` as `DATABASE_URL`
- [x] **Anthropic API key** — get from [console.anthropic.com](https://console.anthropic.com/settings/keys); add to `.env.local` as `ANTHROPIC_API_KEY`
- [x] **CopilotKit Cloud** — account created at [cloud.copilotkit.ai](https://cloud.copilotkit.ai); copy `COPILOT_CLOUD_PUBLIC_API_KEY` to `.env.local`

---

## Phase 1 — Repo scaffold

- [x] **Next.js app** — `npx create-next-app@latest ai-lesson-agent --ts --tailwind --app --src-dir --import-alias "@/*"`
- [x] **`.env.local`** — create at project root; add `DATABASE_URL`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `ANTHROPIC_API_KEY`, `COPILOT_CLOUD_PUBLIC_API_KEY`
- [x] **`.gitignore`** — confirm `.env*` and `node_modules` are excluded (Next.js scaffold does this; verify)

---

## Phase 2 — Core dependencies

Install all at once:

```bash
npm install \
  @copilotkit/react-core @copilotkit/react-ui @copilotkit/runtime \
  @langchain/langgraph @langchain/langgraph-checkpoint-postgres @langchain/anthropic \
  langchain \
  neo4j-driver \
  pg \
  unpdf \
  zod
npm install -D @types/pg
```

| Package | What it does |
|---|---|
| `@copilotkit/react-core` | `useCoAgent`, `useInterrupt` hooks — AG-UI client |
| `@copilotkit/react-ui` | `<CopilotKit>` provider + chat sidebar |
| `@copilotkit/runtime` | Server-side AG-UI runtime (Next.js route handler) |
| `@langchain/langgraph` | Graph engine — nodes, edges, `interrupt()`, `Command` |
| `@langchain/langgraph-checkpoint-postgres` | `PostgresSaver` — durable graph checkpointing |
| `@langchain/anthropic` | `ChatAnthropic` model class |
| `langchain` | Base message types, prompt templates |
| `neo4j-driver` | Official Neo4j JS/TS driver (Node 18+ required) |
| `pg` | Postgres client; `pg.Pool` shared across app + checkpointer |
| `unpdf` | PDF text extraction (async, TypeScript-native) |
| `zod` | Schema validation for structured LLM outputs |

---

## Phase 3 — Database setup

- [x] **Postgres tables** — run migration to create `documents(id, filename, extracted_text, created_at)` and `quiz_attempts(id, document_id, objective_id, question, choices jsonb, selected, correct boolean, attempt_number, resolution, created_at)`
- [x] **PostgresSaver setup** — call `await checkpointer.setup()` once at app startup (provisions LangGraph checkpoint tables in the same DB)
- [x] **Neo4j schema** — no migration needed; nodes/edges are created at runtime. Confirm Aura instance is reachable with a test `driver.verifyConnectivity()` call

---

## Phase 4 — PDF upload + extraction

- [x] **Upload route** — `app/api/upload/route.ts`; accept `multipart/form-data`, extract text with `unpdf`'s `extractText(buffer)`, write row to `documents` table, return `documentId`
- [x] **Upload UI** — `src/components/UploadForm.tsx`; file input (PDF only), POST to `/api/upload`, store `documentId` in component state

---

## Phase 5 — LangGraph agent graph

### 5a — Shared infrastructure
- [x] **Postgres pool** — `src/lib/db.ts`; single `new pg.Pool({ connectionString })` export
- [x] **Neo4j driver** — `src/lib/neo4j.ts`; single `neo4j.driver(uri, neo4j.auth.basic(user, pass))` export; wrap every call with ~1.5s timeout + fallback per CONSTITUTION §Principle 4
- [x] **State schema** — `src/agent/state.ts`; define `GraphState` with Zod or `Annotation`: `documentId`, `extractedText`, `plan`, `planApproved`, `prerequisites`, `objectives`, `currentObjectiveIndex`, `currentQuestion`, `answerKey`, `attemptCount`, `evalAttemptCount`, `attempts[]`, `messages[]`

### 5b — Planner Agent
- [x] **System prompt** — sees: full PDF text, plan state. Never sees: quiz attempts, answer keys (CONSTITUTION §Principle 5)
- [x] **Plan-generation node** — single LLM call; structured output with `objectives[]` and `prerequisites: [{from, to}]`; write to state
- [x] **Self-eval on plan** — explicitly NOT built in phase 1 (PLAN.md §6); skip for now
- [x] **Plan-approval node** — `state.planApproved ?? interrupt({ type: "approval", content: plan })`; guard prevents re-firing on retry

### 5c — Concept graph write (after plan approval)
- [x] **Neo4j write step** — filter `prerequisites` list against user-edited objectives (drop edges referencing removed objectives), write `(:Objective)-[:PREREQUISITE_FOR]->(:Objective)` nodes; wrapped with timeout + fallback; runs once after plan-approval interrupt resumes

### 5d — Quiz Agent
- [x] **System prompt** — sees: approved plan, current objective, answer key it authors. Quiz Agent owns the answer key
- [x] **Select-next-objective step** — query Neo4j for unresolved objective with fewest unresolved prerequisites; fallback to list order on timeout/error/cycle
- [x] **MCQ generation node** — structured output: `{ question, choices[4], correctIndex, explanation }`; answer key written to Quiz Agent's state slice only
- [x] **Self-eval node** — score generated MCQ on rubric (unambiguous answer, plausible distractors, objective alignment); below threshold → regenerate with critique; cap: 2 regenerations (3 total), tracked via `evalAttemptCount` in state (CONSTITUTION §Principle 3)
- [x] **Present-question node** — `interrupt({ type: "quizAnswer", objective, question, choices })`; guarded
- [x] **Grading node** — Quiz Agent compares `selected` to `correctIndex`; writes `quiz_attempts` row to Postgres

### 5e — Tutor Agent
- [x] **System prompt** — sees: question, objective, incorrect attempt, `attemptCount`. Structurally never sees answer key (CONSTITUTION §Principle 1)
- [x] **Hint node** — triggered on incorrect + `attemptCount < 3`; returns hint only; on `attemptCount === 3` returns full explanation + correct answer and marks resolution `revealed`
- [x] **Retry loop edge** — `attemptCount < 3` → re-fire `quizAnswer` interrupt; `attemptCount >= 3` → advance to next objective (CONSTITUTION §Principle 2 + 3)
- [x] **Completion node** — reads `quiz_attempts` rows from Postgres (not agent memory, CONSTITUTION §Principle 9); attempts Neo4j read for prerequisite enrichment on struggled objectives; fallback to flat recap

### 5e-pre — RESOLVED: attempts reducer vs. pending sentinel

> **Resolution:** Option 1 applied. `pendingAnswer: Annotation<number | null>()` added to `GraphState` in `state.ts`. `presentQuestionNode` writes `selectedIndex` to `pendingAnswer`; `gradingNode` reads from there. No sentinel in `attempts` reducer.

### 5f — Graph wiring
- [x] **Graph assembly** — `src/agent/graph.ts`; wire all nodes with `StateGraph`, attach `PostgresSaver` as checkpointer, export compiled graph
- [x] **Use `graph.streamEvents()`** — switched from `graph.stream(streamMode:"values")` to `graph.streamEvents({ version: "v2" })`; emits LangChain event format consumed by `@ag-ui/langgraph` SDK; `Command({ resume })` used for interrupt resume

---

## Phase 6 — CopilotKit runtime + frontend

- [x] **CopilotKit route** — `app/api/copilotkit/[[...slug]]/route.ts`; `CopilotRuntime` with `LangGraphAgent` registered; switched to `createCopilotHonoHandler` (`@copilotkit/runtime/v2/hono`) with `mode: "multi-route"` so GET `/threads` resolves (was 405 with single-route mode)
- [x] **`<CopilotKit>` provider** — `src/components/CopilotProvider.tsx` wraps children with `<CopilotKit runtimeUrl="/api/copilotkit" agent="ai-lesson-agent">`; imported in `app/layout.tsx`
- [x] **Plan-approval UI** — `src/components/PlanApproval.tsx`; pure controlled component `({ plan, onApprove })`; rendered from `page.tsx` when `state.plan && !state.planApproved && !running`
- [x] **Quiz UI** — `src/components/QuizQuestion.tsx`; pure controlled component `({ question, choices, onSelect })`; rendered from `page.tsx` when `state.planApproved && state.currentQuestion && !running`
- [x] **Interrupt resume** — `resume()` helper in `page.tsx` POSTs `{ command: { resume } }` to `/api/langgraph/threads/:id/runs/stream` directly, drains SSE, then GETs `/threads/:id/state` to sync React state; bypasses CopilotKit interrupt hooks entirely (required — hooks only render inside `CopilotChat` UI)
- [x] **LangGraph HTTP adapter** — `src/app/api/langgraph/[...path]/route.ts`; implements full LangGraph Platform HTTP API surface needed by `@langchain/langgraph-sdk` Client: `POST /assistants/search`, `GET /assistants/:id`, `GET /assistants/:id/schemas`, `GET /assistants/:id/graph`, `GET|POST /threads`, `GET /threads/:id`, `GET /threads/:id/state`, `PUT /threads/:id/state`, `POST /threads/:id/runs/stream`
- [ ] **`useCopilotChat` sendMessage** — currently using deprecated `appendMessage` alias; upgrade path: once interrupt resume proven stable, consider triggering agent via state rather than chat message
- [ ] **Hint display** — render hint/explanation inline in the quiz UI when returned from Tutor Agent (Tutor Agent node exists; UI not wired)
- [ ] **Score/recap screen** — render completion node output (per-objective `correct`/`revealed` breakdown + study tips)
- [ ] **End-to-end smoke test** — plan approval modal confirmed rendering ✓; resume was posting to wrong thread (CopilotKit threadId ≠ LangGraph threadId) — fixed via `GET /api/langgraph/active-thread`; quiz flow after approval not yet confirmed

---

## Phase 7 — Constitution compliance audit

Run these checks before calling the build done:

- [ ] **Principle 1** — grep Tutor Agent's prompt-assembly function; confirm answer key string never appears in its inputs
- [ ] **Principle 2** — confirm no graph edge advances past a quiz node except `correct` or `revealed` resolution; no agent tool named `skip*` or `advance*`
- [ ] **Principle 3** — confirm `evalAttemptCount` cap (≤3) and `attemptCount` cap (≤3) are tracked as explicit state fields; neither inferred from node re-entry count
- [ ] **Principle 4** — confirm every Neo4j call has `Promise.race([neoCall, timeout(1500)])` and a fallback branch
- [ ] **Principle 5** — confirm Planner Agent state slice excludes attempt data; Quiz Agent state slice excludes Planner prompt; Tutor Agent state slice excludes answer key
- [ ] **Principle 6** — confirm extracted PDF text lands in a delimited user-content block, never interpolated into system prompt strings
- [ ] **Principle 7** — grep all Cypher queries; confirm every query includes a `documentId` filter parameter
- [ ] **Principle 8** — confirm both `interrupt()` calls are in graph nodes, not tool definitions; confirm frontend uses `useInterrupt` not `useHumanInTheLoop`
- [ ] **Principle 9** — confirm completion node reads from `quiz_attempts` table directly, not `state.messages` or agent recall

---

## Phase 8 — Wiring verification

- [ ] Upload a test PDF → confirm `documents` row written, `documentId` returned
- [ ] Plan generation → confirm structured output with `objectives` + `prerequisites` fields
- [ ] Plan-approval interrupt → confirm `useInterrupt` fires, edits persist through `resolve(editedPlan)`
- [ ] Neo4j write → confirm `(:Objective)` nodes created with correct `documentId`; filtered edges match post-edit objective list
- [ ] Quiz loop → confirm self-eval runs before question is shown; confirm MCQ reaches `quizAnswer` interrupt
- [ ] Correct answer → confirm `quiz_attempts` row written with `resolution: "correct"`, graph advances
- [ ] 3 wrong answers → confirm hint on attempts 1–2, reveal on attempt 3, `resolution: "revealed"`, graph advances
- [ ] Completion → confirm recap built from Postgres rows; confirm Neo4j study-tip enrichment fires (and fallback works when Neo4j is unreachable)
- [ ] Postgres checkpoint → confirm mid-session refresh resumes correctly (same `threadId`)

---

## Phase 9 — Final docs pass

- [ ] **README.md** — verify setup instructions are complete and accurate end-to-end: clone, `npm install`, `.env.local` vars, `npm run dev`
- [ ] **AI_USAGE.md** — confirm all sessions have entries; no gaps
