import { expect, it } from "vitest";
import {
  MemberGroupInputSchema,
  MemberGrantInputSchema,
  GroupGrantInputSchema,
  MemberProfileInputSchema,
} from "./members";

it("validates group edits and rejects duplicate, foreign-shaped and stale revision inputs", () => {
  const input = {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    name: "  Design  ",
    memberIds: [crypto.randomUUID()],
  };
  expect(MemberGroupInputSchema.parse(input).name).toBe("Design");
  expect(
    MemberGroupInputSchema.parse({ ...input, memberIds: [] }).memberIds,
  ).toEqual([]);
  expect(
    MemberGroupInputSchema.safeParse({
      ...input,
      memberIds: [input.memberIds[0], input.memberIds[0]],
    }).success,
  ).toBe(false);
  expect(
    MemberGroupInputSchema.safeParse({ ...input, name: " " }).success,
  ).toBe(false);
  expect(
    MemberGroupInputSchema.safeParse({ ...input, expectedRevision: -1 })
      .success,
  ).toBe(false);
  expect(
    MemberGroupInputSchema.safeParse({
      ...input,
      workspaceId: crypto.randomUUID(),
    }).success,
  ).toBe(false);
});
it("validates Page access and profile changes without accepting Owner or actor overrides", () => {
  const access = {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    role: "commenter",
    includeDescendants: false,
  };
  expect(MemberGrantInputSchema.parse(access).role).toBe("commenter");
  const grant = {
    ...access,
    id: crypto.randomUUID(),
    groupId: crypto.randomUUID(),
    pageId: crypto.randomUUID(),
  };
  expect(GroupGrantInputSchema.parse(grant).pageId).toBe(grant.pageId);
  expect(
    MemberGrantInputSchema.safeParse({ ...access, role: "owner" }).success,
  ).toBe(false);
  expect(
    GroupGrantInputSchema.safeParse({ ...grant, pageId: "wrong" }).success,
  ).toBe(false);
  const profile = { operationId: crypto.randomUUID(), name: "  Reviewer  " };
  expect(MemberProfileInputSchema.parse(profile).name).toBe("Reviewer");
  expect(
    MemberProfileInputSchema.safeParse({
      ...profile,
      identityId: crypto.randomUUID(),
    }).success,
  ).toBe(false);
});
