import { z } from "zod";
const schema = z
  .string()
  .url()
  .refine(
    (value) => ["ws:", "wss:"].includes(new URL(value).protocol),
    "Expected ws or wss URL",
  );
export const publicEnvironment = {
  betaRequired:
    z
      .enum(["true", "false"])
      .default(process.env.NODE_ENV === "production" ? "true" : "false")
      .parse(process.env.NEXT_PUBLIC_BETA_REQUIRED) === "true",
  collaborationUrl: process.env.NEXT_PUBLIC_COLLABORATION_URL
    ? schema.parse(process.env.NEXT_PUBLIC_COLLABORATION_URL)
    : undefined,
};
export function collaborationUrl(origin: string): string {
  if (publicEnvironment.collaborationUrl)
    return publicEnvironment.collaborationUrl;
  const url = new URL("/collaboration", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
