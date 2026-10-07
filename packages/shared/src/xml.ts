import { z } from "zod";
import * as Y from "yjs";
const XmlAttributeSchema = z.json();
const MAX_XML_CLONE_DEPTH = 256;
export type XmlAttribute = z.infer<typeof XmlAttributeSchema>;
export function setXmlAttribute(
  node: Y.XmlElement,
  key: string,
  value: unknown,
): void {
  // Yjs supports JSON attributes at runtime, but XmlFragment.insert defaults to string attributes.
  const writable = node as unknown as Y.XmlElement<
    Record<string, XmlAttribute>
  >;
  writable.setAttribute(key, XmlAttributeSchema.parse(value));
}
export function cloneXmlContent(
  fragment: Y.XmlFragment,
  remap: (key: string, value: unknown, node: Y.XmlElement) => unknown = (
    _key,
    value,
  ) => value,
): (Y.XmlElement | Y.XmlText)[] {
  const clone = (
    node: Y.XmlElement | Y.XmlText,
    depth: number,
  ): Y.XmlElement | Y.XmlText => {
    if (depth > MAX_XML_CLONE_DEPTH)
      throw new Error("본문의 중첩이 너무 깊습니다.");
    if (node instanceof Y.XmlText) {
      const text = new Y.XmlText();
      text.applyDelta(node.toDelta());
      return text;
    }
    const element = new Y.XmlElement(node.nodeName);
    for (const [key, value] of Object.entries(node.getAttributes()))
      setXmlAttribute(element, key, remap(key, value, node));
    element.insert(
      0,
      node
        .toArray()
        .flatMap((child) =>
          child instanceof Y.XmlHook ? [] : [clone(child, depth + 1)],
        ),
    );
    return element;
  };
  return fragment
    .toArray()
    .flatMap((node) => (node instanceof Y.XmlHook ? [] : [clone(node, 0)]));
}
