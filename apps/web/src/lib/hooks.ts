"use client";
import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import * as Y from "yjs";
import {
  database,
  errorMessage,
  type LocalWorkspace,
  type LocalPage,
  type LocalDocument,
  type PendingOperation,
  type PendingComment,
} from "./database";
import { useUiStore } from "./ui-store";
import { retainEqualItems } from "./search";
import type { Identity } from "@zeronote/shared";
export interface WorkspaceData {
  loaded: boolean;
  workspaces: LocalWorkspace[];
  pages: LocalPage[];
  documents: LocalDocument[];
  operations: PendingOperation[];
  pendingComments: PendingComment[];
  identities: (Identity & { workspaceId: string })[];
}
const EMPTY: WorkspaceData = {
  loaded: false,
  workspaces: [],
  pages: [],
  documents: [],
  operations: [],
  pendingComments: [],
  identities: [],
};
export function useWorkspaceData(): WorkspaceData {
  const [data, setData] = useState<WorkspaceData>(EMPTY);
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [
        workspaces,
        pages,
        documents,
        operations,
        pendingComments,
        identities,
      ] = await Promise.all([
        database.workspaces.toArray(),
        database.pages.toArray(),
        database.documents.toArray(),
        database.operations.toArray(),
        database.pendingComments.toArray(),
        database.preferences.get("identities"),
      ]);
      let parsed: WorkspaceData["identities"] = [];
      if (identities) {
        try {
          parsed = JSON.parse(identities.value) as WorkspaceData["identities"];
        } catch {
          parsed = [];
        }
      }
      return {
        loaded: true,
        workspaces,
        pages,
        documents,
        operations,
        pendingComments,
        identities: parsed,
      };
    }).subscribe({
      next: (next) =>
        setData((previous) => ({
          ...next,
          pages: retainEqualItems(previous.pages, next.pages),
          workspaces: retainEqualItems(previous.workspaces, next.workspaces),
        })),
      error: (error) =>
        useUiStore.getState().patch({ notice: errorMessage(error) }),
    });
    return () => subscription.unsubscribe();
  }, []);
  return data;
}
export function useLiveValue<T>(
  query: () => Promise<T>,
  dependencies: unknown[],
  initial: T,
): T {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: (error) =>
        useUiStore.getState().patch({ notice: errorMessage(error) }),
    });
    return () => subscription.unsubscribe();
  }, dependencies);
  return value;
}
export function useDocumentRevision(document: Y.Doc | null): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!document) return;
    const update = () => setRevision((value) => value + 1);
    document.on("update", update);
    return () => document.off("update", update);
  }, [document]);
  return revision;
}
export function useMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)"),
      update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
