"use client";

import { useState, useEffect } from "react";

type Result = {
  isCorrect: boolean;
  correctIndex: number;
  selectedIndex: number;
  explanation: string | null;
  resolution: string | null;
};

function renderInline(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
}

export function QuizQuestion({
  question,
  choices,
  hint,
  result,
  loading,
  objectiveIndex,
  totalObjectives,
  onSelect,
  onContinue,
}: {
  question: string;
  choices: string[];
  hint?: string;
  result?: Result;
  loading?: boolean;
  objectiveIndex: number;
  totalObjectives: number;
  onSelect: (i: number) => void;
  onContinue: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  // showFeedback: true when a wrong-answer result panel should be visible.
  // "Try again" dismisses it locally (no agent resume needed).
  const [showFeedback, setShowFeedback] = useState(false);

  // New question → reset all local state
  useEffect(() => {
    setSelected(null);
    setShowFeedback(false);
  }, [question]);

  // Wrong result arrived from agent → show feedback panel
  useEffect(() => {
    if (result && !result.isCorrect) setShowFeedback(true);
  }, [result]);

  function handleSelect(i: number) {
    if (loading || selected !== null || showFeedback) return;
    setSelected(i);
    onSelect(i);
  }

  function handleTryAgain() {
    setShowFeedback(false);
    setSelected(null);
  }

  const progress = totalObjectives > 0 ? ((objectiveIndex + 1) / totalObjectives) * 100 : 0;

  return (
    <div className="animate-fade-in">
      {/* Progress */}
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

      {/* Choices */}
      <div className="space-y-2.5">
        {choices.map((choice, i) => {
          // Correct answer result: freeze choices, show green on correct + red on wrong pick
          if (result?.isCorrect) {
            const isCorrectChoice = i === result.correctIndex;
            const isWrongSelected = i === result.selectedIndex;
            const isDim = !isCorrectChoice && !isWrongSelected;
            return (
              <div
                key={i}
                className={[
                  "w-full text-left px-4 py-3.5 rounded-xl border-2 flex items-center gap-3 transition-all",
                  isCorrectChoice
                    ? "border-green-400 bg-green-50"
                    : isWrongSelected
                    ? "border-red-400 bg-red-50"
                    : "border-stone-100 bg-stone-50 opacity-40",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold",
                    isCorrectChoice
                      ? "bg-green-500 text-white"
                      : isWrongSelected
                      ? "bg-red-400 text-white"
                      : "bg-stone-100 text-stone-400",
                  ].join(" ")}
                >
                  {isCorrectChoice ? "✓" : isWrongSelected ? "✗" : String.fromCharCode(65 + i)}
                </span>
                <span className={["text-sm", isDim ? "text-stone-400" : "text-stone-800 font-medium"].join(" ")}>
                  {choice}
                </span>
              </div>
            );
          }

          // Wrong-answer feedback visible: highlight only the wrong pick, others interactive-looking but blocked
          if (showFeedback && result && !result.isCorrect) {
            const isWrongSelected = i === result.selectedIndex;
            return (
              <div
                key={i}
                className={[
                  "w-full text-left px-4 py-3.5 rounded-xl border-2 flex items-center gap-3",
                  isWrongSelected
                    ? "border-red-400 bg-red-50"
                    : "border-stone-100 bg-stone-50 opacity-40",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold",
                    isWrongSelected ? "bg-red-400 text-white" : "bg-stone-100 text-stone-400",
                  ].join(" ")}
                >
                  {isWrongSelected ? "✗" : String.fromCharCode(65 + i)}
                </span>
                <span className={["text-sm", isWrongSelected ? "text-stone-800 font-medium" : "text-stone-400"].join(" ")}>
                  {choice}
                </span>
              </div>
            );
          }

          // Normal interactive state
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

      {/* Result feedback */}
      <div className="mt-5">
        {result?.isCorrect ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
            <p className="font-semibold text-green-700 text-sm">Correct!</p>
            {result.explanation && (
              <p className="text-sm text-green-900 mt-1 leading-relaxed">{result.explanation}</p>
            )}
            <button
              onClick={onContinue}
              disabled={loading}
              className="mt-3 w-full py-2.5 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors text-sm"
            >
              {loading ? "Loading…" : "Next question →"}
            </button>
          </div>
        ) : showFeedback ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="font-semibold text-red-700 text-sm">Not quite — give it another try</p>
            {hint && (
              <p className="text-sm text-red-900 mt-2 leading-relaxed">
                <span className="font-semibold">Hint: </span>{renderInline(hint)}
              </p>
            )}
            <button
              onClick={handleTryAgain}
              className="mt-3 w-full py-2.5 rounded-xl bg-stone-800 text-white font-medium hover:bg-stone-900 transition-colors text-sm"
            >
              Try again →
            </button>
          </div>
        ) : !result && loading && selected !== null ? (
          <p className="text-xs text-stone-400 text-center animate-pulse">Checking your answer…</p>
        ) : null}
      </div>
    </div>
  );
}
