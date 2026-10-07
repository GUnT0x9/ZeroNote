import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import {
  bytesToBase64,
  createRecoveryKey,
  sha256Hex,
  EDITOR_PROTOCOL,
  EDITOR_PROTOCOL_HEADER,
  WorkspaceMembersSchema,
  type MemberProfile,
  type WorkspaceMembers,
  type Page,
  type Role,
} from "@zeronote/shared";
import { createApp } from "./app";
import { Repository } from "./database/repository";
import { env } from "./env";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance, repository: Repository;
const workspaces: string[] = [];
interface Actor {
  id: string;
  cookie: string;
}
async function request(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  actor: Actor,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/v1${path}`,
    payload: payload === undefined ? undefined : JSON.stringify(payload),
    headers: {
      origin: env.WEB_ORIGIN,
      cookie: actor.cookie,
      [EDITOR_PROTOCOL_HEADER]: String(EDITOR_PROTOCOL),
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
  });
}
async function actor(): Promise<Actor> {
  const id = crypto.randomUUID(),
    keys = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
  const current = { id, cookie: "" };
  expect(
    (
      await request("POST", "/devices", current, {
        id,
        name: "Member test",
        publicKey: await crypto.subtle.exportKey("jwk", keys.publicKey),
      })
    ).statusCode,
  ).toBe(200);
  const challenge = (
    await request("POST", "/auth/challenge", current, { deviceId: id })
  ).json<{ id: string; nonce: string }>();
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    new TextEncoder().encode(challenge.nonce),
  );
  const response = await request("POST", "/auth/verify", current, {
    challengeId: challenge.id,
    signature: bytesToBase64(new Uint8Array(signature)),
  });
  expect(response.statusCode).toBe(200);
  current.cookie = String(response.headers["set-cookie"]).split(";")[0] ?? "";
  return current;
}
async function workspace(owner: Actor) {
  const id = crypto.randomUUID(),
    key = createRecoveryKey(),
    ownerIdentityId = crypto.randomUUID();
  expect(
    (
      await request("POST", "/workspaces", owner, {
        id,
        name: "Member integration",
        ownerIdentityId,
        createdAt: new Date().toISOString(),
        recoveryHash: await sha256Hex(key),
      })
    ).statusCode,
  ).toBe(200);
  workspaces.push(id);
  return { id, key, ownerIdentityId };
}
async function page(
  owner: Actor,
  workspaceId: string,
  parentId: string | null = null,
) {
  const id = crypto.randomUUID(),
    value: Page = {
      id,
      workspaceId,
      parentId,
      kind: "document",
      title: "Member Page",
      revision: 0,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      isInbox: false,
    };
  expect(
    (
      await request("POST", "/sync/page", owner, {
        operationId: crypto.randomUUID(),
        workspaceId,
        pageId: id,
        expectedRevision: 0,
        action: "create",
        page: value,
      })
    ).statusCode,
  ).toBe(200);
  return value;
}
async function join(
  owner: Actor,
  guest: Actor,
  workspaceId: string,
  pageId: string,
  role: Exclude<Role, "owner"> = "viewer",
) {
  const invite = (
    await request("POST", "/invites", owner, {
      pageId,
      role,
      includeDescendants: false,
    })
  ).json<{ id: string; secret: string }>();
  expect(
    (
      await request("POST", `/invites/${invite.id}/redeem`, guest, {
        secret: invite.secret,
      })
    ).statusCode,
  ).toBe(200);
  return (
    await request("GET", `/workspaces/${workspaceId}/profile`, guest)
  ).json<MemberProfile>();
}
async function members(owner: Actor, id: string): Promise<WorkspaceMembers> {
  const response = await request("GET", `/workspaces/${id}/members`, owner);
  expect(response.statusCode).toBe(200);
  return WorkspaceMembersSchema.parse(response.json());
}
const operation = () => ({ operationId: crypto.randomUUID() });
const groupInput = (memberIds: string[], expectedRevision = 0) => ({
  ...operation(),
  name: "Reviewers",
  memberIds,
  expectedRevision,
});
beforeAll(async () => {
  const value = await createApp(new Repository(env.DATABASE_URL), false);
  app = value.app;
  repository = value.repository;
  await app.ready();
}, 30000);
afterAll(async () => {
  for (const id of workspaces) await repository.deleteWorkspace(id);
  await app.close();
});

it("lists members by Identity, recovers Owner devices and protects personal profiles", async () => {
  const owner = await actor(),
    peer = await actor(),
    recovered = await actor(),
    space = await workspace(owner),
    root = await page(owner, space.id);
  const identity = await join(owner, peer, space.id, root.id);
  expect(
    (await request("GET", `/workspaces/${space.id}/members`, peer)).statusCode,
  ).toBe(403);
  expect(
    (
      await request("POST", "/workspaces/recover", recovered, {
        key: space.key,
      })
    ).statusCode,
  ).toBe(200);
  const result = await members(owner, space.id);
  expect(result.ownIdentityId).toBe(space.ownerIdentityId);
  expect(result.members.find((m) => m.owner)?.devices).toHaveLength(2);
  const rename = { ...operation(), name: "Reviewer" };
  expect(
    (await request("PATCH", `/workspaces/${space.id}/profile`, peer, rename))
      .statusCode,
  ).toBe(200);
  expect(
    (await request("PATCH", `/workspaces/${space.id}/profile`, peer, rename))
      .statusCode,
  ).toBe(200);
  expect(
    (await request("GET", `/workspaces/${space.id}/profile`, peer)).json(),
  ).toMatchObject({ id: identity.id, name: "Reviewer", role: "member" });
  expect(
    (
      await request("PATCH", `/workspaces/${space.id}/profile`, peer, {
        ...rename,
        name: "Other",
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request("PATCH", `/workspaces/${space.id}/profile`, peer, {
        ...operation(),
        name: "Fake",
        identityId: space.ownerIdentityId,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request(
        "DELETE",
        `/workspaces/${space.id}/members/${space.ownerIdentityId}`,
        owner,
        operation(),
      )
    ).statusCode,
  ).toBe(400);
});

it("serializes concurrent group retries and rejects conflicts, foreign members and capacity", async () => {
  const owner = await actor(),
    peer = await actor(),
    space = await workspace(owner),
    foreign = await workspace(owner),
    root = await page(owner, space.id),
    otherPage = await page(owner, foreign.id);
  const identity = await join(owner, peer, space.id, root.id);
  const foreignIdentity = await join(owner, peer, foreign.id, otherPage.id);
  const id = crypto.randomUUID(),
    path = `/workspaces/${space.id}/member-groups/${id}`,
    input = groupInput([identity.id, space.ownerIdentityId]);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => request("PUT", path, owner, input)),
  );
  expect(responses.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
  expect(responses[0]?.json()).toEqual({ id, revision: 1 });
  expect((await members(owner, space.id)).groups).toHaveLength(1);
  expect(
    (
      await request("PUT", path, owner, {
        ...input,
        memberIds: [...input.memberIds].reverse(),
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await request("PUT", path, owner, { ...input, name: "Changed" }))
      .statusCode,
  ).toBe(409);
  expect(
    (await request("PUT", path, owner, groupInput([identity.id]))).statusCode,
  ).toBe(409);
  expect(
    (await request("PUT", path, owner, groupInput([foreignIdentity.id], 1)))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await request(
        "PUT",
        path,
        owner,
        groupInput([identity.id, identity.id], 1),
      )
    ).statusCode,
  ).toBe(400);
  expect((await request("PUT", path, peer, groupInput([], 1))).statusCode).toBe(
    403,
  );
  expect(
    (
      await request(
        "PUT",
        `/workspaces/${foreign.id}/member-groups/${id}`,
        owner,
        groupInput([]),
      )
    ).statusCode,
  ).toBe(409);
  const capacity = vi
    .spyOn(repository.documents, "assertCapacity")
    .mockRejectedValue(new Error("capacity fixture"));
  try {
    expect((await request("PUT", path, owner, input)).statusCode).toBe(200);
    expect(
      (
        await request(
          "PUT",
          `/workspaces/${space.id}/member-groups/${crypto.randomUUID()}`,
          owner,
          groupInput([]),
        )
      ).statusCode,
    ).toBe(500);
  } finally {
    capacity.mockRestore();
  }
  const empty = groupInput([], 1);
  expect((await request("PUT", path, owner, empty)).json()).toEqual({
    id,
    revision: 2,
  });
  expect(
    (
      await request("DELETE", path, owner, {
        ...operation(),
        expectedRevision: 1,
      })
    ).statusCode,
  ).toBe(409);
  const remove = { ...operation(), expectedRevision: 2 };
  expect((await request("DELETE", path, owner, remove)).statusCode).toBe(200);
  expect((await request("DELETE", path, owner, remove)).statusCode).toBe(200);
  expect(
    (await request("PUT", path, owner, groupInput([], 3))).statusCode,
  ).toBe(409);
  await repository.database.execute(
    sql`INSERT INTO member_groups(id,workspace_id,name) SELECT gen_random_uuid(),${space.id}::uuid,'Limit' FROM generate_series(1,100)`,
  );
  expect(
    (
      await request(
        "PUT",
        `/workspaces/${space.id}/member-groups/${crypto.randomUUID()}`,
        owner,
        groupInput([]),
      )
    ).statusCode,
  ).toBe(409);
});

it("applies dynamic group access, descendant scope and strongest Role with individual grants", async () => {
  const owner = await actor(),
    peer = await actor(),
    space = await workspace(owner),
    root = await page(owner, space.id),
    child = await page(owner, space.id, root.id),
    privatePage = await page(owner, space.id);
  const identity = await join(owner, peer, space.id, privatePage.id);
  const groupId = crypto.randomUUID(),
    groupPath = `/workspaces/${space.id}/member-groups/${groupId}`;
  expect(
    (await request("PUT", groupPath, owner, groupInput([identity.id])))
      .statusCode,
  ).toBe(200);
  const grant = {
    ...operation(),
    id: crypto.randomUUID(),
    groupId,
    pageId: root.id,
    role: "commenter",
    includeDescendants: false,
    expectedRevision: 0,
  };
  const path = `/workspaces/${space.id}/group-access`;
  expect((await request("PUT", path, owner, grant)).statusCode).toBe(200);
  expect((await request("PUT", path, owner, grant)).statusCode).toBe(200);
  expect((await request("GET", `/documents/${root.id}`, peer)).statusCode).toBe(
    200,
  );
  expect(
    (await request("GET", `/documents/${child.id}`, peer)).statusCode,
  ).toBe(403);
  expect(
    (
      await request("POST", "/comments", peer, {
        id: crypto.randomUUID(),
        pageId: root.id,
        parentId: null,
        body: "Allowed comment",
      })
    ).statusCode,
  ).toBe(200);
  const document = new Y.Doc();
  document.getText("title").insert(0, "Group edit");
  const update = {
    ...operation(),
    update: bytesToBase64(Y.encodeStateAsUpdate(document)),
  };
  document.destroy();
  expect(
    (await request("POST", `/documents/${root.id}/commit`, peer, update))
      .statusCode,
  ).toBe(403);
  const stronger = {
    ...grant,
    ...operation(),
    role: "editor",
    includeDescendants: true,
    expectedRevision: 1,
  };
  expect((await request("PUT", path, owner, stronger)).statusCode).toBe(200);
  expect(
    (await request("PUT", path, owner, { ...grant, ...operation() }))
      .statusCode,
  ).toBe(409);
  expect(
    (await request("GET", `/documents/${child.id}`, peer)).statusCode,
  ).toBe(200);
  expect(
    (await request("POST", `/documents/${root.id}/commit`, peer, update))
      .statusCode,
  ).toBe(200);
  await join(owner, peer, space.id, root.id, "viewer");
  expect(
    (await request("PUT", groupPath, owner, groupInput([], 1))).statusCode,
  ).toBe(200);
  const metadata = (await request("GET", "/metadata", peer)).json<{
    roles: Record<string, Role>;
  }>();
  expect(metadata.roles[root.id]).toBe("viewer");
  expect(metadata.roles[child.id]).toBeUndefined();
  expect(
    (
      await request("POST", `/documents/${root.id}/commit`, peer, {
        ...update,
        ...operation(),
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await request("PUT", groupPath, owner, groupInput([identity.id], 2)))
      .statusCode,
  ).toBe(200);
  expect(
    (await request("GET", "/metadata", peer)).json<{
      roles: Record<string, Role>;
    }>().roles[root.id],
  ).toBe("editor");
  const remove = { ...operation(), expectedRevision: 2 };
  expect(
    (await request("DELETE", `${path}/${grant.id}`, owner, remove)).statusCode,
  ).toBe(200);
  expect(
    (await request("DELETE", `${path}/${grant.id}`, owner, remove)).statusCode,
  ).toBe(200);
  expect(
    (await request("GET", "/metadata", peer)).json<{
      roles: Record<string, Role>;
    }>().roles[root.id],
  ).toBe("viewer");
});

it("edits individual grants and removes a Member without deleting comments or Owner access", async () => {
  const owner = await actor(),
    peer = await actor(),
    recovered = await actor(),
    space = await workspace(owner),
    root = await page(owner, space.id);
  const identity = await join(owner, peer, space.id, root.id);
  const groupId = crypto.randomUUID();
  await request(
    "PUT",
    `/workspaces/${space.id}/member-groups/${groupId}`,
    owner,
    groupInput([identity.id]),
  );
  const grant = (await members(owner, space.id)).members.find(
    (m) => m.id === identity.id,
  )!.grants[0]!;
  const path = `/workspaces/${space.id}/members/${identity.id}/grants/${grant.id}`;
  const change = {
    ...operation(),
    role: "editor",
    includeDescendants: true,
    expectedRevision: 0,
  };
  expect((await request("PATCH", path, owner, change)).statusCode).toBe(200);
  expect((await request("PATCH", path, owner, change)).statusCode).toBe(200);
  expect(
    (await request("PATCH", path, owner, { ...change, ...operation() }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await request("POST", "/workspaces/recover", recovered, {
        key: space.key,
      })
    ).statusCode,
  ).toBe(200);
  expect((await request("PATCH", path, recovered, change)).statusCode).toBe(
    409,
  );
  const commentId = crypto.randomUUID();
  expect(
    (
      await request("POST", "/comments", peer, {
        id: commentId,
        pageId: root.id,
        parentId: null,
        body: "Keep this author",
      })
    ).statusCode,
  ).toBe(200);
  const remove = operation(),
    removePath = `/workspaces/${space.id}/members/${identity.id}`;
  expect((await request("DELETE", removePath, owner, remove)).statusCode).toBe(
    200,
  );
  expect((await request("DELETE", removePath, owner, remove)).statusCode).toBe(
    200,
  );
  expect((await request("GET", `/documents/${root.id}`, peer)).statusCode).toBe(
    403,
  );
  expect(
    (await request("GET", `/workspaces/${space.id}/profile`, peer)).statusCode,
  ).toBe(403);
  const remaining = await members(recovered, space.id),
    removed = remaining.members.find((m) => m.id === identity.id)!;
  expect(removed.revoked).toBe(true);
  expect(removed.grants.every((g) => g.revoked)).toBe(true);
  expect(remaining.groups[0]?.memberIds).toEqual([]);
  expect(remaining.groups[0]?.revision).toBe(2);
  expect(
    (await request("GET", `/pages/${root.id}/comments`, owner)).json(),
  ).toMatchObject([{ id: commentId, body: "Keep this author" }]);
  expect(
    (
      await request(
        "PUT",
        `/workspaces/${space.id}/member-groups/${groupId}`,
        owner,
        groupInput([identity.id], 2),
      )
    ).statusCode,
  ).toBe(400);
  const rejoined = await join(owner, peer, space.id, root.id);
  expect(rejoined.id).not.toBe(identity.id);
  const revoke = { ...operation(), expectedRevision: 2 };
  expect((await request("DELETE", path, owner, revoke)).statusCode).toBe(200);
  expect((await request("DELETE", path, owner, revoke)).statusCode).toBe(200);
  expect(
    (
      await request("PATCH", path, owner, {
        ...change,
        ...operation(),
        expectedRevision: 3,
      })
    ).statusCode,
  ).toBe(409);
});

it("rejects cross-workspace group access and reserves shared IDs across targets", async () => {
  const owner = await actor(),
    space = await workspace(owner),
    foreign = await workspace(owner),
    root = await page(owner, space.id),
    other = await page(owner, foreign.id);
  const groupId = crypto.randomUUID(),
    foreignGroup = crypto.randomUUID();
  await request(
    "PUT",
    `/workspaces/${space.id}/member-groups/${groupId}`,
    owner,
    groupInput([]),
  );
  await request(
    "PUT",
    `/workspaces/${foreign.id}/member-groups/${foreignGroup}`,
    owner,
    groupInput([]),
  );
  const access = {
    ...operation(),
    id: crypto.randomUUID(),
    pageId: root.id,
    groupId,
    role: "viewer",
    includeDescendants: false,
    expectedRevision: 0,
  };
  const path = `/workspaces/${space.id}/group-access`;
  expect(
    (await request("PUT", path, owner, { ...access, pageId: other.id }))
      .statusCode,
  ).toBe(400);
  expect(
    (await request("PUT", path, owner, { ...access, groupId: foreignGroup }))
      .statusCode,
  ).toBe(404);
  expect((await request("PUT", path, owner, access)).statusCode).toBe(200);
  expect(
    (
      await request("PUT", `/workspaces/${foreign.id}/group-access`, owner, {
        ...access,
        ...operation(),
        pageId: other.id,
        groupId: foreignGroup,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request("PUT", path, owner, {
        ...access,
        ...operation(),
        id: crypto.randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request(
        "DELETE",
        `/workspaces/${foreign.id}/group-access/${access.id}`,
        owner,
        { ...operation(), expectedRevision: 1 },
      )
    ).statusCode,
  ).toBe(404);
  const removal = { ...operation(), expectedRevision: 1 };
  expect(
    (
      await request(
        "DELETE",
        `/workspaces/${space.id}/member-groups/${groupId}`,
        owner,
        removal,
      )
    ).statusCode,
  ).toBe(200);
  expect((await members(owner, space.id)).groupGrants).toEqual([]);
});
