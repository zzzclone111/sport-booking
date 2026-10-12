const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("../db");

async function main() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [20261008]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationsDir = path.resolve(__dirname, "../../migrations");
    const files = (await fs.readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const filename of files) {
      const exists = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [filename],
      );
      if (exists.rowCount) continue;
      const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [filename],
        );
        await client.query("COMMIT");
        console.log(`Applied ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [20261008])
      .catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
