import { expect, it } from "vitest";
import * as Y from "yjs";
import { addDatabaseProperty } from "@zeronote/shared";
import {
  accessibleDatabases,
  relatedDatabases,
  MAX_DATABASE_DEPENDENCIES,
} from "./database-context";
import type { LocalPage } from "./database";
const workspaceId = crypto.randomUUID();
function page(overrides: Partial<LocalPage> = {}): LocalPage {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    parentId: null,
    kind: "database",
    title: "자료",
    isInbox: false,
    deletedAt: null,
    revision: 1,
    createdAt: new Date().toISOString(),
    role: "owner",
    ...overrides,
  };
}
it("restricts accessible databases to active same-workspace pages including parent scope", () => {
  const source = page(),
    visible = page(),
    trash = page({ deletedAt: new Date().toISOString() }),
    child = page({ parentId: trash.id });
  expect(
    accessibleDatabases(source, [
      source,
      visible,
      trash,
      child,
      page({ accessLost: true }),
      page({ workspaceId: crypto.randomUUID() }),
      page({ kind: "document" }),
    ]),
  ).toEqual([source, visible]);
});
it("discovers available relation dependencies, handles cycles and ignores unavailable IDs", () => {
  const source = page(),
    target = page(),
    unavailable = page({ accessLost: true });
  const first = new Y.Doc(),
    second = new Y.Doc();
  for (const id of [target.id, unavailable.id])
    addDatabaseProperty(first, id, "relation", [], crypto.randomUUID(), {
      relation: { databaseId: id },
    });
  addDatabaseProperty(second, "돌아가기", "relation", [], crypto.randomUUID(), {
    relation: { databaseId: source.id },
  });
  expect(
    relatedDatabases(
      source.id,
      first,
      accessibleDatabases(source, [source, target, unavailable]),
      (id) => (id === target.id ? second : undefined),
    ),
  ).toEqual([target]);
  first.destroy();
  second.destroy();
});
it("bounds dependency loading rather than opening an entire workspace", () => {
  const source = page(),
    targets = Array.from({ length: 40 }, () => page()),
    document = new Y.Doc();
  for (const target of targets)
    addDatabaseProperty(
      document,
      target.id,
      "relation",
      [],
      crypto.randomUUID(),
      { relation: { databaseId: target.id } },
    );
  expect(
    relatedDatabases(source.id, document, targets, () => undefined),
  ).toHaveLength(MAX_DATABASE_DEPENDENCIES);
  document.destroy();
});
