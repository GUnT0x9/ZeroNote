import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import { WebSocket } from "ws";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import * as Y from "yjs";
import {
  bytesToBase64,
  base64ToBytes,
  sha256Hex,
  createRecoveryKey,
  EDITOR_PROTOCOL,
  EDITOR_PROTOCOL_HEADER,
  addDatabaseProperty,
} from "@zeronote/shared";
import { createApp } from "./app";
import { Repository } from "./database/repository";
import { env } from "./env";
import { AccessService } from "./services";
let application: Awaited<ReturnType<typeof createApp>>, origin: string;
const TEST_SERVER_STARTUP_TIMEOUT_MS = 30_000;
const workspaces: string[] = [],
  providers: HocuspocusProvider[] = [],
  sockets: HocuspocusProviderWebsocket[] = [],
  documents: Y.Doc[] = [];
class OriginSocket extends WebSocket {
  constructor(url: string) {
    super(url, { origin: env.WEB_ORIGIN });
  }
}
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
  protocol = EDITOR_PROTOCOL,
) {
  const response = await fetch(`${origin}/v1${path}`, {
    method,
    headers: {
      Origin: env.WEB_ORIGIN,
      Cookie: cookie,
      [EDITOR_PROTOCOL_HEADER]: String(protocol),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok, `${method} ${path}`).toBe(true);
  return response;
}
async function actor() {
  const id = crypto.randomUUID(),
    keys = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
  await call("/devices", "POST", {
    id,
    name: `Verified ${id.slice(0, 6)}`,
    publicKey: await crypto.subtle.exportKey("jwk", keys.publicKey),
  });
  const challenge = (await (
    await call("/auth/challenge", "POST", { deviceId: id })
  ).json()) as { id: string; nonce: string };
  const signature = bytesToBase64(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keys.privateKey,
        new TextEncoder().encode(challenge.nonce),
      ),
    ),
  );
  const response = await call("/auth/verify", "POST", {
    challengeId: challenge.id,
    signature,
  });
  return {
    id,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function setup() {
  const owner = await actor(),
    workspaceId = crypto.randomUUID(),
    pageId = crypto.randomUUID();
  await call(
    "/workspaces",
    "POST",
    {
      id: workspaceId,
      name: "Realtime integration",
      ownerIdentityId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      recoveryHash: await sha256Hex(createRecoveryKey()),
    },
    owner.cookie,
  );
  workspaces.push(workspaceId);
  await call(
    "/sync/page",
    "POST",
    {
      operationId: crypto.randomUUID(),
      workspaceId,
      pageId,
      expectedRevision: 0,
      action: "create",
      page: {
        id: pageId,
        workspaceId,
        parentId: null,
        kind: "document",
        title: "Live",
        revision: 0,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        isInbox: false,
      },
    },
    owner.cookie,
  );
  return { owner, workspaceId, pageId };
}
async function collaborator(
  owner: { cookie: string },
  pageId: string,
  role = "editor",
) {
  const member = await actor(),
    invite = (await (
      await call(
        "/invites",
        "POST",
        { pageId, role, includeDescendants: false },
        owner.cookie,
      )
    ).json()) as { id: string; secret: string };
  await call(
    `/invites/${invite.id}/redeem`,
    "POST",
    { secret: invite.secret },
    member.cookie,
  );
  return member;
}
async function connect(
  cookie: string,
  pageId: string,
  protocol = EDITOR_PROTOCOL,
) {
  const { token } = (await (
      await call(
        `/documents/${pageId}/realtime-token`,
        "POST",
        undefined,
        cookie,
        protocol,
      )
    ).json()) as { token: string },
    document = new Y.Doc();
  documents.push(document);
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: origin.replace("http", "ws") + "/collaboration",
    WebSocketPolyfill: OriginSocket,
  });
  sockets.push(websocketProvider);
  let provider: HocuspocusProvider;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Realtime sync timed out")),
      8000,
    );
    provider = new HocuspocusProvider({
      name: pageId,
      document,
      websocketProvider,
      token,
      onSynced: () => {
        clearTimeout(timer);
        resolve();
      },
      onAuthenticationFailed: () => {
        clearTimeout(timer);
        reject(new Error("Realtime authentication rejected"));
      },
    });
    providers.push(provider);
    provider.attach();
  });
  return { document, provider: provider! };
}
async function serverTitle(pageId: string) {
  const doc = new Y.Doc();
  try {
    for (const update of await application.repository.loadDocument(pageId))
      Y.applyUpdate(doc, update);
    return doc.getText("title").toString();
  } finally {
    doc.destroy();
  }
}
beforeAll(async () => {
  application = await createApp(new Repository(env.DATABASE_URL), false);
  origin = await application.app.listen({ port: 0, host: "127.0.0.1" });
}, TEST_SERVER_STARTUP_TIMEOUT_MS);
afterEach(() => {
  vi.restoreAllMocks();
  for (const provider of providers.splice(0)) provider.destroy();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const doc of documents.splice(0)) doc.destroy();
});
it("keeps presence heartbeat traffic in memory without periodic permission queries", async () => {
  const { owner, pageId } = await setup();
  const member = await collaborator(owner, pageId);
  const writer = await connect(owner.cookie, pageId);
  const reader = await connect(member.cookie, pageId);
  await vi.waitFor(() => {
    expect(writer.provider.hasUnsyncedChanges).toBe(false);
    expect(reader.provider.hasUnsyncedChanges).toBe(false);
  });
  const permission = vi.spyOn(AccessService.prototype, "page");
  reader.provider.awareness?.setLocalStateField("cursor", { position: 42 });
  await vi.waitFor(() => {
    const states = Array.from(
      writer.provider.awareness?.getStates().values() ?? [],
    );
    expect(
      states.some(
        (state: { cursor?: { position?: number } }) =>
          state.cursor?.position === 42,
      ),
    ).toBe(true);
  });
  expect(permission).not.toHaveBeenCalled();
  reader.document.getText("title").insert(0, "Real edit");
  await vi.waitFor(() =>
    expect(writer.document.getText("title").toString()).toBe("Real edit"),
  );
  expect(permission).toHaveBeenCalled();
});
it.each(["rest", "websocket"])(
  "disconnects legacy editors before broadcasting new blocks through %s",
  async (transport) => {
    const { owner, pageId } = await setup(),
      member = await collaborator(owner, pageId),
      legacy = await connect(member.cookie, pageId, 1),
      current = await connect(owner.cookie, pageId);
    const staleToken = (await (
      await call(
        `/documents/${pageId}/realtime-token`,
        "POST",
        undefined,
        member.cookie,
        1,
      )
    ).json()) as { token: string };
    await vi.waitFor(() =>
      expect(current.provider.hasUnsyncedChanges).toBe(false),
    );
    expect(
      application.realtime.documents.get(pageId)?.getConnectionsCount(),
    ).toBe(2);
    let delivered = false;
    legacy.document.on("update", () => {
      if (legacy.document.getXmlFragment("content").length) delivered = true;
    });
    if (transport === "websocket")
      current.document
        .getXmlFragment("content")
        .insert(0, [new Y.XmlElement("attachment")]);
    else {
      const document = new Y.Doc();
      document
        .getXmlFragment("content")
        .insert(0, [new Y.XmlElement("attachment")]);
      await call(
        `/documents/${pageId}/commit`,
        "POST",
        {
          operationId: crypto.randomUUID(),
          update: bytesToBase64(Y.encodeStateAsUpdate(document)),
        },
        owner.cookie,
      );
      document.destroy();
    }
    await vi.waitFor(() => {
      expect(current.document.getXmlFragment("content").length).toBe(1);
      expect(
        application.realtime.documents.get(pageId)?.getConnectionsCount(),
      ).toBe(1);
    });
    expect(delivered).toBe(false);
    expect(legacy.document.getXmlFragment("content").length).toBe(0);
    const fresh = new Y.Doc(),
      socket = new HocuspocusProviderWebsocket({
        url: origin.replace("http", "ws") + "/collaboration",
        WebSocketPolyfill: OriginSocket,
      });
    documents.push(fresh);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Legacy token was not rejected")),
        3000,
      );
      const provider = new HocuspocusProvider({
        name: pageId,
        document: fresh,
        websocketProvider: socket,
        token: staleToken.token,
        onAuthenticationFailed: () => {
          clearTimeout(timer);
          resolve();
        },
        onSynced: () => {
          clearTimeout(timer);
          reject(new Error("Legacy token received document state"));
        },
      });
      providers.push(provider);
      provider.attach();
    });
    expect(fresh.getXmlFragment("content").length).toBe(0);
    await expect(connect(member.cookie, pageId, 1)).rejects.toThrow();
    const loaded = new Y.Doc();
    for (const update of await application.repository.loadDocument(pageId))
      Y.applyUpdate(loaded, update);
    expect(loaded.getXmlFragment("content").length).toBe(1);
    loaded.destroy();
  },
);
it.each(["rest", "websocket"])(
  "disconnects Protocol 2 before advanced Property broadcast via %s",
  async (transport) => {
    const { owner, pageId } = await setup(),
      member = await collaborator(owner, pageId);
    const old = await connect(member.cookie, pageId, 2),
      current = await connect(owner.cookie, pageId, 3);
    await vi.waitFor(() =>
      expect(current.provider.hasUnsyncedChanges).toBe(false),
    );
    let delivered = false;
    old.document.on("update", () => {
      if (old.document.getMap("databaseProperties").size) delivered = true;
    });
    if (transport === "websocket")
      addDatabaseProperty(current.document, "File", "file");
    else {
      const doc = new Y.Doc();
      addDatabaseProperty(doc, "File", "file");
      await call(
        `/documents/${pageId}/commit`,
        "POST",
        {
          operationId: crypto.randomUUID(),
          update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
        },
        owner.cookie,
        3,
      );
      doc.destroy();
    }
    await vi.waitFor(() => {
      expect(current.document.getMap("databaseProperties").size).toBe(1);
      expect(
        application.realtime.documents.get(pageId)?.getConnectionsCount(),
      ).toBe(1);
    });
    expect(delivered).toBe(false);
    expect(old.document.getMap("databaseProperties").size).toBe(0);
    await expect(connect(member.cookie, pageId, 2)).rejects.toThrow();
  },
);
afterAll(async () => {
  for (const id of workspaces) await application.repository.deleteWorkspace(id);
  await application.app.close();
});
it("merges five concurrent editors, offline changes and an undo that preserves remote edits", async () => {
  const { owner, pageId } = await setup(),
    members = [
      owner,
      ...(await Promise.all(
        Array.from({ length: 4 }, () => collaborator(owner, pageId)),
      )),
    ],
    peers: Awaited<ReturnType<typeof connect>>[] = [];
  for (const member of members)
    peers.push(await connect(member.cookie, pageId));
  for (const [index, peer] of peers.entries())
    peer.document.getText("title").insert(0, `Peer${index} `);
  await vi.waitFor(
    () => {
      const text = peers[0]!.document.getText("title").toString();
      for (const peer of peers)
        expect(peer.document.getText("title").toString()).toBe(text);
      for (let i = 0; i < 5; i++) expect(text).toContain(`Peer${i}`);
    },
    { timeout: 8000 },
  );
  const offline = peers[4]!;
  offline.provider.configuration.websocketProvider.disconnect();
  await vi.waitFor(() =>
    expect(offline.provider.configuration.websocketProvider.status).toBe(
      "disconnected",
    ),
  );
  offline.document.getText("title").insert(0, "Offline ");
  peers[0]!.document.getText("title").insert(0, "Online ");
  await offline.provider.configuration.websocketProvider.connect();
  await vi.waitFor(
    () => {
      for (const peer of peers) {
        expect(peer.document.getText("title").toString()).toContain("Offline");
        expect(peer.document.getText("title").toString()).toContain("Online");
      }
    },
    { timeout: 8000 },
  );
  const local = peers[0]!.document,
    text = local.getText("title"),
    undo = new Y.UndoManager(text, { trackedOrigins: new Set(["own"]) });
  local.transact(() => text.insert(text.length, "OwnChange "), "own");
  peers[1]!.document.getText("title").insert(0, "RemoteChange ");
  await vi.waitFor(() => expect(text.toString()).toContain("RemoteChange"));
  undo.undo();
  await vi.waitFor(() => {
    expect(text.toString()).not.toContain("OwnChange");
    expect(text.toString()).toContain("RemoteChange");
  });
  undo.destroy();
  await vi.waitFor(async () =>
    expect(await serverTitle(pageId)).toContain("Offline"),
  );
}, 20000);
it.each(["viewer", "commenter"])(
  "blocks forged %s WebSocket writes and stamps verified presence",
  async (role) => {
    const { owner, pageId } = await setup(),
      member = await collaborator(owner, pageId, role),
      writer = await connect(owner.cookie, pageId),
      reader = await connect(member.cookie, pageId);
    writer.document.getText("title").insert(0, "Allowed");
    await vi.waitFor(() =>
      expect(reader.document.getText("title").toString()).toBe("Allowed"),
    );
    reader.document.getText("title").insert(0, "Forged");
    reader.provider.awareness?.setLocalStateField("user", {
      name: "Spoofed owner",
      role: "owner",
      color: "#000",
    });
    await vi.waitFor(() => {
      const names = Array.from(
        writer.provider.awareness?.getStates().values() ?? [],
      ).map((value) => (value as { user?: { name?: string } }).user?.name);
      expect(names).toContain(`Verified ${member.id.slice(0, 6)}`);
      expect(names).not.toContain("Spoofed owner");
    });
    expect(writer.document.getText("title").toString()).toBe("Allowed");
    await vi.waitFor(async () =>
      expect(await serverTitle(pageId)).toBe("Allowed"),
    );
    const binary = (await (
      await call(`/documents/${pageId}`, undefined, undefined, owner.cookie)
    ).json()) as { update: string };
    const restored = new Y.Doc();
    Y.applyUpdate(restored, base64ToBytes(binary.update));
    expect(restored.getText("title").toString()).toBe("Allowed");
    restored.destroy();
  },
);
