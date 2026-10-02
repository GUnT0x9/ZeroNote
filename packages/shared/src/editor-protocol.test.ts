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
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  expect(getDocumentEditorProtocol(copy)).toBe(1);
  doc.destroy();
  copy.destroy();
});
it("requires the current protocol for unknown blocks, task bodies and marks", () => {
  for (const fragment of ["content", "task:row"]) {
    const doc = new Y.Doc();
    doc.getXmlFragment(fragment).insert(0, [new Y.XmlElement("attachment")]);
    expect(getDocumentEditorProtocol(doc)).toBe(EDITOR_PROTOCOL);
    doc.destroy();
  }
  const doc = new Y.Doc(),
    text = new Y.XmlText();
  doc.getXmlFragment("content").insert(0, [text]);
  text.insert(0, "Marked", { highlight: {} });
  expect(getDocumentEditorProtocol(doc)).toBe(EDITOR_PROTOCOL);
  doc.destroy();
});
