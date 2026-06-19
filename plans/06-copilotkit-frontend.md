# Plan 06 — CopilotKit Runtime + Frontend

**Goal:** Wire the compiled LangGraph graph into CopilotKit's AG-UI protocol and build the three UI components (plan approval, quiz question, score recap).

---

## Allowed APIs (verified against installed packages)

| Symbol | Import path | Notes |
|---|---|---|
| `LangGraphAgent` | `@copilotkit/runtime/langgraph` | needs `deploymentUrl` + `graphId` |
| `copilotRuntimeNextJSAppRouterEndpoint` | `@copilotkit/runtime` | wraps `CopilotRuntime` for Next.js App Router |
| `CopilotRuntime` | `@copilotkit/runtime` | `new CopilotRuntime({ agents: Record<string, AbstractAgent> })` |
| `CopilotKit` (provider) | `@copilotkit/react-core` | `<CopilotKit runtimeUrl="/api/copilotkit">` |
| `useLangGraphInterrupt` | `@copilotkit/react-core` | **NOT** `useInterrupt` — that name doesn't exist |
| `useCoAgent` | `@copilotkit/react-core` | for reading agent state |
| `LangGraphInterruptRender<T>` | `@copilotkit/react-core` | type for interrupt action |

### `useLangGraphInterrupt` signature (verified from `index.d.mts:522`)

```ts
useLangGraphInterrupt<TEventValue>(
  action: {
    handler?: (props: { event: LangGraphInterruptEvent<TEventValue>; resolve: (resolution: string) => void }) => any;
    render?:  (props: { result: unknown; event: LangGraphInterruptEvent<TEventValue>; resolve: (resolution: string) => void }) => string | ReactElement;
    enabled?: (args: { eventValue: TEventValue; agentMetadata: AgentSession }) => boolean;
    agentId?: string;
  },
  dependencies?: any[]
): void
```

Note: `resolve` takes `string`. For plan approval, `resolve(JSON.stringify(editedPlan))`. For quiz, `resolve(String(selectedIndex))`.

### CopilotKit route pattern (verified from `shared.d.mts`)

```ts
// app/api/copilotkit/route.ts
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime: new CopilotRuntime({
    agents: {
      "ai-lesson-agent": new LangGraphAgent({
        deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL!,
        graphId: "ai-lesson-agent",
      }),
    },
  }),
  endpoint: "/api/copilotkit",
});

export const GET = handleRequest;
export const POST = handleRequest;
```

### LangGraph HTTP API surface needed

`LangGraphAgent` uses `@langchain/langgraph-sdk`'s `Client` which calls these endpoints on `deploymentUrl`:
- `POST   /threads`                    → create thread, return `{ thread_id }`
- `GET    /threads/:id/state`          → return current graph state
- `POST   /threads/:id/runs/stream`    → stream graph execution (SSE)
- `POST   /threads/:id/runs/:runId/cancel` → cancel (can return 501 for now)
- `GET    /assistants/search`          → list assistants/graphs (return static list)
- `GET    /assistants/:graphId/schemas` → return graph input/output schema

---

## Anti-patterns to avoid

- ❌ `useInterrupt` — doesn't exist in `@copilotkit/react-core` v1.61; use `useLangGraphInterrupt`
- ❌ `useHumanInTheLoop` — exists but is the wrong primitive (PLAN.md §2.3, decision #2)
- ❌ `graph.invoke()` — doesn't surface `__interrupt__`; use `graph.stream()` (PLAN.md §8 watchpoints)
- ❌ Importing `LangGraphAgent` from `@copilotkit/runtime` — deprecated; use `@copilotkit/runtime/langgraph`
- ❌ Setting `deploymentUrl` to `/api/copilotkit` — that's the CopilotKit runtime URL, not the LangGraph server URL (from `wiring-langgraph.md`)
- ❌ Calling `interrupt()` outside a graph node (CONSTITUTION §Principle 8 — already done in Phase 5)
- ❌ `resolve(editedPlan)` without `JSON.stringify` for objects — `resolve` signature is `(string) => void`

---

## Phase 0 — Documentation Discovery (DONE)

Findings:
- `useLangGraphInterrupt` is the correct hook (verified from type declarations)
- `LangGraphAgent` requires a running HTTP server at `deploymentUrl` — the compiled local graph must be exposed as a LangGraph HTTP API adapter
- `resolve` in interrupt callbacks is `(string) => void`
- `copilotRuntimeNextJSAppRouterEndpoint` is the Next.js App Router integration point
- `LANGGRAPH_DEPLOYMENT_URL` should point to the local LangGraph adapter (e.g. `http://localhost:3000/api/langgraph`)

---

## Phase 1 — LangGraph HTTP API adapter

**What:** Create `src/app/api/langgraph/[...path]/route.ts` that exposes the local compiled `graph` as a LangGraph-compatible HTTP server.

**Why:** `LangGraphAgent` from CopilotKit uses `@langchain/langgraph-sdk`'s HTTP client. Without a real server, there's no way to wire the local graph into CopilotKit's runtime without implementing this adapter.

### Endpoints to implement

```
GET  /api/langgraph/assistants/search            → static: [{ assistant_id: "ai-lesson-agent", graph_id: "ai-lesson-agent" }]
GET  /api/langgraph/assistants/:graphId/schemas  → static: { input_schema: {}, output_schema: {} }
POST /api/langgraph/threads                      → generate UUID threadId, store in memory map, return { thread_id }
GET  /api/langgraph/threads/:id/state            → graph.getState({ configurable: { thread_id: id } })
POST /api/langgraph/threads/:id/runs/stream      → graph.stream(input, config) piped as SSE
POST /api/langgraph/threads/:id/runs/:runId/cancel → 200 OK (no-op)
```

### SSE stream format (LangGraph SDK expected events)

Each SSE chunk: `event: <type>\ndata: <json>\n\n`

Event types CopilotKit's `LangGraphAgent.run()` reads:
- `event: values` — state snapshot after each node
- `event: updates` — delta state from a node
- `event: tasks` — pending interrupt tasks (the `__interrupt__` key)
- `event: end` — stream done

From `graph.stream(input, config, { streamMode: ["values", "updates", "debug"] })`:
- Yield `event: values` for value snapshots
- Yield `event: updates` for update chunks  
- When chunk has `__interrupt__` key → yield `event: tasks` with interrupt payload
- On completion → yield `event: end`

### Implementation sketch

```ts
// src/app/api/langgraph/[...path]/route.ts
import { NextRequest } from "next/server";
import { graph } from "@/agent/graph";

// In-memory thread store (checkpoints already in Postgres via PostgresSaver)
const threads = new Map<string, { created_at: string }>();

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) { ... }
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) { ... }
```

### Verification checklist
- [ ] `curl POST /api/langgraph/threads` returns `{ thread_id: "<uuid>" }`
- [ ] `curl GET /api/langgraph/assistants/search` returns non-empty array
- [ ] `curl POST /api/langgraph/threads/:id/runs/stream` with minimal input streams SSE events and ends

---

## Phase 2 — CopilotKit runtime route

**What:** `src/app/api/copilotkit/route.ts`

**Pattern to copy from:** `node_modules/@copilotkit/runtime/skills/runtime/references/wiring-langgraph.md` (exact import paths)

```ts
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    "ai-lesson-agent": new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:3000/api/langgraph",
      graphId: "ai-lesson-agent",
    }),
  },
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  endpoint: "/api/copilotkit",
});

export const GET = handleRequest;
export const POST = handleRequest;
```

**Add to `.env.local`:** `LANGGRAPH_DEPLOYMENT_URL=http://localhost:3000/api/langgraph`

### Verification checklist
- [ ] `curl -X POST http://localhost:3000/api/copilotkit` returns non-500 (may 400 on bad body — that's fine)
- [ ] No TypeScript errors in route file

---

## Phase 3 — CopilotKit provider + layout

**What:** Wrap `src/app/layout.tsx` with `<CopilotKit runtimeUrl="/api/copilotkit">`.

Mark as `"use client"` OR create a separate client wrapper component to preserve server component layout.

**Pattern:**

```tsx
// src/components/CopilotProvider.tsx  (client component)
"use client";
import { CopilotKit } from "@copilotkit/react-core";
export function CopilotProvider({ children }: { children: React.ReactNode }) {
  return <CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>;
}
```

Then in `layout.tsx`:
```tsx
import { CopilotProvider } from "@/components/CopilotProvider";
// wrap body children with <CopilotProvider>
```

### Verification checklist
- [ ] App loads without CopilotKit initialization errors in browser console
- [ ] No hydration errors

---

## Phase 4 — PlanApproval component

**File:** `src/components/PlanApproval.tsx`

**What:** Uses `useLangGraphInterrupt` to render an editable textarea when the agent fires `interrupt({ type: "approval", content: plan })`. On submit, calls `resolve(JSON.stringify(editedPlan))`.

```tsx
"use client";
import { useLangGraphInterrupt } from "@copilotkit/react-core";
import { useState } from "react";

type ApprovalEvent = { type: "approval"; content: string };

export function PlanApproval() {
  useLangGraphInterrupt<ApprovalEvent>({
    agentId: "ai-lesson-agent",
    enabled: ({ eventValue }) => eventValue.type === "approval",
    render: ({ event, resolve }) => {
      // render editable plan UI
    },
  });
  return null; // renders via interrupt hook
}
```

**State inside render:** use `useState` in a sub-component extracted from `render` (render prop can return JSX with hooks if it's a component factory — or use a named component).

**Interrupt value format:** The graph calls `interrupt({ type: "approval", content: state.plan })`. The `event.value` will be `{ type: "approval", content: "..." }`. On resume, `resolve(editedPlanString)` — the graph receives this as the `Command({ resume: value })` payload. The planner node does `state.planApproved ?? interrupt(...)` guard, so on resume `planApproved` gets set.

**UI requirements from tasks.md:**
- Editable text area for objectives
- Submit button calls `resolve`

### Verification checklist
- [ ] After plan generation, PlanApproval UI renders with plan content
- [ ] Editing objectives and submitting calls `resolve` with updated content
- [ ] Graph continues after resume (writeConceptGraph node fires)

---

## Phase 5 — QuizQuestion component

**File:** `src/components/QuizQuestion.tsx`

**What:** Uses `useLangGraphInterrupt` to render MCQ choices when the agent fires `interrupt({ type: "quizAnswer", objective, question, choices })`. On selection, calls `resolve(String(selectedIndex))`.

```tsx
"use client";
import { useLangGraphInterrupt } from "@copilotkit/react-core";

type QuizEvent = { type: "quizAnswer"; objective: string; question: string; choices: string[] };

export function QuizQuestion() {
  useLangGraphInterrupt<QuizEvent>({
    agentId: "ai-lesson-agent",
    enabled: ({ eventValue }) => eventValue.type === "quizAnswer",
    render: ({ event, resolve }) => {
      // render question + 4 choice buttons
      // each button calls resolve(String(index))
    },
  });
  return null;
}
```

**Hint display:** After an incorrect answer, the hint node runs and re-fires the `quizAnswer` interrupt. The hint text is returned as a message in `state.messages`. Use `useCoAgent` to read `state.messages` and display the latest AI message above the question as a hint.

**Score/recap screen:** When the `completion` node runs, the graph ends. The completion node's output goes into `state.messages`. Use `useCoAgent` to detect when the agent is done (no active interrupt) and `state.currentObjectiveIndex >= state.objectives.length` to show the recap.

### Verification checklist
- [ ] Quiz question renders with 4 choices
- [ ] Correct answer → graph advances, next question appears
- [ ] Wrong answer → hint appears, same question re-renders
- [ ] After 3 wrong → explanation shown, graph advances

---

## Phase 6 — Main page wiring

**File:** `src/app/page.tsx`

**What:** Orchestrate the full flow: UploadForm → start agent → show PlanApproval → show QuizQuestion → show completion.

Use `useCoAgent` to start the agent with `documentId` and `extractedText` after upload.

```tsx
"use client";
import { useCoAgent } from "@copilotkit/react-core";
import { GraphStateType } from "@/agent/state";

// Inside component:
const { state, run } = useCoAgent<GraphStateType>({ name: "ai-lesson-agent" });

// After upload:
run(() => ({
  documentId,
  extractedText,  // pass from upload response or fetch from /documents/:id
}));
```

**Page states:**
1. No `documentId` → show `<UploadForm />`
2. `documentId` set, agent running, `!state.planApproved` → `<PlanApproval />` renders via interrupt hook
3. `planApproved`, objectives exist, not complete → `<QuizQuestion />` renders via interrupt hook  
4. Complete (`currentObjectiveIndex >= objectives.length`) → show score/recap from `state.messages`

Note: `PlanApproval` and `QuizQuestion` only need to be mounted — they render via their interrupt hooks, not via conditional rendering. Mount both once the agent is running.

### Upload flow adjustment

The upload route (`/api/upload`) already returns `documentId`. Extend it to also return `extractedText` in the response (or add a `/api/documents/:id` GET route). The agent needs `extractedText` as initial state input.

**Alternative:** Have the agent fetch `extractedText` from Postgres in a new `loadDocument` node at graph start, given just `documentId`. This keeps the initial `run()` call simpler. This is the cleaner approach — avoids sending the full PDF text over the network twice.

### Verification checklist
- [ ] Upload → plan generation visible in state
- [ ] PlanApproval renders, edit+submit works end-to-end
- [ ] Quiz question renders, answer flow works
- [ ] Completion screen shows per-objective breakdown

---

## Phase 7 — Final verification

Run the Phase 7 audit from tasks.md:

```bash
# Principle 1: tutor prompt never sees answerKey
grep -n "answerKey" src/agent/tutor.ts   # should be 0 hits in prompt assembly

# Principle 7: all Cypher queries have documentId filter
grep -n "MATCH\|WHERE" src/agent/conceptGraph.ts src/agent/quiz.ts

# Principle 8: interrupt() only in graph nodes, frontend uses useLangGraphInterrupt
grep -rn "useHumanInTheLoop\|useInterrupt[^s]" src/

# Check agentId consistency
grep -rn "ai-lesson-agent" src/app/api/copilotkit/ src/components/
```

---

## Open questions / deliberate deferrals

1. **`extractedText` in initial state:** Either return from upload API or add `loadDocument` node. Decide before Phase 6-6.
2. **`resolve()` payload parsing in graph:** The graph's `planApprovalNode` reads the resume value. Confirm whether it arrives as a raw string or parsed — may need `JSON.parse` inside the node.
3. **`useCoAgent` run trigger:** Confirm the correct way to pass initial state to the agent via `useCoAgent` in CopilotKit v1.61 — the `run()` function signature may differ from docs.

---

## Session close rule

Append entry to `AI_USAGE.md` and update `README.md` after this phase.
