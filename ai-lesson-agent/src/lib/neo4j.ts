import neo4j, { Driver, Session } from "neo4j-driver";

const driver: Driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!)
);

// ponytail: timeout wrapper — CONSTITUTION §Principle 4 requires ~1.5s limit + fallback
export async function runNeo4j<T>(
  fn: (session: Session) => Promise<T>,
  fallback: T
): Promise<T> {
  const session = driver.session();
  try {
    return await Promise.race([
      fn(session),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("neo4j timeout")), 1500)
      ),
    ]);
  } catch (err) {
    console.error("[neo4j] fallback triggered:", err);
    return fallback;
  } finally {
    await session.close();
  }
}

export default driver;
