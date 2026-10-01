process.env.BETA_REQUIRED = "true";
process.env.ZERONOTE_BUILD_DIR = ".next-e2e";
process.env.API_INTERNAL_ORIGIN = "http://127.0.0.1:3003";
process.env.PORT = "3002";
process.env.SERVER_PORT = "3003";
process.env.WEB_ORIGIN = "http://localhost:3002";
try {
  await import("./start.mjs");
} catch {
  process.stderr.write("Unable to start the browser test servers.\n");
  process.exitCode = 1;
}
