# Plan 01 — Post-Deployment Fixes & Improvements

## Priority Assignment

| # | Issue | Priority | Rationale |
|---|-------|----------|-----------|
| 5 | Neo4j graph not writing for new documents | **P0 — Critical** | Core feature (concept graph) is silently broken; existing data is stale |
| 2 | Chat sidebar: raw `**markdown**` + no clear on question change | **P1 — High** | Visible functional bug affecting every quiz session |
| 1 | PDF validation: image-only / invoice / thin PDFs pass unchecked | **P1 — High** | Silent bad input causes downstream LLM garbage or crashes |
| 4 | Rate limiting for public URL | **P2 — Medium** | App is live and public; abuse vector is real but not yet observed |
| 3 | Objective context-match check on "Add objective" | **P3 — Low** | UX refinement; current behavior is harmless |
| 6 | Domain history / learner history view | **P3 — Low** | New feature; no blocking dependency |

---

## Phase 0 — Documentation Discovery

Before any implementation, read:

- `src/lib/neo4j.ts` — `runNeo4j` wrapper, timeout, fallback behavior
- `src/agent/conceptGraph.ts` — `writeConceptGraphNode`, MERGE logic, `documentId` scoping
- `src/agent/graph.ts` — LangGraph node order; confirm `writeConceptGraphNode` is wired
- `src/app/api/upload/route.ts` — current PDF validation logic
- `src/components/StudySidebar.tsx` — message rendering, `currentQuestion` prop wiring
- `src/components/QuizQuestion.tsx` — how `currentQuestion` is passed to sidebar
- `src/app/page.tsx` — question index state, sidebar prop threading

**Deliverable:** Annotated findings block confirming exact line numbers for each bug site before touching code.

---

## Phase 1 — P0: Fix Neo4j Graph Writes

**Problem:** `writeConceptGraphNode` uses a 1500ms timeout. Cold Neo4j connections on Vercel serverless easily exceed this; the fallback silently returns `{}` and the write never lands. With 81 nodes already in the DB the issue is masked — new uploads get no graph.

**Root cause candidates (verify in order):**
1. 1500ms timeout too short for cold Vercel→Neo4j TCP handshake
2. `executeWrite` inside `Promise.race` — the race resolves to `fallback` but the write may still be in-flight and then fail silently
3. `NEO4J_URI` / credentials env vars missing or wrong on Vercel (check Vercel dashboard → Environment Variables)

**Tasks:**
1. Increase timeout to 8000ms (Vercel function default is 10s; 8s leaves headroom)
2. Add structured error logging inside the catch: `console.error("[neo4j] write failed", { documentId, error: err.message })` so Vercel logs capture failures
3. Add a `GET /api/test-db` style health-check for Neo4j: `RETURN 1` ping, log latency — use to confirm connectivity from Vercel
4. After env fix confirmed, run the migration script `src/scripts/migrate-neo4j-document-ids.ts` to backfill any broken docs

**Files to edit:**
- `src/lib/neo4j.ts` — increase timeout, improve error log
- `src/agent/conceptGraph.ts` — add per-write error log (don't swallow silently)

**Verification:**
```bash
# After deploy, upload a new PDF, then:
curl https://<your-url>/api/test-db   # should show neo4j ping OK
# In Neo4j Aura console: MATCH (o:Objective) RETURN count(o) — should increment
```

---

## Phase 2 — P1: Fix Chat Sidebar Bugs

### Bug A — Raw markdown rendered as text (`**keyword**`)

`StudySidebar.tsx` renders `{m.content}` as a plain string in a `<div>`. The LLM returns markdown; no parser is applied.

**Fix:** Install `react-markdown` (already a common dep — check `package.json` first). Replace the content `<div>` with `<ReactMarkdown>`. If `react-markdown` is not installed, use a minimal inline parser for bold/italic only (5 lines, no dep).

```tsx
// Before
{m.content || <span className="animate-pulse">…</span>}

// After (if react-markdown available)
import ReactMarkdown from "react-markdown";
// ...
<ReactMarkdown className="prose prose-sm max-w-none">{m.content}</ReactMarkdown>
```

### Bug B — Messages persist across question changes

When `currentQuestion` prop changes (user moves to next quiz question), `messages` state is NOT cleared. The user sees the previous question's conversation.

**Fix:** Add a `useEffect` that watches `currentQuestion` and resets `messages` to `[]`.

```tsx
useEffect(() => {
  setMessages([]);
}, [currentQuestion]);
```

**Files to edit:** `src/components/StudySidebar.tsx`

**Verification:** Manually advance quiz questions; confirm chat clears. Confirm markdown bold renders correctly.

---

## Phase 3 — P1: PDF Validation Hardening

**Current state:** Upload route checks `!text.trim()` (empty text). Does NOT catch:
- Image-only PDFs (scanned, no text layer) — `extractText` returns `""` → already caught ✓
- Invoices / non-educational PDFs — text exists but content is garbage for lesson generation
- Single-page / very short PDFs — technically extractable but won't produce a quiz

**Fix:**

```ts
// After existing empty-text check, add:
const wordCount = text.trim().split(/\s+/).length;
if (wordCount < 100) {
  return NextResponse.json(
    { error: "PDF too short — needs at least ~100 words of educational content" },
    { status: 422 }
  );
}
```

For image-heavy PDFs: `unpdf`'s `extractText` already returns `""` for image-only pages. The existing empty check handles this. Add a user-facing error message that explains *why* it failed (not just "extraction failed").

**Optional heuristic (low-effort, high-value):** Check for common invoice/form keywords in the first 200 chars:
```ts
const JUNK_PATTERNS = /invoice|receipt|total due|amount due|bill to|purchase order/i;
if (JUNK_PATTERNS.test(text.slice(0, 500))) {
  return NextResponse.json(
    { error: "This looks like a financial document, not educational content" },
    { status: 422 }
  );
}
```

**Files to edit:** `src/app/api/upload/route.ts`

**Verification:** Upload an invoice PDF → get 422 with descriptive message. Upload a 1-page PDF → get word-count rejection.

---

## Phase 4 — P2: Rate Limiting (Public URL Abuse Protection)

**Constraint:** No user auth, no session, first touch is file upload. Options ranked by effort:

### Option A — IP-based upload limit via Vercel KV (Recommended)
- Use Vercel KV (Redis) — free tier, already available if on Vercel
- Track `uploads:{ip}:{date}` counter, limit to 5/day
- No login required; resets at midnight UTC

```ts
// Pseudo-code in upload/route.ts
import { kv } from "@vercel/kv";
const ip = req.headers.get("x-forwarded-for") ?? "unknown";
const key = `uploads:${ip}:${new Date().toISOString().slice(0, 10)}`;
const count = await kv.incr(key);
if (count === 1) await kv.expire(key, 86400);
if (count > 5) return NextResponse.json({ error: "Daily limit reached (5 uploads/day)" }, { status: 429 });
```

### Option B — Simple passcode gate (Zero infra)
- Add env var `ACCESS_CODE=someword`
- Upload form requires user to enter code before upload
- No KV needed; protects against casual abuse

### Option C — Vercel Edge middleware rate limit
- Use `@upstash/ratelimit` + Upstash Redis (free tier)
- Applied at middleware level, blocks before route handler

**Recommendation:** Start with Option B (passcode) — zero dependencies, deploy in 30 min. Add Option A after if you want self-serve public access with limits.

**Files to edit (Option B):**
- `src/app/api/upload/route.ts` — check `X-Access-Code` header
- `src/components/UploadForm.tsx` — add passcode input field
- `.env.local` + Vercel env vars — add `ACCESS_CODE`

**Files to edit (Option A):**
- `src/app/api/upload/route.ts` — KV counter logic
- Install `@vercel/kv`
- Vercel dashboard — provision KV store

---

## Phase 5 — P3: Objective Context Match (Optional UX Refinement)

**Current behavior:** User can type any text into "Add objective" — no validation that it relates to the document.

**Options:**
1. **Remove the add-objective input entirely** — users can only remove objectives, not add. Simpler, safer, no LLM call needed. Recommended if scope is tight.
2. **Client-side fuzzy match** — check if new objective shares ≥1 keyword with existing objectives (poor accuracy).
3. **Server-side semantic check** — send new objective + document summary to LLM, return yes/no. Extra LLM call per add.

**Recommendation:** Remove the add field. Users can still curate by deleting. Add-from-scratch requires domain knowledge the UI doesn't provide.

**Files to edit:** `src/components/PlanApproval.tsx` — remove the `add()` function and input row.

---

## Phase 6 — P3: Domain History View (New Feature)

**What:** Show past uploads (no content) — document title, quiz topic/domain, timestamp — so visitors can see what kinds of lessons have been generated.

**Data available in PostgreSQL:** `documents` table has `filename`, `extracted_text`, `id`. No `domain` or `topic` column yet.

**Implementation path:**
1. Add `topic` column to `documents` table (migration: `ALTER TABLE documents ADD COLUMN topic TEXT`)
2. After planner generates objectives, extract topic (first objective or LLM-derived label) and write back: `UPDATE documents SET topic = $1 WHERE id = $2`
3. New API route `GET /api/history` — returns `[{ id, filename, topic, created_at }]` (no text content)
4. New page or section on homepage — renders history cards

**Schema migration:**
```sql
ALTER TABLE documents ADD COLUMN topic TEXT;
ALTER TABLE documents ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
```

**Files to create/edit:**
- DB migration (run once in prod)
- `src/app/api/history/route.ts` — new GET route
- `src/agent/planner.ts` or `src/agent/graph.ts` — write `topic` after plan generation
- `src/app/page.tsx` or new `src/components/HistoryPanel.tsx`

---

## Execution Order

```
Phase 1 (Neo4j fix)     → unblocks correct graph data
Phase 2 (Sidebar bugs)  → visible fix, quick wins
Phase 3 (PDF hardening) → prevent bad state entering system
Phase 4 (Rate limiting) → security, pick Option B first
Phase 5 (Objective UX)  → optional, decide before implementing
Phase 6 (History)       → new feature, last
```

Each phase is independently deployable. Start a new chat context per phase with this plan doc as context.
