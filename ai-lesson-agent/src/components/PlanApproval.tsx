"use client";
import { useState } from "react";

type PlanData = {
  objectives: string[];
  prerequisites: { from: string; to: string }[];
};

function parsePlan(raw: string): PlanData {
  try {
    return JSON.parse(raw);
  } catch {
    return { objectives: [raw], prerequisites: [] };
  }
}

export function PlanApproval({
  plan,
  onApprove,
}: {
  plan: string;
  onApprove: (plan: string) => void;
}) {
  const parsed = parsePlan(plan);
  const [objectives, setObjectives] = useState<string[]>(parsed.objectives);
  const [newObj, setNewObj] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  function remove(i: number) {
    setObjectives((prev) => prev.filter((_, idx) => idx !== i));
  }

  function add() {
    const trimmed = newObj.trim();
    if (!trimmed) return;
    setObjectives((prev) => [...prev, trimmed]);
    setNewObj("");
  }

  function startEdit(i: number) {
    setEditingIdx(i);
    setEditValue(objectives[i]);
  }

  function commitEdit() {
    if (editingIdx === null) return;
    const trimmed = editValue.trim();
    if (trimmed) setObjectives((prev) => prev.map((o, i) => i === editingIdx ? trimmed : o));
    setEditingIdx(null);
  }

  function approve() {
    const filteredPrereqs = parsed.prerequisites.filter(
      (p) => objectives.includes(p.from) && objectives.includes(p.to)
    );
    onApprove(JSON.stringify({ objectives, prerequisites: filteredPrereqs }));
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-stone-900">Your lesson plan</h2>
        <p className="text-stone-500 text-sm mt-1">
          {objectives.length} learning objective{objectives.length !== 1 ? "s" : ""} — remove or add any before starting.
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden mb-4">
        {objectives.length === 0 ? (
          <p className="px-4 py-6 text-sm text-stone-400 text-center">No objectives — add at least one below.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {objectives.map((obj, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3 group">
                <span className="flex-shrink-0 w-6 h-6 rounded-md bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
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
                <button
                  onClick={() => remove(i)}
                  className="flex-shrink-0 text-stone-300 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  aria-label="Remove objective"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
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

      <button
        disabled={objectives.length === 0}
        className="w-full py-2.5 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        onClick={approve}
      >
        Start quiz →
      </button>
    </div>
  );
}
