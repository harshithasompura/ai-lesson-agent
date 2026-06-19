import { Pool } from "pg";

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  // supabase session pooler uses self-signed cert chain; rejectUnauthorized must be false
  ssl: { rejectUnauthorized: false },
});

export default db;
