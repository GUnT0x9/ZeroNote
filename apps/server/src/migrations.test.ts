import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import { Repository } from "./database/repository";
import { env } from "./env";
it("upgrades Alpha data once and rebuilds checkpoints from committed logs", async () => {
  const admin = new Repository(env.DATABASE_URL),
    name = `zeronote_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  const url = new URL(env.DATABASE_URL);
  url.pathname = `/${name}`;
  let legacy: Repository | undefined;
  try {
    await admin.database.execute(sql.raw(`CREATE DATABASE ${name}`));
    legacy = new Repository(url.toString());
    await legacy.database.execute(
      sql.raw(
        await readFile(
          new URL("./database/schema.sql", import.meta.url),
          "utf8",
        ),
      ),
    );
    const workspaceId = crypto.randomUUID(),
      pageId = crypto.randomUUID();
    await legacy.database.execute(
      sql`INSERT INTO workspaces(id,name,owner_identity_id,recovery_hash) VALUES(${workspaceId},'Legacy',${crypto.randomUUID()},${crypto.randomUUID()})`,
    );
    await legacy.database.execute(
      sql`INSERT INTO pages(id,workspace_id,kind,title) VALUES(${pageId},${workspaceId},'document','Committed')`,
    );
    const identityId = crypto.randomUUID(),
      commentId = crypto.randomUUID();
    await legacy.database.execute(
      sql`INSERT INTO identities(id,workspace_id,name) VALUES(${identityId},${workspaceId},'Legacy owner')`,
    );
    await legacy.database.execute(
      sql`INSERT INTO comments(id,page_id,identity_id,body) VALUES(${commentId},${pageId},${identityId},'Legacy comment')`,
    );
    const committed = new Y.Doc(),
      dirty = new Y.Doc();
    committed.getText("title").insert(0, "Committed");
    dirty.getText("title").insert(0, "Uncommitted");
    await legacy.database.execute(
      sql`INSERT INTO document_updates(page_id,operation_id,data) VALUES(${pageId},${crypto.randomUUID()},${Buffer.from(Y.encodeStateAsUpdate(committed))})`,
    );
    await legacy.database.execute(
      sql`INSERT INTO document_checkpoints(page_id,data) VALUES(${pageId},${Buffer.from(Y.encodeStateAsUpdate(dirty))})`,
    );
    await legacy.migrate();
    await legacy.migrate();
    expect(
      await legacy.query(sql`SELECT version FROM schema_migrations`),
    ).toHaveLength(9);
    expect(await legacy.comments.list(pageId)).toMatchObject([
      { id: commentId, body: "Legacy comment" },
    ]);
    expect((await legacy.comments.list(pageId))[0]).not.toHaveProperty("rowId");
    expect(
      await legacy.query(
        sql`SELECT row_id FROM comments WHERE id=${commentId}`,
      ),
    ).toEqual([{ row_id: null }]);
    expect(
      await legacy.query(
        sql`SELECT indexname FROM pg_indexes WHERE indexname='comments_scope'`,
      ),
    ).toHaveLength(1);
    const loaded = new Y.Doc();
    for (const update of await legacy.loadDocument(pageId))
      Y.applyUpdate(loaded, update);
    expect(loaded.getText("title").toString()).toBe("Committed");
    await legacy.search.backfill();
    const firstIndex = await legacy.search.list([pageId]);
    await legacy.search.backfill();
    expect(await legacy.search.list([pageId])).toEqual(firstIndex);
    expect((await legacy.search.list([pageId]))[0]?.projection.title).toBe(
      "Committed",
    );
    const emptyPageId = crypto.randomUUID();
    await legacy.database.execute(
      sql`INSERT INTO pages(id,workspace_id,kind,title) VALUES(${emptyPageId},${workspaceId},'document','Registered title')`,
    );
    await legacy.search.backfill();
    expect((await legacy.search.list([emptyPageId]))[0]?.projection.title).toBe(
      "Registered title",
    );
    expect(await legacy.loadDocument(emptyPageId)).toHaveLength(0);
    await legacy.documents.compact(pageId);
    expect(
      await legacy.query(sql`SELECT id FROM document_updates`),
    ).toHaveLength(0);
    expect((await legacy.getPage(pageId))?.title).toBe("Committed");
    committed.destroy();
    dirty.destroy();
    loaded.destroy();
  } finally {
    await legacy?.close();
    await admin.database.execute(sql.raw(`DROP DATABASE IF EXISTS ${name}`));
    await admin.close();
  }
});
