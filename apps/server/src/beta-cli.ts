import { randomBytes } from "node:crypto";
import { writeFile, unlink, realpath } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { INVITE_LIFETIME_MS, sha256Hex } from "@zeronote/shared";
import { Repository } from "./database/repository";
import { env } from "./env";
import { fileURLToPath } from "node:url";
async function issueCodes(): Promise<void> {
  const output = process.argv[2];
  if (!output) throw new Error("Pass an output path outside the repository");
  const codes = Array.from(
    { length: 10 },
    () => `ZNB1-${randomBytes(32).toString("base64url")}`,
  );
  const path = resolve(output),
    repository = new Repository(env.DATABASE_URL);
  const root = await realpath(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  const parent = await realpath(dirname(path));
  if (!relative(root, parent).startsWith(".."))
    throw new Error("Output must be outside the repository");
  let written = false;
  try {
    await repository.migrate();
    await writeFile(path, codes.join("\n") + "\n", { flag: "wx", mode: 0o600 });
    written = true;
    await repository.database.transaction(async (tx) => {
      for (const code of codes)
        await repository.beta.issue(
          crypto.randomUUID(),
          await sha256Hex(code),
          new Date(Date.now() + INVITE_LIFETIME_MS),
          tx,
        );
    });
    process.stdout.write(
      "10 one-use Beta codes saved to the requested file. Expires in 7 days.\n",
    );
  } catch (error) {
    if (written) await unlink(path);
    throw error;
  } finally {
    await repository.close();
  }
}
await issueCodes().catch(() => {
  process.stderr.write(
    "Unable to issue Beta codes. Check database access and output path.\n",
  );
  process.exitCode = 1;
});
