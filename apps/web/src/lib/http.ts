export const REQUEST_TIMEOUT_MS = 15_000;
export const WAKE_TIMEOUT_MS = 90_000;
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requestJson<T>(
  path: string,
  method = "GET",
  body?: unknown,
  timeout = REQUEST_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  const retryable =
    method === "GET" ||
    (method === "POST" && ["/search", "/knowledge"].includes(path)) ||
    (typeof body === "object" && body !== null && "operationId" in body);
  const attempts = retryable && timeout !== WAKE_TIMEOUT_MS ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`/v1${path}`, {
        method,
        credentials: "same-origin",
        signal: controller.signal,
        headers: {
          [EDITOR_PROTOCOL_HEADER]: String(EDITOR_PROTOCOL),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        throw new ApiError(
          response.ok ? 502 : response.status,
          "서버 연결을 준비하고 있습니다. 잠시 후 다시 시도해주세요.",
        );
      }
      if (!response.ok) {
        const message =
          typeof result === "object" &&
          result &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "서버에 연결할 수 없습니다.";
        throw new ApiError(response.status, message);
      }
      return result as T;
    } catch (error) {
      signal?.throwIfAborted();
      const failure =
        error instanceof ApiError
          ? error
          : new ApiError(
              503,
              controller.signal.aborted
                ? "서버 응답 대기 시간이 초과되었습니다. 변경은 이 기기에 보관됩니다."
                : "서버에 연결할 수 없습니다.",
            );
      if (
        !retryable ||
        attempt === attempts - 1 ||
        ![502, 503, 504].includes(failure.status)
      )
        throw failure;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  throw new ApiError(503, "서버에 연결할 수 없습니다.");
}
import { EDITOR_PROTOCOL, EDITOR_PROTOCOL_HEADER } from "@zeronote/shared";
