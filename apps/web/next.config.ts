import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { parseWebServerEnvironment } from "./env.config";
const apiOrigin = parseWebServerEnvironment(process.env).API_INTERNAL_ORIGIN;
const config: NextConfig = {
  transpilePackages: ["@zeronote/shared"],
  distDir: process.env.ZERONOTE_BUILD_DIR ?? ".next",
  turbopack: { root: fileURLToPath(new URL("../..", import.meta.url)) },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/v1/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${apiOrigin}/v1/:path*` },
      { source: "/collaboration", destination: `${apiOrigin}/collaboration` },
    ];
  },
};
export default config;
