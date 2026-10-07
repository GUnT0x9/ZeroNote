import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { IndexeddbPersistence, storeState } from "y-indexeddb";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  base64ToBytes,
  bytesToBase64,
  getDocumentProjection,
  getKnowledgeProjection,
  replaceSharedText,
  getAttachmentIds,
} from "@zeronote/shared";
import { database, errorMessage, type LocalPage } from "./database";
import { api, ApiError } from "./api";
import { collaborationUrl } from "./env";
import { useUiStore } from "./ui-store";
import { notifyDocumentActivity } from "./document-activity";

export interface DocumentSession {
  id: string;
  document: Y.Doc;
  awareness: Awareness;
  persistence: IndexeddbPersistence;
  provider?: HocuspocusProvider;
  rejoinRequired?: boolean;
  rejoinToken?: string;
  attachmentUploads?: Set<string>;
  generation: number;
  localSaveError?: string;
  connecting?: Promise<HocuspocusProvider | undefined>;
  ready: Promise<void>;
  saveTimer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
}
const sessions = new Map<string, DocumentSession>();
const DOCUMENT_RESET_REASON = "Reset Connection";
let requestSync = () => {};
export function setDocumentSyncRequest(callback: () => void): void {
  requestSync = callback;
}
export function getDocumentSession(id: string): DocumentSession | undefined {
  return sessions.get(id);
}
export function getLiveDocumentGenerations(): ReadonlyMap<string, number> {
  return new Map(
    [...sessions].map(([id, session]) => [id, session.generation]),
  );
}
export async function openDocument(page: LocalPage): Promise<DocumentSession> {
  const existing = sessions.get(page.id);
  if (existing) {
    await existing.ready;
    return existing;
  }
  const document = new Y.Doc({ gc: false }),
    persistence = new IndexeddbPersistence(`zeronote:${page.id}`, document);
  const session: DocumentSession = {
    id: page.id,
    document,
    awareness: new Awareness(document),
    persistence,
    generation: 0,
    ready: Promise.resolve(),
  };
  sessions.set(page.id, session);
  session.ready = hydrate(session, page);
  try {
    await session.ready;
    return session;
  } catch (error) {
    sessions.delete(page.id);
    await persistence.destroy();
    document.destroy();
    throw error;
  }
}
async function hydrate(
  session: DocumentSession,
  page: LocalPage,
): Promise<void> {
  await session.persistence.whenSynced;
  const cached = await database.documents.get(page.id);
  if (cached) {
    Y.applyUpdate(session.document, cached.update, "local-cache");
    session.generation = cached.generation;
  }
  const locallyCreated = await database.operations
    .filter(
      (operation) =>
        operation.payload.pageId === page.id &&
        operation.payload.action === "create",
    )
    .first();
  if (!cached && !locallyCreated && !page.accessLost) {
    try {
      const remote = await api<{ update: string }>(`/documents/${page.id}`);
      Y.applyUpdate(
        session.document,
        base64ToBytes(remote.update),
        "remote-fetch",
      );
    } catch (error) {
      if (!navigator.onLine)
        throw new Error(
          "이 기기에 아직 저장되지 않은 Page입니다. Online에서 한 번 열어주세요.",
        );
      throw error;
    }
  }
  session.document.on(
    "update",
    (
      _update: Uint8Array,
      _origin: unknown,
      _doc: Y.Doc,
      _transaction: Y.Transaction,
    ) => {
      session.generation++;
      session.localSaveError = undefined;
      notifyDocumentActivity();
      if (session.saveTimer) clearTimeout(session.saveTimer);
      session.saveTimer = setTimeout(() => {
        session.saving = saveLocal(session, page);
        void session.saving.catch((error) =>
          useUiStore.getState().patch({ notice: errorMessage(error) }),
        );
      }, 80);
    },
  );
  if (!session.document.getText("title").length && locallyCreated)
    replaceSharedText(session.document.getText("title"), page.title);
  if (cached) {
    const state = Y.encodeStateAsUpdate(session.document);
    if (
      state.byteLength === cached.update.byteLength &&
      state.every((byte, index) => byte === cached.update[index])
    ) {
      if (!cached.knowledge)
        await database.documents.update(page.id, {
          knowledge: getKnowledgeProjection(session.document),
          tags: getDocumentProjection(session.document).tags,
        });
      if (cached.generation > cached.committedGeneration) requestSync();
      return;
    }
    // IndexedDB may contain newer edits than the debounced projection after a crash.
    session.generation = Math.max(session.generation, cached.generation + 1);
  }
  await saveLocal(session, page);
}
async function saveLocal(
  session: DocumentSession,
  page: LocalPage,
): Promise<void> {
  const projection = getDocumentProjection(session.document),
    previous = await database.documents.get(page.id),
    generation = session.generation;
  try {
    await storeState(session.persistence, true);
    await database.transaction(
      "rw",
      database.documents,
      database.pages,
      async () => {
        await database.documents.put({
          id: page.id,
          workspaceId: page.workspaceId,
          update: Y.encodeStateAsUpdate(session.document),
          ...projection,
          knowledge: getKnowledgeProjection(session.document),
          generation,
          committedGeneration: previous?.committedGeneration ?? 0,
          state: previous?.state === "preserved" ? "preserved" : "saved",
          updatedAt: Date.now(),
        });
        await database.pages.update(page.id, {
          title: projection.title || page.title,
        });
      },
    );
    session.localSaveError = undefined;
    requestSync();
  } catch (error) {
    session.localSaveError = errorMessage(error);
    useUiStore.getState().patch({
      notice: "저장 공간을 확인해주세요. 내용을 저장하지 못했습니다.",
    });
    throw error;
  }
}
export async function flushDocuments(): Promise<void> {
  for (const session of sessions.values()) {
    await session.ready;
    if (session.saveTimer || session.localSaveError) {
      if (session.saveTimer) clearTimeout(session.saveTimer);
      session.saveTimer = undefined;
      const page = await database.pages.get(session.id);
      if (page) session.saving = saveLocal(session, page);
    }
    if (session.saving) await session.saving;
  }
}
export async function cacheRemoteDocument(page: LocalPage): Promise<void> {
  if (page.accessLost || page.deletedAt) return;
  const existing = await database.documents.get(page.id),
    session = sessions.get(page.id),
    remote = await api<{ update: string }>(`/documents/${page.id}`),
    update = base64ToBytes(remote.update);
  if (session) {
    Y.applyUpdate(session.document, update, "remote-fetch");
    return;
  }
  const document = new Y.Doc({ gc: false });
  try {
    if (existing) Y.applyUpdate(document, existing.update);
    Y.applyUpdate(document, update);
    const projection = getDocumentProjection(document);
    await database.documents.put({
      id: page.id,
      workspaceId: page.workspaceId,
      update: Y.encodeStateAsUpdate(document),
      ...projection,
      knowledge: getKnowledgeProjection(document),
      generation: existing?.generation ?? 0,
      committedGeneration: existing?.committedGeneration ?? 0,
      state: existing?.state ?? "saved",
      updatedAt: Date.now(),
    });
    await database.pages.update(page.id, {
      title: projection.title || page.title,
    });
  } finally {
    document.destroy();
  }
}
export function pauseDocumentForAttachmentUpload(
  pageId: string,
  attachmentId?: string,
): void {
  const session = sessions.get(pageId);
  if (session) {
    if (attachmentId)
      (session.attachmentUploads ??= new Set()).add(attachmentId);
    session.provider?.disconnect();
  }
  requestSync();
}
async function hasUncommittedDocumentFiles(
  session: DocumentSession,
): Promise<boolean> {
  const references = new Set(getAttachmentIds(session.document));
  const ids = [
    ...new Set([...references, ...(session.attachmentUploads ?? [])]),
  ];
  const files = await database.attachments.bulkGet(ids);
  for (let index = 0; index < ids.length; index++) {
    const file = files[index];
    if (
      !file ||
      file.status === "uploaded" ||
      (file.status === "preserved" && !references.has(file.id))
    )
      session.attachmentUploads?.delete(ids[index]!);
  }
  return files.some(
    (file) =>
      file &&
      file.status !== "uploaded" &&
      (references.has(file.id) || session.attachmentUploads?.has(file.id)),
  );
}
export async function connectDocument(
  session: DocumentSession,
  page: LocalPage,
): Promise<HocuspocusProvider | undefined> {
  if (page.accessLost || page.deletedAt || !navigator.onLine) return undefined;
  if (await hasUncommittedDocumentFiles(session)) {
    session.provider?.disconnect();
    return undefined;
  }
  if (session.provider) {
    if (session.rejoinRequired) {
      // sendToken swallows token-fetch errors. Check first so an unavailable
      // token endpoint cannot start another unauthenticated sync loop.
      const response = await api<{ token: string }>(
        `/documents/${page.id}/realtime-token`,
        "POST",
      );
      session.rejoinToken = response.token;
      await session.provider.sendToken();
      session.provider.startSync();
    } else await session.provider.connect();
    return session.provider;
  }
  if (session.connecting) return session.connecting;
  session.connecting = createProvider(session, page);
  try {
    return await session.connecting;
  } finally {
    session.connecting = undefined;
  }
}
async function createProvider(
  session: DocumentSession,
  page: LocalPage,
): Promise<HocuspocusProvider | undefined> {
  if (
    await database.operations
      .filter(
        (operation) =>
          operation.payload.pageId === page.id &&
          operation.payload.action === "create",
      )
      .count()
  ) {
    try {
      const sync = await import("./sync");
      await sync.synchronize();
    } catch {
      return undefined;
    }
  }
  try {
    await api(`/documents/${page.id}/realtime-token`, "POST");
  } catch (error) {
    if (error instanceof ApiError && [403, 410].includes(error.status))
      await markAccessFailure(page.id);
    useUiStore.getState().patch({ syncError: errorMessage(error) });
    return undefined;
  }
  if (await hasUncommittedDocumentFiles(session)) return undefined;
  const provider = new HocuspocusProvider({
    url: collaborationUrl(window.location.origin),
    name: page.id,
    document: session.document,
    awareness: session.awareness,
    token: async () => {
      if (session.rejoinToken) {
        const token = session.rejoinToken;
        session.rejoinToken = undefined;
        return token;
      }
      const response = await api<{ token: string }>(
        `/documents/${page.id}/realtime-token`,
        "POST",
      );
      return response.token;
    },
    onAuthenticated: () => {
      session.rejoinRequired = false;
    },
    onStateless: ({ payload }) => {
      try {
        const event: unknown = JSON.parse(payload);
        if (
          typeof event === "object" &&
          event &&
          "type" in event &&
          event.type === "comments-changed" &&
          "pageId" in event &&
          event.pageId === page.id
        )
          window.dispatchEvent(
            new CustomEvent("zeronote:comments-changed", { detail: page.id }),
          );
      } catch {
        /* Ignore unsupported events. */
      }
    },
    onAuthenticationFailed: () => {
      void markAccessFailure(page.id).catch((error) =>
        useUiStore.getState().patch({ notice: errorMessage(error) }),
      );
    },
    onClose: (closed) => {
      // Revocation can close just this document while its WebSocket stays open.
      // Confirm access with REST; an ordinary disconnect must not discard data.
      if (!navigator.onLine) return;
      if (
        closed?.event?.code === 1000 &&
        closed.event.reason === DOCUMENT_RESET_REASON
      )
        session.rejoinRequired = true;
      void markAccessFailure(page.id).catch((error) =>
        useUiStore.getState().patch({ notice: errorMessage(error) }),
      );
    },
  });
  session.provider = provider;
  return provider;
}
async function markAccessFailure(pageId: string): Promise<void> {
  try {
    await api(`/documents/${pageId}`);
    // A closed connection can mean a Role changed while read access remains.
    requestSync();
  } catch (error) {
    if (error instanceof ApiError && [403, 410].includes(error.status)) {
      // Dependency readers must stop resolving the cached Page as soon as the
      // server confirms revocation/deletion, without waiting for another sync.
      await database.pages.update(pageId, { accessLost: true });
      const current = await database.documents.get(pageId);
      if (current && current.generation > current.committedGeneration)
        await database.documents.update(pageId, {
          state: "preserved",
          error: error.message,
        });
    }
  }
}
export function disconnectDocument(session: DocumentSession): void {
  session.provider?.disconnect();
  session.awareness.setLocalState(null);
}
export function snapshotBase64(session: DocumentSession): string {
  return bytesToBase64(Y.encodeStateAsUpdate(session.document));
}
export async function removeLocalDocument(pageId: string): Promise<void> {
  const session = sessions.get(pageId);
  if (session) {
    if (session.saveTimer) clearTimeout(session.saveTimer);
    session.provider?.destroy();
    session.awareness.destroy();
    if (session.saving) await session.saving;
    await session.persistence.clearData();
    session.document.destroy();
    sessions.delete(pageId);
  } else {
    const persistence = new IndexeddbPersistence(
      `zeronote:${pageId}`,
      new Y.Doc(),
    );
    await persistence.whenSynced;
    await persistence.clearData();
    persistence.doc.destroy();
  }
}

export function disconnectAllDocuments(): void {
  for (const session of sessions.values()) disconnectDocument(session);
}
