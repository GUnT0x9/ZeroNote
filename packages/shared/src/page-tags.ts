import { z } from "zod";
import type * as Y from "yjs";
import { normalizeSearchText } from "./search-normalize";

export const MAX_PAGE_TAGS = 30;
export const MAX_PAGE_TAG_LENGTH = 64;
export const PageTagSchema = z
  .string()
  .transform((value) => value.normalize("NFKC").replace(/\s+/gu, " ").trim())
  .pipe(z.string().min(1).max(MAX_PAGE_TAG_LENGTH));

export function assertPageTags(document: Y.Doc): void {
  const tags = document.getMap<unknown>("pageTags");
  if (tags.size > MAX_PAGE_TAGS) throw new Error("Page Tag는 최대 30개입니다.");
  for (const [key, raw] of tags) {
    const label = PageTagSchema.parse(raw);
    if (raw !== label || key !== normalizeSearchText(label))
      throw new Error("Tag 이름과 Key가 일치하지 않습니다.");
  }
}
export function getPageTags(document: Y.Doc): string[] {
  // Concurrent valid additions can exceed the server limit. Keep them readable
  // locally so the user can remove a Tag and resubmit preserved changes.
  return [...document.getMap<unknown>("pageTags")]
    .flatMap(([key, raw]) => {
      const parsed = PageTagSchema.safeParse(raw);
      return parsed.success && key === normalizeSearchText(parsed.data)
        ? [parsed.data]
        : [];
    })
    .sort((a, b) => a.localeCompare(b));
}
export function setPageTag(document: Y.Doc, input: string): void {
  const label = PageTagSchema.parse(input),
    key = normalizeSearchText(label);
  const tags = document.getMap<string>("pageTags");
  if (!tags.has(key) && tags.size >= MAX_PAGE_TAGS)
    throw new Error("Page Tag는 최대 30개입니다.");
  document.transact(() => {
    tags.set(key, label);
    document.getMap("pageSettings").set("tagProtocol", 4);
  });
}
export function removePageTag(document: Y.Doc, label: string): void {
  document.getMap("pageTags").delete(normalizeSearchText(label));
}
export function renamePageTag(
  document: Y.Doc,
  previous: string,
  next: string,
): void {
  const tags = document.getMap<string>("pageTags");
  const original = normalizeSearchText(previous),
    label = PageTagSchema.parse(next);
  if (!tags.has(original)) throw new Error("변경할 Tag를 찾을 수 없습니다.");
  const replacement = normalizeSearchText(label);
  if (
    replacement !== original &&
    !tags.has(replacement) &&
    tags.size > MAX_PAGE_TAGS
  )
    throw new Error("Page Tag는 최대 30개입니다.");
  document.transact(() => {
    if (original !== replacement) tags.delete(original);
    tags.set(replacement, label);
    document.getMap("pageSettings").set("tagProtocol", 4);
  });
}
