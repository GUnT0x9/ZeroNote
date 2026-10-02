import * as Y from "yjs";
import { setXmlAttribute } from "./xml";
export const BUILT_IN_TEMPLATES = [
  {
    id: "meeting",
    name: "회의록",
    sections: ["참석자", "안건", "결정 사항", "다음 작업"],
  },
  {
    id: "technical",
    name: "기술 문서",
    sections: ["목적", "설계", "구현", "검증"],
  },
  {
    id: "weekly",
    name: "주간 계획",
    sections: ["이번 주 목표", "진행 중", "완료", "다음 주"],
  },
] as const;
export type BuiltInTemplate = (typeof BUILT_IN_TEMPLATES)[number];
export function applyBuiltInTemplate(document: Y.Doc, id: string): void {
  const template = BUILT_IN_TEMPLATES.find((item) => item.id === id);
  if (!template) throw new Error("Template을 찾을 수 없습니다.");
  const content = document.getXmlFragment("content");
  if (content.length) throw new Error("빈 새 Page에 Template을 적용해주세요.");
  document.transact(() => {
    const nodes: Y.XmlElement[] = [];
    for (const section of template.sections) {
      const heading = new Y.XmlElement("heading");
      setXmlAttribute(heading, "level", 2);
      const text = new Y.XmlText();
      heading.insert(0, [text]);
      text.insert(0, section);
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText()]);
      nodes.push(heading, paragraph);
    }
    content.insert(0, nodes);
  });
}
export function setPageTemplate(document: Y.Doc, enabled: boolean): void {
  document.getMap("pageSettings").set("template", enabled);
}
export function isPageTemplate(document: Y.Doc): boolean {
  return document.getMap("pageSettings").get("template") === true;
}
