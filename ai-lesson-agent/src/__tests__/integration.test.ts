import { describe, it, expect, afterAll } from 'vitest'

const hasDB = !!process.env.DATABASE_URL
const hasNeo4j = !!(process.env.NEO4J_URI && process.env.NEO4J_USERNAME && process.env.NEO4J_PASSWORD)

describe.skipIf(!hasDB)('database connectivity', () => {
  // Dynamic import so the Pool is only constructed when env var is present
  let pool: import('pg').Pool

  afterAll(async () => {
    if (pool) await pool.end()
  })

  it('can connect and run SELECT 1', async () => {
    const { default: db } = await import('../lib/db')
    pool = db
    const result = await db.query('SELECT 1 AS value')
    expect(result.rows[0].value).toBe(1)
  })

  it('documents table exists', async () => {
    const { default: db } = await import('../lib/db')
    const result = await db.query("SELECT count(*) FROM documents")
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(0)
  })
})

describe.skipIf(!hasNeo4j)('neo4j connectivity', () => {
  it('can verify connectivity', async () => {
    const { default: driver } = await import('../lib/neo4j')
    try {
      await driver.verifyConnectivity()
    } finally {
      await driver.close()
    }
  })
})
