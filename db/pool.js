const { Pool } = require("pg");

// Uses DATABASE_URL if set (e.g. postgres://user:pass@host:5432/dbname),
// otherwise falls back to the standard PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
// environment variables that node-postgres reads automatically.
const pool = new Pool(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined
);

module.exports = pool;
