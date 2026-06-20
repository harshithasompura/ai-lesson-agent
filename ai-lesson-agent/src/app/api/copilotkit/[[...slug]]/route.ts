import {
  CopilotRuntime,
  AnthropicAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:3000/api/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    "ai-lesson-agent": new LangGraphAgent({
      deploymentUrl: LANGGRAPH_URL,
      graphId: "ai-lesson-agent",
      langsmithApiKey: process.env.LANGSMITH_API_KEY,
    }),
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new AnthropicAdapter({ anthropic }),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};