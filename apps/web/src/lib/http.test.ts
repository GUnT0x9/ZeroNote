import { afterEach, it, expect, vi } from "vitest";
import { requestJson, ApiError, WAKE_TIMEOUT_MS } from "./http";
import { EDITOR_PROTOCOL, EDITOR_PROTOCOL_HEADER } from "@zeronote/shared";
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
    headers: { [EDITOR_PROTOCOL_HEADER]: String(EDITOR_PROTOCOL) },
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
it("preserves compatibility errors without retrying or claiming a successful commit", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response('{"error":"Editor update required"}', { status: 426 }),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    requestJson("/commit", "POST", { operationId: "stable" }),
  ).rejects.toMatchObject({ status: 426, message: "Editor update required" });
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
it("retries read-only Search POSTs while an explicit abort stops retries immediately", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValue(new Response('{"hits":[]}'));
  vi.stubGlobal("fetch", fetch);
  expect(
    await requestJson("/search", "POST", { query: { clauses: [] } }),
  ).toEqual({ hits: [] });
  expect(fetch).toHaveBeenCalledTimes(2);
  const controller = new AbortController();
  controller.abort();
  await expect(
    requestJson("/search", "POST", {}, undefined, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("cancels an in-flight obsolete query without retrying or converting it to a sync error", async () => {
  const fetch = vi.fn(
    (_path, options: RequestInit) =>
      new Promise((_resolve, reject) =>
        options.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const result = expect(
    requestJson("/search", "POST", {}, undefined, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await result;
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("retries the explicit read-only Knowledge endpoint while leaving other POSTs non-retryable", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValue(new Response('{"nodes":[]}'));
  vi.stubGlobal("fetch", fetch);
  expect(await requestJson("/knowledge", "POST", { pageId: "page" })).toEqual({
    nodes: [],
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockReset().mockResolvedValue(new Response("{}", { status: 503 }));
  await expect(
    requestJson("/knowledge/write", "POST", {}),
  ).rejects.toMatchObject({ status: 503 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
