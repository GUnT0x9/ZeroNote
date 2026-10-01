import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CLIENT_COMMANDS = new Set(["pg_dump", "pg_restore", "psql"]);

export function getPostgresClientConnection(databaseUrl) {
  try {
    const connection = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(connection.protocol) ||
      !connection.hostname ||
      !connection.username ||
      connection.pathname.length < 2 ||
      connection.hash ||
      connection.searchParams.has("password") ||
      connection.searchParams.has("sslpassword")
    )
      throw new Error();
    const password = decodeURIComponent(connection.password);
    if (/[\r\n\0]/u.test(password)) throw new Error();
    connection.password = "";
    const escapedPassword = password
      .replaceAll("\\", "\\\\")
      .replaceAll(":", "\\:");
    return {
      connectionString: connection.toString(),
      passwordFileContents: `*:*:*:*:${escapedPassword}\n`,
    };
  } catch {
    throw new Error(
      "Use a PostgreSQL connection URL with credentials in its authority.",
    );
  }
}

export function runPostgresClient(command, args, databaseUrl) {
  if (!CLIENT_COMMANDS.has(command))
    throw new Error("Unsupported PostgreSQL client.");
  const connection = getPostgresClientConnection(databaseUrl);
  const directory = mkdtempSync(join(tmpdir(), "zeronote-pg-client-"));
  try {
    const passwordFile = join(directory, "password");
    writeFileSync(passwordFile, connection.passwordFileContents, {
      mode: 0o600,
    });
    const child = spawnSync(
      command,
      ["--dbname", connection.connectionString, ...args],
      {
        stdio: "inherit",
        env: { ...process.env, PGPASSFILE: passwordFile },
      },
    );
    if (child.error) throw new Error("Unable to start PostgreSQL client.");
    return child.status ?? 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = runPostgresClient(
      process.argv[2],
      process.argv.slice(3),
      process.env.DATABASE_URL,
    );
  } catch {
    process.stderr.write(
      "PostgreSQL client configuration or execution failed.\n",
    );
    process.exitCode = 1;
  }
}
