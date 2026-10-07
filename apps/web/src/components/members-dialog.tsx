"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, ArrowLeft } from "lucide-react";
import {
  RoleSchema,
  MemberGroupInputSchema,
  type MemberProfile,
  type WorkspaceMembers,
  type MemberGroup,
  type MemberGrant,
  type Role,
  MAX_IDENTITY_NAME_LENGTH,
} from "@zeronote/shared";
import { Dialog } from "./primitives";
import { useUiStore } from "@/lib/ui-store";
import { ApiError } from "@/lib/http";
import {
  errorMessage,
  type LocalPage,
  type LocalWorkspace,
} from "@/lib/database";
import { requestSync } from "@/lib/sync";
import {
  cachedMembers,
  cachedMemberProfile,
  fetchMembers,
  fetchMemberProfile,
  pendingMemberChanges,
  queueMemberChange,
  sendMemberChange,
  removeMemberChange,
  loadMemberGroupDraft,
  saveMemberGroupDraft,
  type MemberGroupDraft,
  type MemberChange,
  isRejectedMemberChange,
} from "@/lib/members";

const ROLE_LABELS = {
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
} as const;
const newOperation = () => ({ operationId: crypto.randomUUID() });
type GrantDraft = Omit<MemberGrant, "revision" | "revoked"> & {
  expectedRevision: number;
};
export function MembersDialog({
  workspace,
  owner,
  pages,
  onClose,
}: {
  workspace: LocalWorkspace;
  owner: boolean;
  pages: LocalPage[];
  onClose: () => void;
}) {
  const online = useUiStore((state) => state.syncState === "online");
  const [directory, setDirectory] = useState<WorkspaceMembers | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<MemberChange[]>([]);
  const [draft, setDraft] = useState<MemberGroupDraft | null>(null);
  const [draftState, setDraftState] = useState<
    "saving" | "saved" | "error" | null
  >(null);
  const draftRevision = useRef(0);
  const [grantDraft, setGrantDraft] = useState<GrantDraft | null>(null);
  const [tab, setTab] = useState<"members" | "groups" | "access">("members");
  const [fresh, setFresh] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [groupId, setGroupId] = useState(""),
    [pageId, setPageId] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("viewer");
  const [descendants, setDescendants] = useState(false);
  const working = useRef(false);
  const prefix = `/workspaces/${workspace.id}`;
  const canManage =
    online && fresh && !busy && !pending.length && !workspace.pendingCreation;

  const readCache = async () => {
    const [stored, own, changes, groupDraft] = await Promise.all([
      owner ? cachedMembers(workspace.id) : Promise.resolve(null),
      cachedMemberProfile(workspace.id),
      pendingMemberChanges(workspace.id),
      loadMemberGroupDraft(workspace.id),
    ]);
    setDirectory(stored);
    setProfile(own);
    setPending(changes);
    setDraft(groupDraft);
    setDraftState(groupDraft ? "saved" : null);
    if (own) setName((current) => current || own.name);
  };
  const refresh = async (signal?: AbortSignal) => {
    setFresh(false);
    const [own, data] = await Promise.all([
      fetchMemberProfile(workspace.id, signal),
      owner ? fetchMembers(workspace.id, signal) : Promise.resolve(null),
    ]);
    signal?.throwIfAborted();
    setProfile(own);
    setDirectory(data);
    setFresh(true);
    setName((current) => current || own.name);
  };
  useEffect(() => {
    const controller = new AbortController();
    setFresh(false);
    void (async () => {
      await readCache();
      if (online && !workspace.pendingCreation)
        await refresh(controller.signal);
    })().catch((problem) => {
      if (controller.signal.aborted) return;
      setError(errorMessage(problem));
      if (
        problem instanceof ApiError &&
        [401, 403, 404, 410].includes(problem.status)
      ) {
        setDirectory(null);
        setProfile(null);
      }
    });
    return () => controller.abort();
  }, [workspace.id, owner, online, workspace.pendingCreation]);

  const run = async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await readCache();
    } catch (problem) {
      setError(errorMessage(problem));
      await readCache().catch((local) => setError(errorMessage(local)));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const submit = async (
    path: string,
    method: MemberChange["method"],
    body: unknown,
  ) => {
    const change = await queueMemberChange(workspace.id, path, method, body);
    await sendMemberChange(change, owner);
    setFresh(true);
    requestSync();
  };
  const changeDraft = (value: MemberGroupDraft | null) => {
    const revision = ++draftRevision.current;
    setDraft(value);
    setDraftState(value ? "saving" : null);
    void saveMemberGroupDraft(workspace.id, value)
      .then(() => {
        if (revision === draftRevision.current)
          setDraftState(value ? "saved" : null);
      })
      .catch((problem) => {
        if (revision === draftRevision.current) {
          setDraftState("error");
          setError(errorMessage(problem));
        }
      });
  };
  const editGroup = (group: MemberGroup) =>
    changeDraft({
      id: group.id,
      name: group.name,
      memberIds: [...group.memberIds],
      expectedRevision: group.revision,
    });
  const clearAppliedDraft = async (change: MemberChange) => {
    if (
      draft &&
      change.method === "PUT" &&
      change.path === `${prefix}/member-groups/${draft.id}`
    ) {
      const input = MemberGroupInputSchema.parse(change.body);
      if (
        input.name === draft.name.trim() &&
        [...input.memberIds].sort().join() ===
          [...draft.memberIds].sort().join()
      )
        await saveMemberGroupDraft(workspace.id, null);
    }
  };
  const pageName = (id: string) =>
    pages.find((page) => page.id === id)?.title || "제목 없는 Page";
  const currentGroup = directory?.groups.find(
    (group) => group.id === draft?.id,
  );
  const groupConflict =
    !!draft &&
    (currentGroup
      ? currentGroup.revision !== draft.expectedRevision
      : draft.expectedRevision > 0);
  const existingGrant = directory?.groupGrants.find(
    (grant) => grant.groupId === groupId && grant.pageId === pageId,
  );
  const editablePages = pages.filter(
    (page) =>
      page.workspaceId === workspace.id &&
      !page.deletedAt &&
      !page.ancestorTrashed &&
      !page.accessLost &&
      page.role === "owner",
  );

  return (
    <Dialog
      title={owner ? "멤버와 그룹" : "내 표시 이름"}
      onClose={onClose}
      wide
    >
      <div className="members-content">
        <div className="members-toolbar">
          <p className="muted small" aria-live="polite">
            {fresh && online
              ? "서버의 최신 상태"
              : "이 기기의 마지막 확인 상태"}
          </p>
          <button
            className="icon-button"
            aria-label="멤버 목록 새로고침"
            disabled={busy || !online || workspace.pendingCreation}
            onClick={() => {
              void run(async () => {
                await refresh();
              });
            }}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <form
          className="member-profile"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await submit(`${prefix}/profile`, "PATCH", {
                ...newOperation(),
                name,
              });
            });
          }}
        >
          <label className="field-label">
            내 표시 이름
            <input
              aria-label="내 표시 이름"
              value={name}
              maxLength={MAX_IDENTITY_NAME_LENGTH}
              disabled={!online || busy || !!pending.length}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button
            className="button"
            disabled={
              !canManage ||
              !profile ||
              !name.trim() ||
              name.trim() === profile.name
            }
          >
            이름 저장
          </button>
        </form>
        {error && (
          <p className="inline-warning" role="alert">
            {error}
          </p>
        )}
        {!!pending.length && (
          <section className="member-pending" aria-label="확인할 멤버 변경">
            <h3>확인할 변경</h3>
            {pending.map((change) => (
              <div className="member-pending-row" key={change.id}>
                <p>
                  {change.acknowledged
                    ? "서버 저장됨 · 목록 확인 필요"
                    : isRejectedMemberChange(change)
                      ? "변경이 거절됨 · 입력 보관 중"
                      : "전송 결과를 확인하지 못했습니다."}
                </p>
                {change.error && <p className="muted small">{change.error}</p>}
                <div className="button-row">
                  <button
                    className="button button-small"
                    disabled={busy || !online}
                    onClick={() => {
                      void run(async () => {
                        if (isRejectedMemberChange(change)) await refresh();
                        else {
                          await sendMemberChange(change, owner);
                          await clearAppliedDraft(change);
                          await refresh();
                          requestSync();
                        }
                      });
                    }}
                  >
                    {change.acknowledged || isRejectedMemberChange(change)
                      ? "다시 확인"
                      : "같은 변경 재시도"}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setConfirmation(`pending:${change.id}`)}
                  >
                    기기 기록 제거
                  </button>
                </div>
                {confirmation === `pending:${change.id}` && (
                  <div className="member-confirm">
                    <p>
                      전송한 변경은 서버에 적용됐을 수 있습니다. 이 기기의 대기
                      기록만 제거합니다.
                    </p>
                    <div className="button-row">
                      <button
                        className="button button-small"
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            await removeMemberChange(change);
                            setConfirmation(null);
                            if (online) await refresh();
                          });
                        }}
                      >
                        대기 기록 제거
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setConfirmation(null)}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
        {owner && (
          <>
            <div className="member-tabs" role="tablist" aria-label="팀 관리">
              {(
                [
                  ["members", "멤버"],
                  ["groups", "그룹"],
                  ["access", "그룹 공유"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  id={`team-tab-${value}`}
                  aria-controls={`team-pane-${value}`}
                  tabIndex={tab === value ? 0 : -1}
                  onKeyDown={(event) => {
                    const values = ["members", "groups", "access"] as const;
                    const current = values.indexOf(value);
                    const next =
                      event.key === "ArrowRight"
                        ? (current + 1) % values.length
                        : event.key === "ArrowLeft"
                          ? (current + values.length - 1) % values.length
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? values.length - 1
                              : null;
                    if (next === null) return;
                    event.preventDefault();
                    setTab(values[next]!);
                    const buttons =
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        '[role="tab"]',
                      );
                    buttons?.item(next)?.focus();
                  }}
                  className={tab === value ? "active" : ""}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {!directory && (
              <p className="muted">
                {workspace.pendingCreation
                  ? "Workspace를 서버에 저장한 뒤 팀을 관리할 수 있습니다."
                  : "멤버 목록을 확인하려면 연결이 필요합니다."}
              </p>
            )}
            {directory && tab === "members" && (
              <section
                aria-label="Workspace 멤버"
                className="member-list"
                id="team-pane-members"
                role="tabpanel"
                aria-labelledby="team-tab-members"
              >
                <p className="field-help">
                  협업자는 Page 초대로 참여합니다. 그룹과 개별 권한 중 가장 높은
                  유효 권한이 적용됩니다.
                </p>
                {directory.members.map((member) => (
                  <article
                    className="member-row"
                    key={member.id}
                    data-testid={`member-${member.id}`}
                  >
                    <div className="member-heading">
                      <span className="avatar-mini">
                        {member.name.slice(0, 1)}
                      </span>
                      <div>
                        <strong>{member.name}</strong>
                        <small>
                          {member.owner
                            ? "Owner"
                            : member.revoked
                              ? "철회됨"
                              : `${member.devices.filter((device) => !device.revoked).length}개 기기`}
                        </small>
                      </div>
                      {!member.owner && !member.revoked && (
                        <button
                          className="text-button danger-text"
                          disabled={!canManage}
                          onClick={() => setConfirmation(`member:${member.id}`)}
                        >
                          멤버 제거
                        </button>
                      )}
                    </div>
                    {!!member.groupIds.length && (
                      <p className="muted small">
                        {directory.groups
                          .filter((group) => member.groupIds.includes(group.id))
                          .map((group) => group.name)
                          .join(" · ")}
                      </p>
                    )}
                    {member.grants
                      .filter((grant) => !grant.revoked)
                      .map((grant) => (
                        <div className="member-access-row" key={grant.id}>
                          <span>
                            {pageName(grant.pageId)}{" "}
                            <small>
                              {ROLE_LABELS[grant.role]}
                              {grant.includeDescendants
                                ? " · 하위 Page 포함"
                                : ""}
                            </small>
                          </span>
                          <button
                            className="text-button"
                            disabled={!canManage || member.revoked}
                            onClick={() =>
                              setGrantDraft({
                                id: grant.id,
                                identityId: member.id,
                                pageId: grant.pageId,
                                role: grant.role,
                                includeDescendants: grant.includeDescendants,
                                expectedRevision: grant.revision,
                              })
                            }
                          >
                            권한 변경
                          </button>
                        </div>
                      ))}
                    {confirmation === `member:${member.id}` && (
                      <div className="member-confirm">
                        <p>
                          {member.name}의 모든 기기와 Page·그룹 접근을
                          철회합니다. 작성한 문서와 댓글은 유지합니다.
                        </p>
                        <div className="button-row">
                          <button
                            className="button danger-text"
                            disabled={!canManage}
                            onClick={() => {
                              void run(async () => {
                                await submit(
                                  `${prefix}/members/${member.id}`,
                                  "DELETE",
                                  newOperation(),
                                );
                                setConfirmation(null);
                              });
                            }}
                          >
                            접근 철회
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setConfirmation(null)}
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
                {grantDraft && (
                  <form
                    className="member-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await submit(
                          `${prefix}/members/${grantDraft.identityId}/grants/${grantDraft.id}`,
                          "PATCH",
                          {
                            ...newOperation(),
                            expectedRevision: grantDraft.expectedRevision,
                            role: grantDraft.role,
                            includeDescendants: grantDraft.includeDescendants,
                          },
                        );
                        setGrantDraft(null);
                      });
                    }}
                  >
                    <h3>{pageName(grantDraft.pageId)} 접근 변경</h3>
                    <label className="field-label">
                      Role
                      <select
                        aria-label="멤버 Page Role"
                        value={grantDraft.role}
                        onChange={(event) =>
                          setGrantDraft({
                            ...grantDraft,
                            role: RoleSchema.parse(event.target.value),
                          })
                        }
                        disabled={!canManage}
                      >
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={grantDraft.includeDescendants}
                        disabled={!canManage}
                        onChange={(event) =>
                          setGrantDraft({
                            ...grantDraft,
                            includeDescendants: event.target.checked,
                          })
                        }
                      />
                      하위 Page 포함
                    </label>
                    <div className="button-row">
                      <button className="button" disabled={!canManage}>
                        권한 저장
                      </button>
                      <button
                        type="button"
                        className="button danger-text"
                        disabled={!canManage}
                        onClick={() => {
                          void run(async () => {
                            await submit(
                              `${prefix}/members/${grantDraft.identityId}/grants/${grantDraft.id}`,
                              "DELETE",
                              {
                                ...newOperation(),
                                expectedRevision: grantDraft.expectedRevision,
                              },
                            );
                            setGrantDraft(null);
                          });
                        }}
                      >
                        이 접근 철회
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setGrantDraft(null)}
                      >
                        취소
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}
            {directory && tab === "groups" && (
              <section
                aria-label="멤버 그룹"
                id="team-pane-groups"
                role="tabpanel"
                aria-labelledby="team-tab-groups"
              >
                <div className="members-toolbar">
                  <h3>그룹</h3>
                  <button
                    className="button button-small"
                    disabled={busy || !!pending.length}
                    onClick={() =>
                      changeDraft({
                        id: crypto.randomUUID(),
                        name: "",
                        memberIds: [],
                        expectedRevision: 0,
                      })
                    }
                  >
                    <Plus size={14} />새 그룹
                  </button>
                </div>
                {!directory.groups.length && (
                  <p className="muted small">그룹이 없습니다.</p>
                )}
                {directory.groups.map((group) => (
                  <div className="member-group-row" key={group.id}>
                    <div>
                      <strong>{group.name}</strong>
                      <small>{group.memberIds.length}명</small>
                    </div>
                    <button
                      className="text-button"
                      disabled={busy || !!pending.length}
                      onClick={() => editGroup(group)}
                    >
                      그룹 편집
                    </button>
                    <button
                      className="text-button danger-text"
                      disabled={!canManage}
                      onClick={() => setConfirmation(`group:${group.id}`)}
                    >
                      삭제
                    </button>
                    {confirmation === `group:${group.id}` && (
                      <div className="member-confirm">
                        <p>
                          {group.name}의 그룹 공유가 모두 종료됩니다. 개별
                          권한과 다른 그룹은 유지합니다.
                        </p>
                        <div className="button-row">
                          <button
                            className="button danger-text"
                            disabled={!canManage}
                            onClick={() => {
                              void run(async () => {
                                await submit(
                                  `${prefix}/member-groups/${group.id}`,
                                  "DELETE",
                                  {
                                    ...newOperation(),
                                    expectedRevision: group.revision,
                                  },
                                );
                                if (draft?.id === group.id)
                                  await saveMemberGroupDraft(
                                    workspace.id,
                                    null,
                                  );
                                setConfirmation(null);
                              });
                            }}
                          >
                            그룹 삭제
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setConfirmation(null)}
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {draft && (
                  <form
                    className="member-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        const input = MemberGroupInputSchema.parse({
                          ...newOperation(),
                          name: draft.name,
                          memberIds: draft.memberIds,
                          expectedRevision: draft.expectedRevision,
                        });
                        await submit(
                          `${prefix}/member-groups/${draft.id}`,
                          "PUT",
                          input,
                        );
                        await saveMemberGroupDraft(workspace.id, null);
                      });
                    }}
                  >
                    <label className="field-label">
                      그룹 이름
                      <input
                        aria-label="그룹 이름"
                        value={draft.name}
                        maxLength={MAX_IDENTITY_NAME_LENGTH}
                        disabled={busy || !!pending.length}
                        onChange={(event) =>
                          changeDraft({ ...draft, name: event.target.value })
                        }
                        autoFocus
                      />
                    </label>
                    <div className="member-checkboxes">
                      {directory.members
                        .filter(
                          (member) =>
                            !member.revoked ||
                            draft.memberIds.includes(member.id),
                        )
                        .map((member) => (
                          <label className="check-label" key={member.id}>
                            <input
                              type="checkbox"
                              aria-label={`그룹 멤버 ${member.name}`}
                              checked={draft.memberIds.includes(member.id)}
                              disabled={
                                busy ||
                                !!pending.length ||
                                (member.revoked &&
                                  !draft.memberIds.includes(member.id))
                              }
                              onChange={(event) =>
                                changeDraft({
                                  ...draft,
                                  memberIds: event.target.checked
                                    ? [...draft.memberIds, member.id]
                                    : draft.memberIds.filter(
                                        (id) => id !== member.id,
                                      ),
                                })
                              }
                            />
                            {member.name}
                            {member.revoked && <small>철회됨</small>}
                          </label>
                        ))}
                    </div>
                    <p
                      className="muted small"
                      role="status"
                      data-testid="member-group-draft-status"
                    >
                      {draftState === "saved"
                        ? "이 기기에 저장됨"
                        : draftState === "error"
                          ? "기기 저장 실패 · 입력 보관 중"
                          : "기기에 초안 저장 중"}
                    </p>
                    {groupConflict && (
                      <div className="inline-warning">
                        <p>
                          다른 기기에서 그룹이 변경됐습니다. 입력은 보관하고
                          있습니다.
                        </p>
                        {currentGroup ? (
                          <>
                            <p className="small">
                              현재 구성: {currentGroup.name} ·{" "}
                              {directory.members
                                .filter((member) =>
                                  currentGroup.memberIds.includes(member.id),
                                )
                                .map((member) => member.name)
                                .join(", ") || "빈 그룹"}
                            </p>
                            <button
                              type="button"
                              className="text-button"
                              disabled={!canManage}
                              onClick={() =>
                                changeDraft({
                                  ...draft,
                                  expectedRevision: currentGroup.revision,
                                })
                              }
                            >
                              현재 상태 확인 후 다시 적용
                            </button>
                          </>
                        ) : (
                          <p className="small">
                            삭제된 그룹입니다. 새 그룹으로 저장할 수 있습니다.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="button-row">
                      <button
                        className="button"
                        disabled={
                          !canManage || groupConflict || !draft.name.trim()
                        }
                      >
                        그룹 저장
                      </button>
                      {groupConflict && !currentGroup && (
                        <button
                          type="button"
                          className="button"
                          disabled={!canManage}
                          onClick={() =>
                            changeDraft({
                              ...draft,
                              id: crypto.randomUUID(),
                              expectedRevision: 0,
                            })
                          }
                        >
                          새 그룹으로 만들기
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => changeDraft(null)}
                      >
                        입력 닫기
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}
            {directory && tab === "access" && (
              <section
                aria-label="그룹 Page 공유"
                id="team-pane-access"
                role="tabpanel"
                aria-labelledby="team-tab-access"
              >
                <p className="field-help">
                  현재 그룹 구성원에게 적용됩니다. 이후 그룹에 추가한 사람도 이
                  범위에 접근합니다.
                </p>
                <form
                  className="member-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await submit(`${prefix}/group-access`, "PUT", {
                        ...newOperation(),
                        id: existingGrant?.id ?? crypto.randomUUID(),
                        groupId,
                        pageId,
                        role,
                        includeDescendants: descendants,
                        expectedRevision: existingGrant?.revision ?? 0,
                      });
                    });
                  }}
                >
                  <label className="field-label">
                    그룹
                    <select
                      aria-label="공유할 그룹"
                      value={groupId}
                      disabled={!canManage}
                      onChange={(event) => setGroupId(event.target.value)}
                    >
                      <option value="">그룹 선택</option>
                      {directory.groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Page
                    <select
                      aria-label="그룹에 공유할 Page"
                      value={pageId}
                      disabled={!canManage}
                      onChange={(event) => setPageId(event.target.value)}
                    >
                      <option value="">Page 선택</option>
                      {editablePages.map((page) => (
                        <option key={page.id} value={page.id}>
                          {page.title || "제목 없는 Page"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Role
                    <select
                      aria-label="그룹 Page Role"
                      value={role}
                      disabled={!canManage}
                      onChange={(event) =>
                        setRole(RoleSchema.parse(event.target.value))
                      }
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={descendants}
                      disabled={!canManage}
                      onChange={(event) => setDescendants(event.target.checked)}
                    />
                    하위 Page 포함
                  </label>
                  <button
                    className="button"
                    disabled={
                      !canManage ||
                      !directory.groups.some((group) => group.id === groupId) ||
                      !editablePages.some((page) => page.id === pageId)
                    }
                  >
                    그룹 공유 저장
                  </button>
                </form>
                {directory.groupGrants
                  .filter((grant) => !grant.revoked)
                  .map((grant) => (
                    <div className="member-access-row" key={grant.id}>
                      <span>
                        {
                          directory.groups.find(
                            (group) => group.id === grant.groupId,
                          )?.name
                        }{" "}
                        · {pageName(grant.pageId)}
                        <small>
                          {ROLE_LABELS[grant.role]}
                          {grant.includeDescendants ? " · 하위 Page 포함" : ""}
                        </small>
                      </span>
                      <button
                        className="text-button"
                        disabled={!canManage}
                        onClick={() => {
                          setGroupId(grant.groupId);
                          setPageId(grant.pageId);
                          setRole(grant.role);
                          setDescendants(grant.includeDescendants);
                        }}
                      >
                        공유 편집
                      </button>
                      <button
                        className="text-button danger-text"
                        disabled={!canManage}
                        onClick={() => {
                          void run(async () => {
                            await submit(
                              `${prefix}/group-access/${grant.id}`,
                              "DELETE",
                              {
                                ...newOperation(),
                                expectedRevision: grant.revision,
                              },
                            );
                          });
                        }}
                      >
                        그룹 접근 철회
                      </button>
                    </div>
                  ))}
              </section>
            )}
          </>
        )}
        <button className="text-button" onClick={onClose}>
          <ArrowLeft size={14} />
          Settings로 돌아가기
        </button>
      </div>
    </Dialog>
  );
}
