import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { NextRequest, NextResponse } from "next/server";

const anthropic = new ChatAnthropic({ model: "claude-haiku-4-5-20251001", maxTokens: 512 });

// CONSTITUTION §Principle 1: route accepts no answerKey — structural isolation
const TUTOR_SYSTEM = `You are a study assistant helping a student understand lesson material.

HARD RULES — never violate:
1. NEVER reveal, confirm, or hint at which specific answer choice is correct. If asked directly, refuse and redirect.
2. You CAN explain concepts, clarify terminology, give analogies, and help the student reason through the material.
3. If the student asks something off-topic, acknowledge briefly then steer back to the current question.
4. Keep responses concise — 2-4 sentences max unless a concept genuinely needs more.`;

export async function POST(req: NextRequest) {
  const { messages, currentQuestion, objective } = await req.json() as {
    messages: { role: "user" | "assistant"; content: string }[];
    currentQuestion: string | null;
    objective: string | null;
  };

  // Build context preamble — never includes correctIndex or explanation
  const contextLines = [
    objective ? `Learning objective: ${objective}` : null,
    currentQuestion ? (() => {
      try {
        const { question, choices } = JSON.parse(currentQuestion);
        return `Current question: ${question}\nChoices: ${(choices as string[]).map((c, i) => `${i + 1}. ${c}`).join(" | ")}`;
      } catch {
        return null;
      }
    })() : null,
  ].filter(Boolean).join("\n");

  const systemPrompt = contextLines
    ? `${TUTOR_SYSTEM}\n\nCurrent quiz context (no answer key):\n${contextLines}`
    : TUTOR_SYSTEM;

  const lcMessages = [
    new SystemMessage(systemPrompt),
    ...messages.map((m) =>
      m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
    ),
  ];

  const stream = await anthropic.stream(lcMessages);

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const text = typeof chunk.content === "string" ? chunk.content : "";
        if (text) controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });

  return new NextResponse(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
