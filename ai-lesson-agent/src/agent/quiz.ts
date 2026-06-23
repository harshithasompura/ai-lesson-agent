import { interrupt } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { Client as LangSmithClient } from "langsmith";
import { z } from "zod";
import { runNeo4j } from "@/lib/neo4j";
import db from "@/lib/db";
import { GraphStateType } from "./state";

const lsClient = process.env.LANGSMITH_API_KEY ? new LangSmithClient() : null;

// ── Helpers ───────────────────────────────────────────────────────────────

async function logEval(documentId: string, objectiveIndex: number, evalAttempts: number, overallPass: boolean, passedCap: boolean, failureLayer?: "structural" | "llm") {
  await db.query(
    `INSERT INTO mcq_eval_log (document_id, objective_index, eval_attempts, final_score, passed_cap, failure_layer) VALUES ($1, $2, $3, $4, $5, $6)`,
    [documentId, objectiveIndex, evalAttempts, overallPass ? 1 : 0, passedCap, failureLayer ?? null]
  );
}

// ── Structural Validator ───────────────────────────────────────────────────

export function validateMCQStructure(mcq: { question: string; choices: string[]; correctIndex: number }): string | null {
  const { question, choices, correctIndex } = mcq;

  // 1. Exactly 4 distinct choices
  if (new Set(choices).size !== 4) {
    return `Choices must be exactly 4 distinct options (found ${new Set(choices).size} unique).`;
  }

  // 2. Question ≥ 10 words
  if (question.trim().split(/\s+/).length < 10) {
    return `Question is too short — must be at least 10 words.`;
  }

  // 3. Each choice ≥ 3 words
  const shortChoice = choices.find((c) => c.trim().split(/\s+/).length < 3);
  if (shortChoice) {
    return `Choice "${shortChoice}" is too short — each choice must be at least 3 words.`;
  }

  // 4. No meta-options
  const metaPattern = /^(all of the above|none of the above|both a and b)/i;
  const metaChoice = choices.find((c) => metaPattern.test(c.trim()));
  if (metaChoice) {
    return `Meta-option detected: "${metaChoice}". Do not use "all of the above", "none of the above", or "both A and B".`;
  }

  // 5. Question must end with ?
  if (!question.trimEnd().endsWith("?")) {
    return `Question must end with a "?".`;
  }

  // 6. No answer leak: distractors must not contain correct choice text
  const correctText = choices[correctIndex]?.toLowerCase() ?? "";
  const leakingDistractor = choices.find((c, i) => {
    if (i === correctIndex) return false;
    return c.toLowerCase().includes(correctText);
  });
  if (leakingDistractor) {
    return `Distractor "${leakingDistractor}" contains the correct answer text — this leaks the answer.`;
  }

  return null;
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
  criteria: z.array(z.object({
    name: z.string(),
    pass: z.boolean(),
    reason: z.string(),
  })),
  overallPass: z.boolean(),
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

const EVAL_SYSTEM = `You are an MCQ quality evaluator. Evaluate the question on four independent binary criteria:
1. unambiguous_answer: Is there exactly one unambiguously correct answer? (yes/no + reason)
2. plausible_distractors: Are all distractors plausible (not obviously wrong)? (yes/no + which is weak if no)
3. tests_objective: Does the question directly test the stated objective? (yes/no + reason)
4. grounded_in_passage: Is the correct answer derivable from the source passage? (yes/no + reason)

Return JSON: {"criteria": [{"name": string, "pass": boolean, "reason": string}, ...], "overallPass": boolean}
overallPass must be true only if ALL four criteria pass.`;

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
      await logEval(state.documentId, state.currentObjectiveIndex, nextEvalCount, false, true, "structural");
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

  // Layer A: structural validation (pure TS, no LLM)
  const structuralCritique = validateMCQStructure({ question, choices, correctIndex });
  if (structuralCritique !== null) {
    if (nextEvalCount >= 3) {
      console.warn(`[quiz] MCQ structural validation failed for objective "${objective}" at cap. Proceeding.`);
      await logEval(state.documentId, state.currentObjectiveIndex, nextEvalCount, false, true, "structural");
      return { evalAttemptCount: nextEvalCount };
    }
    return {
      currentQuestion: "",
      answerKey: "",
      evalAttemptCount: nextEvalCount,
      messages: [
        {
          role: "assistant" as const,
          content: `MCQ critique (attempt ${nextEvalCount}): ${structuralCritique}`,
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

  if (evaluation.overallPass) {
    await logEval(state.documentId, state.currentObjectiveIndex, nextEvalCount, true, false);
    if (lsClient) {
      lsClient.createExample(
        { question, choices, objective },
        { criteria: evaluation.criteria, overallPass: true },
        { datasetName: "mcq-eval" }
      ).catch(() => {}); // ponytail: fire-and-forget, eval logging must not block quiz
    }
    return {};
  }

  // CONSTITUTION §Principle 3: cap at 3 total attempts (2 regenerations)
  if (nextEvalCount >= 3) {
    // Past cap — proceed with best available MCQ, flag it
    console.warn(
      `[quiz] MCQ self-eval cap reached for objective "${objective}". Proceeding with failing MCQ.`
    );
    await logEval(state.documentId, state.currentObjectiveIndex, nextEvalCount, false, true, "llm");
    return { evalAttemptCount: nextEvalCount };
  }

  const failedReasons = evaluation.criteria.filter((c) => !c.pass).map((c) => c.reason).join(". ");

  // Clear question so generateMCQNode re-runs with critique injected via messages
  return {
    currentQuestion: "",
    answerKey: "",
    evalAttemptCount: nextEvalCount,
    messages: [
      {
        role: "assistant" as const,
        content: `MCQ critique (attempt ${nextEvalCount}): ${failedReasons}`,
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
