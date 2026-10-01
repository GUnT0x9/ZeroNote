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
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  BETA_REQUIRED: z.enum(["true", "false"]).optional(),
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
if (parsed.NODE_ENV === "production") {
  if (
    !process.env.DATABASE_URL ||
    !process.env.WEB_ORIGIN ||
    new URL(parsed.WEB_ORIGIN).protocol !== "https:"
  )
    throw new Error("Production requires DATABASE_URL and an HTTPS WEB_ORIGIN");
  if (new URL(parsed.WEB_ORIGIN).origin !== parsed.WEB_ORIGIN)
    throw new Error("WEB_ORIGIN must be an origin without a path");
  if (
    !["require", "verify-ca", "verify-full"].includes(
      new URL(parsed.DATABASE_URL).searchParams.get("sslmode") ?? "",
    )
  )
    throw new Error("Production DATABASE_URL requires TLS sslmode");
}
export const env = {
  ...parsed,
  SERVER_PORT: parsed.PORT ?? parsed.SERVER_PORT,
  BETA_REQUIRED: parsed.BETA_REQUIRED
    ? parsed.BETA_REQUIRED === "true"
    : parsed.NODE_ENV === "production",
  REALTIME_SECRET: parsed.REALTIME_SECRET || randomBytes(32).toString("hex"),
};
