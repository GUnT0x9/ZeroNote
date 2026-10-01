import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createApp } from "./app";
import { sql } from "drizzle-orm";
import { Repository } from "./database/repository";
import { env } from "./env";
import { bytesToBase64, createRecoveryKey, sha256Hex } from "@zeronote/shared";
import * as Y from "yjs";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance, repository: Repository;
const created: string[] = [];
interface Actor {
  id: string;
  cookie: string;
  keys: CryptoKeyPair;
}
async function request(
  method: "GET" | "POST" | "DELETE" | "PATCH",
  url: string,
  payload?: unknown,
  cookie = "",
) {
  return app.inject({
    method,
    url,
    payload: payload === undefined ? undefined : JSON.stringify(payload),
    headers: {
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      origin: env.WEB_ORIGIN,
      cookie,
    },
  });
}
async function actor(): Promise<Actor> {
  const id = crypto.randomUUID(),
    keys = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    ),
    publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  expect(
    (
      await request("POST", "/v1/devices", {
        id,
        name: `Device-${id.slice(0, 4)}`,
        publicKey,
      })
    ).statusCode,
  ).toBe(200);
  const challenge = (
    await request("POST", "/v1/auth/challenge", { deviceId: id })
  ).json<{ id: string; nonce: string }>();
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    new TextEncoder().encode(challenge.nonce),
  );
  const verified = await request("POST", "/v1/auth/verify", {
    challengeId: challenge.id,
    signature: bytesToBase64(new Uint8Array(signature)),
  });
  expect(verified.statusCode).toBe(200);
  return {
    id,
    keys,
    cookie: String(verified.headers["set-cookie"]).split(";")[0] ?? "",
  };
}
async function workspace(owner: Actor) {
  const id = crypto.randomUUID(),
    key = createRecoveryKey(),
    input = {
      id,
      name: "Integration",
      ownerIdentityId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      recoveryHash: await sha256Hex(key),
    };
  expect(
    (await request("POST", "/v1/workspaces", input, owner.cookie)).statusCode,
  ).toBe(200);
  created.push(id);
  return { id, key };
}
async function page(
  owner: Actor,
  workspaceId: string,
  parentId: string | null = null,
) {
  const id = crypto.randomUUID(),
    value = {
      id,
      workspaceId,
      parentId,
      kind: "document",
      title: "Private",
      revision: 0,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      isInbox: false,
    };
  const operation = {
    operationId: crypto.randomUUID(),
    workspaceId,
    pageId: id,
    expectedRevision: 0,
    action: "create",
    page: value,
  };
  expect(
    (await request("POST", "/v1/sync/page", operation, owner.cookie))
      .statusCode,
  ).toBe(200);
  return { id, value, operation };
}
async function invite(
  owner: Actor,
  pageId: string,
  role = "editor",
  includeDescendants = false,
) {
  return (
    await request(
      "POST",
      "/v1/invites",
      { pageId, role, includeDescendants },
      owner.cookie,
    )
  ).json<{ id: string; secret: string }>();
}
beforeAll(async () => {
  const result = await createApp(new Repository(env.DATABASE_URL), false);
  app = result.app;
  repository = result.repository;
  await app.ready();
});
afterAll(async () => {
  for (const id of created) await repository.deleteWorkspace(id);
  await app.close();
});

describe("Accountless API integration", () => {
  it("rejects cross-origin mutations and unauthenticated metadata", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/devices",
          headers: { origin: "https://attacker.invalid" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect((await request("GET", "/v1/metadata")).statusCode).toBe(401);
  });
  it("consumes a signed challenge exactly once", async () => {
    const device = await actor();
    const challenge = (
      await request("POST", "/v1/auth/challenge", { deviceId: device.id })
    ).json<{ id: string; nonce: string }>();
    const signature = bytesToBase64(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          device.keys.privateKey,
          new TextEncoder().encode(challenge.nonce),
        ),
      ),
    );
    expect(
      (
        await request("POST", "/v1/auth/verify", {
          challengeId: challenge.id,
          signature,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request("POST", "/v1/auth/verify", {
          challengeId: challenge.id,
          signature,
        })
      ).statusCode,
    ).toBe(401);
  });
  it("recovers owner data and rejects a wrong key", async () => {
    const owner = await actor(),
      other = await actor(),
      ws = await workspace(owner);
    await page(owner, ws.id);
    expect(
      (
        await request(
          "POST",
          "/v1/workspaces/recover",
          { key: ws.key },
          other.cookie,
        )
      ).statusCode,
    ).toBe(200);
    const meta = (
      await request("GET", "/v1/metadata", undefined, other.cookie)
    ).json<{ pages: unknown[] }>();
    expect(meta.pages).toHaveLength(1);
    expect(
      (
        await request(
          "POST",
          "/v1/workspaces/recover",
          { key: createRecoveryKey() },
          other.cookie,
        )
      ).statusCode,
    ).toBe(404);
  });
  it("deduplicates metadata and rejects cycles and stale revisions", async () => {
    const owner = await actor(),
      ws = await workspace(owner),
      root = await page(owner, ws.id),
      child = await page(owner, ws.id, root.id);
    expect(
      (await request("POST", "/v1/sync/page", root.operation, owner.cookie))
        .statusCode,
    ).toBe(200);
    const move = {
      operationId: crypto.randomUUID(),
      workspaceId: ws.id,
      pageId: root.id,
      expectedRevision: 0,
      action: "move",
      parentId: child.id,
    };
    expect(
      (await request("POST", "/v1/sync/page", move, owner.cookie)).statusCode,
    ).toBe(400);
    const trash = {
      ...move,
      operationId: crypto.randomUUID(),
      action: "trash",
    };
    delete (trash as { parentId?: string }).parentId;
    expect(
      (await request("POST", "/v1/sync/page", trash, owner.cookie)).statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          "POST",
          "/v1/sync/page",
          { ...trash, operationId: crypto.randomUUID() },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(409);
  });
  it("limits a viewer to the invited page and blocks writes", async () => {
    const owner = await actor(),
      viewer = await actor(),
      ws = await workspace(owner),
      root = await page(owner, ws.id),
      child = await page(owner, ws.id, root.id),
      link = await invite(owner, root.id, "viewer");
    expect(
      (
        await request(
          "POST",
          `/v1/invites/${link.id}/redeem`,
          { secret: link.secret },
          viewer.cookie,
        )
      ).statusCode,
    ).toBe(200);
    const metadata = (
      await request("GET", "/v1/metadata", undefined, viewer.cookie)
    ).json<{ pages: { id: string }[] }>();
    expect(metadata.pages.map((value) => value.id)).toEqual([root.id]);
    expect(
      (
        await request(
          "GET",
          `/v1/documents/${child.id}`,
          undefined,
          viewer.cookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request(
          "POST",
          `/v1/documents/${root.id}/commit`,
          {
            operationId: crypto.randomUUID(),
            update: bytesToBase64(Y.encodeStateAsUpdate(new Y.Doc())),
          },
          viewer.cookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request(
          "POST",
          "/v1/comments",
          {
            id: crypto.randomUUID(),
            pageId: root.id,
            parentId: null,
            body: "Blocked",
          },
          viewer.cookie,
        )
      ).statusCode,
    ).toBe(403);
  });
  it("permits comments but not content edits for commenters", async () => {
    const owner = await actor(),
      member = await actor(),
      ws = await workspace(owner),
      root = await page(owner, ws.id),
      link = await invite(owner, root.id, "commenter");
    await request(
      "POST",
      `/v1/invites/${link.id}/redeem`,
      { secret: link.secret },
      member.cookie,
    );
    expect(
      (
        await request(
          "POST",
          "/v1/comments",
          {
            id: crypto.randomUUID(),
            pageId: root.id,
            parentId: null,
            body: "Review",
          },
          member.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          "POST",
          `/v1/documents/${root.id}/commit`,
          { operationId: crypto.randomUUID(), update: "AAA=" },
          member.cookie,
        )
      ).statusCode,
    ).toBe(403);
  });
  it("grants a one-use invite to one contender and supports same-device retry", async () => {
    const owner = await actor(),
      a = await actor(),
      b = await actor(),
      ws = await workspace(owner),
      root = await page(owner, ws.id),
      link = await invite(owner, root.id);
    const results = await Promise.all([
      request(
        "POST",
        `/v1/invites/${link.id}/redeem`,
        { secret: link.secret },
        a.cookie,
      ),
      request(
        "POST",
        `/v1/invites/${link.id}/redeem`,
        { secret: link.secret },
        b.cookie,
      ),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 410,
    ]);
    const winner = results[0]?.statusCode === 200 ? a : b;
    expect(
      (
        await request(
          "POST",
          `/v1/invites/${link.id}/redeem`,
          { secret: link.secret },
          winner.cookie,
        )
      ).statusCode,
    ).toBe(200);
  });
  it("commits recoverable documents and deduplicates repeated commits", async () => {
    const owner = await actor(),
      ws = await workspace(owner),
      root = await page(owner, ws.id),
      document = new Y.Doc();
    document.getText("title").insert(0, "Durable title");
    const input = {
      operationId: crypto.randomUUID(),
      update: bytesToBase64(Y.encodeStateAsUpdate(document)),
    };
    expect(
      (
        await request(
          "POST",
          `/v1/documents/${root.id}/commit`,
          input,
          owner.cookie,
        )
      ).json(),
    ).toMatchObject({ durable: true });
    expect(
      (
        await request(
          "POST",
          `/v1/documents/${root.id}/commit`,
          input,
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
    const state = (
      await request("GET", `/v1/documents/${root.id}`, undefined, owner.cookie)
    ).json<{ update: string }>();
    expect(state.update.length).toBeGreaterThan(4);
    expect(
      (
        await request(
          "POST",
          `/v1/documents/${root.id}/commit`,
          { operationId: crypto.randomUUID(), update: "bad!" },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(400);
  });
  it("withholds durable acknowledgement on database failure and permits a retry", async () => {
    const owner = await actor(),
      ws = await workspace(owner),
      root = await page(owner, ws.id),
      document = new Y.Doc();
    document.getText("title").insert(0, "Retried document");
    const input = {
      operationId: crypto.randomUUID(),
      update: bytesToBase64(Y.encodeStateAsUpdate(document)),
    };
    const failed = vi
      .spyOn(repository, "appendUpdate")
      .mockRejectedValueOnce(new Error("Database unavailable"));
    try {
      const response = await request(
        "POST",
        `/v1/documents/${root.id}/commit`,
        input,
        owner.cookie,
      );
      expect(response.statusCode).toBe(500);
      expect(response.json()).not.toHaveProperty("durable");
    } finally {
      failed.mockRestore();
      document.destroy();
    }
    expect(await repository.loadDocument(root.id)).toHaveLength(0);
    const retried = await request(
      "POST",
      `/v1/documents/${root.id}/commit`,
      input,
      owner.cookie,
    );
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ durable: true });
    expect(await repository.loadDocument(root.id)).toHaveLength(1);
  });

  it("revokes granted access and prevents credential export", async () => {
    const owner = await actor(),
      member = await actor(),
      ws = await workspace(owner),
      root = await page(owner, ws.id),
      link = await invite(owner, root.id);
    await request(
      "POST",
      `/v1/invites/${link.id}/redeem`,
      { secret: link.secret },
      member.cookie,
    );
    const share = (
      await request(
        "GET",
        `/v1/pages/${root.id}/share`,
        undefined,
        owner.cookie,
      )
    ).json<{ grants: { id: string }[] }>();
    expect(
      (
        await request(
          "DELETE",
          `/v1/pages/${root.id}/grants/${share.grants[0]?.id}`,
          undefined,
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          "GET",
          `/v1/documents/${root.id}`,
          undefined,
          member.cookie,
        )
      ).statusCode,
    ).toBe(403);
    const metadata = (
      await request("GET", "/v1/metadata", undefined, owner.cookie)
    ).body;
    expect(metadata).not.toContain("recoveryHash");
    expect(metadata).not.toContain(ws.key);
  });
});

it("includes descendants only when requested and rejects expired or cancelled invitations", async () => {
  const owner = await actor(),
    member = await actor(),
    ws = await workspace(owner),
    root = await page(owner, ws.id),
    child = await page(owner, ws.id, root.id),
    link = await invite(owner, root.id, "editor", true);
  await request(
    "POST",
    `/v1/invites/${link.id}/redeem`,
    { secret: link.secret },
    member.cookie,
  );
  expect(
    (
      await request(
        "GET",
        `/v1/documents/${child.id}`,
        undefined,
        member.cookie,
      )
    ).statusCode,
  ).toBe(200);
  const expired = await invite(owner, root.id);
  await repository.database.execute(
    sql`UPDATE invites SET expires_at=now()-interval '1 second' WHERE id=${expired.id}`,
  );
  expect(
    (
      await request(
        "POST",
        `/v1/invites/${expired.id}/redeem`,
        { secret: expired.secret },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(410);
  const cancelled = await invite(owner, root.id);
  await request(
    "DELETE",
    `/v1/pages/${root.id}/invites/${cancelled.id}`,
    undefined,
    owner.cookie,
  );
  expect(
    (
      await request(
        "POST",
        `/v1/invites/${cancelled.id}/redeem`,
        { secret: cancelled.secret },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(410);
});
it("rejects revoked devices and rotates owner recovery keys", async () => {
  const owner = await actor(),
    other = await actor(),
    ws = await workspace(owner),
    root = await page(owner, ws.id);
  await request(
    "POST",
    "/v1/workspaces/recover",
    { key: ws.key },
    other.cookie,
  );
  const fresh = createRecoveryKey();
  await request(
    "POST",
    `/v1/workspaces/${ws.id}/recovery`,
    { key: fresh },
    owner.cookie,
  );
  expect(
    (
      await request(
        "POST",
        "/v1/workspaces/recover",
        { key: ws.key },
        other.cookie,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await request(
        "DELETE",
        `/v1/workspaces/${ws.id}/devices/${other.id}`,
        undefined,
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await request("GET", `/v1/documents/${root.id}`, undefined, other.cookie))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        "DELETE",
        `/v1/workspaces/${ws.id}/devices/${owner.id}`,
        undefined,
        owner.cookie,
      )
    ).statusCode,
  ).toBe(400);
});
it("rejects invalid signatures and expired challenges", async () => {
  const device = await actor(),
    challenge = (
      await request("POST", "/v1/auth/challenge", { deviceId: device.id })
    ).json<{ id: string; nonce: string }>();
  expect(
    (
      await request("POST", "/v1/auth/verify", {
        challengeId: challenge.id,
        signature: bytesToBase64(new Uint8Array(64)),
      })
    ).statusCode,
  ).toBe(401);
  await repository.database.execute(
    sql`UPDATE challenges SET expires_at=now()-interval '1 second' WHERE id=${challenge.id}`,
  );
  const signature = bytesToBase64(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        device.keys.privateKey,
        new TextEncoder().encode(challenge.nonce),
      ),
    ),
  );
  expect(
    (
      await request("POST", "/v1/auth/verify", {
        challengeId: challenge.id,
        signature,
      })
    ).statusCode,
  ).toBe(401);
});
