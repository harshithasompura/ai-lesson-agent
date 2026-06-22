import { interrupt } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { runNeo4j } from "@/lib/neo4j";
import db from "@/lib/db";
import { GraphStateType } from "./state";

// ── Helpers ───────────────────────────────────────────────────────────────

async function logEval(documentId: string, objectiveIndex: number, evalAttempts: number, score: number, passedCap: boolean) {
  await db.query(
    `INSERT INTO mcq_eval_log (document_id, objective_index, eval_attempts, final_score, passed_cap) VALUES ($1, $2, $3, $4, $5)`,
    [documentId, objectiveIndex, evalAttempts, score, passedCap]
  );
}

// ── Schemas ────────────────────────────────────────────────────────────────

const MCQSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  sourcePassage: z.string(), // verbatim excerpt from document
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

const QUIZ_SYSTEM = `You are the Quiz Agent. Your job is to write one multiple-choice question (MCQ) for a given learning objective, grounded in the provided document text.

Rules:
- One unambiguously correct answer only
- Distractors must be plausible — not obviously wrong
- Question must directly test the stated objective
- Do not include "all of the above" or "none of the above"
- sourcePassage must be a verbatim excerpt (≤ 3 sentences) from the document that directly supports the correct answer
- If no single passage supports it, quote the most relevant sentence
- Respond with a JSON object: {"question": string, "choices": [string, string, string, string], "correctIndex": number, "explanation": string, "sourcePassage": string}`;

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
        { documentId: String(state.documentId), unresolvedTitles }
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
  // Include any critique messages from prior self-eval attempts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const critiqueMessages = (state.messages ?? []).filter((m: any) =>
    (m.role === "assistant" || m._getType?.() === "ai") && String(m.content ?? "").startsWith("MCQ critique")
  );
  const mcq: MCQ = await quizModel.invoke([
    { role: "system", content: QUIZ_SYSTEM },
    {
      role: "user",
      content: `Document text:\n${(state.extractedText ?? "").slice(0, 8000)}\n\nApproved lesson plan:\n${approvedPlan}\n\nObjective: ${objective}\n\nWrite one MCQ grounded in the document.`,
    },
    ...critiqueMessages,
    ...(critiqueMessages.length > 0
      ? [{ role: "user" as const, content: "Rewrite the MCQ addressing the critique above." }]
      : []),
  ]);

  // Build updated sourceExcerpts: one slot per objective, set at currentObjectiveIndex
  const excerpts = [...(state.sourceExcerpts ?? [])];
  excerpts[state.currentObjectiveIndex] = mcq.sourcePassage ?? "";

  return {
    // currentQuestion holds display data only — no answer key
    currentQuestion: JSON.stringify({ question: mcq.question, choices: mcq.choices }),
    // answerKey isolated: Tutor Agent must never receive this — CONSTITUTION §Principle 1
    answerKey: JSON.stringify({ correctIndex: mcq.correctIndex, explanation: mcq.explanation, sourcePassage: mcq.sourcePassage ?? "" }),
    sourceExcerpts: excerpts,
    attemptCount: 0,
    evalAttemptCount: (state.evalAttemptCount ?? 0),
    lastHint: null,
  };
}

/** Normalise text for fuzzy passage matching — collapse whitespace, lowercase. */
function normalise(s: string) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Score the generated MCQ. Below threshold and under cap → regenerate with critique. */
export async function selfEvalNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const objective = state.objectives[state.currentObjectiveIndex];
  const { question, choices } = JSON.parse(state.currentQuestion);
  const { correctIndex, sourcePassage } = JSON.parse(state.answerKey);

  // Shared attempt counter — used by both passage check and score check below
  const nextEvalCount = (state.evalAttemptCount ?? 0) + 1;

  // Verify sourcePassage is actually in the document before spending an LLM eval call.
  if (sourcePassage && !normalise(state.extractedText ?? "").includes(normalise(sourcePassage))) {
    if (nextEvalCount >= 3) {
      // Cap reached even on passage check — proceed with warning
      console.warn(`[quiz] sourcePassage not found in document for objective "${objective}". Cap reached, proceeding.`);
      await logEval(state.documentId, state.currentObjectiveIndex, nextEvalCount, 0, true);
      return { evalAttemptCount: nextEvalCount };
    }
    return {
      currentQuestion: "",
      answerKey: "",
      evalAttemptCount: nextEvalCount,
      messages: [
        {
          role: "assistant" as const,
          content: `MCQ critique (attempt ${nextEvalCount}): The sourcePassage you quoted does not appear verbatim in the document. You must copy an exact passage from the document text — do not paraphrase or invent one.`,
        } as never,
      ],
    };
  }

  const evaluation = await evalModel.invoke([
    { role: "system", content: EVAL_SYSTEM },
    {
      role: "user",
      content: `Objective: ${objective}\nQuestion: ${question}\nChoices: ${JSON.stringify(choices)}\nCorrect index: ${correctIndex}`,
    },
  ]);

  if (evaluation.score >= EVAL_PASS_THRESHOLD) {
    // Passes — log and proceed to present-question node
    await logEval(state.documentId, state.currentObjectiveIndex, nextEvalCount, evaluation.score, false);
    return {};
  }

  // CONSTITUTION §Principle 3: cap at 3 total attempts (2 regenerations)
  if (nextEvalCount >= 3) {
    // Past cap — proceed with best available MCQ, flag it
    console.warn(
      `[quiz] MCQ self-eval cap reached for objective "${objective}". Score: ${evaluation.score}. Proceeding.`
    );
    await logEval(state.documentId, state.currentObjectiveIndex, nextEvalCount, evaluation.score, true);
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

  const raw = interrupt({
    type: "quizAnswer",
    objective,
    question,
    choices,
    attemptCount: state.attemptCount,
  });
  // interrupt() may return the resume value as a JSON string (when Command({ resume: string }) is used)
  const { selectedIndex }: { selectedIndex: number } =
    typeof raw === "string" ? JSON.parse(raw) : raw;

  // Clear previous attempt's feedback before grading the new answer
  return { pendingAnswer: selectedIndex, lastResult: null, lastHint: null };
}

/** Interrupt to show the grading result in the UI before advancing. Clears lastResult on resume. */
export async function resultNode(_state: GraphStateType): Promise<Partial<GraphStateType>> {
  interrupt({ type: "result" });
  return { lastResult: null };
}

/** Grade the user's answer. Write quiz_attempts row to Postgres. */
export async function gradingNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const { question, choices } = JSON.parse(state.currentQuestion);
  const { correctIndex, explanation, sourcePassage } = JSON.parse(state.answerKey);

  const selectedIndex = state.pendingAnswer!;

  const isCorrect = selectedIndex === correctIndex;
  const newAttemptCount = (state.attemptCount ?? 0) + 1;
  const resolution = isCorrect ? "correct" : null;

  await db.query(
    `INSERT INTO quiz_attempts
       (document_id, objective_index, objective, question, choices, selected_index, correct_index, attempt_number, resolution, source_passage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
      sourcePassage ?? null,
    ]
  );

  return {
    attemptCount: newAttemptCount,
    pendingAnswer: null,
    lastResult: {
      isCorrect,
      correctIndex,
      selectedIndex,
      explanation: isCorrect ? explanation : null,
      resolution,
    },
    attempts: [
      JSON.stringify({
        objectiveIndex: state.currentObjectiveIndex,
        question,
        selectedIndex,
        correctIndex,
        isCorrect,
        attemptNumber: newAttemptCount,
        resolution,
      }),
    ],
  };
}
