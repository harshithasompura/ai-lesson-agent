# AI Learning Agent

Build an AI learning agent that transforms a PDF into an interactive lesson.

---

## Why this is different

Most "AI quiz" apps are a single LLM call: send text, get questions back, done. This system is an **agent** — a stateful process that pauses for human input, resumes, makes decisions across multiple steps, and enforces rules structurally (not just by prompting).

Two things make it genuinely different:

**1. The quiz can't be skipped or cheated.** Progression through each question is enforced by the graph's structure — there is no action the AI or the user can take to skip a question without submitting an answer. The AI can't decide "let's move on," because there's no graph edge for it. This is a different kind of guarantee than "we told the AI to be strict."

**2. The hint system can't leak the answer.** The agent that gives hints (`Tutor Agent`) is structurally prevented from seeing the answer key — it's never in its context, so it literally cannot reveal it no matter how the user asks. This is different from prompt-only "don't tell them the answer," which can be manipulated.

---

## Why three agents, not one

A single AI model is reused across the whole session, but it runs as **three separate agents** — each with its own identity, its own instructions, and its own restricted view of what's happening.

| Agent | What it does | What it never sees |
|---|---|---|
| **Planner Agent** | Reads the PDF, builds the lesson plan | Quiz answers, answer keys |
| **Quiz Agent** | Writes questions, checks its own work, grades answers | — (holds the answer key) |
| **Tutor Agent** | Gives hints on wrong answers, writes the final recap | The answer key — by design |

The reason: if one agent did everything, keeping the answer key away from the hint logic would be a prompt instruction — something the user could potentially argue around. With three agents, the Tutor Agent is constructed without the answer key in its context. It can't leak what it was never given.

The Quiz Agent also **self-evaluates its own questions** before showing them. After generating a question, a second pass scores it: is the correct answer unambiguous? Are the wrong answers plausibly wrong? Does it match the learning objective? If not, it regenerates with the critique fed back in (`critiqueMessages` — prior self-eval feedback injected into the next generation call), capped at 3 attempts. This catches bad questions before a human ever sees them.

---

## Architecture

The system is a Next.js app with a LangGraph agent backend and CopilotKit runtime. The frontend communicates with the LangGraph graph via a Next.js HTTP adapter route; interrupts (plan approval, quiz answers) are handled by posting `command.resume` directly to the LangGraph streaming endpoint and syncing state back to React.

### System architecture

```mermaid
graph LR
    Browser["Browser\n(Next.js UI)"] -->|HTTP + SSE| CK["CopilotKit Runtime\n/api/copilotkit"]
    CK -->|LangGraph HTTP| Graph["LangGraph Agent\n/api/langgraph"]
    Graph -->|checkpoints| PG[("Postgres\nSupabase")]
    Graph -->|concept edges| Neo4j[("Neo4j Aura")]
    Graph -->|LLM calls| Claude["Anthropic Claude"]
    Browser -->|PDF upload| Upload["/api/upload"]
    Upload --> PG
    Browser -->|quiz chat| Chat["/api/chat\n(answer-guarded)"]
    Chat --> Claude
```

### Agent graph flow

Nodes are color-coded by agent identity:

```mermaid
flowchart TD
    A([PDF Upload]) --> B[generatePlan]
    B --> C{planApproval\ninterrupt}
    C -->|user edits + approves| D[writeConceptGraph\nNeo4j]
    D --> E[selectObjective\nNeo4j ordering]
    E --> F[generateMCQ]
    F --> G[selfEval\ncritiqueMessages →]
    G -->|score low · max 3x| F
    G -->|pass| H{presentQuestion\ninterrupt}
    H -->|answer submitted| I[grading]
    I -->|correct| J[resultNode]
    J -->|more objectives| E
    J -->|all done| K([completion · recap])
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

**Legend:** 🔵 Planner Agent — 🟠 Quiz Agent — 🟢 Tutor Agent — 🟣 Interrupt (user pause)

### Key components

| Path | Purpose |
|---|---|
| `src/agent/graph.ts` | Compiled LangGraph state graph with PostgresSaver checkpointer |
| `src/agent/planner.ts` | Planner Agent — plan generation + plan approval interrupt node |
| `src/agent/quiz.ts` | Quiz Agent — MCQ generation, `critiqueMessages` self-eval loop, grading |
| `src/agent/tutor.ts` | Tutor Agent — hint node (no answer key in context) + completion/recap |
| `src/agent/conceptGraph.ts` | Neo4j prerequisite edge writer (runs after plan approval) |
| `src/app/page.tsx` (route `/`) | Main app page — state-based interrupt detection, `resume()` via LangGraph HTTP |
| `src/app/api/chat/route.ts` | StudySidebar chat endpoint — separate from agent hints; answer-key isolated, quiz-only gate |
| `src/app/api/copilotkit/[[...slug]]/route.ts` | CopilotKit runtime endpoint (multi-route mode) |
| `src/app/api/langgraph/[...path]/route.ts` | LangGraph HTTP adapter — exposes local compiled graph |
| `src/app/api/test-db/route.ts` | DB + Neo4j connectivity health-check |
| `src/app/api/upload/route.ts` | PDF upload, text extraction, word-count + junk-doc validation |
| `src/components/CopilotProvider.tsx` | Client-side CopilotKit context provider |
| `src/components/PlanApproval.tsx` | Plan review UI — editable objectives, inline edit, approve resumes graph |
| `src/components/QuizQuestion.tsx` | MCQ UI — wrong-answer panel, hint display, progress bar |
| `src/components/StudySidebar.tsx` | Chat sidebar — independent from agent hint path; withholds answers until quiz completion |
| `src/components/UploadForm.tsx` | PDF upload form with passcode gate and validation feedback |

### Data flow

1. User uploads PDF → `/api/upload` validates (word count, junk-doc heuristic), extracts text, stores in Postgres, returns `documentId`
2. Frontend sends `documentId` to CopilotKit → agent starts, loads `extractedText` from Postgres
3. **Planner Agent** runs `generatePlan` — one LLM call over full PDF text → structured output: `objectives[]` + `prerequisites[]`
4. Graph hits `planApproval` interrupt → frontend detects via state poll, renders `PlanApproval` modal — user edits objectives inline
5. User approves → frontend POSTs `command.resume` to LangGraph HTTP stream, drains SSE, syncs state
6. `writeConceptGraph` filters prerequisites against edited plan, writes `(:Objective)-[:PREREQUISITE_FOR]->(:Objective)` to Neo4j (8s timeout + fallback to list order)
7. **Quiz loop** per objective: `selectObjective` (Neo4j prereq ordering, list-order fallback) → **Quiz Agent** `generateMCQ` → `selfEval` (scores on unambiguous answer / plausible distractors / objective alignment; injects `critiqueMessages` and regenerates if below threshold, max 3 attempts) → `presentQuestion` interrupt
8. User answers → frontend resumes graph → **Quiz Agent** `grading` node evaluates against `answerKey` in state → writes `quiz_attempts` row to Postgres
9. Wrong answer → **Tutor Agent** `hintNode` (answer key structurally excluded from context) → re-fires `presentQuestion` interrupt
10. Correct → `resultNode` → advance to next objective or `completion`
11. **Tutor Agent** `completionNode` reads `quiz_attempts` from Postgres, splits `firstTry` vs `struggled`, enriches study tips via Neo4j prerequisite query (falls back to flat recap on failure)
12. **StudySidebar** chat (`/api/chat`) runs in parallel throughout — separate from the agent's hint path; uses LangChain `ChatAnthropic` directly; withholds answer keys until `quizComplete` state is true, enforced server-side

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
```

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

### Objective field — no context validation

The plan approval screen lets users add custom objectives via an inline text field. There is no validation that a newly typed objective relates to the uploaded document — any free-form text is accepted. Existing objectives (generated by the planner from the PDF) are also editable inline, so a user can overwrite them with unrelated content.

**Current behaviour:** harmless — the quiz generation will just produce questions around whatever objectives are present, even if they don't match the source material.

**Future improvement:** add a server-side semantic check that compares a new/edited objective against the document summary before accepting it, or restrict the UI to deletion-only (users curate the LLM-generated list rather than authoring from scratch).

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
