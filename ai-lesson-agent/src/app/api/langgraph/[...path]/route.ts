import { NextRequest } from "next/server";
import { graph } from "@/agent/graph";

// In-memory thread store (checkpoints persist in Postgres)
const threads = new Map<string, { created_at: string }>();

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const path = params.path;

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

  // GET /api/langgraph/assistants/:graphId/schemas
  if (path[0] === "assistants" && path[2] === "schemas") {
    return jsonResponse({ input_schema: {}, output_schema: {} });
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
  { params }: { params: { path: string[] } }
) {
  const path = params.path;

  // POST /api/langgraph/threads
  if (path[0] === "threads" && path.length === 1) {
    const threadId = crypto.randomUUID();
    const now = new Date().toISOString();
    threads.set(threadId, { created_at: now });
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
    const body = await req.json().catch(() => ({}));
    const { input, config: runConfig } = body as {
      input?: Record<string, unknown>;
      config?: Record<string, unknown>;
    };

    const stream = new ReadableStream({
      async start(controller) {
        const encode = (text: string) => new TextEncoder().encode(text);

        function emit(event: string, data: unknown) {
          controller.enqueue(
            encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        }

        try {
          const graphStream = await graph.stream(input ?? null, {
            configurable: { thread_id: threadId },
            streamMode: "values" as const,
            ...(runConfig ?? {}),
          });

          for await (const chunk of graphStream) {
            if (chunk && typeof chunk === "object" && "__interrupt__" in chunk) {
              emit("tasks", chunk);
            } else if (
              chunk &&
              typeof chunk === "object" &&
              !Array.isArray(chunk) &&
              Object.keys(chunk as object).some((k) => k !== "__event__")
            ) {
              // Heuristic: if values-shaped (plain object with state keys), emit as values
              emit("values", chunk);
            } else {
              emit("updates", chunk);
            }
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
