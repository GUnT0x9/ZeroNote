import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { createApp } from "./app";
import { sql } from "drizzle-orm";
import { Repository } from "./database/repository";
import { env } from "./env";
import { bytesToBase64, createRecoveryKey, sha256Hex } from "@zeronote/shared";
import * as Y from "yjs";
import type { FastifyInstance } from "fastify";
import {
  getAttachmentIds,
  STORAGE_LIMIT_BYTES,
  WORKSPACE_ATTACHMENT_BYTES,
  EDITOR_PROTOCOL,
  EDITOR_PROTOCOL_HEADER,
  MAX_ATTACHMENT_BYTES,
  addDatabaseProperty,
  compileFormula,
  createTaskRow,
  writeDatabaseValue,
  getTaskRows,
  getDatabaseProperties,
  readDatabaseValue,
  base64ToBytes,
  setPageTag,
  removePageTag,
  getPageTags,
  type Metadata,
  parseSearchQuery,
  getKnowledgeProjection,
  SearchResponseSchema,
  KnowledgeResponseSchema,
  getKnowledgeHead,
  updateTaskField,
} from "@zeronote/shared";

let app: FastifyInstance, repository: Repository;
const created: string[] = [];
let addressSequence = 0,
  testAddress = "2001:db8::1";
// Keep per-IP limits real within each scenario without sharing counters across independent tests.
beforeEach(() => {
  testAddress = `2001:db8::${(++addressSequence).toString(16)}`;
});
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
    remoteAddress: testAddress,
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
  kind: "document" | "database" = "document",
) {
  const id = crypto.randomUUID(),
    value = {
      id,
      workspaceId,
      parentId,
      kind,
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
it("retains independent child grants after parent revocation and does not disclose private parent deletion", async () => {
  const owner = await actor(),
    viewer = await actor(),
    ws = await workspace(owner),
    parent = await page(owner, ws.id),
    child = await page(owner, ws.id, parent.id);
  const doc = new Y.Doc();
  doc.getText("title").insert(0, "Shared child");
  const mention = new Y.XmlElement("pageMention");
  mention.setAttribute("pageId", parent.id);
  doc.getXmlFragment("content").insert(0, [mention]);
  expect(
    (
      await request(
        "POST",
        `/v1/documents/${child.id}/commit`,
        {
          operationId: crypto.randomUUID(),
          update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
        },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  for (const target of [parent, child]) {
    const invitation = await invite(owner, target.id, "viewer");
    expect(
      (
        await request(
          "POST",
          `/v1/invites/${invitation.id}/redeem`,
          { secret: invitation.secret },
          viewer.cookie,
        )
      ).statusCode,
    ).toBe(200);
  }
  const grants = (
    await request(
      "GET",
      `/v1/pages/${parent.id}/share`,
      undefined,
      owner.cookie,
    )
  ).json<{ grants: { id: string }[] }>().grants;
  expect(
    (
      await request(
        "DELETE",
        `/v1/pages/${parent.id}/grants/${grants[0]!.id}`,
        undefined,
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  const metadataResponse = await request(
    "GET",
    "/v1/metadata",
    undefined,
    viewer.cookie,
  );
  expect(metadataResponse.statusCode, metadataResponse.body).toBe(200);
  const metadata = metadataResponse.json<Metadata>();
  expect(metadata.pages.map((entry) => entry.id)).toEqual([child.id]);
  const response = await request(
    "POST",
    "/v1/knowledge",
    { pageId: child.id },
    viewer.cookie,
  );
  expect(response.statusCode).toBe(200);
  const view = KnowledgeResponseSchema.parse(response.json());
  expect(view.root?.title).toBe("Shared child");
  expect(view.issues).toEqual([
    { link: { pageId: parent.id, kind: "mention" }, status: "unverified" },
  ]);
  expect(
    (
      await request(
        "POST",
        "/v1/sync/page",
        {
          operationId: crypto.randomUUID(),
          workspaceId: ws.id,
          pageId: parent.id,
          expectedRevision: 0,
          action: "trash",
        },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await request(
        "POST",
        "/v1/knowledge",
        { pageId: parent.id },
        viewer.cookie,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        "POST",
        "/v1/knowledge",
        { pageId: child.id },
        viewer.cookie,
      )
    ).statusCode,
  ).toBe(410);
  expect(
    (
      await request(
        "GET",
        `/v1/documents/${parent.id}`,
        undefined,
        viewer.cookie,
      )
    ).statusCode,
  ).toBe(403);
  doc.destroy();
});
it("returns scoped Graph/Backlinks/related evidence and distinguishes known deletion from hidden targets", async () => {
  const owner = await actor(),
    viewer = await actor(),
    ws = await workspace(owner),
    reference = await page(owner, ws.id),
    source = await page(owner, ws.id, null, "database"),
    privateTarget = await page(owner, ws.id, null, "database"),
    docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
  const [referenceDoc, sourceDoc, privateDoc] = docs as [Y.Doc, Y.Doc, Y.Doc];
  referenceDoc.getText("title").insert(0, "Reference");
  sourceDoc.getText("title").insert(0, "Source");
  privateDoc.getText("title").insert(0, "Private target name");
  setPageTag(referenceDoc, "Knowledge");
  setPageTag(sourceDoc, "knowledge");
  const sourceRow = createTaskRow(sourceDoc, "Visible source row"),
    targetRow = createTaskRow(privateDoc, "Private Row name"),
    relation = addDatabaseProperty(
      sourceDoc,
      "Linked",
      "relation",
      [],
      crypto.randomUUID(),
      { relation: { databaseId: privateTarget.id } },
    );
  writeDatabaseValue(sourceDoc, sourceRow, relation, [targetRow]);
  const mention = new Y.XmlElement("pageMention");
  mention.setAttribute("pageId", reference.id);
  sourceDoc.getXmlFragment(`task:${sourceRow}`).insert(0, [mention]);
  const privateMention = new Y.XmlElement("pageMention");
  privateMention.setAttribute("pageId", privateTarget.id);
  sourceDoc.getXmlFragment("content").insert(0, [privateMention]);
  const paragraph = new Y.XmlElement("paragraph"),
    text = new Y.XmlText();
  paragraph.insert(0, [text]);
  text.insert(0, "😀".repeat(700) + " offline storage ");
  sourceDoc.getXmlFragment(`task:${sourceRow}`).insert(1, [paragraph]);
  const commit = async (id: string, document: Y.Doc) => {
    expect(
      (
        await request(
          "POST",
          `/v1/documents/${id}/commit`,
          {
            operationId: crypto.randomUUID(),
            update: bytesToBase64(Y.encodeStateAsUpdate(document)),
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
  };
  for (const [id, document] of [
    [reference.id, referenceDoc],
    [source.id, sourceDoc],
    [privateTarget.id, privateDoc],
  ] as const)
    await commit(id, document);
  expect((await repository.search.heads([source.id]))[0]?.head).toEqual(
    getKnowledgeHead(getKnowledgeProjection(sourceDoc)),
  );
  expect(await repository.search.heads([])).toEqual([]);
  const knowledge = async (
    cookie: string,
    pageId: string,
    overlays: unknown[] = [],
  ) => {
    const response = await request(
      "POST",
      "/v1/knowledge",
      { pageId, overlays },
      cookie,
    );
    expect(response.statusCode).toBe(200);
    return KnowledgeResponseSchema.parse(response.json());
  };
  const backlinks = await knowledge(owner.cookie, reference.id);
  expect(backlinks.incoming).toEqual([
    {
      sourceId: source.id,
      sourceTitle: "Source",
      sourceRowId: sourceRow,
      sourceRowTitle: "Visible source row",
      kind: "mention",
    },
  ]);
  expect(backlinks.related[0]?.reasons).toEqual([
    "문서 연결",
    "공통 Tag: knowledge",
  ]);
  const invitation = await invite(owner, source.id, "viewer");
  expect(
    (
      await request(
        "POST",
        `/v1/invites/${invitation.id}/redeem`,
        { secret: invitation.secret },
        viewer.cookie,
      )
    ).statusCode,
  ).toBe(200);
  const scoped = await knowledge(viewer.cookie, source.id);
  expect(scoped.nodes.map((node) => node.id)).toEqual([source.id]);
  expect(scoped.issues).toHaveLength(3);
  expect(scoped.issues.every((issue) => issue.status === "unverified")).toBe(
    true,
  );
  expect(JSON.stringify(scoped)).not.toMatch(
    /Private target name|Private Row name|Reference/,
  );
  const overlay = {
    pageId: source.id,
    projection: { ...getKnowledgeProjection(sourceDoc), links: [] },
  };
  expect(
    (await knowledge(viewer.cookie, source.id, [overlay])).issueCount,
  ).toBe(3);
  expect(
    (await knowledge(owner.cookie, source.id, [overlay])).neighborCount,
  ).toBe(0);
  expect((await knowledge(owner.cookie, source.id)).neighborCount).toBe(2);
  updateTaskField(privateDoc, targetRow, "deleted", true);
  await commit(privateTarget.id, privateDoc);
  expect((await knowledge(owner.cookie, source.id)).issues[0]?.status).toBe(
    "missing_row",
  );
  const referencedPage = await repository.getPage(reference.id);
  expect(
    (
      await request(
        "POST",
        "/v1/sync/page",
        {
          operationId: crypto.randomUUID(),
          workspaceId: ws.id,
          pageId: reference.id,
          expectedRevision: referencedPage!.revision,
          action: "trash",
        },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  const removed = await knowledge(owner.cookie, source.id);
  expect(removed.issues.map((issue) => issue.status).sort()).toEqual([
    "missing_row",
    "trashed",
  ]);
  expect(removed.nodes.map((node) => node.id)).not.toContain(reference.id);
  expect(
    (
      await request(
        "POST",
        "/v1/knowledge",
        { pageId: reference.id },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(410);
  expect(
    (
      await request(
        "POST",
        "/v1/knowledge",
        { pageId: source.id, offset: -1 },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (await request("POST", "/v1/knowledge", { pageId: source.id })).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/knowledge",
        headers: { cookie: owner.cookie, origin: "https://invalid.example" },
        payload: { pageId: source.id },
      })
    ).statusCode,
  ).toBe(403);
  const grants = (
    await request(
      "GET",
      `/v1/pages/${source.id}/share`,
      undefined,
      owner.cookie,
    )
  ).json<{ grants: { id: string }[] }>().grants;
  expect(
    (
      await request(
        "DELETE",
        `/v1/pages/${source.id}/grants/${grants[0]!.id}`,
        undefined,
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await request(
        "POST",
        "/v1/knowledge",
        { pageId: source.id },
        viewer.cookie,
      )
    ).statusCode,
  ).toBe(403);
  for (const doc of docs) doc.destroy();
});
it("searches committed unopened Pages, preserves temporary edits without writes and filters revoked/Trashed scope", async () => {
  const owner = await actor(),
    viewer = await actor(),
    outsider = await actor(),
    ws = await workspace(owner);
  const shared = await page(owner, ws.id),
    privatePage = await page(owner, ws.id),
    doc = new Y.Doc();
  doc.getText("title").insert(0, "Published note");
  const paragraph = new Y.XmlElement("paragraph"),
    text = new Y.XmlText();
  paragraph.insert(0, [text]);
  text.insert(0, "unopened-search-body <literal>");
  doc.getXmlFragment("content").insert(0, [paragraph]);
  setPageTag(doc, "Search");
  for (const target of [shared, privatePage])
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
    ).toBe(200);
  const invitation = await invite(owner, shared.id, "viewer");
  expect(
    (
      await request(
        "POST",
        `/v1/invites/${invitation.id}/redeem`,
        { secret: invitation.secret },
        viewer.cookie,
      )
    ).statusCode,
  ).toBe(200);
  const search = async (
    cookie: string,
    query: string,
    overlays: unknown[] = [],
  ) => {
    const response = await request(
      "POST",
      "/v1/search",
      { query: parseSearchQuery(query), workspaceId: null, overlays },
      cookie,
    );
    expect(response.statusCode).toBe(200);
    return SearchResponseSchema.parse(response.json());
  };
  expect(
    (await search(viewer.cookie, '"unopened-search-body" tag:search')).hits.map(
      (hit) => hit.pageId,
    ),
  ).toEqual([shared.id]);
  expect((await search(outsider.cookie, "unopened-search-body")).hits).toEqual(
    [],
  );
  const overlay = {
    pageId: shared.id,
    updatedAt: new Date().toISOString(),
    projection: { ...getKnowledgeProjection(doc), body: "replacement-token" },
  };
  expect(
    (await search(owner.cookie, '"unopened-search-body"', [overlay])).hits.map(
      (hit) => hit.pageId,
    ),
  ).toEqual([privatePage.id]);
  expect(
    (await search(owner.cookie, '"replacement-token"', [overlay])).hits.map(
      (hit) => hit.pageId,
    ),
  ).toEqual([shared.id]);
  expect(
    (await repository.search.list([shared.id]))[0]?.projection.body,
  ).toContain("unopened-search-body");
  expect(
    (await search(viewer.cookie, '"replacement-token"', [overlay])).hits,
  ).toEqual([]);
  expect(
    (
      await search(owner.cookie, '"replacement-token"', [
        { ...overlay, pageId: privatePage.id },
        { ...overlay, pageId: crypto.randomUUID() },
      ])
    ).hits.map((hit) => hit.pageId),
  ).toEqual([privatePage.id]);
  expect(
    (
      await request(
        "POST",
        "/v1/search",
        {
          query: {
            clauses: [
              {
                kind: "filter",
                field: "before",
                value: "2026-02-30",
                excluded: false,
              },
            ],
          },
          workspaceId: null,
        },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request("POST", "/v1/search", {
        query: { clauses: [] },
        workspaceId: null,
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/search",
        headers: { cookie: owner.cookie, origin: "https://invalid.example" },
        payload: { query: { clauses: [] }, workspaceId: null },
      })
    ).statusCode,
  ).toBe(403);
  const grants = (
    await request(
      "GET",
      `/v1/pages/${shared.id}/share`,
      undefined,
      owner.cookie,
    )
  ).json<{ grants: { id: string }[] }>().grants;
  expect(
    (
      await request(
        "DELETE",
        `/v1/pages/${shared.id}/grants/${grants[0]!.id}`,
        undefined,
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  expect((await search(viewer.cookie, "unopened-search-body")).hits).toEqual(
    [],
  );
  expect(
    (
      await request(
        "POST",
        "/v1/sync/page",
        {
          operationId: crypto.randomUUID(),
          workspaceId: ws.id,
          pageId: shared.id,
          expectedRevision: 0,
          action: "trash",
        },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await search(owner.cookie, '"unopened-search-body"')).hits.map(
      (hit) => hit.pageId,
    ),
  ).toEqual([privatePage.id]);
  doc.destroy();
});
it("searches typed Row properties and computed values only within the requester's Database scope", async () => {
  const owner = await actor(),
    viewer = await actor(),
    ws = await workspace(owner);
  const createDatabase = async (title: string) => {
    const id = crypto.randomUUID(),
      value = {
        id,
        workspaceId: ws.id,
        parentId: null,
        kind: "database",
        title,
        revision: 0,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        isInbox: false,
      };
    expect(
      (
        await request(
          "POST",
          "/v1/sync/page",
          {
            operationId: crypto.randomUUID(),
            workspaceId: ws.id,
            pageId: id,
            expectedRevision: 0,
            action: "create",
            page: value,
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
    return id;
  };
  const targetId = await createDatabase("Target"),
    sourceId = await createDatabase("Source"),
    target = new Y.Doc(),
    source = new Y.Doc();
  target.getText("title").insert(0, "Target");
  source.getText("title").insert(0, "Source");
  const targetRow = createTaskRow(target, "Private linked row"),
    row = createTaskRow(source, "Visible row"),
    points = addDatabaseProperty(target, "Points", "number");
  writeDatabaseValue(target, targetRow, points, 6);
  const relation = addDatabaseProperty(
    source,
    "Linked",
    "relation",
    [],
    crypto.randomUUID(),
    { relation: { databaseId: targetId } },
  );
  writeDatabaseValue(source, row, relation, [targetRow]);
  addDatabaseProperty(source, "Total", "rollup", [], crypto.randomUUID(), {
    rollup: {
      relationPropertyId: relation,
      targetPropertyId: points,
      operation: "sum",
    },
  });
  for (const [id, doc] of [
    [targetId, target],
    [sourceId, source],
  ] as const)
    expect(
      (
        await request(
          "POST",
          `/v1/documents/${id}/commit`,
          {
            operationId: crypto.randomUUID(),
            update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
  const query = (cookie: string, term: string, overlays: unknown[] = []) =>
    request(
      "POST",
      "/v1/search",
      { query: parseSearchQuery(term), workspaceId: ws.id, overlays },
      cookie,
    );
  expect(
    (await query(owner.cookie, "prop:Total:equals:6")).json<{
      hits: { rowId: string }[];
    }>().hits[0]?.rowId,
  ).toBe(row);
  writeDatabaseValue(target, targetRow, points, 11);
  expect(
    (
      await query(owner.cookie, "prop:Total:equals:11", [
        {
          pageId: targetId,
          projection: getKnowledgeProjection(target),
          updatedAt: new Date().toISOString(),
        },
      ])
    ).json<{ hits: { rowId: string }[] }>().hits[0]?.rowId,
  ).toBe(row);
  const invitation = await invite(owner, sourceId, "viewer");
  expect(
    (
      await request(
        "POST",
        `/v1/invites/${invitation.id}/redeem`,
        { secret: invitation.secret },
        viewer.cookie,
      )
    ).statusCode,
  ).toBe(200);
  for (const term of [
    "prop:Total:equals:6",
    "prop:Total:equals:0",
    "-prop:Total:equals:6",
    '"Private linked row"',
  ])
    expect(
      (await query(viewer.cookie, term)).json<{ hits: unknown[] }>().hits,
    ).toEqual([]);
  expect(
    (
      await request(
        "GET",
        `/v1/pages/${sourceId}/search-properties`,
        undefined,
        viewer.cookie,
      )
    )
      .json<{ name: string }[]>()
      .some((p) => p.name === "Total"),
  ).toBe(true);
  expect(
    (
      await request(
        "GET",
        `/v1/pages/${targetId}/search-properties`,
        undefined,
        viewer.cookie,
      )
    ).statusCode,
  ).toBe(403);
  target.destroy();
  source.destroy();
});
it("enforces the same-IP registration rate limit within an isolated scenario", async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  for (let index = 0; index < 30; index++)
    expect(
      (
        await request("POST", "/v1/devices", {
          id: crypto.randomUUID(),
          name: "Rate test",
          publicKey,
        })
      ).statusCode,
    ).toBe(200);
  expect(
    (
      await request("POST", "/v1/devices", {
        id: crypto.randomUUID(),
        name: "Limited",
        publicKey,
      })
    ).statusCode,
  ).toBe(429);
});
it.each(["file", "formula", "relation", "rollup"] as const)(
  "requires Protocol 3 for %s Properties while retaining operation retry protection",
  async (type) => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id),
      doc = new Y.Doc();
    const configuration =
      type === "formula"
        ? { formula: { source: "1 + 2", ast: compileFormula("1 + 2", []) } }
        : type === "relation"
          ? { relation: { databaseId: crypto.randomUUID() } }
          : type === "rollup"
            ? {
                rollup: {
                  relationPropertyId: "relation",
                  targetPropertyId: "points",
                  operation: "sum" as const,
                },
              }
            : {};
    addDatabaseProperty(
      doc,
      "Advanced",
      type,
      [],
      crypto.randomUUID(),
      configuration,
    );
    const endpoint = `/v1/documents/${target.id}`,
      payload = {
        operationId: crypto.randomUUID(),
        update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
      };
    expect(
      (await request("POST", `${endpoint}/commit`, payload, owner.cookie, 2))
        .statusCode,
    ).toBe(426);
    expect(
      (await request("POST", `${endpoint}/commit`, payload, owner.cookie, 3))
        .statusCode,
    ).toBe(200);
    expect(
      (await request("POST", `${endpoint}/commit`, payload, owner.cookie, 3))
        .statusCode,
    ).toBe(200);
    expect(
      (await request("POST", `${endpoint}/commit`, payload, owner.cookie, 2))
        .statusCode,
    ).toBe(426);
    expect(
      (await request("GET", endpoint, undefined, owner.cookie, 2)).statusCode,
    ).toBe(426);
    expect(
      (await request("GET", endpoint, undefined, owner.cookie, 3)).statusCode,
    ).toBe(200);
    doc.destroy();
  },
);
it("rejects malformed advanced definitions without committing and keeps media readable by Protocol 2", async () => {
  const owner = await actor(),
    space = await workspace(owner),
    target = await page(owner, space.id);
  const doc = new Y.Doc(),
    map = new Y.Map<unknown>();
  doc.getMap<Y.Map<unknown>>("databaseProperties").set("bad", map);
  map.set("name", "Bad");
  map.set("type", "formula");
  map.set("formula", {
    source: "eval(1)",
    ast: { type: "call", name: "eval", arguments: [] },
  });
  const endpoint = `/v1/documents/${target.id}`;
  expect(
    (
      await request(
        "POST",
        `${endpoint}/commit`,
        {
          operationId: crypto.randomUUID(),
          update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
        },
        owner.cookie,
      )
    ).statusCode,
  ).toBe(422);
  const media = new Y.Doc();
  media.getXmlFragment("content").insert(0, [new Y.XmlElement("attachment")]);
  expect(
    (
      await request(
        "POST",
        `${endpoint}/commit`,
        {
          operationId: crypto.randomUUID(),
          update: bytesToBase64(Y.encodeStateAsUpdate(media)),
        },
        owner.cookie,
        2,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await request("GET", endpoint, undefined, owner.cookie, 2)).statusCode,
  ).toBe(200);
  doc.destroy();
  media.destroy();
});
it("lists retained file names only for Owner, including Trash, without returning bytes", async () => {
  const owner = await actor(),
    viewer = await actor(),
    space = await workspace(owner),
    target = await page(owner, space.id);
  const code = await invite(owner, target.id, "viewer");
  await request(
    "POST",
    "/v1/invites/accept",
    { id: code.id, secret: code.secret },
    viewer.cookie,
  );
  const file = {
    id: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    name: "history.txt",
    data: bytesToBase64(new TextEncoder().encode("historical bytes")),
  };
  await request(
    "POST",
    `/v1/pages/${target.id}/attachments`,
    file,
    owner.cookie,
  );
  await request(
    "DELETE",
    `/v1/attachments/${file.id}`,
    undefined,
    owner.cookie,
  );
  const endpoint = `/v1/pages/${target.id}/attachments`;
  expect(
    (await request("GET", endpoint, undefined, owner.cookie)).json(),
  ).toEqual([]);
  const retained = await request(
    "GET",
    `${endpoint}?retained=1`,
    undefined,
    owner.cookie,
  );
  expect(retained.statusCode).toBe(200);
  expect(retained.json()).toHaveLength(1);
  expect(retained.body).not.toContain("historical bytes");
  expect(retained.json()[0]).not.toHaveProperty("data");
  expect(
    (await request("GET", `${endpoint}?retained=1`, undefined, viewer.cookie))
      .statusCode,
  ).toBe(403);
  await repository.query(
    sql`UPDATE pages SET deleted_at=now() WHERE id=${target.id}`,
  );
  expect(
    (await request("GET", `${endpoint}?retained=1`, undefined, owner.cookie))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await request(
        "GET",
        `${endpoint}?retained=unexpected`,
        undefined,
        owner.cookie,
      )
    ).statusCode,
  ).toBe(400);
});
it("protects File Property references from purge and copies bytes with new Snapshot-scoped IDs", async () => {
  const owner = await actor(),
    space = await workspace(owner),
    target = await page(owner, space.id);
  const file = {
    id: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    name: "property.txt",
    data: "QQ==",
  };
  await request(
    "POST",
    `/v1/pages/${target.id}/attachments`,
    file,
    owner.cookie,
  );
  const doc = new Y.Doc(),
    rowId = createTaskRow(doc, "File Row"),
    propertyId = addDatabaseProperty(doc, "File", "file");
  writeDatabaseValue(doc, rowId, propertyId, [file.id]);
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
  ).toBe(200);
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
  const snapshot = (
    await request(
      "POST",
      `/v1/pages/${target.id}/snapshots`,
      { operationId: crypto.randomUUID(), name: "File Property" },
      owner.cookie,
    )
  ).json<{ id: string }>();
  const restored = await request(
    "POST",
    `/v1/snapshots/${snapshot.id}/restore-copy`,
    { operationId: crypto.randomUUID() },
    owner.cookie,
  );
  expect(restored.statusCode).toBe(200);
  const newId = restored.json<{ id: string }>().id;
  const update = (
    await request("GET", `/v1/documents/${newId}`, undefined, owner.cookie)
  ).json<{ update: string }>();
  const copy = new Y.Doc();
  Y.applyUpdate(copy, base64ToBytes(update.update));
  const files = readDatabaseValue(
    copy,
    getTaskRows(copy)[0]!,
    getDatabaseProperties(copy).find((property) => property.id === propertyId)!,
  );
  expect(Array.isArray(files)).toBe(true);
  expect(files).not.toContain(file.id);
  const copied = await request(
    "GET",
    `/v1/attachments/${(files as string[])[0]}`,
    undefined,
    owner.cookie,
  );
  expect(copied.statusCode).toBe(200);
  expect(copied.json()).toMatchObject({ pageId: newId, data: file.data });
  doc.destroy();
  copy.destroy();
});

it("protects new blocks from legacy reads, offline deletions, retries and Snapshot previews", async () => {
  const owner = await actor(),
    space = await workspace(owner),
    target = await page(owner, space.id);
  const endpoint = `/v1/documents/${target.id}`;
  expect(
    (await request("GET", endpoint, undefined, owner.cookie, 1)).statusCode,
  ).toBe(200);
  const doc = new Y.Doc(),
    attachment = new Y.XmlElement("attachment");
  doc.getXmlFragment("content").insert(0, [attachment]);
  const operationId = crypto.randomUUID(),
    input = { operationId, update: bytesToBase64(Y.encodeStateAsUpdate(doc)) };
  expect(
    (await request("POST", `${endpoint}/commit`, input, owner.cookie, 1))
      .statusCode,
  ).toBe(426);
  expect(
    (await request("POST", `${endpoint}/commit`, input, owner.cookie))
      .statusCode,
  ).toBe(200);
  for (const path of [endpoint, `${endpoint}/realtime-token`])
    expect(
      (
        await request(
          path === endpoint ? "GET" : "POST",
          path,
          undefined,
          owner.cookie,
          1,
        )
      ).statusCode,
    ).toBe(426);
  expect(
    (await request("POST", `${endpoint}/commit`, input, owner.cookie, 1))
      .statusCode,
  ).toBe(426);
  const snapshot = (
    await request(
      "POST",
      `/v1/pages/${target.id}/snapshots`,
      { operationId: crypto.randomUUID(), name: "New blocks" },
      owner.cookie,
    )
  ).json<{ id: string }>();
  expect(
    (
      await request(
        "GET",
        `/v1/snapshots/${snapshot.id}`,
        undefined,
        owner.cookie,
        1,
      )
    ).statusCode,
  ).toBe(426);
  expect(
    (
      await request(
        "GET",
        `/v1/snapshots/${snapshot.id}`,
        undefined,
        owner.cookie,
      )
    ).statusCode,
  ).toBe(200);
  doc.getXmlFragment("content").delete(0, 1);
  const removal = {
    operationId: crypto.randomUUID(),
    update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
  };
  expect(
    (await request("POST", `${endpoint}/commit`, removal, owner.cookie, 1))
      .statusCode,
  ).toBe(426);
  const unchanged = new Y.Doc();
  for (const update of await repository.loadDocument(target.id))
    Y.applyUpdate(unchanged, update);
  expect(unchanged.getXmlFragment("content").length).toBe(1);
  expect(
    (await request("POST", `${endpoint}/commit`, removal, owner.cookie))
      .statusCode,
  ).toBe(200);
  // The minimum stays pinned even when a current editor intentionally removes every new block.
  await repository.documents.compact(target.id);
  expect(
    (await request("GET", endpoint, undefined, owner.cookie, 1)).statusCode,
  ).toBe(426);
  expect(
    (await request("GET", endpoint, undefined, owner.cookie, 999)).statusCode,
  ).toBe(400);
  doc.destroy();
  unchanged.destroy();
});

describe("permission-bound durable attachments", () => {
  it("commits and reads a byte-identical attachment at the maximum file size", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id),
      bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES, 65),
      payload = {
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        name: "boundary.txt",
        data: bytes.toString("base64"),
      };
    const uploaded = await request(
      "POST",
      `/v1/pages/${target.id}/attachments`,
      payload,
      owner.cookie,
    );
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toMatchObject({ size: bytes.length });
    const downloaded = await request(
      "GET",
      `/v1/attachments/${payload.id}`,
      undefined,
      owner.cookie,
    );
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.json<{ data: string }>().data).toBe(payload.data);
    const retried = await request(
      "POST",
      `/v1/pages/${target.id}/attachments`,
      payload,
      owner.cookie,
    );
    expect(retried.statusCode).toBe(200);
    expect((await repository.attachments.usage(space.id)).count).toBe(1);
  });
  it("persists byte-identical files, deduplicates retries and rejects ID collisions", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id);
    const payload = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "../../소스\r\n.ts",
      data: bytesToBase64(new TextEncoder().encode("const value = 1;")),
    };
    const endpoint = `/v1/pages/${target.id}/attachments`;
    const first = await request("POST", endpoint, payload, owner.cookie);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      id: payload.id,
      pageId: target.id,
      name: "소스.ts",
      mime: "text/plain",
      size: 16,
    });
    expect(
      (await request("POST", endpoint, payload, owner.cookie)).json(),
    ).toEqual(first.json());
    expect(
      (
        await request(
          "GET",
          `/v1/attachments/${payload.id}`,
          undefined,
          owner.cookie,
        )
      ).json(),
    ).toMatchObject({ data: payload.data });
    expect(
      (
        await request(
          "GET",
          `/v1/attachments/${payload.id}/content`,
          undefined,
          owner.cookie,
        )
      ).body,
    ).toBe("const value = 1;");
    expect(
      (
        await request(
          "POST",
          endpoint,
          {
            ...payload,
            data: bytesToBase64(new TextEncoder().encode("changed")),
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await request(
          "POST",
          endpoint,
          { ...payload, id: crypto.randomUUID() },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(409);
    expect(await repository.attachments.list(target.id)).toHaveLength(1);
  });
  it("honors Viewer/Commenter access, unrelated-page denial and immediate revoke", async () => {
    const owner = await actor(),
      viewer = await actor(),
      commenter = await actor(),
      stranger = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id);
    const payload = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "x.txt",
      data: "eA==",
    };
    expect(
      (
        await request(
          "POST",
          `/v1/pages/${target.id}/attachments`,
          payload,
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
    for (const [person, role] of [
      [viewer, "viewer"],
      [commenter, "commenter"],
    ] as const) {
      const invitation = await invite(owner, target.id, role);
      await request(
        "POST",
        `/v1/invites/${invitation.id}/redeem`,
        { secret: invitation.secret },
        person.cookie,
      );
      expect(
        (
          await request(
            "GET",
            `/v1/attachments/${payload.id}`,
            undefined,
            person.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "POST",
            `/v1/pages/${target.id}/attachments`,
            {
              ...payload,
              id: crypto.randomUUID(),
              operationId: crypto.randomUUID(),
            },
            person.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await request(
            "DELETE",
            `/v1/attachments/${payload.id}`,
            undefined,
            person.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await request(
            "GET",
            `/v1/workspaces/${space.id}/attachments/storage`,
            undefined,
            person.cookie,
          )
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await request(
          "GET",
          `/v1/attachments/${payload.id}/content`,
          undefined,
          stranger.cookie,
        )
      ).statusCode,
    ).toBe(403);
    const member = await repository.getMembership(viewer.id, space.id);
    const grant = (await repository.listPageGrants(target.id)).find(
      (value) => value.identityId === member?.identityId,
    );
    expect(grant).toBeDefined();
    await request(
      "DELETE",
      `/v1/pages/${target.id}/grants/${grant!.id}`,
      undefined,
      owner.cookie,
    );
    expect(
      (
        await request(
          "GET",
          `/v1/attachments/${payload.id}`,
          undefined,
          viewer.cookie,
        )
      ).statusCode,
    ).toBe(403);
  });
  it("serves bounded byte ranges and active content as a safe download", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id);
    const payload = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "evil.svg",
      data: bytesToBase64(new TextEncoder().encode("<svg onload='bad()'/>")),
    };
    await request(
      "POST",
      `/v1/pages/${target.id}/attachments`,
      payload,
      owner.cookie,
    );
    const response = await app.inject({
      method: "GET",
      url: `/v1/attachments/${payload.id}/content`,
      headers: { cookie: owner.cookie, range: "bytes=0-3" },
    });
    expect(response.statusCode).toBe(206);
    expect(response.body).toBe("<svg");
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-disposition"]).toContain("attachment;");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/attachments/${payload.id}/content`,
          headers: { cookie: owner.cookie, range: "bytes=999-" },
        })
      ).statusCode,
    ).toBe(416);
    expect(
      (
        await request(
          "POST",
          `/v1/pages/${target.id}/attachments`,
          {
            ...payload,
            id: crypto.randomUUID(),
            operationId: crypto.randomUUID(),
            data: "bad?",
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(400);
  });
  it("keeps local clients retryable when global and Workspace storage is exhausted", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id);
    const payload = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "x.txt",
      data: "eA==",
    };
    const capacity = vi
      .spyOn(repository.documents, "capacity")
      .mockResolvedValue({
        bytes: STORAGE_LIMIT_BYTES,
        warning: true,
        blocked: true,
      });
    try {
      expect(
        (
          await request(
            "POST",
            `/v1/pages/${target.id}/attachments`,
            payload,
            owner.cookie,
          )
        ).statusCode,
      ).toBe(507);
    } finally {
      capacity.mockRestore();
    }
    const usage = vi.spyOn(repository.attachments, "usage").mockResolvedValue({
      bytes: WORKSPACE_ATTACHMENT_BYTES,
      count: 1,
      retained: 0,
      limit: WORKSPACE_ATTACHMENT_BYTES,
      fileLimit: 4194304,
    });
    try {
      expect(
        (
          await request(
            "POST",
            `/v1/pages/${target.id}/attachments`,
            payload,
            owner.cookie,
          )
        ).statusCode,
      ).toBe(507);
    } finally {
      usage.mockRestore();
    }
    expect(await repository.attachments.list(target.id)).toHaveLength(0);
    expect(
      (
        await request(
          "POST",
          `/v1/pages/${target.id}/attachments`,
          payload,
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
  });
  it("restores Snapshot files with new Page-scoped IDs even after Trash and file removal", async () => {
    const owner = await actor(),
      space = await workspace(owner),
      target = await page(owner, space.id);
    const payload = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "old.txt",
      data: "eA==",
    };
    await request(
      "POST",
      `/v1/pages/${target.id}/attachments`,
      payload,
      owner.cookie,
    );
    const doc = new Y.Doc();
    doc.getText("title").insert(0, "Attached");
    const node = new Y.XmlElement("attachment");
    node.setAttribute("attachmentId", payload.id);
    node.setAttribute("name", "old.txt");
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
    ).toBe(200);
    const snapshot = (
      await request(
        "POST",
        `/v1/pages/${target.id}/snapshots`,
        { operationId: crypto.randomUUID(), name: "With file" },
        owner.cookie,
      )
    ).json<{ id: string }>();
    await request(
      "DELETE",
      `/v1/attachments/${payload.id}`,
      undefined,
      owner.cookie,
    );
    await request(
      "POST",
      "/v1/sync/page",
      {
        operationId: crypto.randomUUID(),
        pageId: target.id,
        workspaceId: space.id,
        expectedRevision: 0,
        action: "trash",
      },
      owner.cookie,
    );
    const operationId = crypto.randomUUID();
    const restore = await request(
      "POST",
      `/v1/snapshots/${snapshot.id}/restore-copy`,
      { operationId },
      owner.cookie,
    );
    expect(restore.statusCode).toBe(200);
    const copy = restore.json<{ id: string }>();
    const files = await repository.attachments.list(copy.id);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).not.toBe(payload.id);
    expect(
      (
        await request(
          "GET",
          `/v1/attachments/${files[0]!.id}`,
          undefined,
          owner.cookie,
        )
      ).json(),
    ).toMatchObject({ data: payload.data });
    const decoded = new Y.Doc();
    for (const update of await repository.loadDocument(copy.id))
      Y.applyUpdate(decoded, update);
    expect(getAttachmentIds(decoded)).toEqual([files[0]!.id]);
    expect(
      (
        await request(
          "POST",
          `/v1/snapshots/${snapshot.id}/restore-copy`,
          { operationId },
          owner.cookie,
        )
      ).json(),
    ).toEqual(copy);
    expect(await repository.attachments.list(copy.id)).toHaveLength(1);
    doc.destroy();
    decoded.destroy();
  });
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

  it("persists Tags and the source search Index atomically and rejects incompatible clients and malformed Tags", async () => {
    const owner = await actor(),
      ws = await workspace(owner),
      target = await page(owner, ws.id),
      doc = new Y.Doc();
    doc.getText("title").insert(0, "Tagged note");
    setPageTag(doc, "Knowledge");
    const path = `/v1/documents/${target.id}/commit`,
      input = {
        operationId: crypto.randomUUID(),
        update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
      };
    expect(
      (await request("POST", path, input, owner.cookie, 3)).statusCode,
    ).toBe(426);
    expect(await repository.search.list([target.id])).toEqual([]);
    const writeIndex = repository.search.write.bind(repository.search);
    const failed = vi
      .spyOn(repository.search, "write")
      .mockImplementationOnce(async (...args) => {
        await writeIndex(...args);
        throw new Error("Checkpoint unavailable after Index write");
      });
    try {
      expect(
        (await request("POST", path, input, owner.cookie)).statusCode,
      ).toBe(500);
    } finally {
      failed.mockRestore();
    }
    expect(await repository.loadDocument(target.id)).toHaveLength(0);
    expect(await repository.search.list([target.id])).toEqual([]);
    expect(
      (await request("POST", path, input, owner.cookie)).json(),
    ).toMatchObject({ durable: true });
    expect(
      (await repository.search.list([target.id]))[0]?.projection,
    ).toMatchObject({ title: "Tagged note", tags: ["Knowledge"] });
    expect(await repository.search.list([])).toEqual([]);
    expect(await repository.search.list([crypto.randomUUID()])).toEqual([]);
    const snapshot = (
      await request(
        "POST",
        `/v1/pages/${target.id}/snapshots`,
        { operationId: crypto.randomUUID(), name: "Tags" },
        owner.cookie,
      )
    ).json<{ id: string }>();
    const restored = (
      await request(
        "POST",
        `/v1/snapshots/${snapshot.id}/restore-copy`,
        { operationId: crypto.randomUUID() },
        owner.cookie,
      )
    ).json<{ id: string }>();
    expect(
      (await repository.search.list([restored.id]))[0]?.projection.tags,
    ).toEqual(["Knowledge"]);
    removePageTag(doc, "Knowledge");
    expect(
      (
        await request(
          "POST",
          path,
          {
            operationId: crypto.randomUUID(),
            update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await repository.search.list([target.id]))[0]?.projection.tags,
    ).toEqual([]);
    expect(
      (
        await request(
          "GET",
          `/v1/documents/${target.id}`,
          undefined,
          owner.cookie,
          3,
        )
      ).statusCode,
    ).toBe(426);
    doc.getMap("pageTags").set("broken", false);
    expect(
      (
        await request(
          "POST",
          path,
          {
            operationId: crypto.randomUUID(),
            update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(422);
    const committed = new Y.Doc();
    for (const update of await repository.loadDocument(target.id))
      Y.applyUpdate(committed, update);
    expect(getPageTags(committed)).toEqual([]);
    expect(committed.getMap("pageTags").has("broken")).toBe(false);
    doc.destroy();
    committed.destroy();
    await repository.deleteWorkspace(ws.id);
    expect(await repository.search.list([target.id, restored.id])).toEqual([]);
  });

  it("marks a shared child as unavailable when its invisible parent is trashed without exposing the parent", async () => {
    const owner = await actor(),
      viewer = await actor(),
      ws = await workspace(owner),
      parent = await page(owner, ws.id),
      child = await page(owner, ws.id, parent.id),
      link = await invite(owner, child.id, "viewer");
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
    const metadata = () =>
      request("GET", "/v1/metadata", undefined, viewer.cookie);
    expect((await metadata()).json<Metadata>().pages).toMatchObject([
      { id: child.id, ancestorTrashed: false },
    ]);
    const trash = {
      operationId: crypto.randomUUID(),
      workspaceId: ws.id,
      pageId: parent.id,
      expectedRevision: (await repository.getPage(parent.id))!.revision,
      action: "trash",
    };
    expect(
      (await request("POST", "/v1/sync/page", trash, owner.cookie)).statusCode,
    ).toBe(200);
    const after = (await metadata()).json<Metadata>();
    expect(after.pages).toHaveLength(1);
    expect(after.pages[0]).toMatchObject({
      id: child.id,
      ancestorTrashed: true,
      deletedAt: null,
    });
    expect(after.pages.some((value) => value.id === parent.id)).toBe(false);
    expect(
      (
        await request(
          "GET",
          `/v1/documents/${child.id}`,
          undefined,
          viewer.cookie,
        )
      ).statusCode,
    ).toBe(410);
    expect(
      (
        await request(
          "POST",
          "/v1/sync/page",
          {
            ...trash,
            operationId: crypto.randomUUID(),
            expectedRevision: (await repository.getPage(parent.id))!.revision,
            action: "restore",
          },
          owner.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect((await metadata()).json<Metadata>().pages[0]?.ancestorTrashed).toBe(
      false,
    );
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

it("keeps the Beta redemption limit at fifteen attempts for the same IP", async () => {
  const device = await actor(),
    codeId = crypto.randomUUID(),
    code = `ZNB1-${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
  await repository.beta.issue(
    codeId,
    await sha256Hex(code),
    new Date(Date.now() + 60000),
  );
  try {
    for (let attempt = 0; attempt < 15; attempt++)
      expect(
        (await request("POST", "/v1/beta/redeem", { code }, device.cookie))
          .statusCode,
      ).toBe(200);
    expect(
      (await request("POST", "/v1/beta/redeem", { code }, device.cookie))
        .statusCode,
    ).toBe(429);
  } finally {
    await repository.database.execute(
      sql`DELETE FROM beta_devices WHERE code_id=${codeId}`,
    );
    await repository.database.execute(
      sql`DELETE FROM beta_codes WHERE id=${codeId}`,
    );
  }
});
