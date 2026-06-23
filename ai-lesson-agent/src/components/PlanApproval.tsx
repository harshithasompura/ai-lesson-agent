"use client";
import { useState, useRef, memo } from "react";

type PlanData = {
  objectives: string[];
  prerequisites: { from: string; to: string }[];
  objectiveExcerpts?: string[];
};

function parsePlan(raw: string): PlanData {
  try {
    return JSON.parse(raw);
  } catch {
    return { objectives: [raw], prerequisites: [] };
  }
}

async function validateObjective(
  objective: string,
  documentId: string
): Promise<{ valid: boolean; hint: string }> {
  const res = await fetch("/api/validate-objective", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objective, documentId }),
  });
  if (!res.ok) return { valid: true, hint: "" };
  return res.json();
}

export const PlanApproval = memo(function PlanApproval({
  plan,
  documentId,
  onApprove,
}: {
  plan: string;
  documentId: string;
  onApprove: (plan: string) => void;
}) {
  const parsed = parsePlan(plan);
  // Key excerpts by objective text so removal/reorder doesn't shift indices
  const excerptByObjective = useRef<Record<string, string>>(
    Object.fromEntries((parsed.objectiveExcerpts ?? []).map((e, i) => [parsed.objectives[i], e]).filter(([k]) => k))
  );
  // Track which objectives came from the AI (original set)
  const aiObjectives = useRef(new Set(parsed.objectives));

  const [objectives, setObjectives] = useState<string[]>(parsed.objectives);
  const [newObj, setNewObj] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const [approving, setApproving] = useState(false);

  // Per-objective validation state
  const [validating, setValidating] = useState<Record<number, boolean>>({});
  const [hints, setHints] = useState<Record<number, string>>({});
  const [invalid, setInvalid] = useState<Set<number>>(new Set());

  async function runValidation(idx: number, value: string) {
    // AI-generated objectives skip validation
    if (aiObjectives.current.has(value)) return;

    setValidating((v) => ({ ...v, [idx]: true }));
    const result = await validateObjective(value, documentId);
    setValidating((v) => ({ ...v, [idx]: false }));
    setHints((h) => ({ ...h, [idx]: result.hint }));
    setInvalid((s) => {
      const next = new Set(s);
      if (result.valid) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function remove(i: number) {
    setObjectives((prev) => prev.filter((_, idx) => idx !== i));
    // Re-key hints/invalid by shifted indices after removal
    setHints((h) => Object.fromEntries(
      Object.entries(h).filter(([k]) => Number(k) !== i).map(([k, v]) => [Number(k) > i ? Number(k) - 1 : k, v])
    ));
    setInvalid((s) => new Set(
      [...s].filter((k) => k !== i).map((k) => k > i ? k - 1 : k)
    ));
  }

  function add() {
    const trimmed = newObj.trim();
    if (!trimmed) return;
    const idx = objectives.length;
    // Block approve immediately before async validation result lands
    setValidating((v) => ({ ...v, [idx]: true }));
    setObjectives((prev) => [...prev, trimmed]);
    setNewObj("");
    runValidation(idx, trimmed);
  }

  function startEdit(i: number) {
    setEditingIdx(i);
    setEditValue(objectives[i]);
  }

  async function commitEdit() {
    if (editingIdx === null) return;
    const trimmed = editValue.trim();
    if (trimmed) {
      setObjectives((prev) => prev.map((o, i) => i === editingIdx ? trimmed : o));
      // Clear old hint/invalid state for this index before re-validating
      setHints((h) => { const n = { ...h }; delete n[editingIdx]; return n; });
      setInvalid((s) => { const n = new Set(s); n.delete(editingIdx); return n; });
      await runValidation(editingIdx, trimmed);
    }
    setEditingIdx(null);
  }

  function approve() {
    const filteredPrereqs = parsed.prerequisites.filter(
      (p) => objectives.includes(p.from) && objectives.includes(p.to)
    );
    setApproving(true);
    onApprove(JSON.stringify({ objectives, prerequisites: filteredPrereqs }));
  }

  const isValidating = Object.values(validating).some(Boolean);
  const hasInvalid = invalid.size > 0;
  const approveDisabled = objectives.length === 0 || isValidating || hasInvalid || approving;

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-stone-900">Your lesson plan</h2>
        <p className="text-stone-500 text-sm mt-1">
          {objectives.length} learning objective{objectives.length !== 1 ? "s" : ""} — remove or add any before starting.
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl mb-4">
        {objectives.length === 0 ? (
          <p className="px-4 py-6 text-sm text-stone-400 text-center">No objectives — add at least one below.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {objectives.map((obj, i) => (
              <li key={obj} className={`px-4 py-3 group relative ${i === 0 ? "rounded-t-xl" : ""} ${i === objectives.length - 1 ? "rounded-b-xl" : ""}`}>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-md bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  {excerptByObjective.current[obj] && editingIdx !== i && (
                    <div className="pointer-events-none absolute left-full top-0 ml-3 z-10 w-64 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <div className="bg-stone-800 text-stone-200 text-xs leading-relaxed rounded-xl px-3 py-2.5 shadow-xl border border-stone-700 italic">
                        <span className="not-italic font-semibold text-stone-400 block mb-1">From the PDF</span>
                        {excerptByObjective.current[obj]}
                      </div>
                    </div>
                  )}
                  {editingIdx === i ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingIdx(null); }}
                      onBlur={commitEdit}
                      className="flex-1 text-sm text-stone-700 leading-snug bg-stone-50 border border-teal-300 rounded px-1 focus:outline-none"
                    />
                  ) : (
                    <span
                      className="flex-1 text-sm text-stone-700 leading-snug cursor-text hover:text-teal-700 transition-colors"
                      onClick={() => startEdit(i)}
                      title="Click to edit"
                    >{obj}</span>
                  )}
                  {validating[i] ? (
                    <svg className="flex-shrink-0 w-4 h-4 text-teal-400 animate-spin mt-0.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : hints[i] !== undefined && !invalid.has(i) && !aiObjectives.current.has(obj) ? (
                    <svg className="flex-shrink-0 w-4 h-4 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                  <button
                    onClick={() => remove(i)}
                    className="flex-shrink-0 text-stone-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    aria-label="Remove objective"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {hints[i] && (
                  <p className="mt-1.5 ml-9 text-xs text-amber-600">{hints[i]}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-stone-100 px-4 py-3 flex gap-2 items-center">
          <input
            type="text"
            value={newObj}
            onChange={(e) => setNewObj(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add an objective…"
            className="flex-1 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none bg-transparent"
          />
          <button
            onClick={add}
            disabled={!newObj.trim()}
            className="text-teal-600 text-sm font-medium disabled:opacity-30 hover:text-teal-700 transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Prerequisites</p>
        {parsed.prerequisites.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {parsed.prerequisites.map((p) => (
              <div key={`${p.from}→${p.to}`} className="flex items-center gap-2 text-xs text-stone-500">
                <span className="bg-stone-100 rounded-full px-2 py-0.5 text-stone-600">{p.from}</span>
                <span className="text-stone-300">→</span>
                <span className="bg-teal-50 text-teal-700 rounded-full px-2 py-0.5">{p.to}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400 italic">No dependencies found — objectives can be studied in any order.</p>
        )}
      </div>

      <button
        disabled={approveDisabled}
        className="w-full py-2.5 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        onClick={approve}
      >
        {approving ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Starting…
          </span>
        ) : isValidating ? "Validating…" : "Start quiz →"}
      </button>
    </div>
  );
});
