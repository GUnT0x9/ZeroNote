"use client";
import { useEffect, useMemo, useState } from "react";
import {
  canEdit,
  createSearchEngine,
  SearchRequestSchema,
  SearchResponseSchema,
  type SearchResponse,
  type SearchQuery,
} from "@zeronote/shared";
import type { WorkspaceData } from "./hooks";
import { api, authenticate } from "./api";
import { errorMessage } from "./database";
import { useUiStore } from "./ui-store";
import { cachedAttachmentMetadata } from "./attachment-metadata";
import { localSearchSources, mergeSearchHits } from "./advanced-search";

const SEARCH_DEBOUNCE_MS = 200;
interface RemoteState {
  key: string;
  response?: SearchResponse;
  error?: string;
}
export function useSearch(data: WorkspaceData, query: SearchQuery | null) {
  const syncState = useUiStore((state) => state.syncState);
  const docKey = data.documents
    .map(
      (doc) =>
        `${doc.id}:${doc.generation}:${doc.committedGeneration}:${doc.updatedAt}:${doc.state}`,
    )
    .join("|");
  const peopleKey = JSON.stringify(data.identities);
  const sources = useMemo(
    () => localSearchSources(data),
    [data.pages, data.workspaces, docKey],
  );
  const [fileNames, setFileNames] = useState<Map<string, string>>(new Map()),
    [remote, setRemote] = useState<RemoteState>({ key: "" });
  useEffect(() => {
    let current = true;
    void Promise.all(
      sources
        .filter(
          (source) => source.page.kind === "database" && source.projection,
        )
        .map((source) => cachedAttachmentMetadata(source.page.id)),
    )
      .then((groups) => {
        if (current)
          setFileNames(
            new Map(
              groups
                .flat()
                .map((file) => [`${file.pageId}:${file.id}`, file.name]),
            ),
          );
      })
      .catch(() => {
        if (current) setFileNames(new Map());
      });
    return () => {
      current = false;
    };
  }, [sources]);
  const engine = useMemo(() => {
    const people = new Map(
      data.identities.map((identity) => [
        `${identity.workspaceId}:${identity.id}`,
        identity.name,
      ]),
    );
    return createSearchEngine(sources, {
      fileName: (pageId, id) => fileNames.get(`${pageId}:${id}`),
      personName: (workspaceId, id) => people.get(`${workspaceId}:${id}`),
    });
  }, [sources, fileNames, peopleKey]);
  useEffect(() => () => engine.dispose(), [engine]);
  const local = useMemo(
    () =>
      query
        ? engine.search(query)
        : { hits: [], searchedPages: 0, unavailableProperties: 0 },
    [query, engine],
  );
  const overlays = useMemo(() => {
    const dirty = new Set(
      data.documents
        .filter(
          (doc) =>
            doc.generation > doc.committedGeneration &&
            doc.state !== "preserved",
        )
        .map((doc) => doc.id),
    );
    return sources
      .filter(
        (source) =>
          dirty.has(source.page.id) &&
          source.projection &&
          canEdit(
            data.pages.find((page) => page.id === source.page.id)?.role ??
              "viewer",
          ),
      )
      .map((source) => ({
        pageId: source.page.id,
        projection: source.projection!,
        updatedAt: source.updatedAt,
      }));
  }, [sources, docKey]);
  const scopeKey = data.pages
    .map(
      (page) =>
        `${page.id}:${page.revision}:${page.title}:${page.role}:${page.accessLost}:${page.deletedAt}:${page.ancestorTrashed}`,
    )
    .join("|");
  const key =
    JSON.stringify(query) +
    docKey +
    scopeKey +
    peopleKey +
    JSON.stringify(
      data.workspaces.map((workspace) => [workspace.id, workspace.name]),
    );
  useEffect(() => {
    if (!query || syncState === "offline" || !navigator.onLine) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const input = SearchRequestSchema.parse({
          query,
          workspaceId: null,
          overlays,
        });
        await authenticate();
        controller.signal.throwIfAborted();
        const response = SearchResponseSchema.parse(
          await api("/search", "POST", input, controller.signal),
        );
        if (!controller.signal.aborted) setRemote({ key, response });
      })().catch((error) => {
        if (!controller.signal.aborted)
          setRemote({ key, error: errorMessage(error) });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, syncState]);
  const offline = syncState === "offline",
    current = remote.key === key && !offline ? remote : undefined;
  const pendingPageIds = new Set(
    data.operations
      .filter(
        (operation) =>
          operation.status === "pending" &&
          operation.payload.action === "create",
      )
      .map((operation) => operation.payload.pageId),
  );
  return {
    sources,
    hits: current?.response
      ? mergeSearchHits(current.response.hits, local.hits, pendingPageIds)
      : local.hits,
    error: current?.error,
    loading: !!query && !offline && !current,
    server: !!current?.response,
    cachedPages: sources.filter((source) => !!source.projection).length,
    unavailableProperties:
      current?.response?.unavailableProperties ?? local.unavailableProperties,
  };
}
