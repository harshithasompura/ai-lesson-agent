import { StateGraph, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import { GraphState, GraphStateType } from "./state";
import db from "@/lib/db";
import { generatePlanNode, planApprovalNode } from "./planner";
import { writeConceptGraphNode } from "./conceptGraph";
import {
  selectNextObjectiveNode,
  generateMCQNode,
  selfEvalNode,
  presentQuestionNode,
  gradingNode,
  resultNode,
} from "./quiz";
import { hintNode, completionNode } from "./tutor";

// ── Routing helpers ────────────────────────────────────────────────────────

function afterSelfEval(state: GraphStateType): "generateMCQ" | "presentQuestion" {
  // selfEvalNode clears currentQuestion when it wants a regeneration
  return state.currentQuestion ? "presentQuestion" : "generateMCQ";
}

function afterResult(state: GraphStateType): "hint" | "advance" {
  const last = state.attempts.at(-1);
  if (!last) return "advance";
  const { resolution } = JSON.parse(last);
  return resolution === "correct" ? "advance" : "hint";
}

function afterHint(state: GraphStateType): "presentQuestion" | "advance" {
  // After a reveal (3rd wrong answer), hintNode ran — now advance to next objective
  return state.attemptCount >= 3 ? "advance" : "presentQuestion";
}

function afterSelectObjective(
  state: GraphStateType
): "generateMCQ" | "completion" {
  // sentinel: currentObjectiveIndex === objectives.length means all done
  return state.currentObjectiveIndex >= state.objectives.length
    ? "completion"
    : "generateMCQ";
}

// ── Advance node: clear per-question state before next objective ────────────

async function advanceNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  void state;
  return {
    currentQuestion: "",
    answerKey: "",
    attemptCount: 0,
    evalAttemptCount: 0,
    pendingAnswer: null,
    lastResult: null,
  };
}

// ── loadDocument node ──────────────────────────────────────────────────────

async function loadDocumentNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const { rows } = await db.query<{ extracted_text: string }>(
    "SELECT extracted_text FROM documents WHERE id = $1",
    [state.documentId]
  );
  if (!rows[0]) throw new Error(`Document ${state.documentId} not found`);
  return { extractedText: rows[0].extracted_text };
}

// ── Graph assembly ─────────────────────────────────────────────────────────

const workflow = new StateGraph(GraphState)
  .addNode("loadDocument", loadDocumentNode)
  .addNode("generatePlan", generatePlanNode)
  .addNode("planApproval", planApprovalNode)
  .addNode("writeConceptGraph", writeConceptGraphNode)
  .addNode("selectNextObjective", selectNextObjectiveNode)
  .addNode("generateMCQ", generateMCQNode)
  .addNode("selfEval", selfEvalNode)
  .addNode("presentQuestion", presentQuestionNode)
  .addNode("grading", gradingNode)
  .addNode("result", resultNode)
  .addNode("hint", hintNode)
  .addNode("advance", advanceNode)
  .addNode("completion", completionNode)

  .addEdge("__start__", "loadDocument")
  .addEdge("loadDocument", "generatePlan")
  .addEdge("generatePlan", "planApproval")
  .addEdge("planApproval", "writeConceptGraph")
  .addEdge("writeConceptGraph", "selectNextObjective")
  .addConditionalEdges("selectNextObjective", afterSelectObjective, {
    generateMCQ: "generateMCQ",
    completion: "completion",
  })
  .addEdge("generateMCQ", "selfEval")
  .addConditionalEdges("selfEval", afterSelfEval, {
    generateMCQ: "generateMCQ",
    presentQuestion: "presentQuestion",
  })
  .addEdge("presentQuestion", "grading")
  .addEdge("grading", "result")
  .addConditionalEdges("result", afterResult, {
    hint: "hint",
    advance: "advance",
  })
  .addConditionalEdges("hint", afterHint, {
    presentQuestion: "presentQuestion",
    advance: "advance",
  })
  .addEdge("advance", "selectNextObjective")
  .addEdge("completion", END);

// ── Checkpointer ───────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const checkpointer = new PostgresSaver(pool);

export const graph = workflow.compile({ checkpointer });
