import { Hocuspocus } from "@hocuspocus/server";
import { SignJWT, jwtVerify } from "jose";
import { bytesToBase64, canEdit, MAX_TRANSPORT_BYTES } from "@zeronote/shared";
import { AccessService, DocumentService, DomainError } from "./services";
import { env } from "./env";
import type { FastifyBaseLogger } from "fastify";
import type { Document } from "@hocuspocus/server";
import { EDITOR_PROTOCOL, EDITOR_UPDATE_MESSAGE } from "@zeronote/shared";

interface RealtimeContext {
  editorProtocol?: number;
  deviceId?: string;
  expiresAt?: number;
  identity?: { id: string; name: string; color: string };
}
export function closeIncompatibleConnections(
  document: Document | undefined,
  minimumProtocol: number,
): void {
  for (const connection of document?.getConnections() ?? []) {
    const context: unknown = connection.context;
    const protocol =
      typeof context === "object" &&
      context !== null &&
      "editorProtocol" in context &&
      typeof context.editorProtocol === "number"
        ? context.editorProtocol
        : 1;
    if (protocol < minimumProtocol)
      connection.close({ code: 4406, reason: EDITOR_UPDATE_MESSAGE });
  }
}
const secret = new TextEncoder().encode(env.REALTIME_SECRET);
export function createRealtime(
  access: AccessService,
  documents: DocumentService,
  logger: FastifyBaseLogger,
) {
  return new Hocuspocus<RealtimeContext>({
    name: "ZeroNote",
    quiet: true,
    debounce: 500,
    maxDebounce: 2000,
    async onAuthenticate({ token, documentName, connectionConfig }) {
      const { payload } = await jwtVerify(token, secret, {
        issuer: "zeronote",
        audience: "realtime",
      });
      if (
        typeof payload.deviceId !== "string" ||
        payload.resourceId !== documentName
      )
        throw new DomainError(403, "Wrong document scope");
      const permission = await access.page(payload.deviceId, documentName);
      const editorProtocol = payload.editorProtocol ?? 1;
      if (
        typeof editorProtocol !== "number" ||
        !Number.isInteger(editorProtocol) ||
        editorProtocol < 1 ||
        editorProtocol > EDITOR_PROTOCOL
      )
        throw new DomainError(426, EDITOR_UPDATE_MESSAGE);
      await documents.assertProtocol(documentName, editorProtocol);
      connectionConfig.readOnly = !canEdit(permission.role);
      return {
        deviceId: payload.deviceId,
        editorProtocol,
        expiresAt: payload.exp,
        identity: {
          id: permission.identityId,
          name: permission.name,
          color:
            ["#5277cc", "#a65c75", "#46846a", "#a27c43", "#7968b6"][
              parseInt(permission.identityId.slice(0, 6), 16) % 5
            ] ?? "#5277cc",
        },
      };
    },
    async beforeHandleMessage({ context, update }) {
      if (!context.deviceId) throw new DomainError(401, "Device required");
      if (!context.expiresAt || context.expiresAt <= Date.now() / 1000)
        throw new DomainError(401, "Token expired");
      if (update.byteLength > MAX_TRANSPORT_BYTES)
        throw new DomainError(413, "Message too large");
    },
    async beforeHandleAwareness({ states, context }) {
      if (!context?.identity) return;
      for (const state of states.values()) state.user = context.identity;
    },
    async onLoadDocument({ documentName }) {
      return documents.load(documentName);
    },
    async beforeSync({
      context,
      documentName,
      document,
      connection,
      type,
      payload,
    }) {
      if (!context.deviceId) throw new DomainError(401, "Device required");
      // Awareness heartbeats stay in memory. Revalidate every document read/write;
      // permission mutations also close the affected active connections.
      const permission = await access.page(context.deviceId, documentName);
      connection.readOnly = !canEdit(permission.role);
      await documents.assertProtocol(documentName, context.editorProtocol ?? 1);
      if (type === 0 || connection.readOnly) return;
      // Persist and validate before Hocuspocus applies or broadcasts the update.
      try {
        await documents.commit(
          context.deviceId,
          documentName,
          crypto.randomUUID(),
          bytesToBase64(payload),
          context.editorProtocol ?? 1,
        );
        closeIncompatibleConnections(
          document,
          await documents.assertProtocol(documentName, EDITOR_PROTOCOL),
        );
      } catch (error) {
        logger.warn("Realtime commit rejected");
        throw new DomainError(
          error instanceof DomainError ? error.status : 503,
          error instanceof DomainError && error.status === 426
            ? EDITOR_UPDATE_MESSAGE
            : "실시간 변경을 저장하지 못했습니다. 로컬 데이터로 다시 동기화해주세요.",
        );
      }
    },
    // beforeSync and REST commits already persist checkpoints atomically.
    // A debounced room checkpoint would repeat writes and race with deletion.
  });
}
export async function createRealtimeToken(
  deviceId: string,
  pageId: string,
  access: AccessService,
  editorProtocol = 1,
): Promise<string> {
  await access.page(deviceId, pageId);
  return new SignJWT({ deviceId, resourceId: pageId, editorProtocol })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("zeronote")
    .setAudience("realtime")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}
