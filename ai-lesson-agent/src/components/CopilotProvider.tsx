"use client";
import { CopilotKit } from "@copilotkit/react-core";

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  return <CopilotKit runtimeUrl="/api/copilotkit" agent="ai-lesson-agent">{children}</CopilotKit>;
}
