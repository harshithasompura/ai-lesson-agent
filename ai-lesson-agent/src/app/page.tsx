"use client";

import { useState } from "react";
import { useCoAgent } from "@copilotkit/react-core";
import UploadForm from "@/components/UploadForm";
import { PlanApproval } from "@/components/PlanApproval";
import { QuizQuestion } from "@/components/QuizQuestion";
import { GraphStateType } from "@/agent/state";

export default function Home() {
  const [documentId, setDocumentId] = useState<string | null>(null);

  const { state, setState, start, running } = useCoAgent<GraphStateType>({
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
    start();
  }

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

      {/* Interrupt-driven components — always mounted when agent running */}
      {documentId && <PlanApproval />}
      {documentId && <QuizQuestion />}
    </main>
  );
}
