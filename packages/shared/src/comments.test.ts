import { describe, expect, it } from "vitest";
import {
  CommentInputSchema,
  CommentSchema,
  CommentQuerySchema,
  CommentResolutionSchema,
  commentsPath,
  orderPendingComments,
  sameCommentScope,
} from "./index";

const pageId = crypto.randomUUID(),
  rowId = crypto.randomUUID();
const input = { id: crypto.randomUUID(), pageId, body: "  hello  " };
describe("Comment scopes and retry ordering", () => {
  it("keeps legacy Page DTOs and adds optional stable Row scopes", () => {
    expect(CommentInputSchema.parse(input)).toEqual({
      ...input,
      body: "hello",
      parentId: null,
    });
    expect(CommentInputSchema.parse({ ...input, rowId }).rowId).toBe(rowId);
    const dto = {
      ...input,
      parentId: null,
      identityId: crypto.randomUUID(),
      authorName: "Owner",
      resolved: false,
      createdAt: "now",
    };
    expect(CommentSchema.parse(dto)).not.toHaveProperty("rowId");
    expect(CommentSchema.parse({ ...dto, rowId }).rowId).toBe(rowId);
    expect(CommentQuerySchema.parse({ rowId })).toEqual({ rowId });
    expect(CommentResolutionSchema.parse({ resolved: true })).toEqual({
      resolved: true,
    });
  });
  it("rejects invalid scopes, unknown fields and blank or oversized text", () => {
    for (const body of [" ", "x".repeat(10001)])
      expect(() => CommentInputSchema.parse({ ...input, body })).toThrow();
    expect(() => CommentQuerySchema.parse({ rowId: "" })).toThrow();
    expect(() =>
      CommentResolutionSchema.parse({ resolved: true, role: "owner" }),
    ).toThrow();
    expect(() =>
      CommentInputSchema.parse({ ...input, rowId: "bad" }),
    ).toThrow();
  });
  it("builds explicit scope URLs and compares old null scopes", () => {
    expect(commentsPath(pageId)).toBe(`/pages/${pageId}/comments`);
    expect(commentsPath(pageId, rowId)).toBe(
      `/pages/${pageId}/comments?rowId=${rowId}`,
    );
    expect(sameCommentScope({ pageId }, { pageId, rowId: null })).toBe(true);
    expect(sameCommentScope({ pageId }, { pageId, rowId })).toBe(false);
    expect(
      sameCommentScope(
        { pageId, rowId },
        { pageId: crypto.randomUUID(), rowId },
      ),
    ).toBe(false);
    expect(() => commentsPath(pageId, "")).toThrow();
    expect(() => commentsPath("not-an-id")).toThrow();
  });
  it("puts a queued parent before replies even after clock changes without mutating input", () => {
    const parent = {
      id: "parent",
      createdAt: "2026-10-08",
      payload: { parentId: null },
    };
    const reply = {
      id: "reply",
      createdAt: "2026-10-07",
      payload: { parentId: "parent" },
    };
    const external = {
      id: "external",
      createdAt: "2026-10-09",
      payload: { parentId: "server-root" },
    };
    const input = [reply, external, parent];
    expect(orderPendingComments(input)).toEqual([parent, reply, external]);
    expect(input).toEqual([reply, external, parent]);
    expect(orderPendingComments([])).toEqual([]);
    expect(() =>
      orderPendingComments([
        { ...parent, payload: { parentId: "reply" } },
        reply,
      ]),
    ).toThrow("순환");
  });
});
