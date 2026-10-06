import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  getPageTags,
  setPageTag,
  removePageTag,
  renamePageTag,
  assertPageTags,
  MAX_PAGE_TAGS,
} from "./page-tags";
import {
  cloneDocumentContent,
  getDocumentProjection,
  getDocumentEditorProtocol,
} from "./index";

it("normalizes Tag keys and preserves the display name with deterministic duplicates", () => {
  const doc = new Y.Doc();
  setPageTag(doc, "  Ｔｅａｍ\tWork  ");
  setPageTag(doc, "team work");
  setPageTag(doc, "가");
  expect(getPageTags(doc)).toEqual(["team work", "가"]);
  expect(getDocumentProjection(doc).tags).toEqual(getPageTags(doc));
  removePageTag(doc, "TEAM WORK");
  removePageTag(doc, "missing");
  expect(getPageTags(doc)).toEqual(["가"]);
  doc.destroy();
});
it("renames and merges an existing Tag without losing another Tag on invalid input", () => {
  const doc = new Y.Doc();
  setPageTag(doc, "A");
  setPageTag(doc, "B");
  renamePageTag(doc, "A", "b");
  expect(getPageTags(doc)).toEqual(["b"]);
  expect(() => renamePageTag(doc, "missing", "C")).toThrow("찾을 수");
  expect(() => renamePageTag(doc, "b", " ")).toThrow();
  expect(getPageTags(doc)).toEqual(["b"]);
  doc.destroy();
});
it("bounds Tag count and length while allowing updates at the count limit", () => {
  const doc = new Y.Doc();
  for (let i = 0; i < MAX_PAGE_TAGS; i++) setPageTag(doc, `Tag ${i}`);
  expect(() => setPageTag(doc, "extra")).toThrow("30개");
  setPageTag(doc, "TAG 0");
  expect(getPageTags(doc)).toHaveLength(MAX_PAGE_TAGS);
  expect(() => setPageTag(doc, "x".repeat(65))).toThrow();
  doc.destroy();
});
it("rejects malformed, noncanonical and oversized remote Tag maps", () => {
  for (const value of [true, 1, " ", " A ", "x".repeat(65)]) {
    const doc = new Y.Doc();
    doc.getMap("pageTags").set("a", value);
    expect(() => assertPageTags(doc)).toThrow();
    doc.destroy();
  }
  const doc = new Y.Doc();
  for (let i = 0; i <= MAX_PAGE_TAGS; i++)
    doc.getMap("pageTags").set(String(i), String(i));
  expect(() => assertPageTags(doc)).toThrow("30개");
  doc.destroy();
});
it("preserves Tags in decoded state and fresh Snapshot/duplicate identities", () => {
  const doc = new Y.Doc(),
    oldId = crypto.randomUUID(),
    newId = crypto.randomUUID();
  setPageTag(doc, "설계");
  const decoded = new Y.Doc();
  Y.applyUpdate(decoded, Y.encodeStateAsUpdate(doc));
  const copy = cloneDocumentContent(decoded, oldId, newId);
  expect(getPageTags(copy)).toEqual(["설계"]);
  expect(getDocumentEditorProtocol(copy)).toBe(4);
  removePageTag(copy, "설계");
  expect(getPageTags(doc)).toEqual(["설계"]);
  expect(getDocumentEditorProtocol(copy)).toBe(4);
  doc.destroy();
  decoded.destroy();
  copy.destroy();
});
it("converges simultaneous independent additions and case variants", () => {
  const left = new Y.Doc(),
    right = new Y.Doc();
  setPageTag(left, "A");
  setPageTag(left, "Team");
  setPageTag(right, "B");
  setPageTag(right, "TEAM");
  const a = Y.encodeStateAsUpdate(left),
    b = Y.encodeStateAsUpdate(right);
  Y.applyUpdate(left, b);
  Y.applyUpdate(right, a);
  expect(getPageTags(left)).toEqual(getPageTags(right));
  expect(getPageTags(left)).toHaveLength(3);
  left.destroy();
  right.destroy();
});

it("keeps concurrent overflow readable until an extra Tag is removed", () => {
  const left = new Y.Doc(),
    right = new Y.Doc();
  for (let i = 0; i < MAX_PAGE_TAGS - 1; i++) setPageTag(left, `Tag ${i}`);
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  setPageTag(left, "Left");
  setPageTag(right, "Right");
  const a = Y.encodeStateAsUpdate(left),
    b = Y.encodeStateAsUpdate(right);
  Y.applyUpdate(left, b);
  Y.applyUpdate(right, a);
  expect(getPageTags(left)).toHaveLength(MAX_PAGE_TAGS + 1);
  expect(() => assertPageTags(left)).toThrow("30개");
  expect(() => renamePageTag(left, "Left", "Replacement")).toThrow("30개");
  expect(getPageTags(left)).toContain("Left");
  expect(getPageTags(left)).not.toContain("Replacement");
  renamePageTag(left, "Left", "LEFT");
  expect(getPageTags(left)).toContain("LEFT");
  removePageTag(left, "Right");
  expect(() => assertPageTags(left)).not.toThrow();
  left.destroy();
  right.destroy();
});
