import "fake-indexeddb/auto";
import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import { database } from "./database";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  authenticate: vi.fn(async () => undefined),
}));
vi.mock("./api", () => mocks);
let beta: typeof import("./beta");
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_BETA_REQUIRED", "true");
  beta = await import("./beta");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(async () => {
  await database.preferences.delete("beta");
  vi.unstubAllGlobals();
  mocks.api.mockReset();
});
it("caches approval for offline creation and rejects unapproved offline devices", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  mocks.api.mockResolvedValue({
    required: true,
    approved: true,
    workspaceCount: 0,
    workspaceLimit: 3,
  });
  await expect(beta.requireBetaAccess()).resolves.toBeUndefined();
  vi.stubGlobal("navigator", { onLine: false });
  await expect(beta.requireBetaAccess()).resolves.toBeUndefined();
  await database.preferences.delete("beta");
  await expect(beta.requireBetaAccess()).rejects.toThrow("초대코드");
});
it("applies the workspace limit and validates redeemed status before caching", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  mocks.api.mockResolvedValue({
    required: true,
    approved: true,
    workspaceCount: 3,
    workspaceLimit: 3,
  });
  await expect(beta.requireBetaAccess()).rejects.toThrow("최대 3개");
  mocks.api.mockResolvedValue({
    required: true,
    approved: true,
    workspaceCount: 0,
    workspaceLimit: 3,
  });
  await beta.redeemBetaCode("code");
  expect(mocks.api).toHaveBeenLastCalledWith("/beta/redeem", "POST", {
    code: "code",
  });
  mocks.api.mockResolvedValue({ invalid: true });
  await expect(beta.redeemBetaCode("bad")).rejects.toThrow();
});
