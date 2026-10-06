import "server-only";
import { cache } from "react";
import {
  IdSchema,
  PublicContentSchema,
  PublicShareSchema,
  type PublicContent,
  type PublicShare,
} from "@zeronote/shared";
import { parseWebServerEnvironment } from "../../env.config";
const SERVER_TIMEOUT_MS = 15_000;
export const loadPublicPage = cache(
  async (
    id: string,
    key?: string,
  ): Promise<{
    content: PublicContent | null;
    share: PublicShare | null;
    error?: string;
  }> => {
    if (
      !IdSchema.safeParse(id).success ||
      (key !== undefined && !IdSchema.safeParse(key).success)
    )
      return {
        content: null,
        share: null,
        error: "공유 링크가 올바르지 않습니다.",
      };
    const origin = parseWebServerEnvironment(process.env).API_INTERNAL_ORIGIN;
    let share: PublicShare | null = null;
    try {
      const descriptor = await fetch(`${origin}/v1/public/${id}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
      });
      if (!descriptor.ok)
        return {
          content: null,
          share: null,
          error:
            descriptor.status === 410
              ? "공유 링크가 만료되었거나 해제되었습니다."
              : "공유 문서를 열 수 없습니다. 다시 시도해주세요.",
        };
      share = PublicShareSchema.parse(await descriptor.json());
      if (share.protected) return { content: null, share };
      const response = await fetch(
        `${origin}/v1/public/${id}/content${key ? `/${key}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(SERVER_TIMEOUT_MS) },
      );
      if (!response.ok)
        return {
          content: null,
          share,
          error: "공개된 Page를 찾을 수 없습니다.",
        };
      return {
        content: PublicContentSchema.parse(await response.json()),
        share,
      };
    } catch {
      return {
        content: null,
        share,
        error: "서버 연결을 준비하고 있습니다. 잠시 후 새로고침해주세요.",
      };
    }
  },
);
