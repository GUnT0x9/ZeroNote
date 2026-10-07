import { z } from "zod";
import {
  MemberGroupInputSchema,
  MemberRevisionSchema,
  MemberOperationSchema,
  MemberProfileInputSchema,
  GroupGrantInputSchema,
  MemberGrantInputSchema,
  WorkspaceMembersSchema,
  MemberProfileSchema,
  type WorkspaceMembers,
  type MemberProfile,
  MAX_GROUP_MEMBERS,
  MAX_IDENTITY_NAME_LENGTH,
} from "@zeronote/shared";
import { api, authenticate, getDevice } from "./api";
import { ApiError } from "./http";
import { database, errorMessage } from "./database";

const CACHE_PREFIX = "workspace-members:";
const CHANGE_PREFIX = "member-change:";
export const MEMBER_PREFERENCE_PREFIXES = [
  CACHE_PREFIX,
  CHANGE_PREFIX,
  "member-group-draft:",
] as const;
const DraftSchema = z
  .object({
    id: z.uuid(),
    name: z.string().max(MAX_IDENTITY_NAME_LENGTH),
    memberIds: z.array(z.uuid()).max(MAX_GROUP_MEMBERS),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type MemberGroupDraft = z.infer<typeof DraftSchema>;
const ChangeSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    deviceId: z.uuid(),
    path: z.string(),
    method: z.enum(["PATCH", "PUT", "DELETE"]),
    body: z.unknown(),
    acknowledged: z.boolean(),
    createdAt: z.iso.datetime(),
    error: z.string().optional(),
    errorStatus: z.number().int().optional(),
  })
  .strict();
export type MemberChange = z.infer<typeof ChangeSchema>;
const REJECTED_STATUS_CODES = [400, 403, 404, 409, 410, 422, 507] as const;
export function isRejectedMemberChange(change: MemberChange): boolean {
  return (
    !change.acknowledged &&
    change.errorStatus !== undefined &&
    REJECTED_STATUS_CODES.some((status) => status === change.errorStatus)
  );
}
const draftWrites = new Map<string, Promise<unknown>>();
const cacheKey = (workspaceId: string, deviceId: string) =>
  `${CACHE_PREFIX}${workspaceId}:${deviceId}`;
const changeKey = (change: MemberChange) =>
  `${CHANGE_PREFIX}${change.workspaceId}:${change.deviceId}:${change.id}`;

export function parseMemberChange(value: unknown): MemberChange {
  const change = ChangeSchema.parse(value),
    parts = change.path.split("/");
  if (
    parts[0] !== "" ||
    parts[1] !== "workspaces" ||
    parts[2] !== change.workspaceId
  )
    throw new Error("멤버 변경의 Workspace 범위가 일치하지 않습니다.");
  let body: unknown;
  if (parts.length === 4 && parts[3] === "profile" && change.method === "PATCH")
    body = MemberProfileInputSchema.parse(change.body);
  else if (parts.length === 5 && parts[3] === "member-groups") {
    z.uuid().parse(parts[4]);
    if (change.method === "PUT")
      body = MemberGroupInputSchema.parse(change.body);
    else if (change.method === "DELETE")
      body = MemberRevisionSchema.parse(change.body);
  } else if (
    parts.length === 4 &&
    parts[3] === "group-access" &&
    change.method === "PUT"
  )
    body = GroupGrantInputSchema.parse(change.body);
  else if (
    parts.length === 5 &&
    parts[3] === "group-access" &&
    change.method === "DELETE"
  ) {
    z.uuid().parse(parts[4]);
    body = MemberRevisionSchema.parse(change.body);
  } else if (parts[3] === "members") {
    z.uuid().parse(parts[4]);
    if (parts.length === 5 && change.method === "DELETE")
      body = MemberOperationSchema.parse(change.body);
    else if (parts.length === 7 && parts[5] === "grants") {
      z.uuid().parse(parts[6]);
      if (change.method === "PATCH")
        body = MemberGrantInputSchema.parse(change.body);
      else if (change.method === "DELETE")
        body = MemberRevisionSchema.parse(change.body);
    }
  }
  if (
    !body ||
    MemberOperationSchema.shape.operationId.parse(
      (body as { operationId: unknown }).operationId,
    ) !== change.id
  )
    throw new Error("지원하지 않는 멤버 변경 요청입니다.");
  return { ...change, body };
}

export async function cachedMembers(
  workspaceId: string,
): Promise<WorkspaceMembers | null> {
  const device = await getDevice(),
    stored = await database.preferences.get(cacheKey(workspaceId, device.id));
  return stored ? WorkspaceMembersSchema.parse(JSON.parse(stored.value)) : null;
}
export async function cachedMemberProfile(
  workspaceId: string,
): Promise<MemberProfile | null> {
  const device = await getDevice(),
    stored = await database.preferences.get(
      `${cacheKey(workspaceId, device.id)}:profile`,
    );
  return stored ? MemberProfileSchema.parse(JSON.parse(stored.value)) : null;
}
export async function fetchMembers(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<WorkspaceMembers> {
  const device = await authenticate(),
    id = cacheKey(workspaceId, device.id);
  try {
    const value = WorkspaceMembersSchema.parse(
      await api(`/workspaces/${workspaceId}/members`, "GET", undefined, signal),
    );
    if (value.groups.some((g) => g.workspaceId !== workspaceId))
      throw new Error("다른 Workspace의 멤버 목록을 받았습니다.");
    signal?.throwIfAborted();
    await database.transaction("rw", database.preferences, async () => {
      signal?.throwIfAborted();
      await database.preferences.put({ id, value: JSON.stringify(value) });
    });
    return value;
  } catch (error) {
    if (
      error instanceof ApiError &&
      [401, 403, 404, 410].includes(error.status)
    )
      await database.preferences.delete(id);
    throw error;
  }
}
export async function fetchMemberProfile(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<MemberProfile> {
  const device = await authenticate(),
    id = `${cacheKey(workspaceId, device.id)}:profile`;
  try {
    const profile = MemberProfileSchema.parse(
      await api(`/workspaces/${workspaceId}/profile`, "GET", undefined, signal),
    );
    signal?.throwIfAborted();
    await database.preferences.put({ id, value: JSON.stringify(profile) });
    return profile;
  } catch (error) {
    if (
      error instanceof ApiError &&
      [401, 403, 404, 410].includes(error.status)
    )
      await database.preferences.delete(id);
    throw error;
  }
}
export async function pendingMemberChanges(
  workspaceId: string,
): Promise<MemberChange[]> {
  const device = await getDevice();
  const rows = await database.preferences
    .where("id")
    .startsWith(`${CHANGE_PREFIX}${workspaceId}:${device.id}:`)
    .toArray();
  return rows
    .map((row) => parseMemberChange(JSON.parse(row.value)))
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
}
export async function queueMemberChange(
  workspaceId: string,
  path: string,
  method: MemberChange["method"],
  body: unknown,
): Promise<MemberChange> {
  const device = await getDevice(),
    operation = z.object({ operationId: z.uuid() }).parse(body);
  const change = parseMemberChange({
    id: operation.operationId,
    workspaceId,
    deviceId: device.id,
    path,
    method,
    body,
    acknowledged: false,
    createdAt: new Date().toISOString(),
  });
  const key = changeKey(change),
    existing = await database.preferences.get(key);
  if (existing) {
    const old = parseMemberChange(JSON.parse(existing.value));
    if (
      old.path !== change.path ||
      old.method !== change.method ||
      JSON.stringify(old.body) !== JSON.stringify(change.body)
    )
      throw new Error("같은 변경 ID에 다른 내용을 저장할 수 없습니다.");
    return old;
  }
  await database.preferences.add({ id: key, value: JSON.stringify(change) });
  return change;
}
export async function sendMemberChange(
  input: MemberChange,
  owner: boolean,
): Promise<void> {
  const change = parseMemberChange(input),
    device = await authenticate();
  if (change.deviceId !== device.id)
    throw new Error("다른 기기의 멤버 변경은 전송할 수 없습니다.");
  const stored = await database.preferences.get(changeKey(change));
  if (!stored) throw new Error("이 기기에 저장된 변경을 찾을 수 없습니다.");
  const pending = parseMemberChange(JSON.parse(stored.value));
  try {
    if (!pending.acknowledged) {
      await api(pending.path, pending.method, pending.body);
      pending.acknowledged = true;
      delete pending.error;
      delete pending.errorStatus;
      await database.preferences.put({
        id: changeKey(pending),
        value: JSON.stringify(pending),
      });
    }
    if (owner) await fetchMembers(pending.workspaceId);
    await fetchMemberProfile(pending.workspaceId);
    await database.preferences.delete(changeKey(pending));
  } catch (error) {
    pending.error = errorMessage(error);
    if (error instanceof ApiError) pending.errorStatus = error.status;
    await database.preferences.put({
      id: changeKey(pending),
      value: JSON.stringify(pending),
    });
    throw error;
  }
}
export async function removeMemberChange(input: MemberChange): Promise<void> {
  const change = parseMemberChange(input),
    device = await getDevice();
  if (change.deviceId !== device.id)
    throw new Error("다른 기기의 변경을 제거할 수 없습니다.");
  await database.preferences.delete(changeKey(change));
}
async function draftKey(workspaceId: string): Promise<string> {
  z.uuid().parse(workspaceId);
  const device = await getDevice();
  return `member-group-draft:${workspaceId}:${device.id}`;
}
export async function loadMemberGroupDraft(
  workspaceId: string,
): Promise<MemberGroupDraft | null> {
  const id = await draftKey(workspaceId);
  await draftWrites.get(id);
  const row = await database.preferences.get(id);
  return row ? DraftSchema.parse(JSON.parse(row.value)) : null;
}
export async function saveMemberGroupDraft(
  workspaceId: string,
  value: MemberGroupDraft | null,
): Promise<void> {
  const id = await draftKey(workspaceId),
    draft = value && DraftSchema.parse(value);
  const next = (draftWrites.get(id) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      if (draft)
        await database.preferences.put({ id, value: JSON.stringify(draft) });
      else await database.preferences.delete(id);
    });
  draftWrites.set(id, next);
  try {
    await next;
  } finally {
    if (draftWrites.get(id) === next) draftWrites.delete(id);
  }
}
