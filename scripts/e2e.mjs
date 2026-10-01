import { spawnSync } from "node:child_process";
const env = {
  ...process.env,
  NEXT_PUBLIC_BETA_REQUIRED: "true",
  ZERONOTE_BUILD_DIR: ".next-e2e",
  API_INTERNAL_ORIGIN: "http://127.0.0.1:3003",
};
const build = spawnSync("pnpm", ["--filter", "@zeronote/web", "build"], {
  stdio: "inherit",
  env,
});
if (build.status !== 0) process.exit(build.status ?? 1);
const test = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", ...process.argv.slice(2)],
  { stdio: "inherit", env },
);
process.exit(test.status ?? 1);
