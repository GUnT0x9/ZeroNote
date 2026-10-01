import { env } from "./env";
import { Repository } from "./database/repository";
const repository = new Repository(env.DATABASE_URL);
try {
  await repository.migrate();
  process.stdout.write("ZeroNote schema ready.\n");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Migration failed"}\n`,
  );
  process.exitCode = 1;
} finally {
  await repository.close();
}
