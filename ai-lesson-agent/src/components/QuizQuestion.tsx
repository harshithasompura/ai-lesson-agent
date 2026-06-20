"use client";

import { useState, useEffect, useRef } from "react";

export function QuizQuestion({
  question,
  choices,
  hint,
  loading,
  objectiveIndex,
  totalObjectives,
  onSelect,
}: {
  question: string;
  choices: string[];
  hint?: string;
  loading?: boolean;
  objectiveIndex: number;
  totalObjectives: number;
  onSelect: (i: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [localHint, setLocalHint] = useState<string | undefined>(undefined);
  // true only after user submits answer for current question — prevents stale hint from prev question
  const awaitingFeedback = useRef(false);

  useEffect(() => {
    setSelected(null);
    setLocalHint(undefined);
    awaitingFeedback.current = false;
  }, [question]);

  useEffect(() => {
    if (hint && !loading && awaitingFeedback.current) {
      setLocalHint(hint);
      setSelected(null);
      awaitingFeedback.current = false;
    }
  }, [hint, loading]);

  function handleSelect(i: number) {
    if (loading || selected !== null) return;
    awaitingFeedback.current = true;
    setSelected(i);
    onSelect(i);
  }

  const progress = totalObjectives > 0 ? (objectiveIndex / totalObjectives) * 100 : 0;

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <div className="flex justify-between text-xs text-stone-500 mb-2">
          <span>Question {objectiveIndex + 1}</span>
          <span>{objectiveIndex} of {totalObjectives} complete</span>
        </div>
        <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-teal-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <p className="text-lg font-semibold text-stone-900 mb-6 leading-snug">{question}</p>

      <div className="space-y-2.5">
        {choices.map((choice, i) => {
          const isSelected = selected === i;
          const isLoading = isSelected && loading;
          return (
            <button
              key={i}
              disabled={loading || (selected !== null && !isSelected)}
              onClick={() => handleSelect(i)}
              className={[
                "w-full text-left px-4 py-3.5 rounded-xl border-2 transition-all flex items-center gap-3",
                isSelected
                  ? "border-teal-600 bg-teal-50"
                  : selected !== null
                  ? "border-stone-100 bg-stone-50 opacity-40"
                  : "border-stone-200 hover:border-teal-400 hover:bg-teal-50/40 cursor-pointer",
              ].join(" ")}
            >
              <span
                className={[
                  "flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold font-mono",
                  isSelected ? "bg-teal-600 text-white" : "bg-stone-100 text-stone-500",
                ].join(" ")}
              >
                {isLoading ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  String.fromCharCode(65 + i)
                )}
              </span>
              <span className={["text-sm", isSelected ? "text-stone-900 font-medium" : "text-stone-700"].join(" ")}>
                {choice}
              </span>
            </button>
          );
        })}
      </div>

      {loading && selected !== null && (
        <p className="mt-4 text-xs text-stone-400 text-center animate-pulse">Checking your answer…</p>
      )}

      {localHint && !loading && (
        <div className="mt-5 p-4 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-900 leading-relaxed">
          <span className="font-semibold text-teal-700 mr-1">Hint:</span>
          {localHint}
        </div>
      )}
    </div>
  );
}
