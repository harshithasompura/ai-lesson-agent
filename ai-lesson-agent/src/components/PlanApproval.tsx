"use client";
import { useLangGraphInterrupt } from "@copilotkit/react-core";
import { useState } from "react";

type ApprovalEvent = { type: "approval"; content: string };

function PlanEditor({ initialPlan, onSubmit }: { initialPlan: string; onSubmit: (plan: string) => void }) {
  const [text, setText] = useState(initialPlan);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl">
        <h2 className="text-xl font-semibold mb-4">Review Lesson Plan</h2>
        <textarea
          className="w-full h-64 font-mono text-sm p-3 border rounded resize-none dark:bg-zinc-800 dark:border-zinc-700"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="mt-4 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={() => onSubmit(text)}
        >
          Approve Plan
        </button>
      </div>
    </div>
  );
}

export function PlanApproval() {
  useLangGraphInterrupt<ApprovalEvent>({
    agentId: "ai-lesson-agent",
    enabled: ({ eventValue }) => eventValue.type === "approval",
    render: ({ event, resolve }) => {
      const handleSubmit = (text: string) => {
        try {
          const parsed = JSON.parse(text);
          resolve(JSON.stringify(parsed));
        } catch {
          resolve(text);
        }
      };
      return <PlanEditor initialPlan={event.value.content} onSubmit={handleSubmit} />;
    },
  });
  return null;
}
