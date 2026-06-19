import { interrupt } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { GraphStateType } from "./state";

const PlanSchema = z.object({
  objectives: z.array(z.string()).min(1),
  prerequisites: z.array(z.object({ from: z.string(), to: z.string() })),
});

type Plan = z.infer<typeof PlanSchema>;

const model = new ChatAnthropic({
  model: "claude-sonnet-4-6",
  temperature: 0,
}).withStructuredOutput(PlanSchema);

const SYSTEM_PROMPT = `You are a lesson Planner Agent. Your only job is to analyze a PDF document and produce a structured lesson plan.

Output a list of learning objectives and prerequisite relationships between them.

Rules:
- Each objective must be a concrete, testable learning outcome (one sentence).
- A prerequisite edge {from: A, to: B} means "A must be understood before B".
- Produce between 3 and 8 objectives for a typical document.
- Do not include quiz questions, answer keys, or student performance data.
- Do not produce any output beyond the structured fields.`;

export async function generatePlanNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  // CONSTITUTION §Principle 5: only extractedText goes into this prompt — no attempts, no answer keys
  const plan: Plan = await model.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      // CONSTITUTION §Principle 6: document content in user turn, structurally separate from system prompt
      content: `<document>\n${state.extractedText}\n</document>\n\nProduce the lesson plan for this document.`,
    },
  ]);

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
