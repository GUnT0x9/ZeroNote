import { createApp } from "./app";
import { env } from "./env";
try {
  const { app } = await createApp();
  await app.listen({ host: "0.0.0.0", port: env.SERVER_PORT });
  const stop = async () => {
    await app.close();
  };
  process.on("SIGINT", () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  });
  process.on("SIGTERM", () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  });
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Server failed to start"}\n`,
  );
  process.exitCode = 1;
}
