import type { Metadata } from "next";
import type { PublicContent } from "@zeronote/shared";
export function publicPageMetadata(content: PublicContent | null): Metadata {
  if (!content || !content.share.seo || content.share.protected)
    return {
      title: "공유 문서 | ZeroNote",
      description: "ZeroNote 공유 문서",
      robots: { index: false, follow: false },
    };
  const title = content.page.title || content.share.title,
    description = content.page.description || content.share.title;
  return {
    title: `${title} | ZeroNote`,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: content.canonical },
    openGraph: { type: "article", title, description, url: content.canonical },
    twitter: { card: "summary", title, description },
  };
}
