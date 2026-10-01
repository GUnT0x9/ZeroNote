import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
function launch(name) {
  const child = spawn("pnpm", ["--filter", name, "start"], {
    stdio: "inherit",
  });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => stop(code ?? 1));
}
async function waitForApi() {
  const deadline = Date.now() + 120000,
    port = process.env.SERVER_PORT ?? "3001";
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`);
      if (response.ok) return true;
    } catch {
      /* The server is still starting. */
    }
    await delay(300);
  }
  return false;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
try {
  launch("@zeronote/server");
  if (await waitForApi()) launch("@zeronote/web");
  else stop(1);
} catch {
  process.stderr.write("Unable to start ZeroNote.\n");
  stop(1);
}
