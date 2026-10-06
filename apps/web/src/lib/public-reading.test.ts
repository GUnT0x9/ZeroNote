import { it, expect, vi, afterEach } from "vitest";
import { ApiError } from "./http";
import {
  publicReaderSecret,
  publicReadingError,
  readPublicContent,
  readPublicDescriptor,
} from "./public-reading";
import { publicPageMetadata } from "./public-metadata";
import type { PublicContent } from "@zeronote/shared";
const id = "dbe3f53c-7338-410f-8b80-9bd7d551c30e";
const share = {
  id,
  title: "Published",
  mode: "public" as const,
  protected: false,
  passwordRequired: false,
  expiresAt: null,
  seo: true,
};
const content: PublicContent = {
  share,
  pages: [{ key: id, title: "Visible", kind: "document" }],
  page: {
    key: id,
    title: "Visible",
    kind: "document",
    html: "<p>body</p>",
    description: "Current body",
  },
  canonical: `https://example.test/s/${id}/${id}`,
};
afterEach(() => vi.unstubAllGlobals());
it("reads only anonymous public endpoints and validates malformed JSON without creating a Device", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(content)))
    .mockResolvedValueOnce(new Response(JSON.stringify(share)))
    .mockResolvedValueOnce(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  expect(await readPublicContent(id, id)).toEqual(content);
  expect(await readPublicDescriptor(id)).toEqual(share);
  expect(fetch.mock.calls[0]![0]).toBe(`/v1/public/${id}/content/${id}`);
  await expect(readPublicContent(id)).rejects.toThrow();
  await expect(readPublicContent("../../devices")).rejects.toThrow();
  await expect(readPublicContent(id, "../content")).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(
    publicReadingError(new ApiError(503, "private app wording")),
  ).toContain("서버 연결");
  expect(publicReadingError(new Error("Expired"))).toBe("Expired");
  expect(publicReaderSecret()).toMatch(/^[a-f0-9]{64}$/);
  expect(publicReaderSecret()).not.toBe(publicReaderSecret());
});
it("opts into SEO only for unprotected published content and creates canonical metadata", () => {
  const metadata = publicPageMetadata(content);
  expect(metadata.title).toBe("Visible | ZeroNote");
  expect(metadata.alternates).toEqual({ canonical: content.canonical });
  expect(metadata.robots).toEqual({ index: true, follow: true });
  for (const value of [
    null,
    { ...content, share: { ...share, seo: false } },
    { ...content, share: { ...share, protected: true } },
  ]) {
    expect(publicPageMetadata(value).robots).toEqual({
      index: false,
      follow: false,
    });
    expect(publicPageMetadata(value).alternates).toBeUndefined();
  }
});
