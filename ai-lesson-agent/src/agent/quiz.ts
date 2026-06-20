import { interrupt } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { runNeo4j } from "@/lib/neo4j";
import db from "@/lib/db";
import { GraphStateType } from "./state";

// ── Schemas ────────────────────────────────────────────────────────────────

const MCQSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
});

const EvalSchema = z.object({
  score: z.number().int().min(0).max(5),
  critique: z.string(),
});

type MCQ = z.infer<typeof MCQSchema>;

// ── Models ─────────────────────────────────────────────────────────────────

const quizModel = new ChatAnthropic({
  model: "claude-sonnet-4-6",
  temperature: 0.7, // slight variance for MCQ quality
}).withStructuredOutput(MCQSchema, { method: "jsonMode" });

const evalModel = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0,
}).withStructuredOutput(EvalSchema, { method: "jsonMode" });

// ── Prompts ────────────────────────────────────────────────────────────────

const QUIZ_SYSTEM = `You are the Quiz Agent. Your job is to write one multiple-choice question (MCQ) for a given learning objective.

Rules:
- One unambiguously correct answer only
- Distractors must be plausible — not obviously wrong
- Question must directly test the stated objective
- Do not include "all of the above" or "none of the above"
- Respond with a JSON object: {"question": string, "choices": [string, string, string, string], "correctIndex": number, "explanation": string}`;

const EVAL_SYSTEM = `You are a MCQ quality evaluator. Score the question on a 0–5 scale:
- 5: unambiguous correct answer, all distractors plausible, directly tests the objective
- 3–4: minor issues (slightly ambiguous, one weak distractor)
- 0–2: serious issues (ambiguous answer, trivial distractors, objective drift)

Be strict — a 3 is a borderline pass. Respond with a JSON object: {"score": number, "critique": string}`;

const EVAL_PASS_THRESHOLD = 3;

// ── Nodes ──────────────────────────────────────────────────────────────────

/** Query Neo4j for unresolved objective with fewest unresolved prerequisites.
 *  Falls back to plan-list order on timeout, error, or cycle. */
export async function selectNextObjectiveNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const resolvedIndices = new Set(
    state.attempts.map((a) => JSON.parse(a).objectiveIndex as number)
  );

  const nextByList = state.objectives.findIndex(
    (_, i) => !resolvedIndices.has(i)
  );

  if (nextByList === -1) {
    // All done — signal completion via sentinel index
    return { currentObjectiveIndex: state.objectives.length };
  }

  // Neo4j: find unresolved objective with fewest unresolved prerequisites
  // CONSTITUTION §Principle 4 + 7: runNeo4j wraps with 1.5s timeout; documentId on every query
  const neoIndex = await runNeo4j(async (session) => {
    const unresolvedTitles = state.objectives.filter(
      (_, i) => !resolvedIndices.has(i)
    );

    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (o:Objective {documentId: $documentId})
         WHERE o.title IN $unresolvedTitles
         OPTIONAL MATCH (pre:Objective {documentId: $documentId})-[:PREREQUISITE_FOR]->(o)
         WHERE pre.title IN $unresolvedTitles
         WITH o, count(pre) AS unresolvedPrereqCount
         ORDER BY unresolvedPrereqCount ASC
         LIMIT 1
         RETURN o.title AS title`,
        { documentId: state.documentId, unresolvedTitles }
      )
    );

    const title = result.records[0]?.get("title") as string | undefined;
    if (!title) return null;

    const idx = state.objectives.indexOf(title);
    return idx === -1 ? null : idx;
  }, null);

  return { currentObjectiveIndex: neoIndex ?? nextByList };
}

/** Generate MCQ for the current objective.
 *  Guard: skip if currentQuestion already set (retry attempt, not first visit). */
export async function generateMCQNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  if (state.currentQuestion) {
    // Re-entering on hint retry — question already exists, don't regenerate
    return {};
  }

  const objective = state.objectives[state.currentObjectiveIndex];
  const approvedPlan = state.plan;

  // CONSTITUTION §Principle 5: Quiz Agent sees approved plan + objective only
  const mcq: MCQ = await quizModel.invoke([
    { role: "system", content: QUIZ_SYSTEM },
    {
      role: "user",
      content: `Approved lesson plan:\n${approvedPlan}\n\nCurrent objective:\n${objective}\n\nWrite one MCQ for this objective.`,
    },
  ]);

  return {
    // currentQuestion holds display data only — no answer key
    currentQuestion: JSON.stringify({ question: mcq.question, choices: mcq.choices }),
    // answerKey isolated: Tutor Agent must never receive this — CONSTITUTION §Principle 1
    answerKey: JSON.stringify({ correctIndex: mcq.correctIndex, explanation: mcq.explanation }),
    attemptCount: 0,
    evalAttemptCount: (state.evalAttemptCount ?? 0),
  };
}

/** Score the generated MCQ. Below threshold and under cap → regenerate with critique. */
export async function selfEvalNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const objective = state.objectives[state.currentObjectiveIndex];
  const { question, choices } = JSON.parse(state.currentQuestion);
  const { correctIndex } = JSON.parse(state.answerKey);

  const evaluation = await evalModel.invoke([
    { role: "system", content: EVAL_SYSTEM },
    {
      role: "user",
      content: `Objective: ${objective}\nQuestion: ${question}\nChoices: ${JSON.stringify(choices)}\nCorrect index: ${correctIndex}`,
    },
  ]);

  if (evaluation.score >= EVAL_PASS_THRESHOLD) {
    // Passes — proceed to present-question node
    return {};
  }

  // CONSTITUTION §Principle 3: cap at 3 total attempts (2 regenerations)
  const nextEvalCount = (state.evalAttemptCount ?? 0) + 1;
  if (nextEvalCount >= 3) {
    // Past cap — proceed with best available MCQ, flag it
    console.warn(
      `[quiz] MCQ self-eval cap reached for objective "${objective}". Score: ${evaluation.score}. Proceeding.`
    );
    return { evalAttemptCount: nextEvalCount };
  }

  // Clear question so generateMCQNode re-runs with critique injected via messages
  return {
    currentQuestion: "",
    answerKey: "",
    evalAttemptCount: nextEvalCount,
    messages: [
      {
        role: "assistant" as const,
        content: `MCQ critique (attempt ${nextEvalCount}): ${evaluation.critique}`,
      } as never,
    ],
  };
}

/** Pause and present the question to the user. Guard prevents re-firing if already answered. */
export async function presentQuestionNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const objective = state.objectives[state.currentObjectiveIndex];
  const { question, choices } = JSON.parse(state.currentQuestion);

  // Resume value wrapped as { selectedIndex } to avoid LangGraph EmptyInputError when index is 0
  const { selectedIndex }: { selectedIndex: number } = interrupt({
    type: "quizAnswer",
    objective,
    question,
    choices,
    attemptCount: state.attemptCount,
  });

  return { pendingAnswer: selectedIndex };
}

/** Grade the user's answer. Write quiz_attempts row to Postgres. */
export async function gradingNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const { question, choices } = JSON.parse(state.currentQuestion);
  const { correctIndex, explanation } = JSON.parse(state.answerKey);

  const selectedIndex = state.pendingAnswer!;

  const isCorrect = selectedIndex === correctIndex;
  const newAttemptCount = (state.attemptCount ?? 0) + 1;
  const hitCap = newAttemptCount >= 3;
  const resolution = isCorrect ? "correct" : hitCap ? "revealed" : null;

  await db.query(
    `INSERT INTO quiz_attempts
       (document_id, objective_index, objective, question, choices, selected_index, correct_index, attempt_number, resolution)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      state.documentId,
      state.currentObjectiveIndex,
      state.objectives[state.currentObjectiveIndex],
      question,
      JSON.stringify(choices),
      selectedIndex,
      correctIndex,
      newAttemptCount,
      resolution,
    ]
  );

  return {
    attemptCount: newAttemptCount,
    pendingAnswer: null,
    attempts: [
      JSON.stringify({
        objectiveIndex: state.currentObjectiveIndex,
        question,
        selectedIndex,
        correctIndex,
        isCorrect,
        attemptNumber: newAttemptCount,
        resolution,
        explanation: resolution === "revealed" ? explanation : null,
      }),
    ],
  };
}
