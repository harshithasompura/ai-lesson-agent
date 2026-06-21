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
- [x] **State schema** — `src/agent/state.ts`; `GraphState` with: `documentId`, `extractedText`, `plan`, `planApproved`, `prerequisites`, `objectives`, `currentObjectiveIndex`, `currentQuestion`, `answerKey`, `attemptCount`, `evalAttemptCount`, `pendingAnswer`, `lastResult`, `lastHint`, `attempts[]`, `messages[]`

### 5b — Planner Agent
- [x] **System prompt** — sees: full PDF text, plan state. Never sees: quiz attempts, answer keys (CONSTITUTION §Principle 5)
- [x] **Plan-generation node** — single LLM call; structured output with `objectives[]` and `prerequisites: [{from, to}]`; write to state
- [x] **Self-eval on plan** — explicitly NOT built in phase 1 (PLAN.md §6); skip for now
- [x] **Plan-approval node** — `state.planApproved ?? interrupt({ type: "approval", content: plan })`; guard prevents re-firing on retry

### 5c — Concept graph write (after plan approval)
- [x] **Neo4j write step** — filter `prerequisites` list against user-edited objectives, write `(:Objective)-[:PREREQUISITE_FOR]->(:Objective)` nodes; timeout + fallback; runs once after plan-approval interrupt resumes

### 5d — Quiz Agent
- [x] **System prompt** — sees: approved plan, current objective, answer key it authors
- [x] **Select-next-objective step** — query Neo4j for unresolved objective with fewest unresolved prerequisites; fallback to list order
- [x] **MCQ generation node** — structured output: `{ question, choices[4], correctIndex, explanation }`; answer key written to state (isolated from Tutor)
- [x] **Self-eval node** — score MCQ on rubric; below threshold → regenerate with critique; cap: 3 total attempts via `evalAttemptCount`
- [x] **Present-question node** — `interrupt({ type: "quizAnswer", ... })`; clears `lastResult`/`lastHint` on resume
- [x] **Grading node** — compares `pendingAnswer` to `correctIndex`; writes `quiz_attempts` row; resolution `"correct" | null` (no reveal cap)

### 5e — Tutor Agent
- [x] **System prompt** — sees: question, objective, incorrect attempt, `attemptCount`. Structurally never sees answer key (CONSTITUTION §Principle 1)
- [x] **Hint node** — fires on every wrong answer; stores hint in `lastHint` state field (not messages); no attempt cap or reveal
- [x] **Retry loop** — wrong answer: `grading → hint → presentQuestion` (no extra interrupt, no double-resume); correct: `grading → resultNode → advance`
- [x] **Completion node** — reads `quiz_attempts` from Postgres; splits by `attempt_number`: `firstTry` (1 attempt) vs `struggled` (2+); Neo4j prerequisite enrichment on struggled objectives; personalised study tips

### 5e-pre — RESOLVED: attempts reducer vs. pending sentinel
> **Resolution:** `pendingAnswer: Annotation<number | null>()` in `GraphState`. `presentQuestionNode` writes `selectedIndex` to `pendingAnswer`; `gradingNode` reads from there.

### 5f — Graph wiring
- [x] **Graph assembly** — `src/agent/graph.ts`; all nodes wired; `PostgresSaver` checkpointer; correct→`resultNode`→advance; wrong→`hint`→`presentQuestion` loop
- [x] **`graph.streamEvents()`** — `Command({ resume })` for interrupt resume

---

## Phase 6 — CopilotKit runtime + frontend

- [x] **CopilotKit route** — `app/api/copilotkit/[[...slug]]/route.ts`; `CopilotRuntime` with `LangGraphAgent`; `createCopilotHonoHandler` with `mode: "multi-route"`
- [x] **`<CopilotKit>` provider** — `src/components/CopilotProvider.tsx` with `agent="ai-lesson-agent"`
- [x] **Plan-approval UI** — `src/components/PlanApproval.tsx`; parses plan JSON, renders objectives as numbered checklist
- [x] **Quiz UI** — `src/components/QuizQuestion.tsx`; interactive choices; wrong-answer feedback panel (red, no green reveal); "Try again" is local state only (no resume); correct shows green + explanation + "Next question →"
- [x] **Hint display** — `lastHint` from state renders inline in wrong-answer panel immediately after grading
- [x] **Interrupt resume** — `resume()` POSTs to `/api/langgraph/threads/:id/runs/stream`, drains SSE, GETs state
- [x] **LangGraph HTTP adapter** — `src/app/api/langgraph/[...path]/route.ts`; full platform API surface
- [x] **Score/recap screen** — `page.tsx`; reads `state.attempts` client-side; "First try ✓" (green) + "Needed more attempts" (amber, try count) + study tips from agent message

---

## Phase 7 — Constitution compliance audit

- [x] **Principle 1** — Tutor hint path never sees answerKey
- [x] **Principle 2** — advance only on `correct`; wrong always retries
- [x] **Principle 3** — `evalAttemptCount` caps MCQ regeneration at 3; no attempt cap on student retries (retry without penalty per spec)
- [x] **Principle 4** — `Promise.race` 1500ms timeout in `neo4j.ts`; all callers use `runNeo4j(..., fallback)`
- [x] **Principle 5** — Planner only sees `extractedText`; Tutor structurally excludes answerKey
- [x] **Principle 6** — PDF content in user turn, not system prompt
- [x] **Principle 7** — All Cypher queries include `documentId`
- [x] **Principle 8** — `interrupt()` in node functions, not tools
- [x] **Principle 9** — `completionNode` reads `quiz_attempts` from Postgres, not state

---

## Phase 8 — Wiring verification

- [ ] Upload a test PDF → confirm `documents` row written, `documentId` returned
- [ ] Plan generation → confirm structured output with `objectives` + `prerequisites`
- [ ] Plan-approval interrupt → confirm edits persist
- [ ] Neo4j write → confirm `(:Objective)` nodes created with correct `documentId`
- [ ] Quiz loop → confirm self-eval runs; MCQ reaches `quizAnswer` interrupt
- [ ] Wrong answer → confirm hint shown immediately in red panel; retry works without stuck/double-resume
- [ ] Correct answer → confirm `quiz_attempts` row written with `resolution: "correct"`, graph advances
- [ ] Completion → confirm `firstTry`/`struggled` split; study tips from Neo4j prerequisite query; fallback when Neo4j unreachable
- [ ] Postgres checkpoint → confirm mid-session refresh resumes correctly

---

## Phase 9 — Final docs pass

- [x] **README.md** — setup instructions complete; Mermaid architecture + agent flow diagrams added; `npm test` step added
- [x] **AI_USAGE.md** — all sessions have entries; no gaps

---

## Open threads

- [ ] **End-to-end live test** — full quiz loop (wrong → hint → retry → correct → next objective → completion) not verified against live backend; run once before submission
- [x] **Quiz progress bar off-by-one** — fixed: `(objectiveIndex + 1) / totalObjectives` in `QuizQuestion.tsx`
- [ ] **Phase 8 wiring verification** — grading row, Neo4j write, completion node not verified end-to-end
- [x] **Phase 9 README** — final pass done: chat sidebar documented, npm test added, Mermaid diagrams added, route table corrected, all components listed
- [x] **Delete dead route** — `src/app/api/copilotkit-chat/` deleted
- [ ] **Manual test: sidebar answer guard** — open sidebar during quiz, ask "what's the answer?" → should refuse and redirect; ask "is it option B?" → should refuse without confirming/denying; ask conceptual question → should answer freely
