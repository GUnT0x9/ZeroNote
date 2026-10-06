import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { database } from "./database";
import { api } from "./api";
import { synchronize } from "./sync";
import { useUiStore } from "./ui-store";
import { cacheRemoteDocument } from "./documents";

vi.mock("./api", () => ({
  authenticate: vi.fn(async () => undefined),
  api: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock("./documents", () => ({
  cacheRemoteDocument: vi.fn(),
  setDocumentSyncRequest: vi.fn(),
  getDocumentSession: vi.fn(),
  disconnectDocument: vi.fn(),
  disconnectAllDocuments: vi.fn(),
}));
const emptyMetadata = { workspaces: [], pages: [], identities: [], roles: {} };

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/metadata" ? emptyMetadata : { warning: false },
  );
});
afterEach(async () => {
  for (const table of database.tables) await table.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("finishes one requested sync without idle polling", async () => {
  await synchronize();
  expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual([
    "/metadata",
    "/storage",
  ]);
  expect(useUiStore.getState().syncState).toBe("online");
});
it("syncs accessible metadata without downloading every unopened document body", async () => {
  const id = crypto.randomUUID(),
    workspace = {
      id,
      name: "Many Pages",
      ownerIdentityId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
  const pageId = crypto.randomUUID(),
    page = {
      id: pageId,
      workspaceId: id,
      parentId: null,
      kind: "document",
      title: "Not opened",
      revision: 0,
      deletedAt: null,
      createdAt: workspace.createdAt,
      isInbox: false,
    };
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/metadata"
      ? {
          ...emptyMetadata,
          workspaces: [workspace],
          pages: [page],
          roles: { [pageId]: "owner" },
        }
      : { warning: false },
  );
  await synchronize();
  expect((await database.pages.get(pageId))?.title).toBe("Not opened");
  expect(await database.documents.get(pageId)).toBeUndefined();
  expect(cacheRemoteDocument).not.toHaveBeenCalled();
});

it("refetches grants accepted during an older sync before resolving callers", async () => {
  let releaseMetadata!: (value: typeof emptyMetadata) => void;
  let notifyMetadataStarted!: () => void;
  const firstMetadata = new Promise<typeof emptyMetadata>((resolve) => {
    releaseMetadata = resolve;
  });
  const started = new Promise<void>((resolve) => {
    notifyMetadataStarted = resolve;
  });
  const workspace = {
    id: crypto.randomUUID(),
    name: "Invited workspace",
    ownerIdentityId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  let reads = 0;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path !== "/metadata") return { warning: false };
    if (++reads === 1) {
      notifyMetadataStarted();
      return firstMetadata;
    }
    return { ...emptyMetadata, workspaces: [workspace] };
  });
  const initialSync = synchronize();
  await started;
  const afterInvite = synchronize();
  const simultaneousRequest = synchronize();
  releaseMetadata(emptyMetadata);
  await Promise.all([initialSync, afterInvite, simultaneousRequest]);
  expect(reads).toBe(2);
  expect(await database.workspaces.get(workspace.id)).toMatchObject({
    ...workspace,
    accessLost: false,
  });
});

it("preserves the failure and allows a subsequent sync to retry", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Connection lost"));
  await expect(synchronize()).rejects.toThrow("Connection lost");
  expect(useUiStore.getState().syncState).toBe("error");
  await synchronize();
  expect(useUiStore.getState().syncState).toBe("online");
});

it("leaves local data available without contacting the server offline", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  await synchronize();
  expect(api).not.toHaveBeenCalled();
  expect(useUiStore.getState().syncState).toBe("offline");
});
it("keeps Offline visible when an older successful response finishes after disconnection", async () => {
  let release!: (value: { warning: boolean }) => void, began!: () => void;
  const paused = new Promise<{ warning: boolean }>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      began = resolve;
    });
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/storage") {
      began();
      return paused;
    }
    return emptyMetadata;
  });
  const sync = synchronize();
  await started;
  vi.stubGlobal("navigator", { onLine: false });
  useUiStore.getState().patch({ syncState: "offline" });
  release({ warning: false });
  await sync;
  expect(useUiStore.getState().syncState).toBe("offline");
});
