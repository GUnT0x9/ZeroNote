import "fake-indexeddb/auto";
import { afterEach, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { getDocumentProjection } from "@zeronote/shared";
import { database, type LocalPage } from "./database";
import {
  openDocument,
  connectDocument,
  pauseDocumentForAttachmentUpload,
  removeLocalDocument,
} from "./documents";
import { stageAttachment } from "./attachments";
import { api, ApiError } from "./api";
const providerEvents = vi.hoisted(() => ({
  authenticationFailed: undefined as (() => void) | undefined,
  close: undefined as (() => void) | undefined,
}));
vi.mock("./api", () => ({
  api: vi.fn(),
  ApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    constructor(options: {
      onAuthenticationFailed?: () => void;
      onClose?: () => void;
    }) {
      providerEvents.authenticationFailed = options.onAuthenticationFailed;
      providerEvents.close = options.onClose;
    }
    connect = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => undefined);
    destroy = vi.fn();
  },
}));
const pages: string[] = [];
async function fixture() {
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  const page: LocalPage = {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    parentId: null,
    kind: "document",
    title: "Files",
    role: "owner",
    revision: 0,
    deletedAt: null,
    isInbox: false,
    createdAt: new Date().toISOString(),
  };
  pages.push(page.id);
  await database.pages.put(page);
  const doc = new Y.Doc();
  await database.documents.put({
    id: page.id,
    workspaceId: page.workspaceId,
    update: Y.encodeStateAsUpdate(doc),
    ...getDocumentProjection(doc),
    generation: 0,
    committedGeneration: 0,
    state: "saved",
    updatedAt: Date.now(),
  });
  doc.destroy();
  const session = await openDocument(page);
  const provider = new HocuspocusProvider({
    url: "wss://example.invalid/collaboration",
    name: page.id,
    document: session.document,
  });
  session.provider = provider;
  return { session, provider, page };
}
afterEach(async () => {
  for (const id of pages.splice(0)) {
    await removeLocalDocument(id);
    await database.pages.delete(id);
    await database.attachments.where("pageId").equals(id).delete();
  }
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  providerEvents.authenticationFailed = undefined;
  providerEvents.close = undefined;
});
it("pauses realtime while a referenced file is pending and resumes only after its upload", async () => {
  const { session, provider, page } = await fixture();
  const file = await stageAttachment(
    page.id,
    "pending.txt",
    Uint8Array.from([65]),
  );
  expect(provider.disconnect).toHaveBeenCalledTimes(1);
  // Staging pauses before the editor inserts its Block, including that async gap.
  expect(await connectDocument(session, page)).toBeUndefined();
  expect(provider.connect).not.toHaveBeenCalled();
  const node = new Y.XmlElement("attachment");
  node.setAttribute("attachmentId", file.id);
  session.document.getXmlFragment("content").insert(0, [node]);
  expect(await connectDocument(session, page)).toBeUndefined();
  expect(provider.connect).not.toHaveBeenCalled();
  await database.attachments.update(file.id, { status: "uploaded" });
  expect(await connectDocument(session, page)).toBe(provider);
  expect(provider.connect).toHaveBeenCalledTimes(1);
  await database.attachments.update(file.id, { status: "preserved" });
  expect(await connectDocument(session, page)).toBeUndefined();
  session.document.getXmlFragment("content").delete(0, 1);
  expect(await connectDocument(session, page)).toBe(provider);
  expect(provider.connect).toHaveBeenCalledTimes(2);
});
it("does not block a remote file without a local cache and keeps inaccessible Pages disconnected", async () => {
  const { session, provider, page } = await fixture();
  const node = new Y.XmlElement("attachment");
  node.setAttribute("attachmentId", crypto.randomUUID());
  session.document.getXmlFragment("content").insert(0, [node]);
  expect(await connectDocument(session, page)).toBe(provider);
  pauseDocumentForAttachmentUpload(page.id);
  expect(provider.disconnect).toHaveBeenCalledOnce();
  expect(
    await connectDocument(session, { ...page, accessLost: true }),
  ).toBeUndefined();
  expect(
    await connectDocument(session, {
      ...page,
      deletedAt: new Date().toISOString(),
    }),
  ).toBeUndefined();
  pauseDocumentForAttachmentUpload("missing");
  expect(provider.connect).toHaveBeenCalledOnce();
});

it.each([403, 410])(
  "removes a cached dependency from accessible Pages after confirmed %s and preserves unsent edits",
  async (status) => {
    const { session, page } = await fixture();
    session.provider = undefined;
    await database.documents.update(page.id, { generation: 1 });
    vi.mocked(api).mockRejectedValue(new ApiError(status, "Access removed"));
    expect(await connectDocument(session, page)).toBeUndefined();
    expect((await database.pages.get(page.id))?.accessLost).toBe(true);
    expect((await database.documents.get(page.id))?.state).toBe("preserved");
  },
);
it("updates Page access after realtime authentication fails without treating temporary outages as revocation", async () => {
  const { session, page } = await fixture();
  session.provider = undefined;
  vi.mocked(api).mockRejectedValueOnce(new ApiError(503, "Unavailable"));
  expect(await connectDocument(session, page)).toBeUndefined();
  expect((await database.pages.get(page.id))?.accessLost).not.toBe(true);
  vi.mocked(api).mockResolvedValueOnce(undefined);
  expect(await connectDocument(session, page)).toBeDefined();
  vi.mocked(api).mockRejectedValueOnce(new ApiError(403, "Revoked"));
  providerEvents.authenticationFailed!();
  await vi.waitFor(async () =>
    expect((await database.pages.get(page.id))?.accessLost).toBe(true),
  );
});

it.each([403, 410])(
  "confirms access loss after a document close (%s) and preserves unsent edits",
  async (status) => {
    const { session, page } = await fixture();
    session.provider = undefined;
    vi.mocked(api).mockResolvedValueOnce(undefined);
    expect(await connectDocument(session, page)).toBeDefined();
    await database.documents.update(page.id, { generation: 1 });
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(status, "Access removed"),
    );
    providerEvents.close!();
    await vi.waitFor(async () => {
      expect((await database.pages.get(page.id))?.accessLost).toBe(true);
      expect((await database.documents.get(page.id))?.state).toBe("preserved");
    });
  },
);

it.each(["accessible", "unavailable", "offline"])(
  "keeps cached data after an ordinary close while %s",
  async (state) => {
    const { session, page } = await fixture();
    session.provider = undefined;
    vi.mocked(api).mockResolvedValueOnce(undefined);
    expect(await connectDocument(session, page)).toBeDefined();
    await database.documents.update(page.id, { generation: 1 });
    vi.mocked(api).mockClear();
    if (state === "unavailable")
      vi.mocked(api).mockRejectedValueOnce(new ApiError(503, "Unavailable"));
    else vi.mocked(api).mockResolvedValueOnce(undefined);
    if (state === "offline") vi.stubGlobal("navigator", { onLine: false });
    providerEvents.close!();
    if (state === "offline") expect(api).not.toHaveBeenCalled();
    else
      await vi.waitFor(() =>
        expect(api).toHaveBeenCalledWith(`/documents/${page.id}`),
      );
    expect((await database.pages.get(page.id))?.accessLost).not.toBe(true);
    expect((await database.documents.get(page.id))?.generation).toBe(1);
    expect((await database.documents.get(page.id))?.state).not.toBe(
      "preserved",
    );
  },
);
