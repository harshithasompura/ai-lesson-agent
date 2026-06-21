import neo4j, { Driver, Session } from "neo4j-driver";

const driver: Driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!)
);

// ponytail: timeout wrapper — 8s for cold Vercel→Neo4j TCP; CONSTITUTION §Principle 4
export async function runNeo4j<T>(
  fn: (session: Session) => Promise<T>,
  fallback: T
): Promise<T> {
  const session = driver.session();
  try {
    return await Promise.race([
      fn(session),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("neo4j timeout")), 8000)
      ),
    ]);
  } catch (err) {
    console.error("[neo4j] fallback triggered:", {
      message: err instanceof Error ? err.message : String(err),
      uri: process.env.NEO4J_URI ? "set" : "MISSING",
      user: process.env.NEO4J_USERNAME ? "set" : "MISSING",
      pass: process.env.NEO4J_PASSWORD ? "set" : "MISSING",
    });
    return fallback;
  } finally {
    await session.close();
  }
}

export default driver;
