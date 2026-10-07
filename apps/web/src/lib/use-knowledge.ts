"use client";
import { useEffect, useMemo, useState } from "react";
import {
  canEdit,
  createKnowledgeView,
  KnowledgeRequestSchema,
  KnowledgeResponseSchema,
  type KnowledgeResponse,
} from "@zeronote/shared";
import type { WorkspaceData } from "./hooks";
import { api, authenticate } from "./api";
import { errorMessage } from "./database";
import { localKnowledge } from "./advanced-search";
import { localKnowledgeSources } from "./knowledge";
import { availablePages } from "./search";
import { useUiStore } from "./ui-store";

const KNOWLEDGE_DEBOUNCE_MS = 300;
interface RemoteKnowledge {
  key: string;
  response?: KnowledgeResponse;
  error?: string;
}
export function useKnowledge(
  data: WorkspaceData,
  pageId: string,
  offset = 0,
  localOnly = false,
) {
  const syncState = useUiStore((state) => state.syncState),
    [refresh, setRefresh] = useState(0),
    [remote, setRemote] = useState<RemoteKnowledge>({ key: "" });
  const docKey = data.documents
      .map(
        (doc) =>
          `${doc.id}:${doc.generation}:${doc.committedGeneration}:${doc.updatedAt}:${doc.state}`,
      )
      .join("|"),
    scopeKey = data.pages
      .map(
        (page) =>
          `${page.id}:${page.revision}:${page.title}:${page.role}:${page.accessLost}:${page.deletedAt}:${page.ancestorTrashed}`,
      )
      .join("|");
  const localSources = useMemo(
      () => localKnowledgeSources(data),
      [data.pages, docKey],
    ),
    local = useMemo(
      () => createKnowledgeView(localSources.sources, { pageId, offset }),
      [localSources, pageId, offset],
    );
  const pendingCreation = data.operations.some(
      (operation) =>
        operation.status === "pending" && operation.payload.action === "create",
    ),
    useLocal = localOnly || pendingCreation || syncState === "offline";
  const key = `${pageId}:${offset}:${refresh}:${docKey}:${scopeKey}`;
  const knownRoot = data.pages.find((page) => page.id === pageId),
    rootDenied = !!knownRoot && !local.root;
  useEffect(() => {
    if (useLocal || !navigator.onLine || rootDenied) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const active = new Map(
          availablePages(data.pages).map((page) => [page.id, page]),
        );
        const overlays = data.documents
          .filter(
            (doc) =>
              doc.generation > doc.committedGeneration &&
              doc.state !== "preserved" &&
              canEdit(active.get(doc.id)?.role ?? "viewer"),
          )
          .map((doc) => ({ pageId: doc.id, projection: localKnowledge(doc) }));
        const input = KnowledgeRequestSchema.parse({
          pageId,
          offset,
          overlays,
        });
        await authenticate();
        controller.signal.throwIfAborted();
        const response = KnowledgeResponseSchema.parse(
          await api("/knowledge", "POST", input, controller.signal),
        );
        if (!controller.signal.aborted) setRemote({ key, response });
      })().catch((error) => {
        if (!controller.signal.aborted)
          setRemote({ key, error: errorMessage(error) });
      });
    }, KNOWLEDGE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, syncState, useLocal]);
  const current = !useLocal && remote.key === key ? remote : undefined;
  return {
    view: current?.response ?? local,
    server: !!current?.response,
    loading: !rootDenied && !useLocal && !current,
    error: current?.error,
    unreadable: localSources.unreadable,
    pendingCreation,
    reload: () => setRefresh((value) => value + 1),
  };
}
