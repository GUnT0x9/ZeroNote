import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { createApp } from "./app";
import { sql } from "drizzle-orm";
import { Repository } from "./database/repository";
import { env } from "./env";
import { bytesToBase64, createRecoveryKey, sha256Hex } from "@zeronote/shared";
import * as Y from "yjs";
import { createTaskRow } from "@zeronote/shared";
import type { OwnedPublicShare, PublicContent } from "@zeronote/shared";
import { publicCookieName } from "./public-share-routes";
import type { FastifyInstance } from "fastify";
import { EDITOR_PROTOCOL, EDITOR_PROTOCOL_HEADER } from "@zeronote/shared";

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
beforeEach(async () => {
  const result = await createApp(new Repository(env.DATABASE_URL), false);
  app = result.app;
  repository = result.repository;
  await app.ready();
});
afterEach(async () => {
  for (const id of created.splice(0)) await repository.deleteWorkspace(id);
  await app.close();
});

function sharingInput(pageIds: string[], change: Record<string, unknown> = {}) {
  return {
    operationId: crypto.randomUUID(),
    title: "Published",
    pageIds,
    mode: "public",
    expiresAt: null,
    password: null,
    secret: null,
    seo: false,
    ...change,
  };
}
async function publish(
  owner: Actor,
  workspaceId: string,
  pageIds: string[],
  change: Record<string, unknown> = {},
) {
  const input = sharingInput(pageIds, change),
    result = await request(
      "POST",
      `/v1/workspaces/${workspaceId}/public-shares`,
      input,
      owner.cookie,
    );
  expect(result.statusCode, result.body).toBe(200);
  return { input, share: result.json<OwnedPublicShare>() };
}
function openInput(secret: string | null, password: string | null = null) {
  return {
    operationId: crypto.randomUUID(),
    readerSecret: crypto.randomUUID().replaceAll("-", "").repeat(2),
    secret,
    password,
  };
}
function cookieFor(response: { headers: Record<string, unknown> }): string {
  return String(response.headers["set-cookie"]).split(";")[0] ?? "";
}
async function commit(owner: Actor, pageId: string, doc: Y.Doc) {
  const result = await request(
    "POST",
    `/v1/documents/${pageId}/commit`,
    {
      operationId: crypto.randomUUID(),
      update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
    },
    owner.cookie,
  );
  expect(result.statusCode, result.body).toBe(200);
}
function docWithText(value: string) {
  const doc = new Y.Doc({ gc: false }),
    node = new Y.XmlElement("paragraph"),
    text = new Y.XmlText();
  text.insert(0, value);
  node.insert(0, [text]);
  doc.getXmlFragment("content").insert(0, [node]);
  return { doc, text };
}
describe("Public Page and explicitly selected Workspace sharing", () => {
  it("publishes current content with opaque Page keys, keeps private/new Pages out and applies Trash and revoke immediately", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      first = await page(owner, space.id),
      second = await page(owner, space.id),
      privatePage = await page(owner, space.id);
    const { doc, text } = docWithText("deleted-history");
    text.delete(0, text.length);
    text.insert(0, "Published body");
    doc.getText("title").insert(0, "Public title");
    for (const id of [second.id, privatePage.id]) {
      const mention = new Y.XmlElement("pageMention");
      mention.setAttribute("pageId", id);
      mention.setAttribute("title", "private-title");
      doc
        .getXmlFragment("content")
        .insert(doc.getXmlFragment("content").length, [mention]);
    }
    await repository.database.execute(
      sql`UPDATE pages SET kind='database' WHERE id=${second.id}`,
    );
    const tasks = new Y.Doc(),
      rowId = createTaskRow(tasks, "Visible task"),
      deletedRowId = createTaskRow(tasks, "Removed task");
    tasks
      .getMap<Y.Map<unknown>>("tasks")
      .get(deletedRowId)!
      .set("deleted", true);
    await commit(owner, second.id, tasks);
    for (const id of [rowId, deletedRowId]) {
      const link = new Y.XmlElement("taskLink");
      link.setAttribute("databaseId", second.id);
      link.setAttribute("rowId", id);
      doc
        .getXmlFragment("content")
        .insert(doc.getXmlFragment("content").length, [link]);
    }
    tasks.destroy();
    await commit(owner, first.id, doc);
    const { input, share } = await publish(
      owner,
      space.id,
      [first.id, second.id],
      { seo: true },
    );
    const read = () => request("GET", `/v1/public/${share.id}/content`);
    const body = (await read()).json<PublicContent>();
    expect(body.share.seo).toBe(true);
    expect(body.page.title).toBe("Public title");
    expect(body.page.html).toContain("Published body");
    expect(body.page.html).toContain("Visible task");
    expect(body.page.html).not.toContain(deletedRowId);
    expect(body.pages).toHaveLength(2);
    expect(body.page.key).not.toBe(first.id);
    for (const value of [
      first.id,
      privatePage.id,
      "private-title",
      "deleted-history",
      "recoveryHash",
      "ownerIdentityId",
    ])
      expect(JSON.stringify(body)).not.toContain(value);
    expect(body.page.html).toContain(`/s/${share.id}/${body.pages[1]!.key}`);
    expect(body.canonical).toBe(
      `${env.WEB_ORIGIN}/s/${share.id}/${body.page.key}`,
    );
    expect(
      (await request("GET", `/v1/public/${share.id}/content/${privatePage.id}`))
        .statusCode,
    ).toBe(410);
    await page(owner, space.id);
    expect((await read()).json<PublicContent>().pages).toHaveLength(2);
    expect(
      (
        await request(
          "POST",
          `/v1/workspaces/${space.id}/public-shares`,
          input,
          owner.cookie,
        )
      ).json().id,
    ).toBe(share.id);
    expect(
      (
        await request(
          "POST",
          `/v1/workspaces/${space.id}/public-shares`,
          { ...input, title: "Collision" },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(409);
    text.insert(text.length, " changed");
    await commit(owner, first.id, doc);
    expect((await read()).json<PublicContent>().page.html).toContain("changed");
    await repository.database.execute(
      sql`UPDATE pages SET deleted_at=now() WHERE id=${second.id}`,
    );
    expect((await read()).json<PublicContent>().pages).toHaveLength(1);
    await repository.database.execute(
      sql`UPDATE pages SET deleted_at=now() WHERE id=${first.id}`,
    );
    expect((await read()).statusCode).toBe(410);
    await repository.database.execute(
      sql`UPDATE pages SET deleted_at=NULL WHERE id=${first.id}`,
    );
    expect(
      (
        await request(
          "DELETE",
          `/v1/workspaces/${space.id}/public-shares/${share.id}`,
          undefined,
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect((await read()).statusCode).toBe(410);
    doc.destroy();
  });
  it("requires Owner rights and valid selection/Origin and never grants private REST or realtime access", async () => {
    const owner = await actor(),
      outsider = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id),
      other = await workspace(owner),
      foreign = await page(owner, other.id);
    const path = `/v1/workspaces/${space.id}/public-shares`,
      input = sharingInput([target.id]);
    expect((await request("POST", path, input)).statusCode).toBe(401);
    expect(
      (await request("POST", path, input, outsider.cookie)).statusCode,
    ).toBe(403);
    for (const role of ["editor", "viewer"]) {
      const member = await actor(),
        invitation = await invite(owner, target.id, role);
      await request(
        "POST",
        `/v1/invites/${invitation.id}/redeem`,
        { secret: invitation.secret },
        member.cookie,
      );
      expect(
        (await request("POST", path, input, member.cookie)).statusCode,
      ).toBe(403);
      expect(
        (await request("GET", path, undefined, member.cookie)).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await request(
          "POST",
          path,
          { ...input, pageIds: [foreign.id] },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(
          "POST",
          path,
          { ...input, pageIds: [target.id, target.id] },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(400);
    const { share } = await publish(owner, space.id, [target.id]);
    expect(
      (
        await request(
          "DELETE",
          `/v1/workspaces/${other.id}/public-shares/${share.id}`,
          undefined,
          owner.cookie,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/public/${share.id}/open`,
          payload: openInput(null),
          headers: { origin: "https://bad.test" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await request("GET", `/v1/documents/${target.id}`)).statusCode,
    ).toBe(401);
    expect(
      (await request("POST", `/v1/documents/${target.id}/token`)).statusCode,
    ).not.toBe(200);
  });
  it("checks hashed password, fragment Secret, read session and expiry without exposing titles before opening", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id),
      secret = "a".repeat(64),
      password = "correct password";
    const { share } = await publish(owner, space.id, [target.id], {
      password,
      secret,
    });
    expect(
      (await request("GET", `/v1/public/${share.id}`)).json(),
    ).toMatchObject({
      title: "공유 문서",
      passwordRequired: true,
      protected: true,
      seo: false,
    });
    expect(
      (await request("GET", `/v1/public/${share.id}/content`)).statusCode,
    ).toBe(401);
    const path = `/v1/public/${share.id}/open`,
      input = openInput(secret, password);
    expect(
      (await request("POST", path, { ...input, secret: "b".repeat(64) }))
        .statusCode,
    ).toBe(403);
    expect(
      (await request("POST", path, { ...input, password: "wrong" })).statusCode,
    ).toBe(403);
    const opened = await request(
        "POST",
        `/v1/public/${share.id.toUpperCase()}/open`,
        input,
      ),
      cookie = cookieFor(opened);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(cookie).toContain(publicCookieName(share.id));
    expect(String(opened.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(opened.headers["set-cookie"])).toContain("SameSite=Strict");
    expect(String(opened.headers["set-cookie"])).toContain(
      `/v1/public/${share.id}`,
    );
    expect(
      (
        await request(
          "GET",
          `/v1/public/${share.id}/content`,
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(cookieFor(await request("POST", path, input))).toBe(cookie);
    const [stored] = await repository.query<{
      secretHash: string;
      passwordHash: string;
    }>(
      sql`SELECT secret_hash AS "secretHash",password_hash AS "passwordHash" FROM public_shares WHERE id=${share.id}`,
    );
    expect(stored?.secretHash).not.toBe(secret);
    expect(stored?.passwordHash).not.toContain(password);
    await repository.database.execute(
      sql`UPDATE public_sessions SET expires_at=now()-interval '1 second' WHERE share_id=${share.id}`,
    );
    expect(
      (
        await request(
          "GET",
          `/v1/public/${share.id}/content`,
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(401);
    await request(
      "GET",
      `/v1/workspaces/${space.id}/public-shares`,
      undefined,
      owner.cookie,
    );
    expect(
      await repository.query(
        sql`SELECT token_hash FROM public_sessions WHERE share_id=${share.id}`,
      ),
    ).toHaveLength(0);
    const temporary = await publish(owner, space.id, [target.id], {
      mode: "temporary",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      secret,
    });
    expect(
      (
        await request(
          "POST",
          `/v1/public/${temporary.share.id}/open`,
          openInput(secret),
        )
      ).statusCode,
    ).toBe(200);
    await repository.database.execute(
      sql`UPDATE public_shares SET expires_at=now()-interval '1 second' WHERE id=${temporary.share.id}`,
    );
    expect(
      (await request("GET", `/v1/public/${temporary.share.id}`)).statusCode,
    ).toBe(410);
    expect(
      (
        await request(
          "POST",
          `/v1/public/${temporary.share.id}/open`,
          openInput(secret),
        )
      ).statusCode,
    ).toBe(410);
    for (const change of [
      {
        expiresAt: new Date(
          Date.now() + 91 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        secret,
      },
      { seo: true, password, secret },
      { expiresAt: new Date(Date.now() - 1000).toISOString(), secret },
      { mode: "burn", secret },
      { password },
    ])
      expect(
        (
          await request(
            "POST",
            `/v1/workspaces/${space.id}/public-shares`,
            sharingInput([target.id], change),
            owner.cookie,
          )
        ).statusCode,
      ).toBe(400);
  });
  it("admits exactly one Burn reader, retries safely, freezes live content and retains scoped files until revoke", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id),
      foreign = await page(owner, space.id);
    const file = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "public.txt",
      data: "eA==",
    };
    for (const id of [target.id, foreign.id]) {
      const response = await request(
        "POST",
        `/v1/pages/${id}/attachments`,
        {
          ...file,
          id: id === target.id ? file.id : crypto.randomUUID(),
          operationId: crypto.randomUUID(),
        },
        owner.cookie,
      );
      expect(response.statusCode).toBe(200);
    }
    const { doc, text } = docWithText("First content"),
      attachment = new Y.XmlElement("attachment");
    attachment.setAttribute("attachmentId", file.id);
    doc.getXmlFragment("content").insert(1, [attachment]);
    await commit(owner, target.id, doc);
    const secret = "c".repeat(64),
      { share } = await publish(owner, space.id, [target.id], {
        mode: "burn",
        secret,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    const path = `/v1/public/${share.id}/open`,
      first = openInput(secret),
      second = openInput(secret);
    expect((await request("GET", `/v1/public/${share.id}`)).statusCode).toBe(
      200,
    );
    const opened = await Promise.all([
      request("POST", path, first),
      request("POST", path, second),
    ]);
    expect(opened.map((result) => result.statusCode).sort()).toEqual([
      200, 410,
    ]);
    const winner = opened[0]!.statusCode === 200 ? 0 : 1,
      input = winner === 0 ? first : second,
      cookie = cookieFor(opened[winner]!);
    const read = () =>
      request("GET", `/v1/public/${share.id}/content`, undefined, cookie);
    const original = (await read()).json<PublicContent>();
    expect(original.page.html).toContain("First content");
    expect(cookieFor(await request("POST", path, input))).toBe(cookie);
    expect(
      (await request("POST", path, { ...input, readerSecret: "f".repeat(64) }))
        .statusCode,
    ).toBe(409);
    expect(
      (await request("GET", `/v1/public/${share.id}/files/${file.id}`))
        .statusCode,
    ).toBe(401);
    const download = await request(
      "GET",
      `/v1/public/${share.id}/files/${file.id}`,
      undefined,
      cookie,
    );
    expect(download.body).toBe("x");
    expect(download.headers["cache-control"]).toBe("no-store");
    const unknownFile = (await repository.attachments.list(foreign.id))[0]!;
    expect(
      (
        await request(
          "GET",
          `/v1/public/${share.id}/files/${unknownFile.id}`,
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(404);
    text.delete(0, text.length);
    text.insert(0, "Second content");
    doc.getXmlFragment("content").delete(1, 1);
    await commit(owner, target.id, doc);
    expect((await read()).json<PublicContent>().page.html).toBe(
      original.page.html,
    );
    await repository.database.execute(
      sql`DELETE FROM document_snapshots WHERE page_id=${target.id}`,
    );
    expect(
      (
        await request(
          "DELETE",
          `/v1/workspaces/${space.id}/attachments/${file.id}/content`,
          { name: file.name },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await request(
          "GET",
          `/v1/public/${share.id}/files/${file.id}`,
          undefined,
          cookie,
        )
      ).body,
    ).toBe("x");
    await request(
      "DELETE",
      `/v1/workspaces/${space.id}/public-shares/${share.id}`,
      undefined,
      owner.cookie,
    );
    expect(
      await repository.query(
        sql`SELECT token_hash FROM public_sessions WHERE share_id=${share.id}`,
      ),
    ).toHaveLength(0);
    expect((await read()).statusCode).toBe(410);
    expect(
      (
        await request(
          "GET",
          `/v1/public/${share.id}/files/${file.id}`,
          undefined,
          cookie,
        )
      ).statusCode,
    ).toBe(410);
    expect(
      (
        await request(
          "DELETE",
          `/v1/workspaces/${space.id}/attachments/${file.id}/content`,
          { name: file.name },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
    doc.destroy();
  });
  it("rejects unreferenced files and parent Trash and preserves normal live public reading without a cookie", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      parent = await page(owner, space.id),
      child = await page(owner, space.id, parent.id);
    const file = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "unreferenced.txt",
      data: "eA==",
    };
    await request(
      "POST",
      `/v1/pages/${child.id}/attachments`,
      file,
      owner.cookie,
    );
    const { share } = await publish(owner, space.id, [child.id]);
    expect(
      (await request("POST", `/v1/public/${share.id}/open`, openInput(null)))
        .statusCode,
    ).toBe(400);
    expect(
      (await request("GET", `/v1/public/${share.id}/content`)).statusCode,
    ).toBe(200);
    expect(
      (await request("GET", `/v1/public/${share.id}/files/${file.id}`))
        .statusCode,
    ).toBe(404);
    await repository.database.execute(
      sql`UPDATE pages SET deleted_at=now() WHERE id=${parent.id}`,
    );
    expect(
      (await request("GET", `/v1/public/${share.id}/content`)).statusCode,
    ).toBe(410);
    expect((await request("GET", `/v1/public/${share.id}`)).statusCode).toBe(
      410,
    );
    expect(
      (
        await request(
          "POST",
          `/v1/workspaces/${space.id}/public-shares`,
          sharingInput([child.id]),
          owner.cookie,
        )
      ).statusCode,
    ).toBe(400);
    await repository.deleteWorkspace(space.id);
    expect(
      (await request("GET", `/v1/public/${share.id}/content`)).statusCode,
    ).toBe(410);
  });
});

it("rate limits failed public opening while keeping descriptor and Owner management available", async () => {
  const owner = await actor(),
    space = await workspace(owner),
    target = await page(owner, space.id),
    secret = "d".repeat(64);
  const { share } = await publish(owner, space.id, [target.id], {
    secret,
    password: "rate password",
  });
  const path = `/v1/public/${share.id}/open`,
    input = openInput(secret, "wrong password");
  for (let attempt = 0; attempt < 10; attempt++)
    expect((await request("POST", path, input)).statusCode).toBe(403);
  expect(
    (await request("POST", path, { ...input, password: "rate password" }))
      .statusCode,
  ).toBe(429);
  expect((await request("GET", `/v1/public/${share.id}`)).statusCode).toBe(200);
  expect(
    (
      await request(
        "GET",
        `/v1/workspaces/${space.id}/public-shares`,
        undefined,
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    await repository.query(
      sql`SELECT token_hash FROM public_sessions WHERE share_id=${share.id}`,
    ),
  ).toHaveLength(0);
});
it("serializes publication at the active-link limit and preserves reading and revoke", async () => {
  const owner = await actor(),
    space = await workspace(owner),
    target = await page(owner, space.id);
  const { share } = await publish(owner, space.id, [target.id]);
  await repository.database.execute(
    sql`INSERT INTO public_shares(id,workspace_id,operation_id,payload_hash,title,mode) SELECT gen_random_uuid(),${space.id},gen_random_uuid(),'quota-fixture','Quota','public' FROM generate_series(1,98)`,
  );
  const path = `/v1/workspaces/${space.id}/public-shares`;
  const results = await Promise.all([
    request("POST", path, sharingInput([target.id]), owner.cookie),
    request("POST", path, sharingInput([target.id]), owner.cookie),
  ]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
  expect(
    (await request("GET", `/v1/public/${share.id}/content`)).statusCode,
  ).toBe(200);
  expect(
    (await request("DELETE", `${path}/${share.id}`, undefined, owner.cookie))
      .statusCode,
  ).toBe(200);
  expect(
    (await request("POST", path, sharingInput([target.id]), owner.cookie))
      .statusCode,
  ).toBe(200);
});
