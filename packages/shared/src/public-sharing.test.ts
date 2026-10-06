import { it, expect } from "vitest";
import { PublicOpenSchema, PublicShareInputSchema } from "./public-sharing";
const input = () => ({
  operationId: crypto.randomUUID(),
  title: "Published",
  pageIds: [crypto.randomUUID()],
  mode: "public",
  expiresAt: null,
  password: null,
  secret: null,
  seo: false,
});
it("validates selected public Pages and all protected modes with no automatic SEO", () => {
  const publicPage = input();
  expect(PublicShareInputSchema.parse(publicPage)).toEqual(publicPage);
  for (const mode of ["public", "temporary", "burn"])
    expect(
      PublicShareInputSchema.parse({
        ...publicPage,
        mode,
        secret: "a".repeat(64),
        expiresAt: new Date().toISOString(),
      }).mode,
    ).toBe(mode);
  expect(() =>
    PublicShareInputSchema.parse({
      ...publicPage,
      pageIds: [...publicPage.pageIds, ...publicPage.pageIds],
    }),
  ).toThrow();
  expect(() =>
    PublicShareInputSchema.parse({ ...publicPage, mode: "temporary" }),
  ).toThrow();
  expect(() =>
    PublicShareInputSchema.parse({
      ...publicPage,
      password: "password",
      secret: "a".repeat(64),
      seo: true,
    }),
  ).toThrow();
  expect(() =>
    PublicShareInputSchema.parse({ ...publicPage, pageIds: [] }),
  ).toThrow();
  expect(() =>
    PublicShareInputSchema.parse({ ...publicPage, secret: "a".repeat(64) }),
  ).toThrow();
});
it("requires an opaque reader secret and rejects extra or URL-shaped secrets", () => {
  const value = {
    operationId: crypto.randomUUID(),
    readerSecret: "b".repeat(64),
    secret: null,
    password: null,
  };
  expect(PublicOpenSchema.parse(value)).toEqual(value);
  expect(() =>
    PublicOpenSchema.parse({ ...value, readerSecret: "https://secret.test" }),
  ).toThrow();
  expect(() =>
    PublicOpenSchema.parse({ ...value, deviceId: crypto.randomUUID() }),
  ).toThrow();
});
