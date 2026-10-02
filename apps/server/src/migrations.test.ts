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
    ).toHaveLength(5);
    const loaded = new Y.Doc();
    for (const update of await legacy.loadDocument(pageId))
      Y.applyUpdate(loaded, update);
    expect(loaded.getText("title").toString()).toBe("Committed");
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
