import { z } from "zod";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://zeronote@127.0.0.1:55432/zeronote"),
  SERVER_PORT: z.coerce.number().int().default(3001),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  REALTIME_SECRET: z.string().optional(),
});
const parsed = schema.parse(process.env);
if (
  parsed.NODE_ENV === "production" &&
  (!parsed.REALTIME_SECRET || parsed.REALTIME_SECRET.length < 32)
)
  throw new Error(
    "REALTIME_SECRET must contain at least 32 characters in production",
  );
export const env = {
  ...parsed,
  REALTIME_SECRET: parsed.REALTIME_SECRET || randomBytes(32).toString("hex"),
};
