import { create } from "zustand";
export type Panel = "comments" | "properties" | "backlinks" | "share" | null;
interface UiState {
  workspaceId: string | null;
  pageId: string | null;
  taskId: string | null;
  panel: Panel;
  sidebarOpen: boolean;
  searchOpen: boolean;
  captureOpen: boolean;
  settingsOpen: boolean;
  notice: string | null;
  syncState: "connecting" | "online" | "offline" | "error";
  syncError: string | null;
  offlineReady: boolean;
  theme: "light" | "dark" | "system";
  select: (
    workspaceId: string,
    pageId: string | null,
    taskId?: string | null,
  ) => void;
  patch: (value: Partial<Omit<UiState, "select" | "patch">>) => void;
}
export const useUiStore = create<UiState>((set) => ({
  workspaceId: null,
  pageId: null,
  taskId: null,
  panel: null,
  sidebarOpen: false,
  searchOpen: false,
  captureOpen: false,
  settingsOpen: false,
  notice: null,
  syncState: "connecting",
  syncError: null,
  offlineReady: false,
  theme: "system",
  select: (workspaceId, pageId, taskId = null) => {
    set({ workspaceId, pageId, taskId, sidebarOpen: false });
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set("workspace", workspaceId);
      if (pageId) url.searchParams.set("page", pageId);
      if (taskId) url.searchParams.set("task", taskId);
      window.history.replaceState(null, "", url);
    }
  },
  patch: (value) => set(value),
}));
