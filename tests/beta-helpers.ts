import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const execute = promisify(execFile);
const serverRequire = createRequire(resolve("apps/server/package.json"));
/** Operator-side test setup only; no public code-issuance endpoint. */
export async function createBrowserBetaCode(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zeronote-beta-test-"));
  const output = join(directory, "codes.txt");
  try {
    await execute(
      process.execPath,
      [
        "--import",
        pathToFileURL(serverRequire.resolve("tsx")).href,
        resolve("apps/server/src/beta-cli.ts"),
        output,
      ],
      {
        timeout: process.env.PLAYWRIGHT_BASE_URL ? 90_000 : 15_000,
      },
    );
    const codes = (await readFile(output, "utf8")).trim().split("\n");
    if (
      codes.length !== 10 ||
      !codes.every((code) => /^ZNB1-[A-Za-z0-9_-]{43}$/.test(code))
    )
      throw new Error("Operator CLI returned invalid test codes");
    return codes[0]!;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
