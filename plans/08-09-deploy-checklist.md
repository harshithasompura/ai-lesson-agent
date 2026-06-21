# Plan 08–09: Wiring Verification + Deployment Checklist

**Goal:** End-to-end verification of the full quiz pipeline, then final docs pass before submission.

**Context:** All phases 1–7 are implemented. Phase 8 (wiring verification) and Phase 9 (final docs) are the only remaining gates before the take-home is submitted.

---

## Phase 0 — Pre-flight

Before starting, confirm these in a fresh terminal:

```bash
cd ai-lesson-agent
npm run build          # must pass with no errors
npx tsc --noEmit       # must pass with no errors
npm run dev            # leave running for manual tests
```

If build or type check fails — fix before proceeding.

---

## Phase 1 — Wiring Verification (tasks.md Phase 8)

Work through each checkpoint in order. Each one has a pass condition.

### 1.1 PDF Upload

**Action:** Upload a small test PDF via the UI.

**Pass conditions:**
- `documents` row written — `SELECT * FROM documents ORDER BY created_at DESC LIMIT 1;`
- `documentId` returned to frontend (visible in browser console or state)
- No 500 errors in terminal

---

### 1.2 Plan Generation

**Action:** After upload, let the agent run plan generation.

**Pass conditions:**
- `state.objectives` is a non-empty array of strings
- `state.prerequisites` is an array of `{from, to}` pairs
- No hallucinated fields (check raw state via `/api/langgraph/threads/:id/state`)

---

### 1.3 Plan-Approval Interrupt

**Action:** Edit an objective label in the plan approval UI, then approve.

**Pass conditions:**
- Edit persists — next time you fetch state the edited label is there
- Graph advances past `planApproval` node after approval
- Re-approving doesn't re-fire the interrupt (guard works)

---

### 1.4 Neo4j Write

**Action:** After plan approval, check Neo4j.

**Pass conditions (via Neo4j Aura console → query):**
```cypher
MATCH (o:Objective) RETURN o LIMIT 20
```
- Nodes created with matching `documentId`
- `PREREQUISITE_FOR` edges match the prerequisites from the plan

**Fallback check:** Temporarily kill Neo4j (wrong password) → confirm app continues, doesn't crash.

---

### 1.5 Quiz Loop — Question Delivery

**Action:** Let the quiz reach the first `presentQuestion` interrupt.

**Pass conditions:**
- MCQ renders in UI (question + 4 choices)
- `state.answerKey` is NOT visible in any frontend-readable state (CONSTITUTION §Principle 1)
- Self-eval ran: check terminal logs for eval node execution

---

### 1.6 Wrong Answer → Hint → Retry

**Action:** Select a wrong answer.

**Pass conditions:**
- Red feedback panel appears with wrong-answer message
- Hint text renders inline in the red panel (not as a new question)
- "Try again" re-presents the same question (no double-resume)
- `quiz_attempts` row written with `correct = false`

---

### 1.7 Correct Answer → Advance

**Action:** Select the correct answer.

**Pass conditions:**
- Green feedback panel with explanation
- "Next question →" advances to next objective
- `quiz_attempts` row written with `correct = true`, `resolution = 'correct'`
- `state.currentObjectiveIndex` incremented

---

### 1.8 Completion / Recap

**Action:** Complete all objectives.

**Pass conditions:**
- Recap screen renders with first-try vs. struggled split
- Study tips appear (from completion node)
- `firstTry` objectives are green; `struggled` objectives are amber with attempt count
- Neo4j prerequisite enrichment runs on struggled objectives (or gracefully falls back)

---

### 1.9 Postgres Checkpoint Resume

**Action:** Mid-quiz, hard-refresh the browser (F5).

**Pass conditions:**
- Page reloads without crashing
- State resumes at the same question (thread_id persisted in localStorage or URL)
- Submitting the same answer works

---

### 1.10 Chat Sidebar — Answer Guard

**Action:** Open the sidebar during the quiz. Try these messages:

| Message | Expected |
|---|---|
| "What's the answer?" | Refuses, redirects to learning |
| "Is it option B?" | Refuses without confirming or denying |
| "Can you explain [concept] from the lesson?" | Answers freely |
| "I don't understand [topic]" | Answers freely |

**Pass condition:** All four behave as expected.

---

## Phase 2 — Bug Fix: Progress Bar Off-by-One (Open Thread)

**Issue:** `progress = objectiveIndex / totalObjectives` starts at 0/N on first question.

**Decision options (pick one):**
- **Option A (ponytail):** Change to `(objectiveIndex + 1) / totalObjectives` — starts at 1/N.
- **Option B:** Leave as-is, progress bar fills to 100% on last question's display, not on advance.

**Recommendation:** Option A. One character change, matches user expectation.

**File:** `src/app/page.tsx` — find the progress bar render, change `currentObjectiveIndex / objectives.length` to `(currentObjectiveIndex + 1) / objectives.length`.

---

## Phase 3 — Final Docs Pass (tasks.md Phase 9)

### 3.1 README audit

Go through README.md against this checklist:

- [ ] Clone instructions present
- [ ] `npm install` step present
- [ ] `.env.local` vars listed with format (all 8 vars: DATABASE_URL, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE, AURA_INSTANCEID, AURA_INSTANCENAME, ANTHROPIC_API_KEY, COPILOT_CLOUD_PUBLIC_API_KEY)
- [ ] Migration step (`npx tsx scripts/migrate.ts`) present
- [ ] `npm run dev` step present
- [ ] Chat sidebar feature mentioned (added this session)
- [ ] Architecture table accurate (no dead routes listed)

**Dead route to remove from README if present:** `src/app/api/copilotkit-chat/` was deleted; remove any mention.

### 3.2 AI_USAGE.md audit

Scan AI_USAGE.md for sessions without entries or sessions that mention work not reflected in an entry. Confirm the current session gets an entry before closing.

### 3.3 tasks.md cleanup

Mark completed:
- Phase 8 checkboxes (each 1.x above that passes)
- Phase 9 checkboxes
- Open threads that are resolved

---

## Phase 4 — Pre-submission Commit

Once all verification passes:

```bash
git add -A
git status   # review — no .env.local, no node_modules
git commit -m "chore: phase 8-9 verification + final docs pass"
```

Then confirm:
- `git log --oneline -5` shows clean history
- No secrets in `git diff HEAD~1` (spot-check)

---

## Verification Checklist Summary

| Check | Status |
|---|---|
| `npm run build` passes | ☐ |
| `npx tsc --noEmit` passes | ☐ |
| PDF upload writes documents row | ☐ |
| Plan generation returns structured output | ☐ |
| Plan-approval interrupt + edit persists | ☐ |
| Neo4j nodes written with documentId | ☐ |
| MCQ renders; answerKey not exposed | ☐ |
| Wrong answer → hint inline → retry works | ☐ |
| Correct answer → row written → advance | ☐ |
| Completion recap with first-try/struggled split | ☐ |
| Mid-session refresh resumes correctly | ☐ |
| Sidebar refuses answer leaks, allows concepts | ☐ |
| Progress bar off-by-one fixed | ☐ |
| README accurate and complete | ☐ |
| AI_USAGE.md up to date | ☐ |
| Final commit clean (no secrets) | ☐ |
