import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "./services";
import { parameter } from "./routes";
import { PublicShareService } from "./public-share-service";
import { sendAttachment } from "./attachment-routes";
import { env } from "./env";
export function publicCookieName(id: string): string {
  return `zn_public_${id.toLowerCase().replaceAll("-", "")}`;
}
function publicParameter(request: FastifyRequest, key: string): string {
  return parameter(request, key).toLowerCase();
}
export function registerPublicShareRoutes(
  app: FastifyInstance,
  auth: AuthService,
  shares: PublicShareService,
): void {
  const device = (request: FastifyRequest) =>
    auth.deviceForToken(request.cookies.zn_session);
  app.get("/v1/workspaces/:id/public-shares", async (request) =>
    shares.list(await device(request), publicParameter(request, "id")),
  );
  app.post("/v1/workspaces/:id/public-shares", async (request) =>
    shares.create(
      await device(request),
      publicParameter(request, "id"),
      request.body,
    ),
  );
  app.delete("/v1/workspaces/:id/public-shares/:shareId", async (request) =>
    shares.revoke(
      await device(request),
      publicParameter(request, "id"),
      publicParameter(request, "shareId"),
    ),
  );
  app.get("/v1/public/:id", async (request) =>
    shares.repository.publicShares.describe(publicParameter(request, "id")),
  );
  app.post(
    "/v1/public/:id/open",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const id = publicParameter(request, "id"),
        result = await shares.open(id, request.body);
      reply.setCookie(publicCookieName(id), result.token, {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "strict",
        path: `/v1/public/${id}`,
        expires: result.expires,
      });
      return { opened: true, expiresAt: result.expires.toISOString() };
    },
  );
  const read = (request: FastifyRequest, key?: string) => {
    const id = publicParameter(request, "id");
    return shares.repository.publicShares.content(
      id,
      key,
      request.cookies[publicCookieName(id)],
    );
  };
  app.get("/v1/public/:id/content", async (request) => read(request));
  app.get("/v1/public/:id/content/:key", async (request) =>
    read(request, publicParameter(request, "key")),
  );
  app.get("/v1/public/:id/files/:fileId", async (request, reply) => {
    const id = publicParameter(request, "id");
    const record = await shares.repository.publicShares.file(
      id,
      publicParameter(request, "fileId"),
      request.cookies[publicCookieName(id)],
    );
    return sendAttachment(request, reply, record);
  });
}
