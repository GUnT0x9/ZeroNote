import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createApp } from "./app";
import { sql } from "drizzle-orm";
import { Repository } from "./database/repository";
import { env } from "./env";
import { bytesToBase64, createRecoveryKey, sha256Hex } from "@zeronote/shared";
import * as Y from "yjs";
import type { FastifyInstance } from "fastify";
import { EDITOR_PROTOCOL, EDITOR_PROTOCOL_HEADER } from "@zeronote/shared";

let app: FastifyInstance, repository: Repository;
const TEST_SERVER_STARTUP_TIMEOUT_MS = 30_000;
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
  editorProtocol = EDITOR_PROTOCOL,
) {
  return app.inject({
    method,
    url,
    payload: payload === undefined ? undefined : JSON.stringify(payload),
    headers: {
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      origin: env.WEB_ORIGIN,
      cookie,
      [EDITOR_PROTOCOL_HEADER]: String(editorProtocol),
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
}, TEST_SERVER_STARTUP_TIMEOUT_MS);
afterAll(async () => {
  for (const id of created) await repository.deleteWorkspace(id);
  await app.close();
});

describe("Workspace storage and permanent file cleanup", () => {
  it("lists files for the Owner and purges unused bytes idempotently without replay resurrection", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id);
    const input = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "unused.txt",
      data: "eA==",
    };
    const uploadPath = `/v1/pages/${target.id}/attachments`,
      purgePath = `/v1/workspaces/${space.id}/attachments/${input.id}/content`;
    expect(
      (await request("POST", uploadPath, input, owner.cookie)).statusCode,
    ).toBe(200);
    const usage = (
      await request(
        "GET",
        `/v1/workspaces/${space.id}/attachments/storage`,
        undefined,
        owner.cookie,
      )
    ).json();
    expect(usage).toMatchObject({
      bytes: 1,
      count: 1,
      files: [{ id: input.id, name: input.name, pageTitle: "Private" }],
    });
    expect(
      (await request("DELETE", purgePath, { name: "wrong.txt" }, owner.cookie))
        .statusCode,
    ).toBe(400);
    for (let retry = 0; retry < 2; retry++)
      expect(
        (
          await request("DELETE", purgePath, { name: input.name }, owner.cookie)
        ).json(),
      ).toEqual({ id: input.id, purged: true });
    expect(await repository.attachments.storage(space.id)).toMatchObject({
      bytes: 0,
      count: 0,
      files: [],
    });
    expect(
      (
        await request(
          "GET",
          `/v1/attachments/${input.id}`,
          undefined,
          owner.cookie,
        )
      ).statusCode,
    ).toBe(410);
    expect(
      (await request("POST", uploadPath, input, owner.cookie)).statusCode,
    ).toBe(410);
    expect(
      (
        await request(
          "POST",
          uploadPath,
          { ...input, data: "eQ==" },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      await repository.query(
        sql`SELECT operation_id FROM attachment_operations WHERE operation_id=${input.operationId}`,
      ),
    ).toHaveLength(1);
    const doc = new Y.Doc(),
      node = new Y.XmlElement("attachment");
    node.setAttribute("attachmentId", input.id);
    doc.getXmlFragment("content").insert(0, [node]);
    expect(
      (
        await request(
          "POST",
          `/v1/documents/${target.id}/commit`,
          {
            operationId: crypto.randomUUID(),
            update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(422);
    doc.destroy();
  });
  it("retains files in current or Trash content and Snapshots and permits cleanup after references are removed", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id);
    const input = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "protected.txt",
      data: "eA==",
    };
    await request(
      "POST",
      `/v1/pages/${target.id}/attachments`,
      input,
      owner.cookie,
    );
    const doc = new Y.Doc(),
      node = new Y.XmlElement("attachment");
    node.setAttribute("attachmentId", input.id);
    doc.getXmlFragment("content").insert(0, [node]);
    const commit = () =>
      request(
        "POST",
        `/v1/documents/${target.id}/commit`,
        {
          operationId: crypto.randomUUID(),
          update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
        },
        owner.cookie,
      );
    const purge = () =>
      request(
        "DELETE",
        `/v1/workspaces/${space.id}/attachments/${input.id}/content`,
        { name: input.name },
        owner.cookie,
      );
    expect((await commit()).statusCode).toBe(200);
    const snapshot = (
      await request(
        "POST",
        `/v1/pages/${target.id}/snapshots`,
        { operationId: crypto.randomUUID(), name: "Keep bytes" },
        owner.cookie,
      )
    ).json<{ id: string }>();
    expect((await purge()).statusCode).toBe(409);
    const revision = (await repository.getPage(target.id))!.revision;
    await request(
      "POST",
      "/v1/sync/page",
      {
        operationId: crypto.randomUUID(),
        workspaceId: space.id,
        pageId: target.id,
        expectedRevision: revision,
        action: "trash",
      },
      owner.cookie,
    );
    expect((await purge()).statusCode).toBe(409);
    const trashed = (await repository.getPage(target.id))!;
    await request(
      "POST",
      "/v1/sync/page",
      {
        operationId: crypto.randomUUID(),
        workspaceId: space.id,
        pageId: target.id,
        expectedRevision: trashed.revision,
        action: "restore",
      },
      owner.cookie,
    );
    doc.getXmlFragment("content").delete(0, 1);
    expect((await commit()).statusCode).toBe(200);
    await repository.database.execute(
      sql`DELETE FROM document_snapshots WHERE page_id=${target.id} AND kind='automatic'`,
    );
    expect((await purge()).statusCode).toBe(409);
    expect(
      (
        await request(
          "GET",
          `/v1/attachments/${input.id}/content`,
          undefined,
          owner.cookie,
        )
      ).body,
    ).toBe("x");
    await request(
      "DELETE",
      `/v1/snapshots/${snapshot.id}`,
      undefined,
      owner.cookie,
    );
    expect((await purge()).statusCode).toBe(200);
    doc.destroy();
  });
  it("denies Editor/Viewer/stranger cleanup, cross-Workspace IDs and foreign or missing document file references", async () => {
    const owner = await actor(),
      stranger = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id),
      other = await page(owner, space.id);
    const input = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "private.txt",
      data: "eA==",
    };
    await request(
      "POST",
      `/v1/pages/${target.id}/attachments`,
      input,
      owner.cookie,
    );
    const path = `/v1/workspaces/${space.id}/attachments/${input.id}/content`;
    expect(
      (await request("DELETE", path, { name: input.name }, stranger.cookie))
        .statusCode,
    ).toBe(403);
    for (const role of ["editor", "viewer"]) {
      const person = await actor(),
        invitation = await invite(owner, target.id, role);
      await request(
        "POST",
        `/v1/invites/${invitation.id}/redeem`,
        { secret: invitation.secret },
        person.cookie,
      );
      expect(
        (await request("DELETE", path, { name: input.name }, person.cookie))
          .statusCode,
      ).toBe(403);
    }
    const another = await workspace(owner);
    expect(
      (
        await request(
          "DELETE",
          `/v1/workspaces/${another.id}/attachments/${input.id}/content`,
          { name: input.name },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(404);
    for (const id of [input.id, crypto.randomUUID()]) {
      const doc = new Y.Doc(),
        node = new Y.XmlElement("attachment");
      node.setAttribute("attachmentId", id);
      doc.getXmlFragment("content").insert(0, [node]);
      expect(
        (
          await request(
            "POST",
            `/v1/documents/${other.id}/commit`,
            {
              operationId: crypto.randomUUID(),
              update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
            },
            owner.cookie,
          )
        ).statusCode,
      ).toBe(422);
      doc.destroy();
    }
    expect(
      (
        await request(
          "GET",
          `/v1/attachments/${input.id}/content`,
          undefined,
          owner.cookie,
        )
      ).body,
    ).toBe("x");
  });
});
