import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { database, type LocalPage } from "./database";
import { readLinkedPage } from "./linked-page";
import { availablePages } from "./search";
afterEach(async () => {
  await database.pages.clear();
});
function page(parentId: string | null = null): LocalPage {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    title: "Page",
    kind: "document",
    parentId,
    role: "viewer",
    revision: 0,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    isInbox: false,
  };
}
it("keeps an independently shared child visible when its parent is unavailable, and reads uncached parent scope safely", async () => {
  const parent = { ...page(), accessLost: true },
    child = page(parent.id);
  await database.pages.bulkPut([parent, child]);
  expect(await readLinkedPage(child.id)).toEqual({
    page: child,
    visible: true,
  });
  expect(availablePages([parent, child]).map((entry) => entry.id)).toEqual([
    child.id,
  ]);
  await database.pages.delete(parent.id);
  expect((await readLinkedPage(child.id)).visible).toBe(true);
});
it("hides missing/revoked/deleted Pages, Trash descendants and cycles without exposing their labels in link views", async () => {
  const parent = { ...page(), deletedAt: new Date().toISOString() },
    child = page(parent.id),
    revoked = { ...page(), accessLost: true },
    cycle = page();
  cycle.parentId = cycle.id;
  await database.pages.bulkPut([parent, child, revoked, cycle]);
  for (const id of [
    parent.id,
    child.id,
    revoked.id,
    cycle.id,
    crypto.randomUUID(),
  ])
    expect((await readLinkedPage(id)).visible).toBe(false);
  expect(availablePages([parent, child, revoked, cycle])).toEqual([]);
});
