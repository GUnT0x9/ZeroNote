import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    if (!process.env.PLAYWRIGHT_BASE_URL) {
      // Independent local scenarios represent different peers. Production HTTPS
      // checks keep the actual proxy headers; API tests cover same-IP limits.
      const peer = createHash("sha256").update(testInfo.testId).digest("hex");
      await context.setExtraHTTPHeaders({
        "X-Forwarded-For": `2001:db8:${peer.slice(0, 4)}:${peer.slice(4, 8)}::1`,
      });
    }
    await use(context);
  },
});
