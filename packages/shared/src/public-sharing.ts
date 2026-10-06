import { z } from "zod";

export const PUBLIC_SESSION_MS = 24 * 60 * 60 * 1000;
export const BURN_SESSION_MS = 60 * 60 * 1000;
export const MAX_PUBLIC_LIFETIME_MS = 90 * PUBLIC_SESSION_MS;
export const MAX_PUBLIC_SHARES = 100;
export const MAX_PUBLIC_BYTES = 5 * 1024 * 1024;
export const PublicSecretSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const PublicShareInputSchema = z
  .object({
    operationId: z.uuid(),
    title: z.string().trim().min(1).max(500),
    pageIds: z.array(z.uuid()).min(1).max(1000),
    mode: z.enum(["public", "temporary", "burn"]),
    expiresAt: z.iso.datetime().nullable(),
    password: z.string().min(8).max(128).nullable(),
    secret: PublicSecretSchema.nullable(),
    seo: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.pageIds).size !== value.pageIds.length)
      context.addIssue({ code: "custom", message: "중복 Page입니다." });
    const protectedLink =
      !!value.password || !!value.expiresAt || value.mode !== "public";
    if (protectedLink !== !!value.secret)
      context.addIssue({
        code: "custom",
        message: "보호된 링크에는 Secret이 필요합니다.",
      });
    if (value.mode !== "public" && !value.expiresAt)
      context.addIssue({ code: "custom", message: "만료 시각이 필요합니다." });
    if (value.seo && protectedLink)
      context.addIssue({
        code: "custom",
        message: "보호된 링크는 검색에 등록할 수 없습니다.",
      });
  });
export type PublicShareInput = z.infer<typeof PublicShareInputSchema>;
export const PublicOpenSchema = z
  .object({
    operationId: z.uuid(),
    readerSecret: PublicSecretSchema,
    secret: PublicSecretSchema.nullable(),
    password: z.string().max(128).nullable(),
  })
  .strict();
export type PublicOpen = z.infer<typeof PublicOpenSchema>;
export const PublicShareSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    mode: z.enum(["public", "temporary", "burn"]),
    protected: z.boolean(),
    passwordRequired: z.boolean(),
    expiresAt: z.iso.datetime().nullable(),
    seo: z.boolean(),
  })
  .strict();
export type PublicShare = z.infer<typeof PublicShareSchema>;
export const OwnedPublicShareSchema = PublicShareSchema.extend({
  pageIds: z.array(z.uuid()),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  opened: z.boolean(),
});
export type OwnedPublicShare = z.infer<typeof OwnedPublicShareSchema>;
export const PublicPageSchema = z
  .object({
    key: z.uuid(),
    title: z.string(),
    kind: z.enum(["document", "database"]),
    html: z.string(),
    description: z.string(),
  })
  .strict();
export type PublicPage = z.infer<typeof PublicPageSchema>;
export const PublicContentSchema = z
  .object({
    share: PublicShareSchema,
    pages: z.array(PublicPageSchema.omit({ html: true, description: true })),
    page: PublicPageSchema,
    canonical: z.string().url(),
  })
  .strict();
export type PublicContent = z.infer<typeof PublicContentSchema>;
