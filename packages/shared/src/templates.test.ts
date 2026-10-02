import { it, expect } from "vitest";
import * as Y from "yjs";
import { setXmlAttribute } from "./xml";
import {
  applyBuiltInTemplate,
  setPageTemplate,
  isPageTemplate,
} from "./templates";
import { cloneDocumentContent } from "./index";
it("builds typed heading blocks and prevents destructive template replacement", () => {
  const document = new Y.Doc();
  applyBuiltInTemplate(document, "meeting");
  const first = document.getXmlFragment("content").get(0) as Y.XmlElement;
  expect(first.nodeName).toBe("heading");
  expect(first.getAttribute("level")).toBe(2);
  expect(document.getXmlFragment("content").toString()).toContain("참석자");
  expect(() => applyBuiltInTemplate(document, "weekly")).toThrow("빈 새 Page");
  const before = Y.encodeStateAsUpdate(document);
  expect(() => applyBuiltInTemplate(document, "unknown")).toThrow("찾을");
  expect(Y.encodeStateAsUpdate(document)).toEqual(before);
  document.destroy();
});
it("syncs template flags and preserves non-string block attributes in fresh copies", () => {
  const document = new Y.Doc();
  applyBuiltInTemplate(document, "technical");
  setPageTemplate(document, true);
  const task = new Y.XmlElement("taskItem");
  setXmlAttribute(task, "checked", true);
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText()]);
  task.insert(0, [paragraph]);
  document.getXmlFragment("content").insert(0, [task]);
  const copy = cloneDocumentContent(
    document,
    crypto.randomUUID(),
    crypto.randomUUID(),
  );
  expect(isPageTemplate(copy)).toBe(true);
  expect(
    (copy.getXmlFragment("content").get(0) as Y.XmlElement).getAttribute(
      "checked",
    ),
  ).toBe(true);
  expect(
    (copy.getXmlFragment("content").get(1) as Y.XmlElement).getAttribute(
      "level",
    ),
  ).toBe(2);
  setPageTemplate(copy, false);
  expect(isPageTemplate(copy)).toBe(false);
  expect(isPageTemplate(document)).toBe(true);
  copy.destroy();
  document.destroy();
});
