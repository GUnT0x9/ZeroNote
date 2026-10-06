import { expect, it } from "vitest";
import * as Y from "yjs";
import { EDITOR_PROTOCOL, getDocumentEditorProtocol } from "./editor-protocol";

it("accepts legacy text, headings and marks, including decoded documents", () => {
  const doc = new Y.Doc(),
    paragraph = new Y.XmlElement("paragraph"),
    text = new Y.XmlText();
  paragraph.insert(0, [text]);
  doc.getXmlFragment("content").insert(0, [paragraph]);
  text.insert(0, "Text", { bold: {} });
  text.insert(text.length, "Link", {
    "link--AbCd1234": { href: "https://example.com" },
  });
  paragraph.insert(1, [new Y.XmlElement("hardBreak")]);
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  expect(getDocumentEditorProtocol(copy)).toBe(1);
  doc.destroy();
  copy.destroy();
});
it("preserves protocol 2 for attachment bodies and requires the current protocol for unknown marks", () => {
  for (const fragment of ["content", "task:row"]) {
    const doc = new Y.Doc();
    doc.getXmlFragment(fragment).insert(0, [new Y.XmlElement("attachment")]);
    expect(getDocumentEditorProtocol(doc)).toBe(2);
    doc.destroy();
  }
  const doc = new Y.Doc(),
    text = new Y.XmlText();
  doc.getXmlFragment("content").insert(0, [text]);
  text.insert(0, "Marked", { highlight: {} });
  expect(getDocumentEditorProtocol(doc)).toBe(EDITOR_PROTOCOL);
  doc.destroy();
});
it("requires protocol 3 for new Property definitions, including decoded and deleted definitions", () => {
  for (const type of ["file", "formula", "relation", "rollup"]) {
    const document = new Y.Doc(),
      property = new Y.Map<unknown>();
    document
      .getMap<Y.Map<unknown>>("databaseProperties")
      .set("field", property);
    property.set("type", type);
    property.set("deleted", true);
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, Y.encodeStateAsUpdate(document));
    expect(getDocumentEditorProtocol(decoded)).toBe(3);
    decoded.destroy();
    document.destroy();
  }
  const document = new Y.Doc();
  document
    .getMap<Y.Map<unknown>>("databaseProperties")
    .set("field", new Y.Map([["type", "number"]]));
  expect(getDocumentEditorProtocol(document)).toBe(1);
});
