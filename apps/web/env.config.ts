import { z } from "zod";
export function parseWebServerEnvironment(
  input: Record<string, string | undefined>,
) {
  const origin = z
    .url()
    .parse(
      input.API_INTERNAL_ORIGIN ??
        (input.VERCEL ? undefined : "http://127.0.0.1:3001"),
    );
  const url = new URL(origin);
  if (url.origin !== origin)
    throw new Error("API_INTERNAL_ORIGIN must be an origin");
  if (input.VERCEL && url.protocol !== "https:")
    throw new Error("Vercel requires an HTTPS API_INTERNAL_ORIGIN");
  z.enum(["true", "false"]).optional().parse(input.NEXT_PUBLIC_BETA_REQUIRED);
  const collaboration = input.NEXT_PUBLIC_COLLABORATION_URL;
  if (
    input.VERCEL &&
    (!collaboration || new URL(collaboration).protocol !== "wss:")
  )
    throw new Error("Vercel requires NEXT_PUBLIC_COLLABORATION_URL using wss");
  return { API_INTERNAL_ORIGIN: origin };
}
