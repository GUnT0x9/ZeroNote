import type { FastifyInstance } from "fastify";
import { KnowledgeRequestSchema, MAX_TRANSPORT_BYTES } from "@zeronote/shared";
import type { AuthService } from "./services";
import type { KnowledgeService } from "./knowledge-service";

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  auth: AuthService,
  knowledge: KnowledgeService,
): void {
  app.post(
    "/v1/knowledge",
    { bodyLimit: MAX_TRANSPORT_BYTES },
    async (request) =>
      knowledge.view(
        await auth.deviceForToken(request.cookies.zn_session),
        KnowledgeRequestSchema.parse(request.body),
      ),
  );
}
