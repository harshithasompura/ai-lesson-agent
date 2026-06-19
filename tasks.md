# tasks.md — Implementation Checklist

Each task has a one-liner on what to install, create, or do. Work top-to-bottom; later tasks assume earlier ones are done.

> **Session close rule (every phase):** Before ending any session, append an entry to `AI_USAGE.md` (format in CLAUDE.md) and update `README.md` if the phase added/changed a feature, dependency, or setup step.

---

## Phase 0 — Accounts & Services

- [x] **Neo4j Aura** — free-tier instance created at [console.neo4j.io](https://console.neo4j.io); copy URI, username, password to `.env.local`
- [x] **Supabase (Postgres)** — project created at [supabase.com](https://supabase.com); use the **direct** connection string (not the pooler URL) for `PostgresSaver` compatibility: `Settings → Database → Connection string → URI` (port 5432); copy to `.env.local` as `DATABASE_URL`
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

- [ ] **Postgres tables** — run migration to create `documents(id, filename, extracted_text, created_at)` and `quiz_attempts(id, document_id, objective_id, question, choices jsonb, selected, correct boolean, attempt_number, resolution, created_at)`
- [ ] **PostgresSaver setup** — call `await checkpointer.setup()` once at app startup (provisions LangGraph checkpoint tables in the same DB)
- [ ] **Neo4j schema** — no migration needed; nodes/edges are created at runtime. Confirm Aura instance is reachable with a test `driver.verifyConnectivity()` call

---

## Phase 4 — PDF upload + extraction

- [ ] **Upload route** — `app/api/upload/route.ts`; accept `multipart/form-data`, extract text with `unpdf`'s `extractText(buffer)`, write row to `documents` table, return `documentId`
- [ ] **Upload UI** — `src/components/UploadForm.tsx`; file input (PDF only), POST to `/api/upload`, store `documentId` in component state

---

## Phase 5 — LangGraph agent graph

### 5a — Shared infrastructure
- [ ] **Postgres pool** — `src/lib/db.ts`; single `new pg.Pool({ connectionString })` export
- [ ] **Neo4j driver** — `src/lib/neo4j.ts`; single `neo4j.driver(uri, neo4j.auth.basic(user, pass))` export; wrap every call with ~1.5s timeout + fallback per CONSTITUTION §Principle 4
- [ ] **State schema** — `src/agent/state.ts`; define `GraphState` with Zod or `Annotation`: `documentId`, `extractedText`, `plan`, `planApproved`, `prerequisites`, `objectives`, `currentObjectiveIndex`, `currentQuestion`, `answerKey`, `attemptCount`, `evalAttemptCount`, `attempts[]`, `messages[]`

### 5b — Planner Agent
- [ ] **System prompt** — sees: full PDF text, plan state. Never sees: quiz attempts, answer keys (CONSTITUTION §Principle 5)
- [ ] **Plan-generation node** — single LLM call; structured output with `objectives[]` and `prerequisites: [{from, to}]`; write to state
- [ ] **Self-eval on plan** — explicitly NOT built in phase 1 (PLAN.md §6); skip for now
- [ ] **Plan-approval node** — `state.planApproved ?? interrupt({ type: "approval", content: plan })`; guard prevents re-firing on retry

### 5c — Concept graph write (after plan approval)
- [ ] **Neo4j write step** — filter `prerequisites` list against user-edited objectives (drop edges referencing removed objectives), write `(:Objective)-[:PREREQUISITE_FOR]->(:Objective)` nodes; wrapped with timeout + fallback; runs once after plan-approval interrupt resumes

### 5d — Quiz Agent
- [ ] **System prompt** — sees: approved plan, current objective, answer key it authors. Quiz Agent owns the answer key
- [ ] **Select-next-objective step** — query Neo4j for unresolved objective with fewest unresolved prerequisites; fallback to list order on timeout/error/cycle
- [ ] **MCQ generation node** — structured output: `{ question, choices[4], correctIndex, explanation }`; answer key written to Quiz Agent's state slice only
- [ ] **Self-eval node** — score generated MCQ on rubric (unambiguous answer, plausible distractors, objective alignment); below threshold → regenerate with critique; cap: 2 regenerations (3 total), tracked via `evalAttemptCount` in state (CONSTITUTION §Principle 3)
- [ ] **Present-question node** — `interrupt({ type: "quizAnswer", objective, question, choices })`; guarded
- [ ] **Grading node** — Quiz Agent compares `selected` to `correctIndex`; writes `quiz_attempts` row to Postgres

### 5e — Tutor Agent
- [ ] **System prompt** — sees: question, objective, incorrect attempt, `attemptCount`. Structurally never sees answer key (CONSTITUTION §Principle 1)
- [ ] **Hint node** — triggered on incorrect + `attemptCount < 3`; returns hint only; on `attemptCount === 3` returns full explanation + correct answer and marks resolution `revealed`
- [ ] **Retry loop edge** — `attemptCount < 3` → re-fire `quizAnswer` interrupt; `attemptCount >= 3` → advance to next objective (CONSTITUTION §Principle 2 + 3)
- [ ] **Completion node** — reads `quiz_attempts` rows from Postgres (not agent memory, CONSTITUTION §Principle 9); attempts Neo4j read for prerequisite enrichment on struggled objectives; fallback to flat recap

### 5f — Graph wiring
- [ ] **Graph assembly** — `src/agent/graph.ts`; wire all nodes with `StateGraph`, attach `PostgresSaver` as checkpointer, export compiled graph
- [ ] **Use `graph.stream()`** — not `graph.invoke()`; read `__interrupt__` key from chunks (PLAN.md §8 watchpoints)

---

## Phase 6 — CopilotKit runtime + frontend

- [ ] **CopilotKit route** — `app/api/copilotkit/route.ts`; `CopilotRuntime` with LangGraph agent registered; `agentId` must exactly match what `useInterrupt` uses on the frontend (PLAN.md §8 watchpoint)
- [ ] **`<CopilotKit>` provider** — wrap `app/layout.tsx` with `<CopilotKit runtimeUrl="/api/copilotkit">`
- [ ] **Plan-approval UI** — `src/components/PlanApproval.tsx`; `useInterrupt({ agentId, enabled: e => e.type === "approval", render: ({event, resolve}) => ... })`; editable text area for objectives; `resolve(editedPlan)` on submit
- [ ] **Quiz UI** — `src/components/QuizQuestion.tsx`; `useInterrupt({ agentId, enabled: e => e.type === "quizAnswer", render: ... })`; render MCQ choices; `resolve(selectedIndex)` on selection
- [ ] **Hint display** — render hint/explanation inline in the quiz UI when returned from Tutor Agent
- [ ] **Score/recap screen** — render completion node output (per-objective `correct`/`revealed` breakdown + study tips)

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
