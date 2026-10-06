import { z } from "zod";

export const SearchHitSchema = z
  .object({
    pageId: z.uuid(),
    workspaceId: z.uuid(),
    rowId: z.uuid().nullable(),
    kind: z.enum(["document", "database"]),
    title: z.string(),
    pageTitle: z.string(),
    workspaceName: z.string(),
    snippet: z.string().max(240),
    updatedAt: z.iso.datetime(),
    tags: z.array(z.string()),
    score: z.number().finite(),
    fuzzy: z.boolean(),
  })
  .strict();
export type SearchHit = z.infer<typeof SearchHitSchema>;
export const SearchResponseSchema = z
  .object({
    hits: z.array(SearchHitSchema).max(50),
    searchedPages: z.number().int().nonnegative(),
    unavailableProperties: z.number().int().nonnegative(),
  })
  .strict();
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export function compareSearchHits(a: SearchHit, b: SearchHit): number {
  const keyA = `${a.pageId}:${a.rowId ?? ""}`,
    keyB = `${b.pageId}:${b.rowId ?? ""}`;
  return (
    Number(a.fuzzy) - Number(b.fuzzy) ||
    b.score - a.score ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    (keyA < keyB ? -1 : keyA > keyB ? 1 : 0)
  );
}
