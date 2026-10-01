import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
const versions = existsSync("/usr/lib/postgresql")
  ? readdirSync("/usr/lib/postgresql").sort((a, b) => Number(b) - Number(a))
  : [];
const version = versions[0];
if (!version) {
  process.stderr.write(
    "Local PostgreSQL not found. Use docker compose up -d db, then configure DATABASE_URL.\n",
  );
  process.exit(1);
}
const binary = `/usr/lib/postgresql/${version}/bin`;
const workspaceHash = createHash("sha256")
  .update(process.cwd())
  .digest("hex")
  .slice(0, 12);
const data = resolve(
  homedir(),
  ".local/share/zeronote",
  workspaceHash,
  "postgres",
);
const run = (name, args) => {
  const result = spawnSync(`${binary}/${name}`, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
mkdirSync(resolve(".local"), { recursive: true });
mkdirSync(resolve(data, ".."), { recursive: true, mode: 0o700 });
if (!existsSync(`${data}/PG_VERSION`))
  run("initdb", [
    "-D",
    data,
    "-U",
    "zeronote",
    "--auth-local=trust",
    "--auth-host=trust",
    "--encoding=UTF8",
    "--no-locale",
  ]);
const status = spawnSync(`${binary}/pg_ctl`, ["-D", data, "status"], {
  stdio: "ignore",
});
if (status.status !== 0)
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    resolve(".local/postgres.log"),
    "-o",
    "-p 55432 -h 127.0.0.1 -k /tmp",
    "-w",
    "start",
  ]);
const exists = spawnSync(
  `${binary}/psql`,
  [
    "-h",
    "127.0.0.1",
    "-p",
    "55432",
    "-U",
    "zeronote",
    "-d",
    "postgres",
    "-tAc",
    "SELECT 1 FROM pg_database WHERE datname = 'zeronote'",
  ],
  { encoding: "utf8" },
);
if (!exists.stdout.trim())
  run("createdb", [
    "-h",
    "127.0.0.1",
    "-p",
    "55432",
    "-U",
    "zeronote",
    "zeronote",
  ]);
process.stdout.write(
  "Development PostgreSQL ready at 127.0.0.1:55432. Local-only trust authentication; production uses credentials.\n",
);
