import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { runNeo4j } from "@/lib/neo4j";
import db from "@/lib/db";
import { GraphStateType } from "./state";

// ── Schema ─────────────────────────────────────────────────────────────────

const HintSchema = z.object({
  hint: z.string(),
  sourceRef: z.string().optional(),
});

// ── Models ─────────────────────────────────────────────────────────────────

const tutorModel = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0.3,
}).withStructuredOutput(HintSchema, { method: "jsonMode" });

// ── Prompts ────────────────────────────────────────────────────────────────

// CONSTITUTION §Principle 1: Tutor system prompt structurally excludes answerKey
const HINT_SYSTEM = `You are a Tutor Agent. A student answered a quiz question incorrectly.
Your job is to give a targeted hint that guides them toward the correct answer without revealing it.

Rules:
- Hint must nudge thinking, not give the answer away
- Reference the learning objective
- Keep hint to 1-2 sentences
- Do not repeat the question back verbatim
- If a source passage is provided, set sourceRef to a topic/section label only (e.g. "Nasal cavity" or "Respiratory System > Filtering function") — never quote or paraphrase the passage, that gives away the answer
- Respond with a JSON object: {"hint": string, "sourceRef": string | undefined}`;

// ── Nodes ──────────────────────────────────────────────────────────────────

/** Returns a hint guiding the student toward the answer without revealing it. */
export async function hintNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const objective = state.objectives[state.currentObjectiveIndex];
  const { question, choices } = JSON.parse(state.currentQuestion);

  // Last attempt record for this objective
  const lastAttempt = [...state.attempts]
    .reverse()
    .map((a) => JSON.parse(a))
    .find((a) => a.objectiveIndex === state.currentObjectiveIndex);

  // Fetch source_passage from DB — CONSTITUTION §Principle 1: source comes from DB, not answerKey
  const { rows: passageRows } = await db.query<{ source_passage: string }>(
    `SELECT source_passage FROM quiz_attempts
     WHERE document_id = $1 AND objective_index = $2
       AND source_passage IS NOT NULL
     ORDER BY attempt_number DESC LIMIT 1`,
    [state.documentId, state.currentObjectiveIndex]
  );
  const sourcePassage = passageRows[0]?.source_passage ?? null;

  const sourceContext = sourcePassage
    ? `\nSource passage from the document: "${sourcePassage}"\nUse this to set sourceRef in your response.`
    : "";

  // CONSTITUTION §Principle 1: answerKey NOT passed to prompt
  const result = await tutorModel.invoke([
    { role: "system", content: HINT_SYSTEM },
    {
      role: "user",
      content: `Objective: ${objective}\nQuestion: ${question}\nChoices: ${JSON.stringify(choices)}\nStudent selected: ${choices[lastAttempt?.selectedIndex ?? 0]}\nAttempts so far: ${state.attemptCount}${sourceContext}\n\nWrite a hint.`,
    },
  ]);

  return { lastHint: result.hint, lastHintSourceRef: result.sourceRef ?? null };
}

/** Final recap node. Reads from Postgres (CONSTITUTION §Principle 9). */
export async function completionNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const { rows } = await db.query<{
    objective: string;
    objective_index: number;
    attempt_number: number;
    resolution: string | null;
  }>(
    `SELECT objective, objective_index, attempt_number, resolution
     FROM quiz_attempts
     WHERE document_id = $1
     ORDER BY objective_index ASC, attempt_number ASC`,
    [state.documentId]
  );

  // Per objective: total attempts and whether they got it correct
  type ObjStat = { objective: string; totalAttempts: number; correct: boolean };
  const byIndex = new Map<number, ObjStat>();
  for (const row of rows) {
    const existing = byIndex.get(row.objective_index);
    byIndex.set(row.objective_index, {
      objective: row.objective,
      totalAttempts: row.attempt_number,
      correct: row.resolution === "correct" || existing?.correct === true,
    });
  }
  const stats = [...byIndex.values()];

  const firstTry = stats.filter((s) => s.correct && s.totalAttempts === 1);
  const struggled = stats.filter((s) => s.correct && s.totalAttempts > 1);

  // Enrich struggled objectives with prerequisite context from Neo4j
  const prereqTips = await runNeo4j(async (session) => {
    if (struggled.length === 0) return null;
    const titles = struggled.map((s) => s.objective);
    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (o:Objective {documentId: $documentId})
         WHERE o.title IN $titles
         OPTIONAL MATCH (pre:Objective {documentId: $documentId})-[:PREREQUISITE_FOR]->(o)
         RETURN o.title AS objective, collect(pre.title) AS prerequisites`,
        { documentId: String(state.documentId), titles }
      )
    );
    return result.records.map((r) => ({
      objective: r.get("objective") as string,
      prerequisites: r.get("prerequisites") as string[],
    }));
  }, null);

  const tipLines = struggled.map((s) => {
    const prereqs = prereqTips?.find((t) => t.objective === s.objective)?.prerequisites ?? [];
    const attemptsNote = `(needed ${s.totalAttempts} attempts)`;
    return prereqs.length > 0
      ? `- **${s.objective}** ${attemptsNote} — strengthen prerequisite(s): ${prereqs.join(", ")}`
      : `- **${s.objective}** ${attemptsNote} — review this concept before moving on`;
  });

  const recap = [
    `## Session Complete`,
    ``,
    `**Score:** ${stats.filter((s) => s.correct).length}/${stats.length} objectives mastered`,
    ``,
    firstTry.length > 0
      ? `**Got it first try:**\n${firstTry.map((s) => `- ${s.objective}`).join("\n")}`
      : "",
    struggled.length > 0
      ? `**Needed more attempts:**\n${struggled.map((s) => `- ${s.objective} (${s.totalAttempts} tries)`).join("\n")}`
      : "",
    tipLines.length > 0
      ? `\n**Study tips:**\n${tipLines.join("\n")}`
      : struggled.length === 0
      ? `\n**Study tips:**\nExcellent work — you answered every question correctly on the first attempt!`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    messages: [
      {
        role: "assistant" as const,
        content: recap,
      } as never,
    ],
  };
}
