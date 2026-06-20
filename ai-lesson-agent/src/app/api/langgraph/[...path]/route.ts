import { NextRequest } from "next/server";
import { graph } from "@/agent/graph";

// In-memory thread store (checkpoints persist in Postgres)
const threads = new Map<string, { created_at: string }>();
// Last thread created by LangGraphAgent — used by frontend to resume interrupts
let latestThreadId: string | null = null;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // GET /api/langgraph/active-thread — returns the most recently created LangGraph thread ID
  if (path[0] === "active-thread") {
    return jsonResponse({ thread_id: latestThreadId });
  }

  // GET /api/langgraph/assistants/search
  if (path[0] === "assistants" && path[1] === "search") {
    return jsonResponse([
      {
        assistant_id: "ai-lesson-agent",
        graph_id: "ai-lesson-agent",
        name: "ai-lesson-agent",
        config: {},
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  }

  // GET /api/langgraph/assistants/:id
  if (path[0] === "assistants" && path.length === 2) {
    return jsonResponse({
      assistant_id: path[1],
      graph_id: "ai-lesson-agent",
      name: "ai-lesson-agent",
      config: {},
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  // GET /api/langgraph/assistants/:id/schemas
  if (path[0] === "assistants" && path[2] === "schemas") {
    return jsonResponse({ input_schema: {}, output_schema: {}, config_schema: {}, context_schema: {} });
  }

  // GET /api/langgraph/assistants/:id/graph
  if (path[0] === "assistants" && path[2] === "graph") {
    return jsonResponse({ nodes: [], edges: [] });
  }

  // GET /api/langgraph/threads/:id
  if (path[0] === "threads" && path.length === 2) {
    const threadId = path[1];
    const now = new Date().toISOString();
    return jsonResponse({
      thread_id: threadId,
      created_at: now,
      updated_at: now,
      status: "idle",
      config: {},
      metadata: {},
    });
  }

  // GET /api/langgraph/threads/:id/state
  if (path[0] === "threads" && path[2] === "state") {
    const threadId = path[1];
    try {
      const state = await graph.getState({
        configurable: { thread_id: threadId },
      });
      return jsonResponse(state ?? {});
    } catch {
      return jsonResponse({});
    }
  }

  return jsonResponse({ error: "Not found" }, 404);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // POST /api/langgraph/assistants/search
  if (path[0] === "assistants" && path[1] === "search") {
    return jsonResponse([
      {
        assistant_id: "ai-lesson-agent",
        graph_id: "ai-lesson-agent",
        name: "ai-lesson-agent",
        config: {},
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  }

  // POST /api/langgraph/threads
  if (path[0] === "threads" && path.length === 1) {
    const threadId = crypto.randomUUID();
    const now = new Date().toISOString();
    threads.set(threadId, { created_at: now });
    latestThreadId = threadId;
    return jsonResponse({
      thread_id: threadId,
      created_at: now,
      updated_at: now,
      status: "idle",
      config: {},
      metadata: {},
    });
  }

  // POST /api/langgraph/threads/:id/runs/stream
  if (path[0] === "threads" && path[2] === "runs" && path[3] === "stream") {
    const threadId = path[1];
    // CopilotKit may skip POST /threads and go straight here — capture thread ID either way
    latestThreadId = threadId;
    const body = await req.json().catch(() => ({}));
    const { input, config: runConfig, stream_mode, command } = body as {
      input?: Record<string, unknown>;
      config?: Record<string, unknown>;
      stream_mode?: string | string[];
      command?: { resume?: string };
    };

    // Requested modes from client; fall back to events+values
    const requestedModes = Array.isArray(stream_mode)
      ? stream_mode
      : stream_mode
      ? [stream_mode]
      : ["events", "values"];

    const stream = new ReadableStream({
      async start(controller) {
        const encode = (text: string) => new TextEncoder().encode(text);

        function emit(event: string, data: unknown) {
          controller.enqueue(
            encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        }

        try {
          // If command.resume is set, use Command to resume an interrupt; otherwise use input
          const { Command } = await import("@langchain/langgraph");
          const streamInput = command?.resume != null
            ? new Command({ resume: command.resume })
            : (input ?? null);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const graphStream = await (graph.streamEvents as any)(streamInput, {
            version: "v2",
            ...(runConfig ?? {}),
            // thread_id must always win — runConfig.configurable must not override it
            configurable: {
              ...(runConfig as Record<string, unknown> & { configurable?: Record<string, unknown> })?.configurable,
              thread_id: threadId,
            },
          });

          for await (const chunk of graphStream) {
            if (requestedModes.includes("events")) {
              // @ag-ui/langgraph crashes when response_metadata is absent on chat model stream chunks.
              // Spread into a plain object so JSON.stringify picks up the injected field.
              const event =
                chunk.event === "on_chat_model_stream" && chunk.data?.chunk != null
                  ? {
                      ...chunk,
                      data: {
                        ...chunk.data,
                        chunk: {
                          ...chunk.data.chunk,
                          response_metadata: chunk.data.chunk.response_metadata ?? {},
                        },
                      },
                    }
                  : chunk;
              emit("events", event);
            }
          }

          // Emit final values snapshot
          if (requestedModes.includes("values")) {
            try {
              const state = await graph.getState({ configurable: { thread_id: threadId } });
              emit("values", state.values ?? {});
            } catch { /* ignore */ }
          }

          emit("end", {});
        } catch (err) {
          emit("error", { message: String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // POST /api/langgraph/threads/:id/runs/:runId/cancel
  if (
    path[0] === "threads" &&
    path[2] === "runs" &&
    path[4] === "cancel"
  ) {
    return jsonResponse({});
  }

  return jsonResponse({ error: "Not found" }, 404);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // PUT /api/langgraph/threads/:id/state
  if (path[0] === "threads" && path[2] === "state") {
    const threadId = path[1];
    const body = await req.json().catch(() => ({}));
    const { values, as_node } = body as {
      values?: Record<string, unknown>;
      as_node?: string;
    };
    try {
      const result = await graph.updateState(
        { configurable: { thread_id: threadId } },
        values ?? {},
        as_node
      );
      return jsonResponse({ checkpoint: result });
    } catch {
      return jsonResponse({ checkpoint: {} });
    }
  }

  return jsonResponse({ error: "Not found" }, 404);
}
