"use client";

import { useEffect, useState } from "react";

type Stats = {
  pg: {
    overview: {
      total_questions: string;
      total_objectives: string;
      first_try_correct: string;
      avg_attempts: string;
    };
    evalOverview: {
      total_evals: string;
      avg_rounds: string;
      cap_hits: string;
      pass_rate: string;
    };
    evalLayers: { layer: string; count: string }[];
    topStruggled: { objective: string; avg_attempts: string; times_seen: string }[];
    recentSessions: {
      document_id: string;
      filename: string;
      objectives: string;
      first_try_pct: string;
      created_at: string;
    }[];
  };
  neo: {
    total_objectives: number;
    total_edges: number;
    documents_with_graph: number;
  } | null;
};

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm space-y-1">
      <div className="text-2xl font-bold text-stone-900">{value ?? "—"}</div>
      <div className="text-sm font-medium text-stone-700">{label}</div>
      {sub && <div className="text-xs text-stone-400">{sub}</div>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-full px-3 py-1 text-xs font-semibold text-teal-700 uppercase tracking-wide">
      {children}
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setError("Failed to load stats."));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center text-stone-500">
        {error}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center text-stone-400 text-sm">
        Loading…
      </div>
    );
  }

  const { pg, neo } = stats;
  const structuralCount = pg.evalLayers.find((l) => l.layer === "structural")?.count ?? "0";
  const llmCount = pg.evalLayers.find((l) => l.layer === "llm")?.count ?? "0";

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {/* Nav */}
      <nav className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="text-sm font-semibold text-stone-700 hover:text-teal-700 transition-colors">
            &larr; Back to App
          </a>
          <span className="text-sm font-medium text-stone-500">AI Lesson Agent &middot; Stats</span>
          <a href="/docs" className="text-sm text-stone-400 hover:text-stone-700 transition-colors">
            Docs
          </a>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-14 space-y-16">

        {/* Quiz performance */}
        <section className="space-y-6">
          <SectionLabel>Quiz Performance</SectionLabel>
          <h2 className="text-2xl font-bold text-stone-900">Student outcomes</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Questions answered" value={pg.overview.total_questions ?? "0"} />
            <Stat label="Objectives covered" value={pg.overview.total_objectives ?? "0"} />
            <Stat
              label="First-try correct rate"
              value={pg.overview.first_try_correct != null ? `${pg.overview.first_try_correct}%` : "—"}
              sub="% of objectives correct on first answer"
            />
            <Stat
              label="Avg attempts to correct"
              value={pg.overview.avg_attempts ?? "—"}
              sub="across all objectives"
            />
          </div>
        </section>

        {/* Self-eval pipeline */}
        <section className="space-y-6">
          <SectionLabel>Self-Eval Pipeline</SectionLabel>
          <h2 className="text-2xl font-bold text-stone-900">MCQ quality gate</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Total MCQs evaluated" value={pg.evalOverview.total_evals ?? "0"} />
            <Stat
              label="Pass rate"
              value={pg.evalOverview.pass_rate != null ? `${pg.evalOverview.pass_rate}%` : "—"}
              sub="passed all criteria on final attempt"
            />
            <Stat
              label="Avg eval rounds"
              value={pg.evalOverview.avg_rounds ?? "—"}
              sub="regeneration cycles per MCQ"
            />
            <Stat
              label="Hit eval cap"
              value={pg.evalOverview.cap_hits ?? "0"}
              sub="proceeded with best available MCQ"
            />
          </div>

          {/* Failure layer breakdown */}
          <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm space-y-3">
            <div className="text-sm font-semibold text-stone-700">Eval failure layer breakdown</div>
            <p className="text-xs text-stone-400">Where failures were caught — structural checks save LLM cost</p>
            <div className="flex gap-6">
              <div>
                <div className="text-xl font-bold text-teal-700">{structuralCount}</div>
                <div className="text-xs text-stone-500 mt-0.5">Structural (no LLM call)</div>
              </div>
              <div>
                <div className="text-xl font-bold text-orange-600">{llmCount}</div>
                <div className="text-xs text-stone-500 mt-0.5">LLM criteria failure</div>
              </div>
            </div>
          </div>
        </section>

        {/* Neo4j concept graph */}
        <section className="space-y-6">
          <SectionLabel>Concept Graph</SectionLabel>
          <h2 className="text-2xl font-bold text-stone-900">Neo4j prerequisite graph</h2>
          {neo ? (
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Objective nodes" value={neo.total_objectives} />
              <Stat
                label="Prerequisite edges"
                value={neo.total_edges}
                sub="PREREQUISITE_FOR relationships"
              />
              <Stat
                label="Documents with graph"
                value={neo.documents_with_graph}
                sub="uploaded PDFs with concept maps"
              />
            </div>
          ) : (
            <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-5">
              Neo4j unavailable — graph stats could not be loaded.
            </div>
          )}
        </section>

        {/* Top struggled objectives */}
        {pg.topStruggled.length > 0 && (
          <section className="space-y-6">
            <SectionLabel>Hardest Objectives</SectionLabel>
            <h2 className="text-2xl font-bold text-stone-900">Where students struggled most</h2>
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-5 py-3 text-stone-500 font-medium">Objective</th>
                    <th className="text-right px-5 py-3 text-stone-500 font-medium">Avg attempts</th>
                    <th className="text-right px-5 py-3 text-stone-500 font-medium">Times seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {pg.topStruggled.map((row, i) => (
                    <tr key={i} className="hover:bg-stone-50 transition-colors">
                      <td className="px-5 py-3 text-stone-800 max-w-xs truncate">{row.objective}</td>
                      <td className="px-5 py-3 text-right font-mono text-orange-600">{row.avg_attempts}</td>
                      <td className="px-5 py-3 text-right text-stone-500">{row.times_seen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Recent sessions */}
        {pg.recentSessions.length > 0 && (
          <section className="space-y-6">
            <SectionLabel>Recent Sessions</SectionLabel>
            <h2 className="text-2xl font-bold text-stone-900">Last 10 uploads</h2>
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-5 py-3 text-stone-500 font-medium">File</th>
                    <th className="text-right px-5 py-3 text-stone-500 font-medium">Objectives</th>
                    <th className="text-right px-5 py-3 text-stone-500 font-medium">First-try %</th>
                    <th className="text-right px-5 py-3 text-stone-500 font-medium">Uploaded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {pg.recentSessions.map((row) => (
                    <tr key={row.document_id} className="hover:bg-stone-50 transition-colors">
                      <td className="px-5 py-3 text-stone-800 max-w-xs truncate">{row.filename}</td>
                      <td className="px-5 py-3 text-right text-stone-600">{row.objectives ?? "0"}</td>
                      <td className="px-5 py-3 text-right font-mono text-teal-700">
                        {row.first_try_pct != null ? `${row.first_try_pct}%` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-stone-400 text-xs">
                        {new Date(row.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
