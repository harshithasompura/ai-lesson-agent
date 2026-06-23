import db from "@/lib/db";
import { runNeo4j } from "@/lib/neo4j";
import { NextResponse } from "next/server";

export async function GET() {
  const [pg, neo] = await Promise.all([fetchPostgresStats(), fetchNeo4jStats()]);
  return NextResponse.json({ pg, neo });
}

async function fetchPostgresStats() {
  const [overview, evalOverview, evalLayers, topStruggled, recentSessions] =
    await Promise.all([
      db.query<{ total_questions: string; total_objectives: string; first_try_correct: string; avg_attempts: string }>(`
        SELECT
          COUNT(*)                                                            AS total_questions,
          COUNT(DISTINCT document_id || '-' || objective_index)              AS total_objectives,
          ROUND(100.0 * SUM(CASE WHEN attempt_number = 1 AND resolution = 'correct' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(DISTINCT document_id || '-' || objective_index), 0), 1) AS first_try_correct,
          ROUND(AVG(attempt_number) FILTER (WHERE resolution = 'correct'), 2) AS avg_attempts
        FROM quiz_attempts
      `),

      db.query<{ total_evals: string; avg_rounds: string; cap_hits: string; pass_rate: string }>(`
        SELECT
          COUNT(*)                                                         AS total_evals,
          ROUND(AVG(eval_attempts), 2)                                     AS avg_rounds,
          SUM(CASE WHEN passed_cap THEN 1 ELSE 0 END)                      AS cap_hits,
          ROUND(100.0 * SUM(CASE WHEN final_score = 1 THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0), 1)                                      AS pass_rate
        FROM mcq_eval_log
      `),

      db.query<{ layer: string; count: string }>(`
        SELECT COALESCE(failure_layer, 'llm') AS layer, COUNT(*) AS count
        FROM mcq_eval_log
        WHERE final_score = 0 AND NOT passed_cap
        GROUP BY COALESCE(failure_layer, 'llm')
      `),

      db.query<{ objective: string; avg_attempts: string; times_seen: string }>(`
        SELECT objective,
               ROUND(AVG(attempt_number), 2) AS avg_attempts,
               COUNT(*)                       AS times_seen
        FROM quiz_attempts
        WHERE resolution = 'correct'
        GROUP BY objective
        ORDER BY AVG(attempt_number) DESC
        LIMIT 5
      `),

      db.query<{ document_id: string; filename: string; objectives: string; first_try_pct: string; created_at: string }>(`
        SELECT
          d.id::text                                                              AS document_id,
          d.filename,
          COUNT(DISTINCT qa.objective_index)::text                               AS objectives,
          ROUND(100.0 * SUM(CASE WHEN qa.attempt_number = 1 AND qa.resolution = 'correct' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(DISTINCT qa.objective_index), 0), 1)::text           AS first_try_pct,
          d.created_at::text
        FROM documents d
        LEFT JOIN quiz_attempts qa ON qa.document_id = d.id
        GROUP BY d.id, d.filename, d.created_at
        ORDER BY d.created_at DESC
        LIMIT 10
      `),
    ]);

  return {
    overview: overview.rows[0],
    evalOverview: evalOverview.rows[0],
    evalLayers: evalLayers.rows,
    topStruggled: topStruggled.rows,
    recentSessions: recentSessions.rows,
  };
}

async function fetchNeo4jStats() {
  return runNeo4j(async (session) => {
    const result = await session.executeRead((tx) =>
      tx.run(`
        MATCH (o:Objective)
        OPTIONAL MATCH (o)-[r:PREREQUISITE_FOR]->()
        WITH
          count(DISTINCT o)  AS total_objectives,
          count(r)           AS total_edges,
          collect(DISTINCT o.documentId) AS docs
        RETURN total_objectives, total_edges, size(docs) AS documents_with_graph
      `)
    );
    const row = result.records[0];
    return {
      total_objectives: row?.get("total_objectives")?.toNumber() ?? 0,
      total_edges: row?.get("total_edges")?.toNumber() ?? 0,
      documents_with_graph: row?.get("documents_with_graph")?.toNumber() ?? 0,
    };
  }, null);
}
