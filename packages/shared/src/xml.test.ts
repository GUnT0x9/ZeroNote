import { it, expect } from "vitest";
import * as Y from "yjs";
import { setXmlAttribute } from "./xml";
it("preserves typed ProseMirror attributes and rejects non-JSON values", () => {
  const document = new Y.Doc(),
    node = new Y.XmlElement("tableCell");
  document.getXmlFragment("content").insert(0, [node]);
  setXmlAttribute(node, "colwidth", [120, 180]);
  setXmlAttribute(node, "checked", true);
  setXmlAttribute(node, "level", 2);
  const attrs: Record<string, unknown> = node.getAttributes();
  expect(attrs.colwidth).toEqual([120, 180]);
  expect(attrs.checked).toBe(true);
  expect(attrs.level).toBe(2);
  expect(() => setXmlAttribute(node, "unsafe", () => "bad")).toThrow();
  expect(() => setXmlAttribute(node, "unsafe", undefined)).toThrow();
  expect(node.getAttribute("unsafe")).toBeUndefined();
  document.destroy();
});
