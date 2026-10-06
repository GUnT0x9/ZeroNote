import { PublicReader } from "@/components/public-reader";
import { loadPublicPage } from "@/lib/public-server";
import { publicPageMetadata } from "@/lib/public-metadata";
type Props = { params: Promise<{ shareId: string; pageKey?: string[] }> };
export async function generateMetadata({ params }: Props) {
  const { shareId, pageKey } = await params;
  const result = await loadPublicPage(
    shareId,
    pageKey?.length === 1
      ? pageKey[0]
      : pageKey?.length
        ? "invalid"
        : undefined,
  );
  return publicPageMetadata(result.content);
}
export default async function PublicPage({ params }: Props) {
  const { shareId, pageKey } = await params;
  const key =
    pageKey?.length === 1
      ? pageKey[0]
      : pageKey?.length
        ? "invalid"
        : undefined;
  const result = await loadPublicPage(shareId, key);
  return (
    <PublicReader
      id={shareId}
      pageKey={key}
      initialContent={result.content}
      initialShare={result.share}
      initialError={result.error}
    />
  );
}
