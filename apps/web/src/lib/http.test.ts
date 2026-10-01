import { afterEach, it, expect, vi } from "vitest";
import { requestJson, ApiError, WAKE_TIMEOUT_MS } from "./http";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("returns JSON with same-origin credentials and retries only reads or operation IDs", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await requestJson("/metadata")).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    credentials: "same-origin",
  });
});
it("turns cold-start HTML errors into a usable error without retrying unsafe posts", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response("<html>starting</html>", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  await expect(requestJson("/invites", "POST", {})).rejects.toBeInstanceOf(
    ApiError,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("uses a stable operation ID across retries and rejects authorization errors immediately", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(new Response('{"durable":true}'));
  vi.stubGlobal("fetch", fetch);
  await requestJson("/commit", "POST", { operationId: "stable" });
  expect(fetch.mock.calls[0]?.[1].body).toBe(fetch.mock.calls[1]?.[1].body);
  fetch
    .mockReset()
    .mockResolvedValue(new Response('{"error":"Denied"}', { status: 403 }));
  await expect(requestJson("/metadata")).rejects.toMatchObject({ status: 403 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("bounds cold-start waits to ninety seconds", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_path, options: RequestInit) =>
        new Promise((_resolve, reject) =>
          options.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    ),
  );
  const pending = expect(
    requestJson("/health", "GET", undefined, WAKE_TIMEOUT_MS),
  ).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(WAKE_TIMEOUT_MS);
  await pending;
});
