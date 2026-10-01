import { spawn } from "node:child_process";
const processes = [
  spawn("pnpm", ["--filter", "@zeronote/server", "dev"], { stdio: "inherit" }),
  spawn("pnpm", ["--filter", "@zeronote/web", "dev"], { stdio: "inherit" }),
];
const stop = () => {
  for (const child of processes) child.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of processes)
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    stop();
    process.exitCode = 1;
  });
