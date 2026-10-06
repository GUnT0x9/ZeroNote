import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  parseAttachmentRange,
  AttachmentListQuerySchema,
} from "@zeronote/shared";
import { parameter } from "./routes";
import type { AuthService } from "./services";
import type { AttachmentService } from "./attachment-service";

export function registerAttachmentRoutes(
  app: FastifyInstance,
  auth: AuthService,
  files: AttachmentService,
): void {
  const device = (request: FastifyRequest) =>
    auth.deviceForToken(request.cookies.zn_session);
  app.get("/v1/pages/:id/attachments", async (request) =>
    files.list(
      await device(request),
      parameter(request, "id"),
      AttachmentListQuerySchema.parse(request.query).retained === "1",
    ),
  );
  app.post("/v1/pages/:id/attachments", async (request) =>
    files.upload(await device(request), parameter(request, "id"), request.body),
  );
  app.get("/v1/attachments/:id", async (request) =>
    files.download(await device(request), parameter(request, "id")),
  );
  app.delete("/v1/attachments/:id", async (request) =>
    files.remove(await device(request), parameter(request, "id")),
  );
  app.get("/v1/workspaces/:id/attachments/storage", async (request) =>
    files.storage(await device(request), parameter(request, "id")),
  );
  app.delete(
    "/v1/workspaces/:id/attachments/:fileId/content",
    async (request) =>
      files.purge(
        await device(request),
        parameter(request, "id"),
        parameter(request, "fileId"),
        request.body,
      ),
  );
  app.get("/v1/attachments/:id/content", async (request, reply) => {
    const record = await files.read(
      await device(request),
      parameter(request, "id"),
    );
    return sendAttachment(request, reply, record);
  });
}
export function sendAttachment(
  request: FastifyRequest,
  reply: FastifyReply,
  record: Awaited<ReturnType<AttachmentService["read"]>>,
) {
  reply
    .header("X-Content-Type-Options", "nosniff")
    .header("Content-Security-Policy", "default-src 'none'; sandbox")
    .header("Accept-Ranges", "bytes");
  reply.header(
    "Content-Disposition",
    `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(record.name).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
  );
  reply.type(record.mime);
  let range;
  try {
    range = parseAttachmentRange(request.headers.range, record.size);
  } catch {
    return reply
      .code(416)
      .header("Content-Range", `bytes */${record.size}`)
      .send();
  }
  if (range)
    return reply
      .code(206)
      .header(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${record.size}`,
      )
      .send(record.data.subarray(range.start, range.end + 1));
  return reply.send(record.data);
}
