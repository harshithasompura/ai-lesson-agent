"use client";
import { useState } from "react";

export function PlanApproval({
  plan,
  onApprove,
}: {
  plan: string;
  onApprove: (plan: string) => void;
}) {
  const [text, setText] = useState(plan);
  const [editing, setEditing] = useState(false);

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-stone-900">Your lesson plan</h2>
        <p className="text-stone-500 text-sm mt-1">Review the plan below. Edit it if you&apos;d like, then start your quiz.</p>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden mb-4">
        {editing ? (
          <textarea
            className="w-full h-72 font-mono text-sm p-4 resize-none focus:outline-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        ) : (
          <div className="p-4 text-sm text-stone-700 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
            {text}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button
          className="px-4 py-2.5 text-sm text-stone-600 border border-stone-300 rounded-xl hover:bg-stone-50 transition-colors"
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? "Preview" : "Edit plan"}
        </button>
        <button
          className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 transition-colors"
          onClick={() => onApprove(text)}
        >
          Start quiz →
        </button>
      </div>
    </div>
  );
}
