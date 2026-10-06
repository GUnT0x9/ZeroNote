"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { liveQuery } from "dexie";
import type * as Y from "yjs";
import {
  createDatabaseValueReader,
  getDatabaseProperties,
  getLiveAttachmentIds,
  type AttachmentMetadata,
  type DatabaseValueReader,
} from "@zeronote/shared";
import { openDocument, connectDocument, getDocumentSession } from "./documents";
import { availablePages } from "./search";
import { errorMessage, type LocalPage } from "./database";
import { useDocumentRevision, type WorkspaceData } from "./hooks";
import {
  cachedAttachmentMetadata,
  loadAttachmentMetadata,
} from "./attachment-metadata";

export const MAX_DATABASE_DEPENDENCIES = 32;
export interface DatabaseEditorContext {
  page: LocalPage;
  databases: LocalPage[];
  reader: DatabaseValueReader;
  databaseById: (id: string) => Y.Doc | undefined;
  filesByDatabase: Map<string, AttachmentMetadata[]>;
  loadDatabase: (id: string) => Promise<void>;
  fileError: string | null;
}
export function accessibleDatabases(
  page: LocalPage,
  pages: LocalPage[],
): LocalPage[] {
  return availablePages(pages).filter(
    (target) =>
      target.workspaceId === page.workspaceId && target.kind === "database",
  );
}
export function relatedDatabases(
  sourceId: string,
  document: Y.Doc,
  pages: LocalPage[],
  resolve: (id: string) => Y.Doc | undefined,
): LocalPage[] {
  const lookup = new Map(pages.map((page) => [page.id, page]));
  const visited = new Set([sourceId]),
    pending = [document],
    targets: LocalPage[] = [];
  while (pending.length && targets.length < MAX_DATABASE_DEPENDENCIES) {
    for (const property of getDatabaseProperties(pending.shift()!)) {
      const id = property.relation?.databaseId;
      if (!id || visited.has(id) || !lookup.has(id)) continue;
      visited.add(id);
      targets.push(lookup.get(id)!);
      const target = resolve(id);
      if (target) pending.push(target);
      if (targets.length >= MAX_DATABASE_DEPENDENCIES) break;
    }
  }
  return targets;
}
export function useDatabaseEditorContext(
  document: Y.Doc | null,
  page: LocalPage,
  data: WorkspaceData,
  historical = false,
): DatabaseEditorContext | null {
  const sourceRevision = useDocumentRevision(document);
  const [revision, refresh] = useState(0),
    [networkRevision, reconnect] = useState(0);
  const [files, setFiles] = useState(new Map<string, AttachmentMetadata[]>());
  const [fileError, setFileError] = useState<string | null>(null);
  const ready = useRef(new Set<string>());
  const databases = useMemo(
    () => accessibleDatabases(page, data.pages),
    [page, data.pages],
  );
  const allowed = new Map(databases.map((target) => [target.id, target]));
  const databaseById = (id: string): Y.Doc | undefined =>
    id === page.id
      ? (document ?? undefined)
      : allowed.has(id) && ready.current.has(id)
        ? getDocumentSession(id)?.document
        : undefined;
  const dependencies = document
    ? relatedDatabases(page.id, document, databases, databaseById)
    : [];
  const dependencyKey = JSON.stringify(
    dependencies.map((target) => [target.id, target.revision, target.role]),
  );
  const loadDatabase = async (id: string) => {
    const target = allowed.get(id);
    if (!target) throw new Error("대상 Database에 접근할 수 없습니다.");
    const session = await openDocument(target);
    ready.current.add(id);
    refresh((value) => value + 1);
    await connectDocument(session, target);
  };
  useEffect(() => {
    const online = () => reconnect((value) => value + 1);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const subscribed: Y.Doc[] = [];
    const changed = () => {
      if (!cancelled) refresh((value) => value + 1);
    };
    for (const target of dependencies)
      void openDocument(target)
        .then(async (session) => {
          if (cancelled) return;
          ready.current.add(target.id);
          subscribed.push(session.document);
          session.document.on("update", changed);
          changed();
          await connectDocument(session, target);
        })
        .catch(() => {
          /* Missing/offline targets remain explicit reference errors. */
        });
    return () => {
      cancelled = true;
      for (const target of subscribed) target.off("update", changed);
    };
  }, [page.id, dependencyKey, networkRevision]);
  const fileSources = document
    ? [
        { id: page.id, document },
        ...dependencies.flatMap((target) => {
          const state = databaseById(target.id);
          return state ? [{ id: target.id, document: state }] : [];
        }),
      ]
    : [];
  const pendingPages = new Set(
    data.operations
      .filter((operation) => operation.payload.action === "create")
      .map((operation) => operation.payload.pageId),
  );
  const fileKey = JSON.stringify(
    fileSources.map((source) => [
      source.id,
      getLiveAttachmentIds(source.document).sort(),
      pendingPages.has(source.id),
    ]),
  );
  useEffect(() => {
    let cancelled = false;
    const sources = fileSources.filter(
      (source) => getLiveAttachmentIds(source.document).length,
    );
    const subscription = liveQuery(
      async () =>
        new Map(
          await Promise.all(
            sources.map(
              async (source) =>
                [source.id, await cachedAttachmentMetadata(source.id)] as const,
            ),
          ),
        ),
    ).subscribe({
      next: (value) => {
        if (!cancelled) setFiles(value);
      },
      error: (issue) => {
        if (!cancelled) setFileError(errorMessage(issue));
      },
    });
    setFileError(null);
    for (const source of sources)
      void loadAttachmentMetadata(
        source.id,
        historical && source.id === page.id,
      ).catch((issue) => {
        if (!cancelled) setFileError(errorMessage(issue));
      });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [page.id, fileKey, historical, networkRevision]);
  return useMemo(() => {
    if (!document) return null;
    const identities = new Map(
      data.identities
        .filter((identity) => identity.workspaceId === page.workspaceId)
        .map((identity) => [identity.id, identity.name]),
    );
    const fileNames = new Map(
      [...files].flatMap(([id, entries]) =>
        entries.map((file) => [`${id}:${file.id}`, file.name] as const),
      ),
    );
    return {
      page,
      databases,
      filesByDatabase: files,
      databaseById,
      loadDatabase,
      fileError,
      reader: createDatabaseValueReader(page.id, document, {
        database: databaseById,
        fileName: (id, fileId) => fileNames.get(`${id}:${fileId}`),
        personName: (id) => identities.get(id),
      }),
    };
  }, [
    document,
    page,
    databases,
    files,
    fileError,
    sourceRevision,
    revision,
    data.identities,
  ]);
}
