import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  MemberGroupInputSchema,
  GroupGrantInputSchema,
  MemberRevisionSchema,
  MemberOperationSchema,
  MemberGrantInputSchema,
  MemberProfileInputSchema,
} from "@zeronote/shared";
import { parameter } from "./routes";
import type { AuthService } from "./services";
import type { MemberService } from "./member-service";

export function registerMemberRoutes(
  app: FastifyInstance,
  auth: AuthService,
  members: MemberService,
): void {
  const device = (request: FastifyRequest) =>
    auth.deviceForToken(request.cookies.zn_session);
  app.get("/v1/workspaces/:id/members", async (request) =>
    members.list(await device(request), parameter(request, "id")),
  );
  app.get("/v1/workspaces/:id/profile", async (request) =>
    members.profile(await device(request), parameter(request, "id")),
  );
  app.patch("/v1/workspaces/:id/profile", async (request) =>
    members.rename(
      await device(request),
      parameter(request, "id"),
      MemberProfileInputSchema.parse(request.body),
    ),
  );
  app.put("/v1/workspaces/:id/member-groups/:groupId", async (request) =>
    members.saveGroup(
      await device(request),
      parameter(request, "id"),
      parameter(request, "groupId"),
      MemberGroupInputSchema.parse(request.body),
    ),
  );
  app.delete("/v1/workspaces/:id/member-groups/:groupId", async (request) =>
    members.deleteGroup(
      await device(request),
      parameter(request, "id"),
      parameter(request, "groupId"),
      MemberRevisionSchema.parse(request.body),
    ),
  );
  app.put("/v1/workspaces/:id/group-access", async (request) =>
    members.saveGroupGrant(
      await device(request),
      parameter(request, "id"),
      GroupGrantInputSchema.parse(request.body),
    ),
  );
  app.delete("/v1/workspaces/:id/group-access/:grantId", async (request) =>
    members.revokeGroupGrant(
      await device(request),
      parameter(request, "id"),
      parameter(request, "grantId"),
      MemberRevisionSchema.parse(request.body),
    ),
  );
  app.patch(
    "/v1/workspaces/:id/members/:identityId/grants/:grantId",
    async (request) =>
      members.changeGrant(
        await device(request),
        parameter(request, "id"),
        parameter(request, "identityId"),
        parameter(request, "grantId"),
        MemberGrantInputSchema.parse(request.body),
      ),
  );
  app.delete(
    "/v1/workspaces/:id/members/:identityId/grants/:grantId",
    async (request) =>
      members.changeGrant(
        await device(request),
        parameter(request, "id"),
        parameter(request, "identityId"),
        parameter(request, "grantId"),
        MemberRevisionSchema.parse(request.body),
      ),
  );
  app.delete("/v1/workspaces/:id/members/:identityId", async (request) =>
    members.revokeMember(
      await device(request),
      parameter(request, "id"),
      parameter(request, "identityId"),
      MemberOperationSchema.parse(request.body),
    ),
  );
}
