import type { FastifyInstance } from "fastify";
import { SearchRequestSchema, MAX_TRANSPORT_BYTES } from "@zeronote/shared";
import type { AuthService } from "./services";
import type { SearchService } from "./search-service";
import { parameter } from "./routes";

export function registerSearchRoutes(
  app: FastifyInstance,
  auth: AuthService,
  search: SearchService,
): void {
  app.post("/v1/search", { bodyLimit: MAX_TRANSPORT_BYTES }, async (request) =>
    search.search(
      await auth.deviceForToken(request.cookies.zn_session),
      SearchRequestSchema.parse(request.body),
    ),
  );
  app.get("/v1/pages/:id/search-properties", async (request) =>
    search.properties(
      await auth.deviceForToken(request.cookies.zn_session),
      parameter(request, "id"),
    ),
  );
}
