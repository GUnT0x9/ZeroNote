import { database, type LocalPage } from "./database";
/** A Page grant remains valid even when its parent is not shared. Trash still propagates. */
export async function readLinkedPage(
  id: string,
): Promise<{ page: LocalPage | undefined; visible: boolean }> {
  const page = await database.pages.get(id);
  if (!page || page.accessLost || page.deletedAt || page.ancestorTrashed)
    return { page, visible: false };
  const seen = new Set([id]);
  let parentId = page.parentId;
  while (parentId) {
    if (seen.has(parentId)) return { page, visible: false };
    seen.add(parentId);
    const parent = await database.pages.get(parentId);
    if (parent?.deletedAt || parent?.ancestorTrashed)
      return { page, visible: false };
    parentId = parent?.parentId ?? null;
  }
  return { page, visible: true };
}
