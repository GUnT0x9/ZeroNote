import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  isValidDateOnly,
  canEdit,
  canComment,
  bytesToBase64,
  base64ToBytes,
  sha256Hex,
  createRecoveryKey,
  normalizeRecoveryKey,
  replaceSharedText,
  createTaskRow,
  getTaskRows,
  updateTaskField,
  getDocumentProjection,
  wouldCreateCycle,
  safeLinkHref,
  ExportSchema,
  updatesHaveSameSnapshot,
} from "./index";

describe("Calendar dates", () => {
  it("accepts leap dates", () =>
    expect(isValidDateOnly("2024-02-29")).toBe(true));
  it("rejects rollover and timestamps", () => {
    expect(isValidDateOnly("2025-02-29")).toBe(false);
    expect(isValidDateOnly("2026-10-01T00:00Z")).toBe(false);
  });
});
describe("Role boundaries", () => {
  it("permits editor writes and commenter comments", () => {
    expect(canEdit("editor")).toBe(true);
    expect(canComment("commenter")).toBe(true);
  });
  it("rejects viewer writes and missing grants", () => {
    expect(canEdit("viewer")).toBe(false);
    expect(canComment(undefined)).toBe(false);
  });
});
describe("Binary transport", () => {
  it("round trips large binary payloads", () => {
    const data = Uint8Array.from({ length: 20000 }, (_, index) => index % 256);
    expect(base64ToBytes(bytesToBase64(data))).toEqual(data);
  });
  it("rejects invalid encodings", () =>
    expect(() => base64ToBytes("bad!")).toThrow());
});
describe("Recovery material", () => {
  it("creates independent 256-bit keys", () => {
    const key = createRecoveryKey();
    expect(key).toMatch(/^ZN1-(?:[A-F0-9]{8}-){7}[A-F0-9]{8}$/);
    expect(createRecoveryKey()).not.toBe(key);
  });
  it("normalizes paste whitespace and case", () =>
    expect(normalizeRecoveryKey(" zn1-abcd ")).toBe("ZN1-ABCD"));
  it("computes SHA-256", async () =>
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ));
  it("hashes an empty string deterministically", async () =>
    expect(await sha256Hex("")).toHaveLength(64));
});
describe("Shared text", () => {
  it("updates only the edited range", () => {
    const doc = new Y.Doc();
    const text = doc.getText("title");
    text.insert(0, "Hello world");
    replaceSharedText(text, "Hello friend");
    expect(text.toString()).toBe("Hello friend");
  });
  it("handles empty and identical values", () => {
    const doc = new Y.Doc();
    const text = doc.getText("title");
    replaceSharedText(text, "");
    replaceSharedText(text, "abc");
    replaceSharedText(text, "abc");
    expect(text.toString()).toBe("abc");
  });
});
describe("Task data", () => {
  it("creates a row and updates properties", () => {
    const doc = new Y.Doc();
    const id = createTaskRow(doc, "Ship Alpha");
    updateTaskField(doc, id, "status", "done");
    expect(getTaskRows(doc)[0]?.status).toBe("done");
  });
  it("rejects invalid dates and missing rows", () => {
    const doc = new Y.Doc();
    const id = createTaskRow(doc, "x");
    expect(() => updateTaskField(doc, id, "dueDate", "2025-02-29")).toThrow();
    expect(() =>
      updateTaskField(doc, crypto.randomUUID(), "status", "done"),
    ).toThrow();
  });
  it("ignores malformed and deleted rows", () => {
    const doc = new Y.Doc();
    createTaskRow(doc, "Keep");
    const id = createTaskRow(doc, "Remove");
    updateTaskField(doc, id, "deleted", true);
    doc.getMap("tasks").set("invalid", "bad");
    expect(getTaskRows(doc)).toHaveLength(1);
  });
  it("converges different offline field edits", () => {
    const first = new Y.Doc(),
      second = new Y.Doc();
    const id = createTaskRow(first, "Shared");
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    updateTaskField(first, id, "status", "done");
    updateTaskField(second, id, "priority", "high");
    const a = Y.encodeStateAsUpdate(first),
      b = Y.encodeStateAsUpdate(second);
    Y.applyUpdate(first, b);
    Y.applyUpdate(second, a);
    expect(getTaskRows(first)).toEqual(getTaskRows(second));
    expect(getTaskRows(first)[0]).toMatchObject({
      status: "done",
      priority: "high",
    });
  });
});
describe("Projections and trees", () => {
  it("extracts visible text and stable mentions", () => {
    const doc = new Y.Doc();
    doc.getText("title").insert(0, "Notes");
    const p = new Y.XmlElement("paragraph"),
      text = new Y.XmlText();
    p.insert(0, [text]);
    text.insert(0, "Hello");
    const mention = new Y.XmlElement("pageMention");
    mention.setAttribute("pageId", "target");
    p.insert(1, [mention]);
    doc.getXmlFragment("content").insert(0, [p]);
    expect(getDocumentProjection(doc)).toMatchObject({
      title: "Notes",
      references: ["target"],
    });
  });
  it("projects empty documents", () =>
    expect(getDocumentProjection(new Y.Doc()).text).toBe(" "));
  it("detects ancestor cycles", () =>
    expect(wouldCreateCycle("a", "b", [{ id: "b", parentId: "a" }])).toBe(
      true,
    ));
  it("permits root moves and missing ancestors", () => {
    expect(wouldCreateCycle("a", null, [])).toBe(false);
    expect(wouldCreateCycle("a", "b", [])).toBe(false);
  });
});
describe("Untrusted input", () => {
  it("allows normal links", () =>
    expect(safeLinkHref("https://example.com")).toBe("https://example.com"));
  it("rejects script and data URLs", () => {
    expect(safeLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeLinkHref("data:text/html,test")).toBeNull();
  });
  it("accepts a versioned export", () =>
    expect(
      ExportSchema.safeParse({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        name: "Notes",
        pages: [],
      }).success,
    ).toBe(true));
  it("rejects secret fields and incompatible versions", () => {
    expect(
      ExportSchema.safeParse({
        schemaVersion: 1,
        exportedAt: "now",
        name: "x",
        pages: [],
        recoveryKey: "secret",
      }).success,
    ).toBe(false);
    expect(ExportSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
  });
});

describe("Alpha data scale", () => {
  it("projects 500 blocks including linked task bodies and indexes 1000 tasks", () => {
    const doc = new Y.Doc(),
      fragment = doc.getXmlFragment("content");
    doc.transact(() => {
      for (let i = 0; i < 500; i++) {
        const paragraph = new Y.XmlElement("paragraph"),
          text = new Y.XmlText();
        text.insert(0, `Block ${i}`);
        paragraph.insert(0, [text]);
        fragment.insert(fragment.length, [paragraph]);
      }
      for (let i = 0; i < 1000; i++) createTaskRow(doc, `Task ${i}`);
    });
    const row = getTaskRows(doc)[0]!,
      mention = new Y.XmlElement("pageMention"),
      target = crypto.randomUUID();
    mention.setAttribute("pageId", target);
    doc.getXmlFragment(`task:${row.id}`).insert(0, [mention]);
    const started = performance.now(),
      projection = getDocumentProjection(doc);
    expect(projection.text).toContain("Block 499");
    expect(projection.text).toContain("Task 999");
    expect(projection.references).toContain(target);
    expect(performance.now() - started).toBeLessThan(200);
    doc.destroy();
  });
});

describe("Durable state comparison", () => {
  it("matches equivalent persisted documents and distinguishes deletion updates", () => {
    const left = new Y.Doc(),
      right = new Y.Doc();
    left.getText("title").insert(0, "Persisted");
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    expect(
      updatesHaveSameSnapshot(
        Y.encodeStateAsUpdate(left),
        Y.encodeStateAsUpdate(right),
      ),
    ).toBe(true);
    left.getText("title").delete(0, 1);
    expect(
      updatesHaveSameSnapshot(
        Y.encodeStateAsUpdate(left),
        Y.encodeStateAsUpdate(right),
      ),
    ).toBe(false);
  });
  it("rejects damaged snapshots", () => {
    expect(() =>
      updatesHaveSameSnapshot(new Uint8Array([255]), new Uint8Array()),
    ).toThrow();
  });
});
