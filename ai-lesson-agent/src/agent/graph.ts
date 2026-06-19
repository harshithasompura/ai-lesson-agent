import { StateGraph, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import { GraphState, GraphStateType } from "./state";
import { generatePlanNode, planApprovalNode } from "./planner";
import { writeConceptGraphNode } from "./conceptGraph";
import {
  selectNextObjectiveNode,
  generateMCQNode,
  selfEvalNode,
  presentQuestionNode,
  gradingNode,
} from "./quiz";
import { hintNode, completionNode } from "./tutor";

// ── Routing helpers ────────────────────────────────────────────────────────

function afterSelfEval(state: GraphStateType): "generateMCQ" | "presentQuestion" {
  // selfEvalNode clears currentQuestion when it wants a regeneration
  return state.currentQuestion ? "presentQuestion" : "generateMCQ";
}

function afterGrading(state: GraphStateType): "hint" | "advance" {
  const last = state.attempts.at(-1);
  if (!last) return "hint";
  const { resolution } = JSON.parse(last);
  return resolution === "correct" || resolution === "revealed" ? "advance" : "hint";
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
  void state; // read to satisfy TS; we're just resetting fields
  return {
    currentQuestion: "",
    answerKey: "",
    attemptCount: 0,
    evalAttemptCount: 0,
    pendingAnswer: null,
  };
}

// ── Graph assembly ─────────────────────────────────────────────────────────

const workflow = new StateGraph(GraphState)
  .addNode("generatePlan", generatePlanNode)
  .addNode("planApproval", planApprovalNode)
  .addNode("writeConceptGraph", writeConceptGraphNode)
  .addNode("selectNextObjective", selectNextObjectiveNode)
  .addNode("generateMCQ", generateMCQNode)
  .addNode("selfEval", selfEvalNode)
  .addNode("presentQuestion", presentQuestionNode)
  .addNode("grading", gradingNode)
  .addNode("hint", hintNode)
  .addNode("advance", advanceNode)
  .addNode("completion", completionNode)

  .addEdge("__start__", "generatePlan")
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
  .addConditionalEdges("grading", afterGrading, {
    hint: "hint",
    advance: "advance",
  })
  .addEdge("hint", "presentQuestion")
  .addEdge("advance", "selectNextObjective")
  .addEdge("completion", END);

// ── Checkpointer ───────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const checkpointer = new PostgresSaver(pool);

export const graph = workflow.compile({ checkpointer });
