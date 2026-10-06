import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
const MIGRATIONS = [
  "001-alpha.sql",
  "002-beta.sql",
  "003-attachments.sql",
  "004-editor-protocol.sql",
  "005-attachment-purge.sql",
  "006-public-sharing.sql",
  "007-database-properties.sql",
  "008-knowledge-search.sql",
] as const;
export async function migrateDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(92061001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const version of MIGRATIONS) {
      const existing = await client.query(
        "SELECT version FROM schema_migrations WHERE version=$1",
        [version],
      );
      if (existing.rowCount) continue;
      const ddl = await readFile(
        new URL(`./migrations/${version}`, import.meta.url),
        "utf8",
      );
      await client.query(ddl);
      await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        version,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
