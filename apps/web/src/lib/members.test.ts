import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, authenticate, getDevice } from "./api";
import { ApiError } from "./http";
import { database } from "./database";
import {
  cachedMembers,
  cachedMemberProfile,
  fetchMembers,
  fetchMemberProfile,
  queueMemberChange,
  sendMemberChange,
  pendingMemberChanges,
  removeMemberChange,
  loadMemberGroupDraft,
  saveMemberGroupDraft,
  parseMemberChange,
  isRejectedMemberChange,
} from "./members";

vi.mock("./api", () => ({
  api: vi.fn(),
  authenticate: vi.fn(),
  getDevice: vi.fn(),
}));
const workspaceId = crypto.randomUUID(),
  deviceId = crypto.randomUUID(),
  identityId = crypto.randomUUID(),
  groupId = crypto.randomUUID();
const profile = { id: identityId, name: "Owner", role: "owner" };
const directory = () => ({
  ownIdentityId: identityId,
  members: [
    {
      id: identityId,
      name: "Owner",
      owner: true,
      revoked: false,
      devices: [{ id: deviceId, name: "Browser", revoked: false }],
      grants: [],
      groupIds: [groupId],
    },
  ],
  groups: [
    {
      id: groupId,
      workspaceId,
      name: "Editors",
      memberIds: [identityId],
      revision: 1,
    },
  ],
  groupGrants: [],
});
const draft = () => ({
  id: groupId,
  name: "Editors",
  memberIds: [identityId],
  expectedRevision: 1,
});
const body = () => ({
  name: "Editors",
  memberIds: [identityId],
  expectedRevision: 1,
  operationId: crypto.randomUUID(),
});
async function queue() {
  return queueMemberChange(
    workspaceId,
    `/workspaces/${workspaceId}/member-groups/${groupId}`,
    "PUT",
    body(),
  );
}
beforeEach(async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const device = {
    id: deviceId,
    name: "Browser",
    privateKey: keys.privateKey,
    publicKey: {},
  };
  vi.mocked(getDevice).mockResolvedValue(device);
  vi.mocked(authenticate).mockResolvedValue(device);
});
afterEach(async () => {
  await database.preferences.clear();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("caches Owner data per Workspace and masks revoked or foreign responses", async () => {
  vi.mocked(api).mockResolvedValueOnce(directory());
  expect(await fetchMembers(workspaceId)).toEqual(directory());
  expect(await cachedMembers(workspaceId)).toEqual(directory());
  expect(await cachedMembers(crypto.randomUUID())).toBeNull();
  const foreign = directory();
  foreign.groups[0]!.workspaceId = crypto.randomUUID();
  vi.mocked(api).mockResolvedValueOnce(foreign);
  await expect(fetchMembers(workspaceId)).rejects.toThrow("다른 Workspace");
  expect(await cachedMembers(workspaceId)).toEqual(directory());
  vi.mocked(api).mockRejectedValueOnce(new ApiError(403, "Revoked"));
  await expect(fetchMembers(workspaceId)).rejects.toThrow("Revoked");
  expect(await cachedMembers(workspaceId)).toBeNull();
});

it("preserves cached data when a scope request is cancelled and clears denied profiles", async () => {
  vi.mocked(api).mockResolvedValueOnce(directory());
  await fetchMembers(workspaceId);
  const controller = new AbortController();
  vi.mocked(api).mockImplementationOnce(async () => {
    controller.abort();
    return directory();
  });
  await expect(fetchMembers(workspaceId, controller.signal)).rejects.toThrow();
  expect(await cachedMembers(workspaceId)).toEqual(directory());
  vi.mocked(api).mockResolvedValueOnce(profile);
  expect(await fetchMemberProfile(workspaceId)).toEqual(profile);
  expect(await cachedMemberProfile(workspaceId)).toEqual(profile);
  vi.mocked(api).mockRejectedValueOnce(new ApiError(403, "Denied"));
  await expect(fetchMemberProfile(workspaceId)).rejects.toThrow("Denied");
  expect(await cachedMemberProfile(workspaceId)).toBeNull();
});

it("saves drafts in order, isolates scopes and preserves the previous value on storage failure", async () => {
  await Promise.all([
    saveMemberGroupDraft(workspaceId, { ...draft(), name: "First" }),
    saveMemberGroupDraft(workspaceId, { ...draft(), name: "Latest" }),
  ]);
  expect((await loadMemberGroupDraft(workspaceId))?.name).toBe("Latest");
  expect(await loadMemberGroupDraft(crypto.randomUUID())).toBeNull();
  const fail = vi
    .spyOn(database.preferences, "put")
    .mockRejectedValueOnce(new Error("QuotaExceeded"));
  await expect(saveMemberGroupDraft(workspaceId, draft())).rejects.toThrow(
    "QuotaExceeded",
  );
  fail.mockRestore();
  expect((await loadMemberGroupDraft(workspaceId))?.name).toBe("Latest");
  await saveMemberGroupDraft(workspaceId, null);
  expect(await loadMemberGroupDraft(workspaceId)).toBeNull();
});

it("keeps the same mutation payload on retries and never sends before Local storage succeeds", async () => {
  const change = await queue();
  expect(
    await queueMemberChange(
      workspaceId,
      change.path,
      change.method,
      change.body,
    ),
  ).toEqual(change);
  const value = change.body as { operationId: string; name: string };
  await expect(
    queueMemberChange(workspaceId, change.path, change.method, {
      ...value,
      name: "Other",
    }),
  ).rejects.toThrow("다른 내용");
  const fail = vi
    .spyOn(database.preferences, "add")
    .mockRejectedValueOnce(new Error("QuotaExceeded"));
  await expect(queue()).rejects.toThrow("QuotaExceeded");
  fail.mockRestore();
  expect(api).not.toHaveBeenCalled();
  expect(await pendingMemberChanges(workspaceId)).toEqual([change]);
});

it("confirms an acknowledged mutation by GET only after a failed refresh", async () => {
  const change = await queue();
  vi.mocked(api)
    .mockResolvedValueOnce({ id: groupId, revision: 2 })
    .mockRejectedValueOnce(new Error("Refresh failed"));
  await expect(sendMemberChange(change, true)).rejects.toThrow(
    "Refresh failed",
  );
  const pending = await pendingMemberChanges(workspaceId);
  expect(pending[0]).toMatchObject({
    id: change.id,
    acknowledged: true,
    error: "Refresh failed",
  });
  vi.mocked(api)
    .mockResolvedValueOnce(directory())
    .mockResolvedValueOnce(profile);
  await sendMemberChange(pending[0]!, true);
  expect(
    vi.mocked(api).mock.calls.filter((call) => call[1] === "PUT"),
  ).toHaveLength(1);
  expect(await pendingMemberChanges(workspaceId)).toEqual([]);
  expect(await cachedMembers(workspaceId)).toEqual(directory());
});

it("retains failed mutation bodies and errors until an explicit local removal", async () => {
  const change = await queue();
  vi.mocked(api).mockRejectedValueOnce(new ApiError(409, "Changed elsewhere"));
  await expect(sendMemberChange(change, true)).rejects.toThrow(
    "Changed elsewhere",
  );
  const pending = await pendingMemberChanges(workspaceId);
  expect(pending[0]).toMatchObject({
    body: change.body,
    acknowledged: false,
    errorStatus: 409,
  });
  await removeMemberChange(pending[0]!);
  expect(await pendingMemberChanges(workspaceId)).toEqual([]);
});

it("rejects unsafe paths and cross-device mutations without making API calls", async () => {
  const change = await queue();
  expect(() =>
    parseMemberChange({
      ...change,
      path: `/workspaces/${crypto.randomUUID()}/profile`,
    }),
  ).toThrow("범위");
  expect(() =>
    parseMemberChange({ ...change, path: "https://example.com/workspaces/" }),
  ).toThrow();
  expect(() =>
    parseMemberChange({ ...change, path: `${change.path}/unexpected` }),
  ).toThrow();
  await expect(
    sendMemberChange({ ...change, deviceId: crypto.randomUUID() }, true),
  ).rejects.toThrow("다른 기기");
  await expect(
    removeMemberChange({ ...change, deviceId: crypto.randomUUID() }),
  ).rejects.toThrow("다른 기기");
  expect(api).not.toHaveBeenCalled();
});
it("distinguishes rejected changes from temporary errors and acknowledged writes", async () => {
  const change = await queue();
  expect(isRejectedMemberChange({ ...change, errorStatus: 409 })).toBe(true);
  expect(isRejectedMemberChange({ ...change, errorStatus: 503 })).toBe(false);
  expect(
    isRejectedMemberChange({ ...change, acknowledged: true, errorStatus: 403 }),
  ).toBe(false);
});
