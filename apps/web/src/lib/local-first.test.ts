import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence, storeState } from "y-indexeddb";
import {
  createTaskRow,
  addDatabaseProperty,
  getDatabaseProperties,
  getDatabaseMode,
  getDatabaseViews,
  getTaskRows,
  readDatabaseValue,
  writeDatabaseValue,
  saveDatabaseView,
  defaultDatabaseView,
  replaceSharedText,
  bytesToBase64,
  type WorkspaceExport,
  getDocumentProjection,
} from "@zeronote/shared";
import { database, type LocalPage, type LocalDocument } from "./database";
import {
  createLocalWorkspace,
  createLocalPage,
  captureNote,
  exportWorkspace,
  importWorkspace,
  deleteLocalWorkspace,
  validateImportedTree,
  changePageStructure,
  duplicateLocalPage,
} from "./workspace";
import { openDocument, flushDocuments } from "./documents";
import { searchLocalPages, availablePages, retainEqualItems } from "./search";
import { stageAttachment, loadAttachment } from "./attachments";
import { getAttachmentIds } from "@zeronote/shared";
vi.mock("./api", () => ({
  api: vi.fn(async () => {
    throw new Error("Network disabled in local tests");
  }),
  ApiError: class extends Error {
    status = 403;
  },
}));
const created: string[] = [];
it("exports and imports attachment bytes with remapped Page/file IDs and rejects corrupt files", async () => {
  const { workspace: source, page } = await workspace();
  const session = await openDocument(page),
    file = await stageAttachment(
      page.id,
      "한글.ts",
      new TextEncoder().encode("const value=1;"),
    );
  const node = new Y.XmlElement("attachment");
  node.setAttribute("attachmentId", file.id);
  session.document.getXmlFragment("content").insert(0, [node]);
  const exported = await exportWorkspace(source.id);
  expect(exported.schemaVersion).toBe(2);
  expect(exported.attachments).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toContain(file.operationId);
  const imported = await importWorkspace(exported);
  created.push(imported.workspace.id);
  const copy = (
    await database.pages
      .where("workspaceId")
      .equals(imported.workspace.id)
      .toArray()
  ).find((value) => value.title === page.title)!;
  const copied = await openDocument(copy),
    ids = getAttachmentIds(copied.document);
  expect(ids).toHaveLength(1);
  expect(ids[0]).not.toBe(file.id);
  const bytes = await loadAttachment(ids[0]!, copy.id);
  expect(bytes.data).toEqual(file.data);
  expect(bytes.status).toBe("pending");
  const before = await database.workspaces.count();
  await expect(
    importWorkspace({
      ...exported,
      attachments: exported.attachments!.map((value) => ({
        ...value,
        hash: "0".repeat(64),
      })),
    }),
  ).rejects.toThrow("손상");
  expect(await database.workspaces.count()).toBe(before);
});
async function workspace() {
  const result = await createLocalWorkspace("Local tests");
  created.push(result.workspace.id);
  return result;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of created.splice(0)) await deleteLocalWorkspace(id);
});
it("opens an unchanged cached page without rewriting its local projection", async () => {
  const { page: original } = await workspace();
  const page = { ...original, id: crypto.randomUUID(), title: "Cached" };
  const document = new Y.Doc({ gc: false });
  document.getText("title").insert(0, page.title);
  await database.pages.put(page);
  await database.documents.put({
    id: page.id,
    workspaceId: page.workspaceId,
    ...getDocumentProjection(document),
    update: Y.encodeStateAsUpdate(document),
    generation: 0,
    committedGeneration: 0,
    state: "saved",
    updatedAt: Date.now(),
  });
  const write = vi.spyOn(database.documents, "put");
  const session = await openDocument(page);
  expect(session.document.getText("title").toString()).toBe("Cached");
  expect(write).not.toHaveBeenCalled();
  expect(session.generation).toBe(0);
  document.destroy();
});
it("duplicates a Page into independent content and attachment IDs without copying Template or grants", async () => {
  const { page } = await workspace(),
    session = await openDocument(page);
  session.document.getMap("pageSettings").set("template", true);
  const file = await stageAttachment(
      page.id,
      "copy.txt",
      new TextEncoder().encode("copy me"),
    ),
    node = new Y.XmlElement("attachment");
  node.setAttribute("attachmentId", file.id);
  session.document.getXmlFragment("content").insert(0, [node]);
  const copy = await duplicateLocalPage(page),
    copied = await openDocument(copy);
  expect(copy.id).not.toBe(page.id);
  expect(copy.title).toBe(`${page.title} (복사)`);
  expect(copied.document.getText("title").toString()).toBe(copy.title);
  expect(copied.document.getMap("pageSettings").get("template")).toBe(false);
  const ids = getAttachmentIds(copied.document);
  expect(ids[0]).not.toBe(file.id);
  expect((await loadAttachment(ids[0]!, copy.id)).data).toEqual(file.data);
  await expect(duplicateLocalPage({ ...page, role: "viewer" })).rejects.toThrow(
    "Owner",
  );
  await expect(
    duplicateLocalPage({ ...page, deletedAt: new Date().toISOString() }),
  ).rejects.toThrow("Owner");
  expect(session.document.getMap("pageSettings").get("template")).toBe(true);
});
it("recovers newer persisted edits after a crash and marks them uncommitted", async () => {
  const { page: original } = await workspace();
  const page = { ...original, id: crypto.randomUUID(), title: "Cached" };
  const document = new Y.Doc({ gc: false });
  document.getText("title").insert(0, page.title);
  await database.pages.put(page);
  await database.documents.put({
    id: page.id,
    workspaceId: page.workspaceId,
    ...getDocumentProjection(document),
    update: Y.encodeStateAsUpdate(document),
    generation: 0,
    committedGeneration: 0,
    state: "saved",
    updatedAt: Date.now(),
  });
  const persistence = new IndexeddbPersistence(`zeronote:${page.id}`, document);
  await persistence.whenSynced;
  document
    .getText("title")
    .insert(document.getText("title").length, " recovered");
  await storeState(persistence, true);
  await persistence.destroy();
  document.destroy();
  const session = await openDocument(page);
  const record = await database.documents.get(page.id);
  expect(session.document.getText("title").toString()).toBe("Cached recovered");
  expect(record?.title).toBe("Cached recovered");
  expect(record!.generation).toBeGreaterThan(record!.committedGeneration);
});
describe("Local-first data", () => {
  it("creates a workspace with only a recovery hash and durable local pages", async () => {
    const { workspace: ws, key, page } = await workspace();
    expect(ws.recoveryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(await database.workspaces.get(ws.id))).not.toContain(
      key,
    );
    expect(
      await database.pages.where("workspaceId").equals(ws.id).count(),
    ).toBe(3);
    expect(
      (await openDocument(page)).document.getXmlFragment("content").length,
    ).toBe(0);
    expect(
      await database.pages
        .where("workspaceId")
        .equals(ws.id)
        .filter((item) => item.kind === "database")
        .first(),
    ).toMatchObject({ title: "To-Do" });
  });
  it("captures multiline notes in Inbox without requiring the server", async () => {
    const { workspace: ws } = await workspace(),
      inbox = await database.pages
        .where("workspaceId")
        .equals(ws.id)
        .filter((page) => page.isInbox)
        .first();
    expect(inbox).toBeDefined();
    await captureNote(ws.id, "An idea\nSecond line", inbox!.id);
    const note = await database.pages
      .where("parentId")
      .equals(inbox!.id)
      .first();
    expect(note?.title).toBe("An idea");
    expect((await database.documents.get(note!.id))?.text).toContain(
      "Second line",
    );
  });
  it("exports/imports documents, task properties and stable remapped mentions without secrets", async () => {
    const { workspace: ws, page, key } = await workspace(),
      project = await database.pages
        .where("workspaceId")
        .equals(ws.id)
        .filter((value) => value.kind === "database")
        .first(),
      session = await openDocument(page);
    const mention = new Y.XmlElement("pageMention");
    mention.setAttribute("pageId", project!.id);
    session.document.getXmlFragment("content").insert(0, [mention]);
    createTaskRow((await openDocument(project!)).document, "Ship Alpha");
    replaceSharedText(session.document.getText("title"), "Knowledge");
    await flushDocuments();
    const exported = await exportWorkspace(ws.id);
    expect(JSON.stringify(exported)).not.toContain(key);
    expect(JSON.stringify(exported)).not.toContain("recoveryHash");
    const imported = await importWorkspace(exported);
    created.push(imported.workspace.id);
    const pages = await database.pages
        .where("workspaceId")
        .equals(imported.workspace.id)
        .toArray(),
      document = pages.find((item) => item.title === "Knowledge"),
      newProject = pages.find((item) => item.kind === "database");
    expect(document).toBeDefined();
    expect((await database.documents.get(document!.id))?.references).toContain(
      newProject!.id,
    );
    expect((await database.documents.get(document!.id))?.title).toBe(
      "Knowledge",
    );
    expect((await database.documents.get(newProject!.id))?.text).toContain(
      "Ship Alpha",
    );
  });
  it("rejects invalid versions or corrupted document data before creating a workspace", async () => {
    const before = await database.workspaces.count();
    await expect(importWorkspace({ schemaVersion: 2 })).rejects.toThrow();
    const fixture: WorkspaceExport = {
      schemaVersion: 1,
      name: "Bad",
      exportedAt: new Date().toISOString(),
      pages: [
        {
          id: crypto.randomUUID(),
          parentId: null,
          title: "Bad",
          kind: "document",
          isInbox: false,
          document: "not-base64!",
        },
      ],
    };
    await expect(importWorkspace(fixture)).rejects.toThrow("손상");
    expect(await database.workspaces.count()).toBe(before);
  });
  it("rejects cycles and duplicate IDs before import", () => {
    const id = crypto.randomUUID(),
      input: WorkspaceExport = {
        schemaVersion: 1,
        name: "Graph",
        exportedAt: "now",
        pages: [
          {
            id,
            parentId: id,
            kind: "document",
            title: "Loop",
            isInbox: false,
            document: "AAA=",
          },
        ],
      };
    expect(() => validateImportedTree(input)).toThrow("순환");
    input.pages[0]!.parentId = null;
    expect(() => validateImportedTree(input)).not.toThrow();
    input.pages.push(input.pages[0]!);
    expect(() => validateImportedTree(input)).toThrow("중복");
  });
  it("preserves offline page structures in an operation queue", async () => {
    const { page } = await workspace();
    await changePageStructure(page, "trash");
    expect((await database.pages.get(page.id))?.deletedAt).not.toBeNull();
    const operation = await database.operations
      .filter(
        (value) =>
          value.payload.pageId === page.id && value.payload.action === "trash",
      )
      .first();
    expect(operation?.payload.expectedRevision).toBe(0);
    expect(operation?.status).toBe("pending");
  });
  it("clears page documents and pending comments when deleting local workspaces", async () => {
    const { workspace: ws, page } = await workspace();
    await database.pendingComments.put({
      id: crypto.randomUUID(),
      createdAt: "now",
      payload: {
        id: crypto.randomUUID(),
        pageId: page.id,
        parentId: null,
        body: "Pending",
      },
    });
    await deleteLocalWorkspace(ws.id);
    expect(await database.documents.get(page.id)).toBeUndefined();
    expect(await database.pendingComments.count()).toBe(0);
    expect(
      await database.operations
        .filter((value) => value.payload.workspaceId === ws.id)
        .count(),
    ).toBe(0);
  });
});
describe("Local search and visibility", () => {
  const page = (title: string): LocalPage => ({
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    parentId: null,
    kind: "document",
    title,
    createdAt: "now",
    deletedAt: null,
    isInbox: false,
    revision: 0,
    role: "owner",
  });
  it("searches normalized titles and contents but hides revoked or trashed descendants", () => {
    const visible = page("API ＡＢＣ"),
      lost = { ...page("secret"), accessLost: true },
      trash = { ...page("Removed"), deletedAt: "now" },
      child = { ...page("hidden"), parentId: trash.id };
    expect(
      searchLocalPages([visible, lost, trash, child], [], "abc").map(
        (value) => value.page.id,
      ),
    ).toEqual([visible.id]);
    expect(availablePages([visible, lost, trash, child])).toEqual([visible]);
    expect(searchLocalPages([visible], [], "missing")).toEqual([]);
  });
  it("searches 1000 cached documents within the 200ms budget", () => {
    const pages = Array.from({ length: 1000 }, (_, index) =>
      page(`Page ${index}`),
    );
    const docs: LocalDocument[] = pages.map((value, index) => ({
      id: value.id,
      workspaceId: value.workspaceId,
      title: value.title,
      text: `Body unique-${index}`,
      references: [],
      update: new Uint8Array(),
      generation: 0,
      committedGeneration: 0,
      state: "saved",
      updatedAt: index,
    }));
    const start = performance.now(),
      results = searchLocalPages(pages, docs, "unique-998"),
      elapsed = performance.now() - start;
    expect(results[0]?.page.id).toBe(pages[998]?.id);
    expect(elapsed).toBeLessThan(200);
  });
  it("rejects structural loops from local navigation", () => {
    const first = page("Loop");
    first.parentId = first.id;
    expect(availablePages([first])).toEqual([]);
  });
  it("accepts valid binary CRDT exports without credentials", async () => {
    const doc = new Y.Doc();
    doc.getText("title").insert(0, "Imported");
    const result = await importWorkspace({
      schemaVersion: 1,
      name: "Portable",
      exportedAt: "now",
      pages: [
        {
          id: crypto.randomUUID(),
          parentId: null,
          title: "Imported",
          kind: "document",
          isInbox: false,
          document: bytesToBase64(Y.encodeStateAsUpdate(doc)),
        },
      ],
    });
    created.push(result.workspace.id);
    expect(
      await database.pages
        .where("workspaceId")
        .equals(result.workspace.id)
        .count(),
    ).toBe(2);
    doc.destroy();
  });
});

it("keeps the in-memory document and reports quota failure without acknowledging local storage", async () => {
  const { page } = await workspace(),
    session = await openDocument(page),
    before = await database.documents.get(page.id);
  const failed = vi
    .spyOn(database.documents, "put")
    .mockRejectedValueOnce(
      new DOMException("Quota exceeded", "QuotaExceededError"),
    );
  replaceSharedText(session.document.getText("title"), "Unsaved edit");
  await expect(flushDocuments()).rejects.toThrow("Quota exceeded");
  expect(session.localSaveError).toContain("Quota");
  expect((await database.documents.get(page.id))?.generation).toBe(
    before?.generation,
  );
  expect(session.document.getText("title").toString()).toBe("Unsaved edit");
  failed.mockRestore();
  await flushDocuments();
});

it("preserves unsynced edits after an access revocation", async () => {
  const { workspace: ws, page } = await workspace(),
    session = await openDocument(page);
  await database.workspaces.update(ws.id, { pendingCreation: false });
  await database.operations.clear();
  replaceSharedText(session.document.getText("title"), "Unsent private change");
  await flushDocuments();
  const { mergeMetadata } = await import("./sync");
  await mergeMetadata({ workspaces: [], pages: [], roles: {}, identities: [] });
  const saved = await database.documents.get(page.id);
  expect(saved?.state).toBe("preserved");
  expect(saved?.title).toBe("Unsent private change");
  expect((await database.pages.get(page.id))?.accessLost).toBe(true);
  expect((await database.pages.get(page.id))?.role).toBeUndefined();
});

it("keeps dirty content as a local copy when metadata marks a Page deleted", async () => {
  const { workspace: ws, page } = await workspace(),
    session = await openDocument(page);
  await database.workspaces.update(ws.id, { pendingCreation: false });
  await database.operations.clear();
  replaceSharedText(session.document.getText("title"), "Offline change");
  await flushDocuments();
  const { mergeMetadata } = await import("./sync");
  await mergeMetadata({
    workspaces: [ws],
    pages: [{ ...page, deletedAt: new Date().toISOString(), revision: 1 }],
    roles: { [page.id]: "owner" },
    identities: [],
  });
  expect((await database.pages.get(page.id))?.deletedAt).not.toBeNull();
  const preserved = await database.documents.get(page.id);
  expect(preserved?.state).toBe("preserved");
  expect(preserved?.title).toBe("Offline change");
});

it("imports the maximum-length Workspace name without creating invalid metadata", async () => {
  const { workspace: ws } = await workspace(),
    exported = await exportWorkspace(ws.id);
  exported.name = "A".repeat(160);
  const imported = await importWorkspace(exported);
  created.push(imported.workspace.id);
  expect(imported.workspace.name).toHaveLength(160);
  expect(imported.workspace.name.endsWith(" (가져옴)")).toBe(true);
});

it("retains unchanged metadata references and updates changed rows", () => {
  const rows = [{ id: "one", title: "Old" }];
  expect(retainEqualItems(rows, [{ ...rows[0]! }])).toBe(rows);
  expect(retainEqualItems(rows, [{ id: "one", title: "New" }])).not.toBe(rows);
  expect(retainEqualItems(rows, [])).toEqual([]);
});

it("exports and imports generic definitions, row values and saved views without credentials", async () => {
  const original = await workspace();
  const page = await createLocalPage(
    original.workspace.id,
    "Resources",
    "database",
    null,
    false,
    "generic",
  );
  const session = await openDocument(page);
  const field = addDatabaseProperty(session.document, "Points", "number");
  const rowId = createTaskRow(session.document, "Portable entry");
  writeDatabaseValue(session.document, rowId, field, 42);
  saveDatabaseView(session.document, {
    ...defaultDatabaseView("gallery", session.document),
    name: "Resource gallery",
  });
  const exported = await exportWorkspace(original.workspace.id);
  const imported = await importWorkspace(exported);
  created.push(imported.workspace.id);
  const restoredPage = (
    await database.pages
      .where("workspaceId")
      .equals(imported.workspace.id)
      .toArray()
  ).find((entry) => entry.title === "Resources")!;
  const restored = await openDocument(restoredPage);
  expect(restoredPage.id).not.toBe(page.id);
  expect(getDatabaseMode(restored.document)).toBe("generic");
  expect(getDatabaseViews(restored.document)[0]?.name).toBe("Resource gallery");
  const property = getDatabaseProperties(restored.document).find(
    (entry) => entry.id === field,
  )!;
  expect(
    readDatabaseValue(
      restored.document,
      getTaskRows(restored.document)[0]!,
      property,
    ),
  ).toBe(42);
  expect(JSON.stringify(exported)).not.toContain("recoveryHash");
  expect(
    exported.pages.find((entry) => entry.title === "Resources")?.kind,
  ).toBe("database");
});
