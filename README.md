# AI Learning Agent

Build an AI learning agent that transforms a PDF into an interactive lesson.

---

## Architecture

The system is a Next.js app with a LangGraph agent backend and CopilotKit AG-UI frontend.

### Key components

| Path | Purpose |
|---|---|
| `src/agent/graph.ts` | Compiled LangGraph state graph with PostgresSaver checkpointer |
| `src/agent/planner.ts` | Plan generation + plan approval interrupt node |
| `src/agent/quiz.ts` | MCQ generation, self-eval, grading nodes |
| `src/agent/tutor.ts` | Hint and completion/recap nodes |
| `src/agent/conceptGraph.ts` | Neo4j prerequisite edge writer |
| `src/app/api/langgraph/[...path]/route.ts` | LangGraph HTTP adapter (exposes local graph to CopilotKit) |
| `src/app/api/copilotkit/route.ts` | CopilotKit runtime endpoint |
| `src/app/api/upload/route.ts` | PDF upload + text extraction |
| `src/components/CopilotProvider.tsx` | Client-side CopilotKit context provider |
| `src/components/PlanApproval.tsx` | Interrupt-driven plan review UI |
| `src/components/QuizQuestion.tsx` | Interrupt-driven MCQ UI |
| `src/app/page.tsx` | Main page — upload → plan → quiz → recap flow |

### Data flow

1. User uploads PDF → `/api/upload` extracts text, stores in Postgres, returns `documentId`
2. Frontend calls `useCoAgent.setState({ documentId })` + `start()` → agent runs
3. `loadDocument` node fetches `extractedText` from Postgres
4. `generatePlan` → `planApproval` (interrupt) → user edits/approves plan in `PlanApproval` modal
5. `writeConceptGraph` writes prerequisite edges to Neo4j
6. Quiz loop: `generateMCQ` → `selfEval` → `presentQuestion` (interrupt) → `grading` → `hint`/`advance`
7. `completion` node writes recap to `state.messages`; frontend shows score breakdown

### Environment variables

```
DATABASE_URL=          # Postgres (Supabase)
NEO4J_URI=             # Neo4j Aura
NEO4J_USERNAME=
NEO4J_PASSWORD=
NEO4J_DATABASE=
ANTHROPIC_API_KEY=
LANGGRAPH_DEPLOYMENT_URL=http://localhost:3000/api/langgraph
```

### Running locally

```bash
cd ai-lesson-agent
npm install
npm run dev
```

---

## Credits

### Tooling & Plugins

- **[claude-mem](https://github.com/thedotmack/claude-mem)** — cross-session memory and observation tracking for Claude Code; used for session context, `/make-plan`, and `/do` workflows throughout this project
- **[caveman](https://github.com/juliusbrussee/caveman)** — token-efficient communication mode for Claude Code sessions
- **[ponytail](https://github.com/DietrichGebert/ponytail)** — lazy/minimal code generation discipline for Claude Code

### Scaffolding Approach

Project structure, governance docs (`PLAN.md`, `CONSTITUTION.md`), and the phased task breakdown in `tasks.md` were modelled on the **spec-kit** methodology — a structured planning approach used to produce implementation-ready specs before writing code. See: [https://github.com/github/spec-kit](https://github.com/github/spec-kit)
