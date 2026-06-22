import { interrupt } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { GraphStateType } from "./state";

const PlanSchema = z.object({
  objectives: z.array(z.string()).min(1),
  prerequisites: z.array(z.object({ from: z.string(), to: z.string() })),
  objectiveExcerpts: z.array(z.string()).optional(),
});

type Plan = z.infer<typeof PlanSchema>;

const model = new ChatAnthropic({
  model: "claude-sonnet-4-6",
  temperature: 0,
}).withStructuredOutput(PlanSchema, { method: "jsonMode" });

const SYSTEM_PROMPT = `You are a lesson Planner Agent. Your only job is to analyze a PDF document and produce a structured lesson plan.

Output a list of learning objectives and prerequisite relationships between them.

Rules:
- Each objective must be a concrete, testable learning outcome (one sentence).
- A prerequisite edge {from: A, to: B} means "A must be understood before B".
- Produce between 3 and 8 objectives for a typical document.
- Do not include quiz questions, answer keys, or student performance data.
- For each objective, include a verbatim 1–2 sentence excerpt from the document that most directly supports it in the "objectiveExcerpts" array (same order as objectives).
- Respond with a JSON object matching this schema: {"objectives": string[], "prerequisites": [{"from": string, "to": string}], "objectiveExcerpts": string[]}`;

export async function generatePlanNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    {
      role: "user" as const,
      // CONSTITUTION §Principle 5/6: only extractedText, in user turn
      content: `<document>\n${state.extractedText}\n</document>\n\nProduce the lesson plan for this document.`,
    },
  ];

  // Retry once — streamEvents-driven invocation occasionally returns empty tool args
  let plan: Plan;
  try {
    plan = await model.invoke(messages);
  } catch {
    plan = await model.invoke(messages);
  }

  return {
    objectives: plan.objectives,
    prerequisites: plan.prerequisites.map((p) => `${p.from}→${p.to}`),
    plan: JSON.stringify(plan, null, 2),
    planApproved: false,
  };
}

export async function planApprovalNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  // Guard: if already approved (e.g. node re-entered on retry), skip the interrupt
  if (state.planApproved) {
    return {};
  }

  // Pause and hand the plan to the frontend for human review/edit
  const editedPlan = interrupt({ type: "approval", content: state.plan });

  // editedPlan is whatever the frontend sent back via Command({ resume: ... })
  const parsed: Plan =
    typeof editedPlan === "string" ? JSON.parse(editedPlan) : editedPlan;

  return {
    plan: JSON.stringify(parsed, null, 2),
    objectives: parsed.objectives,
    // Re-derive prerequisites filtered to objectives that still exist after user edits
    prerequisites: parsed.prerequisites
      .filter(
        (p: { from: string; to: string }) =>
          parsed.objectives.includes(p.from) &&
          parsed.objectives.includes(p.to)
      )
      .map((p: { from: string; to: string }) => `${p.from}→${p.to}`),
    planApproved: true,
    currentObjectiveIndex: 0,
  };
}
