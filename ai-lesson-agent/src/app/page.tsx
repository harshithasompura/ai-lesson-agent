"use client";

import { useState, useCallback } from "react";
import { useCoAgent, useCopilotChat } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import UploadForm from "@/components/UploadForm";
import { PlanApproval } from "@/components/PlanApproval";
import { QuizQuestion } from "@/components/QuizQuestion";
import { GraphStateType } from "@/agent/state";

export default function Home() {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  // ponytail: appendMessage is deprecated but sendMessage requires Enterprise license
  const { appendMessage: sendMessage } = useCopilotChat();
  const { state, setState, running } = useCoAgent<GraphStateType>({
    name: "ai-lesson-agent",
    initialState: {
      documentId: "",
      extractedText: "",
      plan: "",
      planApproved: false,
      prerequisites: [],
      objectives: [],
      currentObjectiveIndex: 0,
      currentQuestion: "",
      answerKey: "",
      attemptCount: 0,
      evalAttemptCount: 0,
      pendingAnswer: null,
      attempts: [],
      messages: [],
    },
  });

  function handleUpload(id: string) {
    setDocumentId(id);
    setState((prev) => ({ ...prev!, documentId: id, extractedText: "" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendMessage(new TextMessage({ id: crypto.randomUUID(), content: "__start__", role: Role.User }));
  }

  // Resume a LangGraph interrupt by POSTing command.resume directly to our adapter,
  // then syncing the resulting state back into React via setState.
  // Note: useCopilotContext().threadId is the CopilotKit thread, not the LangGraph thread.
  // We fetch the active LangGraph thread from our adapter instead.
  const resume = useCallback(async (resumeValue: string) => {
    const activeRes = await fetch("/api/langgraph/active-thread");
    const { thread_id: lgThreadId } = await activeRes.json();
    if (!lgThreadId) return;

    setResuming(true);
    try {
      const res = await fetch(`/api/langgraph/threads/${lgThreadId}/runs/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: { resume: resumeValue } }),
      });
      // drain the SSE stream
      const reader = res.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
      // sync final graph state back into coagent state
      const stateRes = await fetch(`/api/langgraph/threads/${lgThreadId}/state`);
      if (stateRes.ok) {
        const graphState = await stateRes.json();
        if (graphState?.values) setState(() => graphState.values as GraphStateType);
      }
    } finally {
      setResuming(false);
    }
  }, [setState]);

  const handlePlanApprove = useCallback(async (text: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    await resume(JSON.stringify(parsed));
  }, [resume]);

  const handleQuizAnswer = useCallback(async (index: number) => {
    await resume(JSON.stringify({ selectedIndex: index }));
  }, [resume]);

  const showPlanApproval = documentId && !running && state.plan && !state.planApproved;
  const showQuiz = documentId && !running && state.planApproved && state.currentQuestion;

  const isComplete =
    documentId &&
    !running &&
    (state.objectives?.length ?? 0) > 0 &&
    state.currentObjectiveIndex >= state.objectives.length;

  const lastMessage = state.messages?.at(-1);
  const recap =
    isComplete && lastMessage
      ? typeof lastMessage === "object" && "content" in lastMessage
        ? String((lastMessage as { content: unknown }).content)
        : null
      : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-black p-8">
      <h1 className="text-2xl font-semibold mb-8 text-zinc-900 dark:text-zinc-50">
        AI Lesson Agent
      </h1>

      {!documentId && <UploadForm onUpload={handleUpload} />}

      {documentId && running && !state.planApproved && (
        <p className="text-zinc-500 animate-pulse">Generating lesson plan…</p>
      )}

      {documentId && running && state.planApproved && (
        <p className="text-zinc-500 animate-pulse">
          Quiz in progress — objective {state.currentObjectiveIndex + 1} of{" "}
          {state.objectives.length}
        </p>
      )}

      {documentId && isComplete && recap && (
        <div className="max-w-xl w-full bg-white dark:bg-zinc-900 rounded-lg p-6 shadow prose dark:prose-invert">
          <pre className="whitespace-pre-wrap text-sm">{recap}</pre>
          <button
            className="mt-6 px-4 py-2 bg-zinc-800 text-white rounded hover:bg-zinc-700"
            onClick={() => setDocumentId(null)}
          >
            Start over
          </button>
        </div>
      )}

      {showPlanApproval && (
        <PlanApproval plan={state.plan} onApprove={handlePlanApprove} />
      )}

      {showQuiz && (() => {
        try {
          const { question, choices } = JSON.parse(state.currentQuestion);
          const lastMsg = state.messages?.findLast(
            (m: { role: string; content: string }) => m.role === "assistant"
          );
          const hint = lastMsg ? String(lastMsg.content) : undefined;
          return (
            <QuizQuestion
              question={question}
              choices={choices}
              hint={hint}
              loading={resuming}
              onSelect={handleQuizAnswer}
            />
          );
        } catch {
          return null;
        }
      })()}
    </main>
  );
}
