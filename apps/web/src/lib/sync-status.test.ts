import { describe, expect, it } from "vitest";
import type { WorkspaceData } from "./hooks";
import { getSyncStatus, getWorkspaceSyncStatus } from "./sync-status";

const workspaceId = crypto.randomUUID();
const pageId = crypto.randomUUID();
const data: WorkspaceData = {
  loaded: true,
  workspaces: [
    {
      id: workspaceId,
      name: "Notes",
      ownerIdentityId: crypto.randomUUID(),
      createdAt: "2026-10-01",
      pendingCreation: false,
    },
  ],
  pages: [
    {
      id: pageId,
      workspaceId,
      kind: "document",
      title: "Note",
      revision: 0,
      parentId: null,
      deletedAt: null,
      createdAt: "2026-10-01",
      isInbox: false,
    },
  ],
  documents: [
    {
      id: pageId,
      workspaceId,
      update: new Uint8Array(),
      title: "Note",
      text: "",
      references: [],
      generation: 2,
      committedGeneration: 2,
      state: "saved",
      updatedAt: 0,
    },
  ],
  operations: [],
  pendingComments: [],
  identities: [],
};
const online = { connection: "online" as const, error: null };

describe("sync presentation", () => {
  it("shows saving until commit confirmation and reports saved afterward", () => {
    expect(
      getSyncStatus({ ...online, pending: true, hasWorkspace: true }).kind,
    ).toBe("saving");
    expect(
      getSyncStatus({ ...online, pending: false, hasWorkspace: true }).label,
    ).toBe("서버 동기화 완료");
  });
  it("distinguishes cold-start connection from saved data and the empty workspace", () => {
    expect(
      getSyncStatus({
        ...online,
        connection: "connecting",
        pending: false,
        hasWorkspace: true,
      }).kind,
    ).toBe("connecting");
    expect(
      getSyncStatus({ ...online, pending: false, hasWorkspace: false }).label,
    ).toBe("서버 연결됨");
  });
  it("shows offline without an infinite saving motion and preserves error details", () => {
    expect(
      getSyncStatus({
        connection: "offline",
        error: "Timeout",
        pending: true,
        hasWorkspace: true,
      }).kind,
    ).toBe("offline");
    expect(
      getSyncStatus({
        ...online,
        error: "Permission revoked",
        pending: true,
        hasWorkspace: true,
      }),
    ).toMatchObject({ kind: "error", detail: "Permission revoked" });
    expect(
      getSyncStatus({
        ...online,
        connection: "error",
        pending: false,
        hasWorkspace: true,
      }).kind,
    ).toBe("error");
  });
});

describe("workspace sync presentation", () => {
  it("waits for live edits before the Local projection and ignores other scopes or preserved documents", () => {
    expect(
      getWorkspaceSyncStatus(data, workspaceId, online, new Map([[pageId, 3]]))
        .kind,
    ).toBe("saving");
    expect(
      getWorkspaceSyncStatus(data, workspaceId, online, new Map([[pageId, 2]]))
        .kind,
    ).toBe("saved");
    expect(
      getWorkspaceSyncStatus(
        data,
        workspaceId,
        online,
        new Map([[crypto.randomUUID(), 3]]),
      ).kind,
    ).toBe("saved");
    expect(
      getWorkspaceSyncStatus(
        { ...data, documents: [{ ...data.documents[0]!, state: "preserved" }] },
        workspaceId,
        online,
        new Map([[pageId, 3]]),
      ).kind,
    ).toBe("saved");
    expect(
      getWorkspaceSyncStatus(
        { ...data, documents: [] },
        workspaceId,
        online,
        new Map([[pageId, 1]]),
      ).kind,
    ).toBe("saving");
  });
  it("waits for attachment commits and reports retained upload errors", () => {
    const pending: WorkspaceData = {
      ...data,
      attachmentStates: [
        { id: crypto.randomUUID(), pageId, status: "pending" },
      ],
    };
    expect(getWorkspaceSyncStatus(pending, workspaceId, online).kind).toBe(
      "saving",
    );
    expect(
      getWorkspaceSyncStatus(
        { ...pending, attachmentStates: [] },
        workspaceId,
        online,
      ).kind,
    ).toBe("saved");
    expect(
      getWorkspaceSyncStatus(
        {
          ...pending,
          attachmentStates: pending.attachmentStates!.map((file) => ({
            ...file,
            error: "quota exceeded",
          })),
        },
        workspaceId,
        online,
      ),
    ).toMatchObject({ kind: "error", detail: "quota exceeded" });
  });
  it("includes uncommitted documents and resolves after a durable acknowledgment", () => {
    const pending = {
      ...data,
      documents: [{ ...data.documents[0]!, committedGeneration: 1 }],
    };
    expect(getWorkspaceSyncStatus(pending, workspaceId, online).kind).toBe(
      "saving",
    );
    expect(getWorkspaceSyncStatus(data, workspaceId, online).kind).toBe(
      "saved",
    );
  });
  it("includes queued comments without falsely acknowledging server storage", () => {
    const pending: WorkspaceData = {
      ...data,
      pendingComments: [
        {
          id: crypto.randomUUID(),
          payload: {
            id: crypto.randomUUID(),
            pageId,
            parentId: null,
            body: "Review",
          },
          createdAt: "2026-10-01",
        },
      ],
    };
    expect(getWorkspaceSyncStatus(pending, workspaceId, online).kind).toBe(
      "saving",
    );
    pending.pendingComments[0]!.error = "Comment permission changed";
    expect(getWorkspaceSyncStatus(pending, workspaceId, online)).toMatchObject({
      kind: "error",
      detail: "Comment permission changed",
    });
  });
  it("ignores changes in other workspaces and preserved, deleted or inaccessible pages", () => {
    const pending: WorkspaceData = {
      ...data,
      documents: [
        { ...data.documents[0]!, committedGeneration: 0, state: "preserved" },
      ],
    };
    expect(getWorkspaceSyncStatus(pending, workspaceId, online).kind).toBe(
      "saved",
    );
    pending.documents[0]!.state = "saved";
    for (const pages of [
      [{ ...data.pages[0]!, accessLost: true }],
      [{ ...data.pages[0]!, deletedAt: "2026-10-01" }],
      [{ ...data.pages[0]!, workspaceId: crypto.randomUUID() }],
    ])
      expect(
        getWorkspaceSyncStatus({ ...pending, pages }, workspaceId, online).kind,
      ).toBe("saved");
  });
  it("reports failed document storage even when the error text is absent", () => {
    expect(
      getWorkspaceSyncStatus(
        {
          ...data,
          documents: [
            { ...data.documents[0]!, state: "error", error: undefined },
          ],
        },
        workspaceId,
        online,
      ).kind,
    ).toBe("error");
  });
  it("waits for workspace registration and shows creation rejection", () => {
    const pending = {
      ...data,
      workspaces: [{ ...data.workspaces[0]!, pendingCreation: true }],
    };
    expect(getWorkspaceSyncStatus(pending, workspaceId, online).kind).toBe(
      "saving",
    );
    expect(
      getWorkspaceSyncStatus(
        {
          ...pending,
          workspaces: [
            { ...pending.workspaces[0]!, creationError: "Beta limit" },
          ],
        },
        workspaceId,
        online,
      ),
    ).toMatchObject({ kind: "error", detail: "Beta limit" });
  });
  it("waits for Page metadata and reports conflicts until resolved", () => {
    const pending: WorkspaceData = {
      ...data,
      operations: [
        {
          id: crypto.randomUUID(),
          sequence: 1,
          status: "pending",
          payload: {
            operationId: crypto.randomUUID(),
            workspaceId,
            pageId,
            expectedRevision: 0,
            action: "trash",
          },
        },
      ],
    };
    expect(getWorkspaceSyncStatus(pending, workspaceId, online).kind).toBe(
      "saving",
    );
    pending.operations[0]!.status = "conflict";
    pending.operations[0]!.error = "Page was moved";
    expect(getWorkspaceSyncStatus(pending, workspaceId, online)).toMatchObject({
      kind: "error",
      detail: "Page was moved",
    });
  });
});
