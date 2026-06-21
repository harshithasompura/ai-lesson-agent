# AI Learning Agent

Build an AI learning agent that transforms a PDF into an interactive lesson.

---

## Architecture

The system is a Next.js app with a LangGraph agent backend and CopilotKit AG-UI frontend.

### System architecture

```mermaid
graph LR
    Browser["Browser\n(Next.js UI)"] -->|AG-UI SSE| CK["CopilotKit Runtime\n/api/copilotkit"]
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

```mermaid
flowchart TD
    A([PDF Upload]) --> B[generatePlan\nPlanner Agent]
    B --> C{planApproval\ninterrupt}
    C -->|user edits + approves| D[writeConceptGraph\nNeo4j]
    D --> E[selectObjective\nNeo4j ordering]
    E --> F[generateMCQ\nQuiz Agent]
    F --> G[selfEval]
    G -->|score low · max 3x| F
    G -->|pass| H{presentQuestion\ninterrupt}
    H -->|answer submitted| I[grading]
    I -->|correct| J[resultNode]
    J -->|more objectives| E
    J -->|all done| K([completion · recap])
    I -->|wrong| L[hintNode\nTutor Agent]
    L --> H

    style C fill:#f0f,color:#fff,stroke:#c0c
    style H fill:#f0f,color:#fff,stroke:#c0c
    style K fill:#0a0,color:#fff,stroke:#080
```

### Key components

| Path | Purpose |
|---|---|
| `src/agent/graph.ts` | Compiled LangGraph state graph with PostgresSaver checkpointer |
| `src/agent/planner.ts` | Plan generation + plan approval interrupt node |
| `src/agent/quiz.ts` | MCQ generation, self-eval, grading nodes |
| `src/agent/tutor.ts` | Hint and completion/recap nodes |
| `src/agent/conceptGraph.ts` | Neo4j prerequisite edge writer |
| `src/app/page.tsx` (route `/`) | Main app page |
| `src/app/api/chat/route.ts` | StudySidebar chat endpoint — answer-key isolated, quiz-only gate |
| `src/app/api/copilotkit/[[...slug]]/route.ts` | CopilotKit runtime endpoint |
| `src/app/api/langgraph/[...path]/route.ts` | LangGraph HTTP adapter (exposes local graph to CopilotKit) |
| `src/app/api/test-db/route.ts` | DB connectivity health-check |
| `src/app/api/upload/route.ts` | PDF upload + text extraction |
| `src/components/CopilotProvider.tsx` | Client-side CopilotKit context provider |
| `src/components/PlanApproval.tsx` | Interrupt-driven plan review UI |
| `src/components/QuizQuestion.tsx` | Interrupt-driven MCQ UI with progress bar |
| `src/components/StudySidebar.tsx` | Answer-guarded chat sidebar — provides hints during quiz, unlocks full discussion after completion |
| `src/components/UploadForm.tsx` | PDF upload form component |

### Data flow

1. User uploads PDF → `/api/upload` extracts text, stores in Postgres, returns `documentId`
2. Frontend sets `documentId` in coagent state + sends `__start__` message → agent runs
3. Agent uses `extractedText` from upload response (stored in state)
4. `generatePlan` → `planApproval` (interrupt) → user edits/approves plan in `PlanApproval` modal
5. `writeConceptGraph` writes prerequisite edges to Neo4j
6. Quiz loop: `generateMCQ` → `selfEval` → `presentQuestion` (interrupt) → `grading` → `hint`/`advance`
7. `completion` node writes recap to `state.messages`; frontend shows score breakdown
8. **StudySidebar** (chat panel) is available throughout the quiz — it provides proactive hints but withholds answer keys until quiz completion; the `/api/chat` endpoint enforces this isolation server-side

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
```

### Running locally

```bash
cd ai-lesson-agent
npm install

# Run DB migrations once (provisions Postgres tables + LangGraph checkpoint tables)
npx tsx scripts/migrate.ts

npm run dev

# Run unit + integration tests
npm test
```

---

## Credits

### Tooling & Plugins

- **[claude-mem](https://github.com/thedotmack/claude-mem)** — cross-session memory and observation tracking for Claude Code; used for session context, `/make-plan`, and `/do` workflows throughout this project
- **[caveman](https://github.com/juliusbrussee/caveman)** — token-efficient communication mode for Claude Code sessions
- **[ponytail](https://github.com/DietrichGebert/ponytail)** — lazy/minimal code generation discipline for Claude Code

### Scaffolding Approach

Project structure, governance docs (`PLAN.md`, `CONSTITUTION.md`), and the phased task breakdown in `tasks.md` were modelled on the **spec-kit** methodology — a structured planning approach used to produce implementation-ready specs before writing code. See: [https://github.com/github/spec-kit](https://github.com/github/spec-kit)
