import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { EDITOR_PROTOCOL, EDITOR_PROTOCOL_HEADER } from "@zeronote/shared";

export function requestEditorProtocol(
  request: Pick<FastifyRequest, "headers">,
): number {
  return z
    .string()
    .pipe(z.coerce.number<string>().int().min(1).max(EDITOR_PROTOCOL))
    .parse(request.headers[EDITOR_PROTOCOL_HEADER.toLowerCase()] ?? "1");
}
