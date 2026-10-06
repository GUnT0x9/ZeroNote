import {
  IdSchema,
  PublicContentSchema,
  PublicShareSchema,
  type PublicContent,
  type PublicShare,
} from "@zeronote/shared";
import { ZodError } from "zod";
import { ApiError, requestJson, WAKE_TIMEOUT_MS } from "./http";
export async function readPublicContent(
  id: string,
  key?: string,
): Promise<PublicContent> {
  id = IdSchema.parse(id).toLowerCase();
  if (key !== undefined) key = IdSchema.parse(key).toLowerCase();
  return requestJson(
    `/public/${id}/content${key ? `/${key}` : ""}`,
    "GET",
    undefined,
    WAKE_TIMEOUT_MS,
  ).then((value) => PublicContentSchema.parse(value));
}
export async function readPublicDescriptor(id: string): Promise<PublicShare> {
  id = IdSchema.parse(id).toLowerCase();
  return requestJson(`/public/${id}`, "GET", undefined, WAKE_TIMEOUT_MS).then(
    (value) => PublicShareSchema.parse(value),
  );
}
export function publicReadingError(problem: unknown): string {
  if (problem instanceof ZodError)
    return "공유 문서를 처리할 수 없습니다. 다시 시도해주세요.";
  if (problem instanceof ApiError && [502, 503, 504].includes(problem.status))
    return "서버 연결을 준비하고 있습니다. 잠시 후 다시 시도해주세요.";
  return problem instanceof Error
    ? problem.message
    : "공유 문서를 열 수 없습니다.";
}
export function publicReaderSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
