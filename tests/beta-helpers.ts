import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const execute = promisify(execFile);
/** Operator-side test setup only; no public code-issuance endpoint. */
export async function createBrowserBetaCode(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zeronote-beta-test-"));
  const output = join(directory, "codes.txt");
  try {
    await execute(
      "pnpm",
      ["--filter", "@zeronote/server", "beta:issue", output],
      {
        timeout: 15_000,
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
