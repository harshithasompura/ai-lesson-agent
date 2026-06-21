import { runNeo4j } from "@/lib/neo4j";
import { GraphStateType } from "./state";

/**
 * Writes (:Objective)-[:PREREQUISITE_FOR]->(:Objective) nodes to Neo4j.
 * Runs once after plan-approval interrupt resumes. CONSTITUTION §Principle 4:
 * wrapped via runNeo4j (1.5s timeout + fallback) — failure is silent, quiz
 * loop falls back to plan-list order.
 */
export async function writeConceptGraphNode(
  state: GraphStateType
): Promise<Partial<GraphStateType>> {
  const plan: { objectives: string[]; prerequisites: { from: string; to: string }[] } =
    JSON.parse(state.plan);

  const objectiveSet = new Set(plan.objectives);

  // Filter edges: both endpoints must exist in the user-approved objective list
  const edges = plan.prerequisites.filter(
    (p) => objectiveSet.has(p.from) && objectiveSet.has(p.to)
  );

  await runNeo4j(async (session) => {
    // CONSTITUTION §Principle 7: documentId scopes every node and query
    await session.executeWrite(async (tx) => {
      // Merge objective nodes
      for (const title of plan.objectives) {
        await tx.run(
          `MERGE (o:Objective {title: $title, documentId: $documentId})`,
          { title, documentId: String(state.documentId) }
        );
      }

      // Merge prerequisite edges
      for (const { from, to } of edges) {
        await tx.run(
          `MATCH (a:Objective {title: $from, documentId: $documentId})
           MATCH (b:Objective {title: $to, documentId: $documentId})
           MERGE (a)-[:PREREQUISITE_FOR]->(b)`,
          { from, to, documentId: String(state.documentId) }
        );
      }
    });
  }, undefined);

  // No state mutation — this is a side-effect-only node
  return {};
}
