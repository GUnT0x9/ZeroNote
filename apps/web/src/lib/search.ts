import type { LocalPage, LocalDocument } from "./database";
export interface SearchResult {
  page: LocalPage;
  record: LocalDocument | undefined;
}
export function searchLocalPages(
  pages: LocalPage[],
  documents: LocalDocument[],
  query: string,
  limit = 30,
): SearchResult[] {
  const normalized = query.normalize("NFKC").toLowerCase().trim(),
    records = new Map(documents.map((document) => [document.id, document]));
  return availablePages(pages)
    .map((page) => ({ page, record: records.get(page.id) }))
    .filter(
      ({ page, record }) =>
        !normalized ||
        `${page.title} ${record?.text ?? ""}`
          .normalize("NFKC")
          .toLowerCase()
          .includes(normalized),
    )
    .sort((a, b) =>
      normalized
        ? Number(b.page.title.toLowerCase().includes(normalized)) -
          Number(a.page.title.toLowerCase().includes(normalized))
        : (b.record?.updatedAt ?? 0) - (a.record?.updatedAt ?? 0),
    )
    .slice(0, limit);
}
export function availablePages(pages: LocalPage[]): LocalPage[] {
  const index = new Map(pages.map((page) => [page.id, page]));
  return pages.filter((page) => {
    if (page.accessLost || page.deletedAt) return false;
    let parent = page.parentId;
    const seen = new Set([page.id]);
    while (parent) {
      if (seen.has(parent)) return false;
      seen.add(parent);
      const ancestor = index.get(parent);
      if (ancestor?.deletedAt) return false;
      parent = ancestor?.parentId ?? null;
    }
    return true;
  });
}
export function retainEqualItems<T extends { id: string }>(
  previous: T[],
  next: T[],
): T[] {
  if (previous.length !== next.length) return next;
  return previous.every(
    (value, index) =>
      value.id === next[index]?.id &&
      JSON.stringify(value) === JSON.stringify(next[index]),
  )
    ? previous
    : next;
}
