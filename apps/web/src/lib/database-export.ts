import * as Y from "yjs";
import {
  base64ToBytes,
  createDatabaseValueReader,
  type WorkspaceExport,
} from "@zeronote/shared";
const MAX_EXPORT_DATABASE_DEPENDENCIES = 32;
/** Only included Pages and same-Page file metadata can participate in a portable export. */
export function createExportDatabaseReader(
  input: WorkspaceExport,
  pageId: string,
  document: Y.Doc,
) {
  const pages = new Map(
    input.pages
      .filter((page) => page.kind === "database")
      .map((page) => [page.id, page]),
  );
  const targets = new Map<string, Y.Doc>();
  const files = new Map(
    (input.attachments ?? []).map((file) => [
      `${file.pageId}:${file.id}`,
      file.name,
    ]),
  );
  const reader = createDatabaseValueReader(pageId, document, {
    database: (id) => {
      if (targets.has(id)) return targets.get(id);
      const page = pages.get(id);
      if (!page || targets.size >= MAX_EXPORT_DATABASE_DEPENDENCIES)
        return undefined;
      const target = new Y.Doc();
      try {
        Y.applyUpdate(target, base64ToBytes(page.document));
      } catch (error) {
        target.destroy();
        throw error;
      }
      targets.set(id, target);
      return target;
    },
    fileName: (id, fileId) => files.get(`${id}:${fileId}`),
  });
  return {
    reader,
    dispose: () => {
      for (const target of targets.values()) target.destroy();
      targets.clear();
    },
  };
}
