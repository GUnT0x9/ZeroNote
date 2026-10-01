import { beforeAll, afterAll, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { sql } from "drizzle-orm";
import {
  bytesToBase64,
  base64ToBytes,
  createRecoveryKey,
  sha256Hex,
  MAX_DOCUMENT_BYTES,
} from "@zeronote/shared";
import { createApp } from "./app";
import { Repository } from "./database/repository";
import { env } from "./env";
let system: Awaited<ReturnType<typeof createApp>>;
const workspaceIds: string[] = [];
const originalGate = env.BETA_REQUIRED;
async function call(
  url: string,
  cookie = "",
  method: "GET" | "POST" | "DELETE" = "GET",
  payload?: unknown,
) {
  return system.app.inject({
    url,
    method,
    headers: {
      origin: env.WEB_ORIGIN,
      cookie,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}
async function actor() {
  const id = crypto.randomUUID();
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  await call("/v1/devices", "", "POST", {
    id,
    name: "Beta tester",
    publicKey: await crypto.subtle.exportKey("jwk", keys.publicKey),
  });
  const challenge = (
    await call("/v1/auth/challenge", "", "POST", { deviceId: id })
  ).json<{ id: string; nonce: string }>();
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    new TextEncoder().encode(challenge.nonce),
  );
  const verified = await call("/v1/auth/verify", "", "POST", {
    challengeId: challenge.id,
    signature: bytesToBase64(new Uint8Array(signature)),
  });
  expect(verified.statusCode).toBe(200);
  return { id, cookie: String(verified.headers["set-cookie"]).split(";")[0]! };
}
async function issue(expired = false) {
  const code = `ZNB1-${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
  await system.repository.beta.issue(
    crypto.randomUUID(),
    await sha256Hex(code),
    new Date(Date.now() + (expired ? -1000 : 60_000)),
  );
  return code;
}
async function owner() {
  const device = await actor();
  expect(
    (
      await call("/v1/beta/redeem", device.cookie, "POST", {
        code: await issue(),
      })
    ).statusCode,
  ).toBe(200);
  return device;
}
async function workspace(cookie: string) {
  const key = createRecoveryKey(),
    id = crypto.randomUUID();
  const payload = {
    id,
    name: "Beta workspace",
    ownerIdentityId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    recoveryHash: await sha256Hex(key),
  };
  const result = await call("/v1/workspaces", cookie, "POST", payload);
  if (result.statusCode === 200) workspaceIds.push(id);
  return { id, key, result, payload };
}
async function page(cookie: string, workspaceId: string, kind = "document") {
  const value = {
    id: crypto.randomUUID(),
    workspaceId,
    parentId: null,
    kind,
    title: "Original",
    revision: 0,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    isInbox: false,
  };
  const result = await call("/v1/sync/page", cookie, "POST", {
    operationId: crypto.randomUUID(),
    workspaceId,
    pageId: value.id,
    expectedRevision: 0,
    action: "create",
    page: value,
  });
  expect(result.statusCode).toBe(200);
  return value;
}
async function commit(
  cookie: string,
  pageId: string,
  document: Y.Doc,
  operationId = crypto.randomUUID(),
) {
  return call(`/v1/documents/${pageId}/commit`, cookie, "POST", {
    operationId,
    update: bytesToBase64(Y.encodeStateAsUpdate(document)),
  });
}
beforeAll(async () => {
  env.BETA_REQUIRED = true;
  system = await createApp(new Repository(env.DATABASE_URL), false);
});
afterAll(async () => {
  env.BETA_REQUIRED = originalGate;
  for (const id of workspaceIds) await system.repository.deleteWorkspace(id);
  await system.app.close();
});
it("requires admission and atomically redeems a one-use code with stable retries", async () => {
  const a = await actor(),
    b = await actor(),
    code = await issue();
  expect((await workspace(a.cookie)).result.statusCode).toBe(403);
  expect((await call("/v1/beta/status")).statusCode).toBe(401);
  const contenders = await Promise.all([
    call("/v1/beta/redeem", a.cookie, "POST", { code }),
    call("/v1/beta/redeem", b.cookie, "POST", { code }),
  ]);
  expect(contenders.map((r) => r.statusCode).sort()).toEqual([200, 410]);
  const winner = contenders[0]!.statusCode === 200 ? a : b;
  expect(
    (await call("/v1/beta/redeem", winner.cookie, "POST", { code })).statusCode,
  ).toBe(200);
  expect(
    (
      await call("/v1/beta/redeem", b.cookie, "POST", {
        code: await issue(true),
      })
    ).statusCode,
  ).toBe(410);
  expect(
    (
      await call("/v1/beta/redeem", winner.cookie, "POST", {
        code: await issue(),
      })
    ).statusCode,
  ).toBe(409);
});
it("limits workspaces across recovered owner devices and preserves page-invite entry", async () => {
  const a = await owner(),
    b = await actor(),
    collaborator = await actor();
  const ws = await workspace(a.cookie);
  expect(ws.result.statusCode).toBe(200);
  expect(
    (await call("/v1/workspaces", a.cookie, "POST", ws.payload)).statusCode,
  ).toBe(200);
  expect(
    (await call("/v1/workspaces/recover", b.cookie, "POST", { key: ws.key }))
      .statusCode,
  ).toBe(200);
  expect((await call("/v1/beta/status", b.cookie)).json()).toMatchObject({
    approved: true,
    workspaceCount: 1,
  });
  const nextId = crypto.randomUUID();
  const payload = {
    ...ws.payload,
    id: nextId,
    ownerIdentityId: crypto.randomUUID(),
    recoveryHash: await sha256Hex(createRecoveryKey()),
  };
  const creates = await Promise.all([
    call("/v1/workspaces", b.cookie, "POST", payload),
    call("/v1/workspaces", b.cookie, "POST", payload),
  ]);
  expect(creates.map((result) => result.statusCode)).toEqual([200, 200]);
  workspaceIds.push(nextId);
  await workspace(a.cookie);
  expect((await workspace(b.cookie)).result.statusCode).toBe(409);
  const root = await page(a.cookie, ws.id);
  const link = (
    await call("/v1/invites", a.cookie, "POST", {
      pageId: root.id,
      role: "viewer",
    })
  ).json<{ id: string; secret: string }>();
  expect(
    (
      await call(`/v1/invites/${link.id}/redeem`, collaborator.cookie, "POST", {
        secret: link.secret,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call(`/v1/documents/${root.id}`, collaborator.cookie)).statusCode,
  ).toBe(200);
  expect(
    (await call("/v1/beta/status", collaborator.cookie)).json(),
  ).toMatchObject({ approved: false });
});
it("creates immutable manual/daily snapshots and restores private fresh task copies from Trash", async () => {
  const a = await owner(),
    b = await actor(),
    ws = await workspace(a.cookie),
    root = await page(a.cookie, ws.id, "database");
  const document = new Y.Doc();
  document.getText("title").insert(0, "Project");
  const { createTaskRow } = await import("@zeronote/shared");
  const rowId = createTaskRow(document, "Task");
  const element = new Y.XmlElement("pageMention");
  element.setAttribute("pageId", root.id);
  document.getXmlFragment("content").insert(0, [element]);
  const taskBody = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, "Task body");
  taskBody.insert(0, [text]);
  document.getXmlFragment(`task:${rowId}`).insert(0, [taskBody]);
  expect((await commit(a.cookie, root.id, document)).statusCode).toBe(200);
  const operationId = crypto.randomUUID();
  const snapshot = (
    await call(`/v1/pages/${root.id}/snapshots`, a.cookie, "POST", {
      operationId,
      name: "Before change",
    })
  ).json<{ id: string }>();
  expect(
    (
      await call(`/v1/pages/${root.id}/snapshots`, a.cookie, "POST", {
        operationId,
        name: "Before change",
      })
    ).json(),
  ).toMatchObject(snapshot);
  document.getText("title").insert(0, "Edited ");
  await commit(a.cookie, root.id, document);
  const list = (await call(`/v1/pages/${root.id}/snapshots`, a.cookie)).json<
    { kind: string }[]
  >();
  expect(list.filter((s) => s.kind === "automatic")).toHaveLength(1);
  const link = (
    await call("/v1/invites", a.cookie, "POST", {
      pageId: root.id,
      role: "editor",
    })
  ).json<{ id: string; secret: string }>();
  await call(`/v1/invites/${link.id}/redeem`, b.cookie, "POST", {
    secret: link.secret,
  });
  expect(
    (await call(`/v1/snapshots/${snapshot.id}`, b.cookie)).statusCode,
  ).toBe(403);
  await call("/v1/sync/page", a.cookie, "POST", {
    operationId: crypto.randomUUID(),
    workspaceId: ws.id,
    pageId: root.id,
    expectedRevision: 0,
    action: "trash",
  });
  const restoreOperationId = crypto.randomUUID();
  const recovered = (
    await call(`/v1/snapshots/${snapshot.id}/restore-copy`, a.cookie, "POST", {
      operationId: restoreOperationId,
    })
  ).json<{ id: string; parentId: null }>();
  expect(recovered.id).not.toBe(root.id);
  expect(recovered.parentId).toBeNull();
  expect(
    (
      await call(
        `/v1/snapshots/${snapshot.id}/restore-copy`,
        a.cookie,
        "POST",
        { operationId: restoreOperationId },
      )
    ).json(),
  ).toEqual(recovered);
  expect(
    (await call(`/v1/documents/${recovered.id}`, b.cookie)).statusCode,
  ).toBe(403);
  const restored = new Y.Doc();
  Y.applyUpdate(
    restored,
    base64ToBytes(
      (await call(`/v1/documents/${recovered.id}`, a.cookie)).json<{
        update: string;
      }>().update,
    ),
  );
  expect(restored.getText("title").toString()).toMatch(/^Project \(복구/);
  expect(restored.getXmlFragment(`task:${rowId}`).toString()).toContain(
    "Task body",
  );
  expect(
    (restored.getXmlFragment("content").get(0) as Y.XmlElement).getAttribute(
      "pageId",
    ),
  ).toBe(recovered.id);
  expect(await system.repository.listPageGrants(recovered.id)).toHaveLength(0);
  expect((await system.repository.getPage(root.id))?.deletedAt).not.toBeNull();
  document.destroy();
  restored.destroy();
});
it("enforces manual retention, deletes snapshots and rejects unsupported versions", async () => {
  const a = await owner(),
    ws = await workspace(a.cookie),
    root = await page(a.cookie, ws.id);
  const staleId = crypto.randomUUID();
  await system.repository.database.execute(
    sql`INSERT INTO document_snapshots(id,page_id,kind,data,automatic_day) VALUES(${staleId},${root.id},'automatic',${Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()))},(now() AT TIME ZONE 'UTC')::date-7)`,
  );
  expect((await call(`/v1/snapshots/${staleId}`, a.cookie)).statusCode).toBe(
    404,
  );
  expect(
    (await call(`/v1/pages/${root.id}/snapshots`, a.cookie)).json(),
  ).toEqual([]);
  expect(
    await system.repository.query(
      sql`SELECT id FROM document_snapshots WHERE id=${staleId}`,
    ),
  ).toHaveLength(0);
  let first = "";
  for (let i = 0; i < 3; i++) {
    const result = await call(
      `/v1/pages/${root.id}/snapshots`,
      a.cookie,
      "POST",
      { operationId: crypto.randomUUID() },
    );
    expect(result.statusCode).toBe(200);
    first = result.json<{ id: string }>().id;
  }
  expect(
    (
      await call(`/v1/pages/${root.id}/snapshots`, a.cookie, "POST", {
        operationId: crypto.randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  await system.repository.database.execute(
    sql`UPDATE document_snapshots SET schema_version=2 WHERE id=${first}`,
  );
  expect(
    (
      await call(`/v1/snapshots/${first}/restore-copy`, a.cookie, "POST", {
        operationId: crypto.randomUUID(),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await call(`/v1/snapshots/${first}`, a.cookie, "DELETE")).statusCode,
  ).toBe(200);
  expect(
    (
      await call(`/v1/pages/${root.id}/snapshots`, a.cookie, "POST", {
        operationId: crypto.randomUUID(),
      })
    ).statusCode,
  ).toBe(200);
});
it("rolls back failed checkpoints, compacts safely and detects collisions after compaction", async () => {
  const a = await owner(),
    ws = await workspace(a.cookie),
    root = await page(a.cookie, ws.id),
    doc = new Y.Doc();
  doc.getText("title").insert(0, "Committed");
  const operationId = crypto.randomUUID();
  const failure = vi
    .spyOn(system.repository.documents, "writeCheckpoint")
    .mockRejectedValueOnce(new Error("checkpoint failure"));
  expect((await commit(a.cookie, root.id, doc, operationId)).statusCode).toBe(
    500,
  );
  failure.mockRestore();
  expect(await system.repository.loadDocument(root.id)).toHaveLength(0);
  expect((await commit(a.cookie, root.id, doc, operationId)).statusCode).toBe(
    200,
  );
  expect(
    await system.repository.query(
      sql`SELECT id FROM document_updates WHERE page_id=${root.id}`,
    ),
  ).toHaveLength(0);
  expect((await commit(a.cookie, root.id, doc, operationId)).statusCode).toBe(
    200,
  );
  doc.getText("title").insert(0, "Other");
  expect((await commit(a.cookie, root.id, doc, operationId)).statusCode).toBe(
    409,
  );
  const repo = new Repository(env.DATABASE_URL);
  const updates = await repo.loadDocument(root.id);
  const loaded = new Y.Doc();
  for (const u of updates) Y.applyUpdate(loaded, u);
  expect(loaded.getText("title").toString()).toBe("Committed");
  await repo.close();
  doc.destroy();
  loaded.destroy();
});
it("rejects aggregate oversized documents and capacity exhaustion without damaging committed data", async () => {
  const a = await owner(),
    ws = await workspace(a.cookie),
    root = await page(a.cookie, ws.id),
    doc = new Y.Doc();
  doc.getText("title").insert(0, "Safe");
  expect((await commit(a.cookie, root.id, doc)).statusCode).toBe(200);
  doc.getText("huge").insert(0, "a".repeat(3 * 1024 * 1024));
  expect((await commit(a.cookie, root.id, doc)).statusCode).toBe(200);
  const vector = Y.encodeStateVector(doc);
  doc.getText("huge").insert(0, "b".repeat(3 * 1024 * 1024));
  const delta = Y.encodeStateAsUpdate(doc, vector);
  expect(delta.byteLength).toBeLessThan(MAX_DOCUMENT_BYTES);
  expect(
    (
      await call(`/v1/documents/${root.id}/commit`, a.cookie, "POST", {
        operationId: crypto.randomUUID(),
        update: bytesToBase64(delta),
      })
    ).statusCode,
  ).toBe(413);
  const blocked = vi
    .spyOn(system.repository.documents, "capacity")
    .mockResolvedValue({
      bytes: 400 * 1024 * 1024,
      blocked: true,
      warning: true,
    });
  doc.getText("huge").delete(0, doc.getText("huge").length);
  const small = new Y.Doc();
  small.getText("title").insert(0, "Small");
  expect((await commit(a.cookie, root.id, small)).statusCode).toBe(507);
  expect((await call(`/v1/documents/${root.id}`, a.cookie)).statusCode).toBe(
    200,
  );
  expect(
    (
      await call(`/v1/pages/${root.id}/snapshots`, a.cookie, "POST", {
        operationId: crypto.randomUUID(),
      })
    ).statusCode,
  ).toBe(507);
  blocked.mockRestore();
  doc.destroy();
  small.destroy();
});
