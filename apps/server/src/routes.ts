import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  BetaRedeemSchema,
  SnapshotInputSchema,
  RestoreSnapshotSchema,
  CreateWorkspaceSchema,
  RegisterDeviceSchema,
  PageOperationSchema,
  InviteSchema,
  CommitSchema,
  CommentInputSchema,
  RecoverySchema,
  INVITE_LIFETIME_MS,
  IdSchema,
  sha256Hex,
  normalizeRecoveryKey,
} from "@zeronote/shared";
import { Repository } from "./database/repository";
import {
  AuthService,
  AccessService,
  WorkspaceService,
  DocumentService,
  DomainError,
} from "./services";
import { closeIncompatibleConnections, createRealtimeToken } from "./realtime";
import { requestEditorProtocol } from "./editor-protocol";
import { EDITOR_PROTOCOL } from "@zeronote/shared";
import type { createRealtime } from "./realtime";
import { SnapshotService } from "./snapshot-service";
import { env } from "./env";
import * as Y from "yjs";
import { AttachmentService } from "./attachment-service";
import { registerAttachmentRoutes } from "./attachment-routes";

type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
  deviceId: string,
) => Promise<unknown>;
export function parameter(request: FastifyRequest, key: string): string {
  return IdSchema.parse(
    z.record(z.string(), z.string()).parse(request.params)[key],
  );
}
export function registerRoutes(
  app: FastifyInstance,
  repository: Repository,
  realtime: ReturnType<typeof createRealtime>,
  documents: DocumentService,
): void {
  const auth = new AuthService(repository),
    access = new AccessService(repository),
    workspaces = new WorkspaceService(repository, access),
    snapshots = new SnapshotService(repository, access);
  registerAttachmentRoutes(
    app,
    auth,
    new AttachmentService(repository, access),
  );
  const authenticated =
    (handler: Handler) =>
    async (request: FastifyRequest, reply: FastifyReply) =>
      handler(
        request,
        reply,
        await auth.deviceForToken(request.cookies.zn_session),
      );
  app.get("/v1/health", async () => ({ status: "ok" }));
  app.get(
    "/v1/beta/status",
    authenticated(async (_request, _reply, deviceId) =>
      repository.beta.status(deviceId),
    ),
  );
  app.post(
    "/v1/beta/redeem",
    { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
    authenticated(async (request, _reply, deviceId) => {
      const { code } = BetaRedeemSchema.parse(request.body);
      await repository.beta.redeem(deviceId, await sha256Hex(code));
      return repository.beta.status(deviceId);
    }),
  );
  app.get(
    "/v1/storage",
    authenticated(async () => repository.documents.capacity()),
  );
  app.get(
    "/v1/pages/:id/snapshots",
    authenticated(async (request, _reply, deviceId) =>
      snapshots.list(deviceId, parameter(request, "id")),
    ),
  );
  app.post(
    "/v1/pages/:id/snapshots",
    authenticated(async (request, _reply, deviceId) => {
      const input = SnapshotInputSchema.parse(request.body);
      return snapshots.create(
        deviceId,
        parameter(request, "id"),
        input.operationId,
        input.name,
      );
    }),
  );
  app.get(
    "/v1/snapshots/:id",
    authenticated(async (request, _reply, deviceId) =>
      snapshots.read(
        deviceId,
        parameter(request, "id"),
        requestEditorProtocol(request),
      ),
    ),
  );
  app.delete(
    "/v1/snapshots/:id",
    authenticated(async (request, _reply, deviceId) => {
      await snapshots.remove(deviceId, parameter(request, "id"));
      return { deleted: true };
    }),
  );
  app.post(
    "/v1/snapshots/:id/restore-copy",
    authenticated(async (request, _reply, deviceId) => {
      const input = RestoreSnapshotSchema.parse(request.body);
      return snapshots.restore(
        deviceId,
        parameter(request, "id"),
        input.operationId,
      );
    }),
  );
  app.post(
    "/v1/devices",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const input = RegisterDeviceSchema.parse(request.body);
      await auth.register({
        id: input.id,
        name: input.name,
        publicKey: input.publicKey,
      });
      return { id: input.id };
    },
  );
  app.post(
    "/v1/auth/challenge",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) =>
      auth.challenge(
        z.object({ deviceId: IdSchema }).strict().parse(request.body).deviceId,
      ),
  );
  app.post("/v1/auth/verify", async (request, reply) => {
    const input = z
      .object({ challengeId: IdSchema, signature: z.string().max(200) })
      .strict()
      .parse(request.body);
    const token = await auth.verify(input.challengeId, input.signature);
    reply.setCookie("zn_session", token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 86400,
    });
    return { authenticated: true };
  });
  app.get(
    "/v1/metadata",
    authenticated(async (_request, _reply, deviceId) =>
      access.metadata(deviceId),
    ),
  );
  app.post(
    "/v1/workspaces",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    authenticated(async (request, _reply, deviceId) => {
      const input = CreateWorkspaceSchema.parse(request.body),
        device = await repository.getDevice(deviceId);
      if (!device) throw new DomainError(401, "기기를 확인할 수 없습니다.");
      const existing = await repository.getWorkspace(input.id);
      if (existing) {
        await access.workspaceOwner(deviceId, input.id);
        return { id: existing.id };
      }
      await repository.createWorkspace(input, device);
      return { id: input.id };
    }),
  );
  app.post(
    "/v1/workspaces/recover",
    { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
    authenticated(async (request, _reply, deviceId) =>
      workspaces.recover(deviceId, RecoverySchema.parse(request.body).key),
    ),
  );
  app.post(
    "/v1/workspaces/:id/recovery",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id");
      await access.workspaceOwner(deviceId, id);
      await repository.rotateRecovery(
        id,
        await sha256Hex(
          normalizeRecoveryKey(RecoverySchema.parse(request.body).key),
        ),
      );
      return { updated: true };
    }),
  );
  app.delete(
    "/v1/workspaces/:id",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id");
      await access.workspaceOwner(deviceId, id);
      const input = z.object({ name: z.string() }).strict().parse(request.body),
        workspace = await repository.getWorkspace(id);
      if (input.name !== workspace?.name)
        throw new DomainError(400, "Workspace 이름을 정확하게 입력해주세요.");
      for (const page of await repository.listPages(id))
        realtime.closeConnections(page.id);
      await repository.deleteWorkspace(id);
      return { deleted: true };
    }),
  );
  app.get(
    "/v1/workspaces/:id/devices",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id");
      await access.workspaceOwner(deviceId, id);
      return repository.listDevices(id);
    }),
  );
  app.delete(
    "/v1/workspaces/:id/devices/:deviceId",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id"),
        target = parameter(request, "deviceId");
      await access.workspaceOwner(deviceId, id);
      if (target === deviceId)
        throw new DomainError(
          400,
          "현재 기기는 다른 승인된 기기에서 철회해주세요.",
        );
      await repository.revokeDevice(id, target);
      for (const page of await repository.listPages(id))
        realtime.closeConnections(page.id);
      return { revoked: true };
    }),
  );
  app.post(
    "/v1/sync/page",
    authenticated(async (request, _reply, deviceId) => {
      const operation = PageOperationSchema.parse(request.body),
        result = await workspaces.pageOperation(deviceId, operation);
      if (operation.action !== "create")
        for (const page of await repository.listPages(operation.workspaceId))
          realtime.closeConnections(page.id);
      return result;
    }),
  );
  app.get(
    "/v1/documents/:id",
    authenticated(async (request, _reply, deviceId) => ({
      update: await documents.read(
        deviceId,
        parameter(request, "id"),
        requestEditorProtocol(request),
      ),
    })),
  );
  app.post(
    "/v1/documents/:id/commit",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id"),
        input = CommitSchema.parse(request.body),
        update = await documents.commit(
          deviceId,
          id,
          input.operationId,
          input.update,
          requestEditorProtocol(request),
        );
      closeIncompatibleConnections(
        realtime.documents.get(id),
        await documents.assertProtocol(id, EDITOR_PROTOCOL),
      );
      const connection = await realtime.openDirectConnection(id, { deviceId });
      try {
        await connection.transact((document) =>
          Y.applyUpdate(document, update),
        );
      } finally {
        await connection.disconnect({ unloadImmediately: false });
      }
      return { operationId: input.operationId, durable: true };
    }),
  );
  app.post(
    "/v1/documents/:id/realtime-token",
    authenticated(async (request, _reply, deviceId) => {
      const pageId = parameter(request, "id"),
        protocol = requestEditorProtocol(request);
      await access.page(deviceId, pageId);
      await documents.assertProtocol(pageId, protocol);
      return {
        token: await createRealtimeToken(deviceId, pageId, access, protocol),
      };
    }),
  );
  app.post(
    "/v1/invites",
    authenticated(async (request, _reply, deviceId) => {
      const input = InviteSchema.parse(request.body),
        page = await repository.getPage(input.pageId);
      if (!page) throw new DomainError(404, "Page를 찾을 수 없습니다.");
      await access.workspaceOwner(deviceId, page.workspaceId);
      await access.page(deviceId, page.id);
      const id = crypto.randomUUID(),
        secret = randomBytes(32).toString("base64url"),
        expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS).toISOString();
      await repository.createInvite({
        id,
        workspaceId: page.workspaceId,
        ...input,
        secretHash: await sha256Hex(secret),
        expiresAt,
      });
      return { id, secret, expiresAt };
    }),
  );
  app.post(
    "/v1/invites/:id/redeem",
    authenticated(async (request, _reply, deviceId) => {
      const input = z
          .object({ secret: z.string().min(20).max(128) })
          .strict()
          .parse(request.body),
        device = await repository.getDevice(deviceId);
      if (!device) throw new DomainError(401, "Device required");
      const result = await repository.redeemInvite(
        parameter(request, "id"),
        await sha256Hex(input.secret),
        device,
      );
      if (!result)
        throw new DomainError(410, "만료되었거나 이미 사용된 초대입니다.");
      await access.page(deviceId, result.pageId);
      return result;
    }),
  );
  app.get(
    "/v1/pages/:id/share",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id"),
        permission = await access.page(deviceId, id);
      await access.workspaceOwner(deviceId, permission.page.workspaceId);
      return {
        grants: await repository.listPageGrants(id),
        invites: await repository.listInvites(id),
      };
    }),
  );
  app.delete(
    "/v1/pages/:id/grants/:grantId",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id"),
        permission = await access.page(deviceId, id);
      await access.workspaceOwner(deviceId, permission.page.workspaceId);
      await repository.revokeGrant(id, parameter(request, "grantId"));
      for (const page of await repository.listPages(
        permission.page.workspaceId,
      ))
        realtime.closeConnections(page.id);
      return { revoked: true };
    }),
  );
  app.delete(
    "/v1/pages/:id/invites/:inviteId",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id"),
        permission = await access.page(deviceId, id);
      await access.workspaceOwner(deviceId, permission.page.workspaceId);
      await repository.cancelInvite(id, parameter(request, "inviteId"));
      return { revoked: true };
    }),
  );
  app.get(
    "/v1/pages/:id/comments",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id");
      await access.page(deviceId, id);
      return repository.listComments(id);
    }),
  );
  app.post(
    "/v1/comments",
    authenticated(async (request, _reply, deviceId) => {
      const input = CommentInputSchema.parse(request.body);
      await workspaces.comment(deviceId, input);
      realtime.documents
        .get(input.pageId)
        ?.broadcastStateless(
          JSON.stringify({ type: "comments-changed", pageId: input.pageId }),
        );
      return { id: input.id };
    }),
  );
  app.patch(
    "/v1/pages/:id/comments/:commentId",
    authenticated(async (request, _reply, deviceId) => {
      const id = parameter(request, "id"),
        permission = await access.page(deviceId, id);
      if (permission.role === "viewer")
        throw new DomainError(403, "Comment 권한이 필요합니다.");
      await repository.resolveComment(
        id,
        parameter(request, "commentId"),
        z.object({ resolved: z.boolean() }).strict().parse(request.body)
          .resolved,
      );
      realtime.documents
        .get(id)
        ?.broadcastStateless(
          JSON.stringify({ type: "comments-changed", pageId: id }),
        );
      return { updated: true };
    }),
  );
}
