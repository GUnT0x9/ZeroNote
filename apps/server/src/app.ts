import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { WebSocketServer } from "ws";
import { Repository } from "./database/repository";
import { AccessService, DocumentService, DomainError } from "./services";
import { createRealtime } from "./realtime";
import { registerRoutes } from "./routes";
import { env } from "./env";
import { MAX_TRANSPORT_BYTES } from "@zeronote/shared";

export async function createApp(
  repository = new Repository(env.DATABASE_URL),
  logging = true,
) {
  await repository.migrate();
  await repository.search.backfill();
  const app = Fastify({
    logger: logging
      ? {
          level: "info",
          redact: ["req.headers.cookie", "req.headers.authorization"],
        }
      : false,
    bodyLimit: MAX_TRANSPORT_BYTES,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 1200, timeWindow: "1 minute" });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(request.method) &&
      request.headers.origin !== env.WEB_ORIGIN
    )
      throw new DomainError(403, "허용되지 않은 Origin입니다.");
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof ZodError
          ? 400
          : typeof error === "object" &&
              error &&
              "statusCode" in error &&
              typeof error.statusCode === "number"
            ? error.statusCode
            : 500;
    if (status >= 500)
      app.log.error({ requestId: request.id }, "Request failed");
    const message =
      error instanceof DomainError
        ? error.message
        : status === 400
          ? "요청 정보가 올바르지 않습니다."
          : status === 429
            ? "잠시 후 다시 시도해주세요."
            : "서버 요청을 처리할 수 없습니다.";
    void reply.status(status).send({ error: message });
  });
  const access = new AccessService(repository),
    documents = new DocumentService(repository, access),
    realtime = createRealtime(access, documents, app.log);
  registerRoutes(app, repository, realtime, documents);
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_TRANSPORT_BYTES,
  });
  app.server.on("upgrade", (request, socket, head) => {
    if (
      request.url?.split("?")[0] !== "/collaboration" ||
      request.headers.origin !== env.WEB_ORIGIN
    ) {
      socket.destroy();
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      const client = realtime.handleConnection(
        websocket,
        new Request(`${env.WEB_ORIGIN}/collaboration`, { headers }),
      );
      websocket.on("message", (data) =>
        client.handleMessage(
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : Array.isArray(data)
              ? new Uint8Array(Buffer.concat(data))
              : new Uint8Array(data),
        ),
      );
      websocket.on("close", (code, reason) =>
        client.handleClose({ code, reason: reason.toString() }),
      );
      websocket.on("error", () => client.handleClose());
    });
  });
  app.addHook("onClose", async () => {
    realtime.closeConnections();
    for (const document of [...realtime.documents.values()])
      await realtime.unloadDocument(document);
    websocketServer.close();
    await repository.close();
  });
  return { app, repository, realtime };
}
