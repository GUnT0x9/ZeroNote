import { it, expect } from "vitest";
import { parseWebServerEnvironment } from "../../env.config";
import { collaborationUrl } from "./env";
it("keeps local defaults and derives same-origin WebSocket URLs", () => {
  expect(parseWebServerEnvironment({}).API_INTERNAL_ORIGIN).toBe(
    "http://127.0.0.1:3001",
  );
  expect(collaborationUrl("https://example.com")).toBe(
    "wss://example.com/collaboration",
  );
});
it("requires explicit secure split deployment URLs on Vercel", () => {
  expect(() => parseWebServerEnvironment({ VERCEL: "1" })).toThrow();
  expect(() =>
    parseWebServerEnvironment({
      VERCEL: "1",
      API_INTERNAL_ORIGIN: "http://localhost:3001",
      NEXT_PUBLIC_COLLABORATION_URL: "ws://localhost/collaboration",
    }),
  ).toThrow();
  expect(
    parseWebServerEnvironment({
      VERCEL: "1",
      API_INTERNAL_ORIGIN: "https://api.onrender.com",
      NEXT_PUBLIC_COLLABORATION_URL: "wss://api.onrender.com/collaboration",
    }),
  ).toMatchObject({ API_INTERNAL_ORIGIN: "https://api.onrender.com" });
});
