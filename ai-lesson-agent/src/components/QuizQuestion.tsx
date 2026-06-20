"use client";

export function QuizQuestion({
  question,
  choices,
  hint,
  loading,
  onSelect,
}: {
  question: string;
  choices: string[];
  hint?: string;
  loading?: boolean;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 max-w-xl w-full mx-4 shadow-xl">
        <p className="text-lg font-medium mb-6">{question}</p>
        <div className="space-y-3">
          {choices.map((choice, i) => (
            <button
              key={i}
              disabled={loading}
              className="w-full text-left px-4 py-3 rounded border hover:bg-blue-50 dark:hover:bg-zinc-800 dark:border-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => onSelect(i)}
            >
              <span className="font-mono mr-2">{String.fromCharCode(65 + i)}.</span>
              {choice}
            </button>
          ))}
        </div>
        {loading && (
          <p className="mt-4 text-sm text-zinc-500 animate-pulse">Checking answer…</p>
        )}
        {hint && !loading && (
          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-sm text-amber-900 dark:text-amber-200">
            💡 {hint}
          </div>
        )}
      </div>
    </div>
  );
}
