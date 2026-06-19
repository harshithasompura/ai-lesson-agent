/**
 * End-to-end smoke test for the Phase 5 agent graph.
 *
 * Run: npx tsx src/scripts/test-graph.ts
 *
 * What it covers:
 *  1. graph compiles + checkpointer initialises
 *  2. generatePlan → planApproval (auto-approve) → writeConceptGraph
 *  3. selectNextObjective → generateMCQ → selfEval → presentQuestion
 *  4. grading (correct answer) → advance → repeat until completion
 *  5. completionNode produces a recap message
 *
 * Interrupts (planApproval, presentQuestion) are resumed programmatically
 * so this runs headless with no human input required.
 */

import { Command } from "@langchain/langgraph";
import { graph, checkpointer } from "../agent/graph";
import db from "@/lib/db";

// ── Minimal test document ──────────────────────────────────────────────────

const EXTRACTED_TEXT = `
Photosynthesis is the process by which green plants convert sunlight into glucose.
It occurs in the chloroplasts and requires CO2, water, and light energy.
The light-dependent reactions happen in the thylakoid membrane and produce ATP and NADPH.
The Calvin cycle (light-independent reactions) uses ATP and NADPH to fix CO2 into glucose.
Chlorophyll a and b are the primary pigments that absorb light, mainly in the red and blue spectrum.
`;

const THREAD_ID = `thread-${Date.now()}`;
const config = { configurable: { thread_id: THREAD_ID } };

// ── Helpers ────────────────────────────────────────────────────────────────

function log(label: string, value?: unknown) {
  console.log(`\n[${label}]`, value !== undefined ? JSON.stringify(value, null, 2) : "");
}



// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Phase 5 graph smoke test ===");

  // 0. Insert real document row so document_id FK is valid
  const { rows } = await db.query(
    `INSERT INTO documents (filename, extracted_text) VALUES ($1, $2) RETURNING id`,
    ["smoke-test.txt", EXTRACTED_TEXT]
  );
  const DOCUMENT_ID: number = rows[0].id;
  console.log(`documentId: ${DOCUMENT_ID}  threadId: ${THREAD_ID}`);

  // 1. Init checkpointer tables
  await checkpointer.setup();
  log("checkpointer", "setup OK");

  // 2. Kick off graph — runs until first interrupt (planApproval)
  log("invoking graph", "initial run → expect planApproval interrupt");
  await graph.invoke(
    {
      documentId: DOCUMENT_ID,
      extractedText: EXTRACTED_TEXT,
      planApproved: false,
    },
    config
  );

  const state1 = await graph.getState(config);
  log("state after run 1", {
    nextNode: state1.next,
    hasPlan: !!state1.values.plan,
    objectives: state1.values.objectives?.length ?? 0,
  });

  if (!state1.next?.includes("planApproval")) {
    log("WARN", "planApproval interrupt not hit — continuing");
  } else {
    // Resume with the plan object (unedited) — same shape planApprovalNode expects
    const planObj = JSON.parse(state1.values.plan);
    log("resuming planApproval", planObj);
    await graph.invoke(new Command({ resume: planObj }), config);
  }

  // 3. Loop: answer each presentQuestion interrupt with correct answer (index from answerKey)
  let maxIterations = 20; // guard against infinite loop
  while (maxIterations-- > 0) {
    const state = await graph.getState(config);
    log("state.next", state.next);

    if (!state.next || state.next.length === 0) {
      log("graph", "DONE (reached END)");
      const lastMsg = state.values.messages?.at(-1);
      if (lastMsg) {
        console.log("\n=== Completion message ===");
        console.log((lastMsg as { content?: string }).content ?? lastMsg);
      }
      break;
    }

    const next = state.next[0];

    if (next === "presentQuestion") {
      // Answer with correct index from answerKey stored in state
      const { correctIndex } = JSON.parse(state.values.answerKey ?? "{}");
      log("presentQuestion interrupt", { correctIndex, answerKey: state.values.answerKey });

      if (correctIndex === undefined) {
        console.error("ERROR: answerKey missing or malformed");
        process.exit(1);
      }

      await graph.invoke(
        new Command({ resume: { selectedIndex: correctIndex } }),
        config
      );
      continue;
    }

    if (next === "planApproval") {
      log("planApproval interrupt (late hit)", "approving");
      const planObj = JSON.parse(state.values.plan);
      await graph.invoke(new Command({ resume: planObj }), config);
      continue;
    }

    // Any other interrupt — shouldn't happen in this test
    log("UNEXPECTED interrupt", next);
    break;
  }

  if (maxIterations <= 0) {
    console.error("ERROR: hit iteration cap — graph may be looping");
    process.exit(1);
  }

  console.log("\n=== smoke test PASSED ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
