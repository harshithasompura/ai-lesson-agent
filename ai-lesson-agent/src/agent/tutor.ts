import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { runNeo4j } from "@/lib/neo4j";
import db from "@/lib/db";
import { GraphStateType } from "./state";

// ── Schema ─────────────────────────────────────────────────────────────────

const HintSchema = z.object({
  hint: z.string(),
});

// ── Models ─────────────────────────────────────────────────────────────────

const tutorModel = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0.3,
}).withStructuredOutput(HintSchema);

// ── Prompts ────────────────────────────────────────────────────────────────

// CONSTITUTION §Principle 1: Tutor system prompt structurally excludes answerKey
const HINT_SYSTEM = `You are a Tutor Agent. A student answered a quiz question incorrectly.
Your job is to give a targeted hint that guides them toward the correct answer without revealing it.

Rules:
- Hint must nudge thinking, not give the answer away
- Reference the learning objective
- Keep hint to 1-2 sentences
- Do not repeat the question back verbatim`;

const REVEAL_SYSTEM = `You are a Tutor Agent. A student has exhausted their attempts on a quiz question.
Your job is to give a clear, educational explanation of the correct answer.

Rules:
- Explain WHY the correct answer is correct
- Briefly explain why the other options are wrong if relevant
- Keep it under 4 sentences
- Be encouraging — frame it as a learning moment`;

// ── Nodes ──────────────────────────────────────────────────────────────────

/** Returns hint on attempts 1-2; full reveal + correct answer on attempt 3. */
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

  const isReveal = state.attemptCount >= 3;

  if (isReveal) {
    // CONSTITUTION §Principle 1: reveal uses explanation from answerKey (Quiz Agent authored it)
    // Tutor receives it here ONLY at the reveal stage — it cannot derive it
    const { explanation, correctIndex } = JSON.parse(state.answerKey);
    const correctChoice = choices[correctIndex];

    const result = await tutorModel.invoke([
      { role: "system", content: REVEAL_SYSTEM },
      {
        role: "user",
        content: `Objective: ${objective}\nQuestion: ${question}\nChoices: ${JSON.stringify(choices)}\nCorrect answer: ${correctChoice}\nExplanation: ${explanation}\n\nWrite the reveal explanation.`,
      },
    ]);

    return {
      messages: [
        {
          role: "assistant" as const,
          content: `**Answer revealed:** ${correctChoice}\n\n${result.hint}`,
        } as never,
      ],
    };
  }

  // Hint path — CONSTITUTION §Principle 1: answerKey NOT passed to prompt
  const result = await tutorModel.invoke([
    { role: "system", content: HINT_SYSTEM },
    {
      role: "user",
      content: `Objective: ${objective}\nQuestion: ${question}\nChoices: ${JSON.stringify(choices)}\nStudent selected: ${choices[lastAttempt?.selectedIndex ?? 0]}\nAttempts so far: ${state.attemptCount}\n\nWrite a hint.`,
    },
  ]);

  return {
    messages: [
      {
        role: "assistant" as const,
        content: result.hint,
      } as never,
    ],
  };
}

/** Final recap node. Reads from Postgres (CONSTITUTION §Principle 9). */
export async function completionNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const { rows } = await db.query<{
    objective: string;
    resolution: string | null;
    attempt_number: number;
  }>(
    `SELECT objective, resolution, attempt_number
     FROM quiz_attempts
     WHERE document_id = $1
     ORDER BY objective_index ASC, attempt_number DESC`,
    [state.documentId]
  );

  // Last row per objective = final resolution
  const seen = new Set<string>();
  const finalAttempts: typeof rows = [];
  for (const row of rows) {
    if (!seen.has(row.objective)) {
      seen.add(row.objective);
      finalAttempts.push(row);
    }
  }

  const correct = finalAttempts.filter((r) => r.resolution === "correct");
  const revealed = finalAttempts.filter((r) => r.resolution === "revealed");

  // Enrich struggled objectives via Neo4j (CONSTITUTION §Principle 4: timeout + fallback)
  const studyTips = await runNeo4j(async (session) => {
    if (revealed.length === 0) return null;

    const struggledTitles = revealed.map((r) => r.objective);
    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (o:Objective {documentId: $documentId})
         WHERE o.title IN $struggledTitles
         OPTIONAL MATCH (pre:Objective {documentId: $documentId})-[:PREREQUISITE_FOR]->(o)
         RETURN o.title AS objective, collect(pre.title) AS prerequisites`,
        { documentId: state.documentId, struggledTitles }
      )
    );

    return result.records.map((r) => ({
      objective: r.get("objective") as string,
      prerequisites: r.get("prerequisites") as string[],
    }));
  }, null);

  const recap = [
    `## Session Complete`,
    ``,
    `**Score:** ${correct.length}/${finalAttempts.length} objectives mastered`,
    ``,
    correct.length > 0
      ? `**Mastered:**\n${correct.map((r) => `- ${r.objective}`).join("\n")}`
      : "",
    revealed.length > 0
      ? `**Review these:**\n${revealed.map((r) => `- ${r.objective}`).join("\n")}`
      : "",
    studyTips && studyTips.length > 0
      ? `\n**Study tips:**\n${studyTips
          .map((t) =>
            t.prerequisites.length > 0
              ? `- Revisit **${t.objective}** — review prerequisite(s): ${t.prerequisites.join(", ")}`
              : `- Revisit **${t.objective}**`
          )
          .join("\n")}`
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
