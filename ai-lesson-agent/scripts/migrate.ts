/**
 * Phase 3: Postgres table migration + PostgresSaver setup + Neo4j connectivity check.
 * Run once: npx tsx scripts/migrate.ts
 */
import pg from "pg";
import neo4j from "neo4j-driver";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const { Pool } = pg;

console.log("DATABASE_URL:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function migratePostgres() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id           SERIAL PRIMARY KEY,
        filename     TEXT        NOT NULL,
        extracted_text TEXT      NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id               SERIAL PRIMARY KEY,
        document_id      INTEGER     NOT NULL REFERENCES documents(id),
        objective_index  INTEGER     NOT NULL,
        objective        TEXT        NOT NULL,
        question         TEXT        NOT NULL,
        choices          JSONB       NOT NULL,
        selected_index   INTEGER,
        correct_index    INTEGER     NOT NULL,
        attempt_number   INTEGER     NOT NULL,
        resolution       TEXT,
        source_passage   TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Idempotent: add source_passage if it doesn't exist yet (for pre-existing DBs)
    await client.query(`
      ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS source_passage TEXT;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mcq_eval_log (
        id               SERIAL PRIMARY KEY,
        document_id      TEXT,
        objective_index  INT,
        eval_attempts    INT,
        final_score      INT,
        passed_cap       BOOLEAN,
        failure_layer    TEXT
      );
    `);

    await client.query(`
      ALTER TABLE mcq_eval_log ADD COLUMN IF NOT EXISTS failure_layer TEXT;
    `);

    console.log("✓ Postgres app tables ready");
  } finally {
    client.release();
  }
}

async function setupCheckpointer() {
  const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
  await checkpointer.setup();
  console.log("✓ LangGraph checkpoint tables ready");
}

async function verifyNeo4j() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!),
  );
  try {
    await driver.verifyConnectivity();
    console.log("✓ Neo4j Aura reachable");
  } finally {
    await driver.close();
  }
}

(async () => {
  try {
    await migratePostgres();
    await setupCheckpointer();
    await verifyNeo4j();
    console.log("\nPhase 3 complete.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
