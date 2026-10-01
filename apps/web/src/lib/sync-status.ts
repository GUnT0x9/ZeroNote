import type { WorkspaceData } from "./hooks";

export interface SyncStatusInput {
  connection: "connecting" | "online" | "offline" | "error";
  error: string | null;
  pending: boolean;
  hasWorkspace: boolean;
}

export interface SyncStatusPresentation {
  kind: "connecting" | "saving" | "saved" | "offline" | "error";
  label: string;
  detail: string;
}

export function getSyncStatus(input: SyncStatusInput): SyncStatusPresentation {
  if (input.connection === "offline")
    return {
      kind: "offline",
      label: "Offline",
      detail: "연결되면 대기 중인 변경사항을 서버와 동기화합니다.",
    };
  if (input.error || input.connection === "error")
    return {
      kind: "error",
      label: "동기화 확인 필요",
      detail:
        input.error ??
        "서버에 연결하지 못했습니다. 저장되지 않은 변경사항을 다시 동기화해주세요.",
    };
  if (input.connection === "connecting")
    return {
      kind: "connecting",
      label: "서버 연결 중",
      detail:
        "연결을 준비하고 있습니다. 이 기기의 문서에서 계속 작업할 수 있습니다.",
    };
  if (input.pending)
    return {
      kind: "saving",
      label: "서버에 저장 중",
      detail:
        "이 기기에 저장한 변경사항을 전송하고 있습니다. 서버의 저장 확인을 기다립니다.",
    };
  return {
    kind: "saved",
    label: input.hasWorkspace ? "서버 동기화 완료" : "서버 연결됨",
    detail: input.hasWorkspace
      ? "대기 중인 변경사항이 없습니다."
      : "Workspace를 만들거나 초대받은 Page를 열 수 있습니다.",
  };
}
export function getWorkspaceSyncStatus(
  data: WorkspaceData,
  workspaceId: string | null,
  connection: Pick<SyncStatusInput, "connection" | "error">,
): SyncStatusPresentation {
  const workspace = data.workspaces.find((item) => item.id === workspaceId);
  const pageIds = new Set(
    data.pages
      .filter(
        (page) =>
          page.workspaceId === workspaceId &&
          !page.deletedAt &&
          !page.accessLost,
      )
      .map((page) => page.id),
  );
  const documents = data.documents.filter(
    (document) => pageIds.has(document.id) && document.state !== "preserved",
  );
  const operations = data.operations.filter(
    (operation) => operation.payload.workspaceId === workspaceId,
  );
  const comments = data.pendingComments.filter((comment) =>
    pageIds.has(comment.payload.pageId),
  );
  const failedDocument = documents.find(
    (document) => document.state === "error",
  );
  const failedOperation = operations.find(
    (operation) => operation.status !== "pending",
  );
  return getSyncStatus({
    ...connection,
    hasWorkspace: !!workspace && !workspace.accessLost,
    error:
      connection.error ??
      workspace?.creationError ??
      (failedDocument
        ? (failedDocument.error ?? "문서 저장을 확인해주세요.")
        : null) ??
      (failedOperation
        ? (failedOperation.error ?? "Page 구조 변경을 확인해주세요.")
        : null) ??
      comments.find((comment) => comment.error)?.error ??
      null,
    pending:
      !!workspace?.pendingCreation ||
      documents.some(
        (document) => document.generation > document.committedGeneration,
      ) ||
      operations.some((operation) => operation.status === "pending") ||
      comments.some((comment) => !comment.error),
  });
}
