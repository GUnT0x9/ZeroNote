import * as Y from "yjs";
import {
  createRecoveryKey,
  initializeGenericDatabase,
  sha256Hex,
  replaceSharedText,
  ExportSchema,
  base64ToBytes,
  bytesToBase64,
  getDocumentProjection,
  type WorkspaceExport,
  type PageOperation,
} from "@zeronote/shared";
import { database, type LocalWorkspace, type LocalPage } from "./database";
import { openDocument, flushDocuments, removeLocalDocument } from "./documents";
import { availablePages } from "./search";
import { useUiStore } from "./ui-store";
import { requireBetaAccess } from "./beta";
let sequence = 0;
export async function enqueuePageOperation(
  payload: PageOperation,
): Promise<void> {
  await database.operations.put({
    id: payload.operationId,
    sequence: Date.now() * 1000 + (sequence++ % 1000),
    payload,
    status: "pending",
  });
}
export async function createLocalPage(
  workspaceId: string,
  title = "제목 없음",
  kind: "document" | "database" = "document",
  parentId: string | null = null,
  isInbox = false,
  databaseMode: "task" | "generic" = "task",
): Promise<LocalPage> {
  const page: LocalPage = {
    id: crypto.randomUUID(),
    workspaceId,
    parentId,
    kind,
    title,
    revision: 0,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    isInbox,
    role: "owner",
  };
  await database.pages.put(page);
  await enqueuePageOperation({
    operationId: crypto.randomUUID(),
    workspaceId,
    pageId: page.id,
    expectedRevision: 0,
    action: "create",
    page,
  });
  const session = await openDocument(page);
  replaceSharedText(session.document.getText("title"), title);
  if (kind === "database" && databaseMode === "generic")
    initializeGenericDatabase(session.document);
  await flushDocuments();
  return page;
}
export async function createLocalWorkspace(
  name: string,
): Promise<{ workspace: LocalWorkspace; key: string; page: LocalPage }> {
  await requireBetaAccess();
  const key = createRecoveryKey(),
    workspace: LocalWorkspace = {
      id: crypto.randomUUID(),
      name,
      ownerIdentityId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      recoveryHash: await sha256Hex(key),
      pendingCreation: true,
    };
  await database.workspaces.put(workspace);
  await createLocalPage(workspace.id, "받은 메모", "document", null, true);
  const page = await createLocalPage(workspace.id, "시작하기");
  await createLocalPage(workspace.id, "To-Do", "database");
  await flushDocuments();
  useUiStore.getState().select(workspace.id, page.id);
  return { workspace, key, page };
}
export function insertParagraphs(document: Y.Doc, text: string): void {
  document.transact(() => {
    const fragment = document.getXmlFragment("content");
    const paragraphs = text.split("\n").map((line) => {
      const paragraph = new Y.XmlElement("paragraph");
      const content = new Y.XmlText();
      paragraph.insert(0, [content]);
      if (line) content.insert(0, line);
      return paragraph;
    });
    fragment.insert(fragment.length, paragraphs);
  });
}
export async function changePageStructure(
  page: LocalPage,
  action: "move" | "trash" | "restore",
  parentId: string | null = null,
): Promise<void> {
  const operation: PageOperation = {
    operationId: crypto.randomUUID(),
    workspaceId: page.workspaceId,
    pageId: page.id,
    expectedRevision: page.revision,
    action,
    ...(action === "move" ? { parentId } : {}),
  };
  await enqueuePageOperation(operation);
  await database.pages.update(page.id, {
    revision: page.revision + 1,
    ...(action === "move"
      ? { parentId }
      : { deletedAt: action === "trash" ? new Date().toISOString() : null }),
  });
}
export async function captureNote(
  workspaceId: string,
  text: string,
  destinationId: string,
): Promise<void> {
  const page = await createLocalPage(
    workspaceId,
    text.trim().split("\n")[0]?.slice(0, 80) || "메모",
    "document",
    destinationId,
  );
  const session = await openDocument(page);
  insertParagraphs(session.document, text);
  await flushDocuments();
}
export async function exportWorkspace(
  workspaceId: string,
): Promise<WorkspaceExport> {
  await flushDocuments();
  const workspace = await database.workspaces.get(workspaceId);
  if (!workspace) throw new Error("Workspace를 찾을 수 없습니다.");
  const pages = availablePages(
    await database.pages.where("workspaceId").equals(workspaceId).toArray(),
  );
  const exported: WorkspaceExport["pages"] = [];
  for (const page of pages) {
    const session = await openDocument(page);
    exported.push({
      id: page.id,
      parentId: page.parentId,
      kind: page.kind,
      title: session.document.getText("title").toString() || page.title,
      isInbox: page.isInbox,
      document: bytesToBase64(Y.encodeStateAsUpdate(session.document)),
    });
  }
  return ExportSchema.parse({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    name: workspace.name,
    pages: exported,
  });
}
export async function importWorkspace(
  input: unknown,
): Promise<{ key: string; workspace: LocalWorkspace }> {
  await requireBetaAccess();
  const parsed = ExportSchema.parse(input);
  validateImportedTree(parsed);
  const documents = parsed.pages.map((page) => {
    const document = new Y.Doc({ gc: false });
    try {
      Y.applyUpdate(document, base64ToBytes(page.document));
      return document;
    } catch {
      document.destroy();
      throw new Error("Import 파일에 손상된 문서가 있습니다.");
    }
  });
  await requireBetaAccess();
  const key = createRecoveryKey(),
    workspace: LocalWorkspace = {
      id: crypto.randomUUID(),
      name: `${parsed.name.slice(0, 154)} (가져옴)`,
      ownerIdentityId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      recoveryHash: await sha256Hex(key),
      pendingCreation: true,
    };
  const ids = new Map(
    parsed.pages.map((page) => [page.id, crypto.randomUUID()]),
  );
  try {
    await database.workspaces.put(workspace);
    const ordered = [...parsed.pages].sort(
      (a, b) => importDepth(a, parsed) - importDepth(b, parsed),
    );
    for (const source of ordered) {
      const index = parsed.pages.indexOf(source);
      const id = ids.get(source.id);
      if (!id) continue;
      const page: LocalPage = {
        id,
        workspaceId: workspace.id,
        parentId: source.parentId ? (ids.get(source.parentId) ?? null) : null,
        kind: source.kind,
        title: source.title,
        revision: 0,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        isInbox: source.isInbox,
        role: "owner",
      };
      await database.pages.put(page);
      await enqueuePageOperation({
        operationId: crypto.randomUUID(),
        workspaceId: workspace.id,
        pageId: id,
        expectedRevision: 0,
        action: "create",
        page,
      });
      const document = documents[index];
      if (document) {
        remapReferences(document, ids);
        await database.documents.put({
          id,
          workspaceId: workspace.id,
          update: Y.encodeStateAsUpdate(document),
          ...getDocumentProjection(document),
          generation: 1,
          committedGeneration: 0,
          state: "saved",
          updatedAt: Date.now(),
        });
        await openDocument(page);
      }
    }
    if (!parsed.pages.some((page) => page.isInbox))
      await createLocalPage(workspace.id, "받은 메모", "document", null, true);
    await flushDocuments();
    useUiStore
      .getState()
      .select(
        workspace.id,
        ids.get(parsed.pages.find((page) => !page.isInbox)?.id ?? "") ?? null,
      );
    return { key, workspace };
  } finally {
    for (const document of documents) document.destroy();
  }
}
function remapReferences(document: Y.Doc, ids: Map<string, string>): void {
  const walk = (fragment: Y.XmlFragment | Y.XmlElement) => {
    for (const node of fragment.toArray()) {
      if (node instanceof Y.XmlElement) {
        for (const attribute of ["pageId", "databaseId"]) {
          const value = node.getAttribute(attribute);
          if (typeof value === "string" && ids.has(value))
            node.setAttribute(attribute, ids.get(value)!);
        }
        walk(node);
      }
    }
  };
  document.transact(() => {
    walk(document.getXmlFragment("content"));
    for (const [name, type] of document.share)
      if (name.startsWith("task:") && type instanceof Y.XmlFragment) walk(type);
  });
}
export function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function validateImportedTree(input: WorkspaceExport): void {
  const ids = new Set(input.pages.map((page) => page.id));
  if (ids.size !== input.pages.length)
    throw new Error("Import 파일에 중복된 Page ID가 있습니다.");
  for (const page of input.pages) {
    if (page.parentId && !ids.has(page.parentId))
      throw new Error("Import 파일의 상위 Page가 없습니다.");
    importDepth(page, input);
  }
}
function importDepth(
  page: WorkspaceExport["pages"][number],
  input: WorkspaceExport,
): number {
  const index = new Map(input.pages.map((item) => [item.id, item]));
  let current = page.parentId,
    depth = 0;
  const seen = new Set([page.id]);
  while (current) {
    if (seen.has(current))
      throw new Error("Import 파일의 Page 구조가 순환합니다.");
    seen.add(current);
    depth++;
    current = index.get(current)?.parentId ?? null;
  }
  return depth;
}
export async function deleteLocalWorkspace(workspaceId: string): Promise<void> {
  const pages = await database.pages
      .where("workspaceId")
      .equals(workspaceId)
      .toArray(),
    ids = pages.map((page) => page.id),
    pageIds = new Set(ids);
  for (const id of ids) await removeLocalDocument(id);
  await database.transaction(
    "rw",
    [
      database.workspaces,
      database.pages,
      database.documents,
      database.operations,
      database.comments,
      database.pendingComments,
    ],
    async () => {
      await database.workspaces.delete(workspaceId);
      await database.pages.bulkDelete(ids);
      await database.documents.bulkDelete(ids);
      await database.operations
        .filter((operation) => operation.payload.workspaceId === workspaceId)
        .delete();
      await database.comments
        .filter((comment) => pageIds.has(comment.pageId))
        .delete();
      await database.pendingComments
        .filter((comment) => pageIds.has(comment.payload.pageId))
        .delete();
    },
  );
}
