import {
  MetadataSchema,
  bytesToBase64,
  type Metadata,
  canEdit,
  base64ToBytes,
  updatesHaveSameSnapshot,
} from "@zeronote/shared";
import { z } from "zod";
import { database, errorMessage, type LocalPage } from "./database";
import { api, ApiError, authenticate } from "./api";
import { useUiStore } from "./ui-store";
import { syncAttachments } from "./attachments";
import { syncPendingComments } from "./comments";
import {
  setDocumentSyncRequest,
  getDocumentSession,
  disconnectDocument,
  disconnectAllDocuments,
} from "./documents";

let running: Promise<void> | undefined,
  timer: ReturnType<typeof setTimeout> | undefined,
  requested = false,
  started = false;
export function requestSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void synchronize().catch((error) =>
      useUiStore.getState().patch({
        syncState: navigator.onLine ? "error" : "offline",
        syncError: errorMessage(error),
      }),
    );
  }, 400);
}
export function startSync(): () => void {
  if (started) return () => {};
  started = true;
  setDocumentSyncRequest(requestSync);
  const online = () => requestSync(),
    offline = () =>
      useUiStore.getState().patch({ syncState: "offline", syncError: null });
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  const visible = () => {
    if (document.visibilityState === "visible") requestSync();
    else disconnectAllDocuments();
  };
  window.addEventListener("focus", online);
  document.addEventListener("visibilitychange", visible);
  requestSync();
  return () => {
    started = false;
    window.removeEventListener("focus", online);
    document.removeEventListener("visibilitychange", visible);
    if (timer) clearTimeout(timer);
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
    setDocumentSyncRequest(() => {});
  };
}
export async function synchronize(): Promise<void> {
  if (running) {
    requested = true;
    return running;
  }
  if (!navigator.onLine) {
    useUiStore.getState().patch({ syncState: "offline" });
    return;
  }
  running = drainSyncRequests();
  try {
    await running;
  } finally {
    running = undefined;
  }
}
async function drainSyncRequests(): Promise<void> {
  do {
    requested = false;
    if (!navigator.onLine) {
      useUiStore.getState().patch({ syncState: "offline" });
      return;
    }
    await runSync();
  } while (requested);
}
async function runSync(): Promise<void> {
  try {
    useUiStore.getState().patch({ syncState: "connecting", syncError: null });
    await authenticate();
    await syncWorkspaces();
    await syncMetadataOperations();
    await syncAttachments();
    await syncDocuments();
    await syncPendingComments(async (comment) => {
      const session = getDocumentSession(comment.payload.pageId);
      if (!session) return true;
      const local = await database.documents.get(comment.payload.pageId);
      return (
        !session.localSaveError &&
        (!local ||
          local.state === "preserved" ||
          session.generation <= local.committedGeneration)
      );
    });
    const metadata = MetadataSchema.parse(await api<unknown>("/metadata"));
    await mergeMetadata(metadata);
    const capacity = z
      .object({ warning: z.boolean() })
      .parse(await api("/storage"));
    useUiStore.getState().patch({ storageWarning: capacity.warning });
    useUiStore
      .getState()
      .patch({ syncState: navigator.onLine ? "online" : "offline" });
  } catch (error) {
    useUiStore.getState().patch({
      syncState: navigator.onLine ? "error" : "offline",
      syncError: errorMessage(error),
    });
    throw error;
  }
}
async function syncWorkspaces(): Promise<void> {
  for (const workspace of await database.workspaces
    .filter((value) => value.pendingCreation)
    .toArray()) {
    const { id, name, ownerIdentityId, createdAt, recoveryHash } = workspace;
    try {
      await api("/workspaces", "POST", {
        id,
        name,
        ownerIdentityId,
        createdAt,
        recoveryHash,
      });
      await database.workspaces.update(id, {
        pendingCreation: false,
        creationError: undefined,
      });
    } catch (error) {
      if (error instanceof ApiError && [403, 409].includes(error.status)) {
        await database.workspaces.update(id, { creationError: error.message });
        useUiStore.getState().patch({ notice: error.message });
        continue;
      }
      throw error;
    }
  }
}
async function syncMetadataOperations(): Promise<void> {
  for (const operation of await database.operations
    .orderBy("sequence")
    .toArray()) {
    if (operation.status !== "pending") continue;
    if (
      (await database.workspaces.get(operation.payload.workspaceId))
        ?.pendingCreation
    )
      continue;
    try {
      const result = await api<LocalPage>(
        "/sync/page",
        "POST",
        operation.payload,
      );
      await database.operations.delete(operation.id);
      const remaining = await database.operations
        .filter((value) => value.payload.pageId === result.id)
        .count();
      if (!remaining) {
        const local = await database.pages.get(result.id);
        await database.pages.put({
          ...local,
          ...result,
          role: local?.role ?? "owner",
        });
      }
    } catch (error) {
      if (error instanceof ApiError && [403, 409, 410].includes(error.status)) {
        await database.operations.update(operation.id, {
          status: error.status === 409 ? "conflict" : "blocked",
          error: error.message,
        });
        continue;
      }
      throw error;
    }
  }
}
async function syncDocuments(): Promise<void> {
  for (const document of await database.documents
    .filter(
      (value) =>
        value.generation > value.committedGeneration &&
        value.state !== "preserved",
    )
    .toArray()) {
    const page = await database.pages.get(document.id);
    if (!page || page.deletedAt || page.accessLost) continue;
    if ((await database.workspaces.get(page.workspaceId))?.pendingCreation)
      continue;
    if (
      await database.operations
        .filter((value) => value.payload.pageId === page.id)
        .count()
    )
      continue;
    try {
      if (!canEdit(page.role)) {
        const remote = await api<{ update: string }>(
          `/documents/${document.id}`,
        );
        if (
          updatesHaveSameSnapshot(document.update, base64ToBytes(remote.update))
        )
          await database.documents.update(document.id, {
            committedGeneration: document.generation,
            state: "saved",
            error: undefined,
          });
        continue;
      }
      const result = await api<{ durable: boolean }>(
        `/documents/${document.id}/commit`,
        "POST",
        {
          operationId: crypto.randomUUID(),
          update: bytesToBase64(document.update),
        },
      );
      if (result.durable)
        await database.documents.update(document.id, {
          committedGeneration: document.generation,
          state: "saved",
          error: undefined,
        });
    } catch (error) {
      if (error instanceof ApiError && [403, 410].includes(error.status)) {
        await database.documents.update(document.id, {
          state: "preserved",
          error: error.message,
        });
        continue;
      }
      await database.documents.update(document.id, {
        state: "error",
        error: errorMessage(error),
      });
      throw error;
    }
  }
}
export async function mergeMetadata(metadata: Metadata): Promise<void> {
  const workspaces = await database.workspaces.toArray(),
    pages = await database.pages.toArray();
  for (const remote of metadata.workspaces) {
    const existing = workspaces.find((workspace) => workspace.id === remote.id);
    await database.workspaces.put({
      ...existing,
      ...remote,
      pendingCreation: false,
      accessLost: false,
    });
  }
  for (const existing of workspaces) {
    if (
      !existing.pendingCreation &&
      !metadata.workspaces.some((workspace) => workspace.id === existing.id)
    )
      await database.workspaces.update(existing.id, { accessLost: true });
  }
  for (const remote of metadata.pages) {
    const existing = pages.find((page) => page.id === remote.id),
      pending = await database.operations
        .filter((operation) => operation.payload.pageId === remote.id)
        .count();
    const document = await database.documents.get(remote.id);
    if (
      remote.deletedAt &&
      document &&
      document.generation > document.committedGeneration
    )
      await database.documents.update(remote.id, {
        state: "preserved",
        error: "원격에서 삭제된 Page의 미전송 변경을 보존했습니다.",
      });
    await database.pages.put({
      ...existing,
      ...(pending ? existing : remote),
      ...(!existing ? remote : {}),
      role: metadata.roles[remote.id],
      accessLost: false,
      title: document?.title || remote.title,
    } as LocalPage);
  }
  for (const existing of pages) {
    if (metadata.pages.some((page) => page.id === existing.id)) continue;
    if (
      await database.operations
        .filter(
          (operation) =>
            operation.payload.pageId === existing.id &&
            operation.payload.action === "create",
        )
        .count()
    )
      continue;
    await database.pages.update(existing.id, {
      role: undefined,
      accessLost: true,
    });
    const session = getDocumentSession(existing.id);
    if (session) disconnectDocument(session);
    const document = await database.documents.get(existing.id);
    if (
      document?.generation &&
      document.generation > document.committedGeneration
    )
      await database.documents.update(existing.id, {
        state: "preserved",
        error: "Page 접근 권한이 변경되어 로컬 복사본으로 보존했습니다.",
      });
  }
  await database.preferences.put({
    id: "identities",
    value: JSON.stringify(metadata.identities),
  });
}
export async function reapplyOperation(id: string): Promise<void> {
  const operation = await database.operations.get(id);
  if (!operation) return;
  const metadata = MetadataSchema.parse(await api<unknown>("/metadata")),
    remote = metadata.pages.find(
      (page) => page.id === operation.payload.pageId,
    );
  if (!remote) throw new Error("Page에 접근할 수 없습니다.");
  await database.operations.update(id, {
    status: "pending",
    error: undefined,
    payload: { ...operation.payload, expectedRevision: remote.revision },
  });
  requestSync();
}
