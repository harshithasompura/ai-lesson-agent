# Plan 10 — Pre-Submission Polish

**Goal:** Five targeted improvements before submission, prioritised by evaluator impact.

---

## Priority ranking

| Pri | Item | Why it matters |
|-----|------|----------------|
| P0 | README overhaul | First thing reviewers read — needs to sell the system |
| P1 | HITL objective validation | Demo-breaking bug: gibberish can poison the entire quiz |
| P2 | PDF-grounded questions | Core credibility claim: questions must trace to source |
| P3 | Eval metrics (README + runtime) | Shows engineering rigour; metrics evaluators look for |
| P4 | Tutor source citations | Nice enhancement, low effort after P2 foundation |

---

## Phase 0: Discovery (read before any edit)

Files to read before touching code:

- `src/agent/planner.ts` — `generatePlanNode`, `planApprovalNode` (objective HITL)
- `src/agent/quiz.ts` — `generateMCQNode`, `selfEvalNode` (grounding, metrics)
- `src/agent/tutor.ts` — `hintNode` (citation surface)
- `src/agent/state.ts` — what fields exist; what to add
- `src/components/PlanApproval.tsx` — current objective edit UI
- `src/lib/db.ts` — `quiz_attempts` schema; what columns exist
- `README.md` — current structure to know what to rewrite vs keep

---

## Phase 1 (P0): README Overhaul

**Goal:** README leads with problems and outcomes, not tech stack. Architecture diagram appears once. Adds: design tradeoffs, failure modes, why-this-is-hard, eval section stub, quantitative stats.

### Structure (new order)

```
## The Problem  ← what is broken about single-LLM quiz apps
## What this does differently  ← outcomes, not stack
## Design decisions  ← why 3 agents / why Neo4j / structural vs prompt guarantees
## Architecture  ← diagram ONCE, data flow, key components (existing, collapsed)
## Evaluation  ← metrics tracked, self-eval behaviour, known gaps
## Failure modes  ← where it breaks and why
## Why this is hard  ← brief; show domain knowledge
## Setup  ← unchanged
## Known Issues  ← unchanged
```

### Content to write (not currently in README)

**Design decisions section:**

- *Why not one agent?* → Single agent can't structurally isolate the answer key from the hint path. With three agents, the Tutor Agent is constructed without answerKey in context — not a prompt instruction, a construction guarantee.
- *Why Neo4j?* → Prerequisite relationships are a graph, not a list. `PREREQUISITE_FOR` edges let `selectObjective` pick the question with fewest unresolved dependencies — a topological sort that degrades gracefully to list order on timeout/failure.
- *Why structural enforcement over prompting?* → Prompts can be argued around. Graph edges can't. No edge exists to skip a question; the Tutor Agent has no access path to the answer key.

**Failure modes section:**

- Cold Neo4j connection (~8 s timeout) → falls back to list-order objective selection; quiz still works
- `selfEval` cap reached (3 attempts) → proceeds with best available MCQ, logs warning; question may be lower quality
- PDF with < 200 words or junk content → rejected at upload with feedback
- Objective field accepts free text → user can poison quiz with off-domain objectives (see P1)
- Page refresh mid-quiz → graph state restored from Postgres; chat history lost (known issue)
- LLM citation hallucination → questions reference the objective, not page/paragraph; no citation guarantee pre-P2

**Why this is hard:**

- Interrupt-driven multi-agent systems require state that survives process restarts → Postgres checkpointer
- Structural answer-key isolation means routing state carefully so grading context never leaks to hint path
- Self-eval loop must terminate (cap at 3) even if every attempt scores below threshold
- Neo4j prerequisite ordering must degrade gracefully — a cold DB can't block the quiz
- Streaming graph output to a React UI requires draining SSE and syncing state without CopilotKit's standard polling

**Quantitative stats to add (measure before writing):**

```bash
# Run these against the codebase and fill in:
wc -l src/agent/*.ts src/components/*.tsx src/app/**/*.ts
grep -c "interrupt\|resume" src/agent/*.ts
# Self-eval pass threshold, max attempts, word-count limits — hardcode from code
```

### Verification

- README renders cleanly in GitHub preview
- Architecture diagram appears exactly once
- "The Problem" and "Failure modes" sections present

---

## Phase 2 (P1): HITL Objective Validation

**Goal:** When a user types or edits an objective in `PlanApproval`, validate it is semantically related to the uploaded document before allowing approval.

### What to build

**Server-side:** Add a new Next.js API route `POST /api/validate-objective` that:
1. Accepts `{ objective: string, documentId: string }`
2. Loads `extractedText` from Postgres (already stored at upload time)
3. Calls Claude with a short prompt: "Does this objective relate to the document? Answer yes/no and why."
4. Returns `{ valid: boolean, hint: string }` — hint shown to user when invalid

**Frontend (`PlanApproval.tsx`):**
- Call `/api/validate-objective` on blur or on "Add" action
- If `valid: false` → show `hint` inline under the field, block "Approve" button until resolved
- Existing LLM-generated objectives skip validation (they came from the document already)
- Only user-typed/edited objectives are validated

**Prompt for validation:**
```
You are validating a learning objective for a lesson based on a document.
Document summary (first 500 words): <excerpt>
Proposed objective: <objective>

Is this objective plausibly derived from or related to the document?
Answer JSON: {"valid": boolean, "hint": string}
hint = "" if valid, else a 1-sentence guidance like "This objective is about X which doesn't appear in the document. Try: <suggestion based on document>."
```

### State changes

- No graph state changes needed — validation is UI-only
- `planApproved` stays blocked until all objectives pass

### Verification

- Type "Introduction to quantum mechanics" on a French grammar PDF → blocked with hint
- Edit an existing LLM objective → validation runs on edit
- Approve with all valid objectives → proceeds normally

---

## Phase 3 (P2): PDF-Grounded Questions

**Goal:** MCQ generation includes exact source passages. Questions must cite where in the document the answer comes from.

### What to change

**`src/agent/state.ts`:** Add `sourceExcerpts: string[]` field — one per objective, populated during MCQ generation. These are the document passages the question was grounded in.

**`src/agent/quiz.ts` — `generateMCQNode`:**

Change MCQ schema to include `sourcePassage`:

```typescript
const MCQSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  sourcePassage: z.string(), // ← new: verbatim excerpt from document
});
```

Change QUIZ_SYSTEM prompt:
```
- sourcePassage must be a verbatim excerpt (≤ 3 sentences) from the document that directly supports the correct answer
- If no single passage supports it, quote the most relevant sentence
```

Change user prompt to include `extractedText` (already in state):
```typescript
content: `Document text:\n${state.extractedText.slice(0, 8000)}\n\nObjective: ${objective}\n\nWrite one MCQ grounded in the document.`
```

Store `sourcePassage` in `answerKey` JSON (it's answer-adjacent, not exposed to Tutor).

**`src/components/QuizQuestion.tsx`:** After a correct answer, show "Source: [sourcePassage]" collapsed under the explanation.

**`src/agent/tutor.ts` — `hintNode` (P4 prep):** Pass `sourcePassage` from last attempt record (stored in `quiz_attempts`) so the hint can reference the document section.

### DB change

Add `source_passage TEXT` column to `quiz_attempts`:
```sql
ALTER TABLE quiz_attempts ADD COLUMN source_passage TEXT;
```

Update `gradingNode` to write `sourcePassage` when inserting.

### Verification

- After a correct answer, source passage visible in UI
- `quiz_attempts.source_passage` populated in DB
- `selfEval` still uses same scoring criteria (no change needed)

---

## Phase 4 (P3): Eval Metrics

**Goal:** Record and surface three metrics. Add an Evaluation section to README.

### Metrics to capture (all derivable from existing `quiz_attempts` table)

| Metric | Query |
|--------|-------|
| % questions answered correctly on first try | `COUNT(*) FILTER (WHERE attempt_number=1 AND resolution='correct') / COUNT(DISTINCT objective_index)` |
| Average attempts per objective | `AVG(attempt_number) FILTER (WHERE resolution='correct')` |
| Self-eval pass rate | Already logged as `evalAttemptCount` in state — add to `quiz_attempts` or a separate `mcq_eval_log` table |

### What to add

**New table `mcq_eval_log`** (minimal):
```sql
CREATE TABLE mcq_eval_log (
  id SERIAL PRIMARY KEY,
  document_id TEXT,
  objective_index INT,
  eval_attempts INT,        -- how many selfEval rounds before pass
  final_score INT,          -- score of the passing MCQ
  passed_cap BOOLEAN        -- true if accepted despite low score
);
```

Write to this in `selfEvalNode` when the question is accepted (either passes threshold or hits cap).

**README Evaluation section** (add after Architecture):
```markdown
## Evaluation

### Self-eval quality gate

Every generated MCQ passes through a second LLM call (Haiku) that scores it 0–5 on:
- Unambiguous correct answer
- Plausible distractors
- Objective alignment

Pass threshold: ≥ 3. Max regeneration attempts: 3. MCQs that reach the cap proceed with a console warning.

### Runtime metrics (per session, Postgres)

| Metric | Where |
|--------|-------|
| First-try correct rate | `quiz_attempts` |
| Avg attempts per objective | `quiz_attempts` |
| Self-eval rounds per question | `mcq_eval_log` |
| Questions that hit eval cap | `mcq_eval_log.passed_cap` |

### Known eval gaps

- No citation verification: `sourcePassage` is LLM-asserted, not diff'd against the raw PDF bytes
- Self-eval judge uses the same model family as the generator — correlated failures possible
- No cross-session aggregate dashboard (future: LangSmith traces + custom evals)
```

### Verification

- `mcq_eval_log` table exists and gets rows after a quiz run
- README Evaluation section renders
- `quiz_attempts` query above returns plausible numbers

---

## Phase 5 (P4): Tutor Source Citations

**Goal:** Hint response includes a document reference so the student knows where to look.

### What to change

`src/agent/tutor.ts` — `hintNode`:
- Query `quiz_attempts` for the `source_passage` of the current objective's MCQ (written in P2)
- Include it in the tutor prompt: "The answer is supported by this passage from the document: [sourcePassage]"
- HINT_SYSTEM update: "After your hint, add: 'Refer to: [brief passage reference]'"

Change `HintSchema` to include optional `sourceRef`:
```typescript
const HintSchema = z.object({
  hint: z.string(),
  sourceRef: z.string().optional(),
});
```

`QuizQuestion.tsx`: Display `sourceRef` below the hint in italics.

### Verification

- Wrong answer → hint shows with source reference
- `sourceRef` absent gracefully if `source_passage` is null (pre-P2 sessions)

---

---

## Phase 6: Final Docs Sweep

**Goal:** One last read of every `.md` file before submission. Fix stale content, inconsistencies, broken links. No new features.

### Files to audit in order

| File | What to check |
|------|---------------|
| `README.md` | Post-phase-1 pass: headings flow, no duplicate sections, architecture diagram renders, env var table complete, no "TODO" or stub text left |
| `PLAN.md` | Locked — read only. Flag to user if anything is now actively misleading |
| `SYSTEM_DESIGN.md` | Locked — read only. Flag open questions that were resolved during implementation |
| `CONSTITUTION.md` | Verify every principle is still upheld by current code (spot-check: answerKey isolation, selfEval cap, documentId scoping) |
| `AI_USAGE.md` | Ensure final session entry is appended |
| `tasks.md` | Mark all completed tasks done; remove stale in-progress items |
| `plans/*.md` | No action needed — historical record, leave as-is |

### README final checklist

- [ ] "The Problem" section present and leads the doc
- [ ] Architecture diagram appears exactly once
- [ ] Design decisions section covers: why 3 agents, why Neo4j, structural vs prompt guarantees
- [ ] Evaluation section present with metric table
- [ ] Failure modes section present
- [ ] "Why this is hard" section present
- [ ] Known Issues section accurate (remove any that were fixed in this plan)
- [ ] All env vars in the table match `.env.example`
- [ ] No placeholder text, stale dates, or broken markdown

### CONSTITUTION spot-check

grep the codebase before signing off:

```bash
# answerKey never in tutor context
grep -n "answerKey" src/agent/tutor.ts  # should return nothing

# selfEval cap still 3
grep -n "evalAttemptCount >= 3" src/agent/quiz.ts

# documentId on every Neo4j query
grep -c "documentId" src/agent/quiz.ts src/agent/tutor.ts src/agent/conceptGraph.ts
```

### Verification

- All `.md` files read through at least once
- README renders cleanly on GitHub (check heading hierarchy, code blocks closed)
- No locked file edited without approval
- `AI_USAGE.md` has entry for this session

---

## Execution order

1. Phase 1 (README) — no code risk, highest evaluator impact
2. Phase 2 (HITL validation) — self-contained new route + UI guard
3. Phase 3 (grounded questions) — schema + prompt change, needs DB migration
4. Phase 4 (metrics) — new table + README section
5. Phase 5 (citations) — depends on Phase 3 (sourcePassage in DB)
6. Phase 6 (docs sweep) — always last; nothing to implement

Each phase is independently reviewable. Phases 3–5 share the `source_passage` DB column — do Phase 3 first.
