import { z } from "zod";
import type * as Y from "yjs";
const XmlAttributeSchema = z.json();
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
