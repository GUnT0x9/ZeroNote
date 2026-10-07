import { z } from "zod";
import { IdSchema, NameSchema, RoleSchema } from "./identity-schema";

export const MAX_MEMBER_GROUPS = 100;
export const MAX_GROUP_MEMBERS = 1000;
const RevisionSchema = z.number().int().nonnegative();
export const MemberOperationSchema = z
  .object({ operationId: IdSchema })
  .strict();
export const MemberRevisionSchema = MemberOperationSchema.extend({
  expectedRevision: RevisionSchema,
}).strict();
export const MemberProfileInputSchema = MemberOperationSchema.extend({
  name: NameSchema,
}).strict();
export const MemberProfileSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  role: z.enum(["owner", "member"]),
});
export const MemberGroupInputSchema = MemberRevisionSchema.extend({
  name: NameSchema,
  memberIds: z.array(IdSchema).max(MAX_GROUP_MEMBERS),
})
  .strict()
  .refine((input) => new Set(input.memberIds).size === input.memberIds.length, {
    message: "같은 멤버를 두 번 추가할 수 없습니다.",
    path: ["memberIds"],
  });
export const MemberGrantInputSchema = MemberRevisionSchema.extend({
  role: RoleSchema,
  includeDescendants: z.boolean(),
}).strict();
export const GroupGrantInputSchema = MemberGrantInputSchema.extend({
  id: IdSchema,
  groupId: IdSchema,
  pageId: IdSchema,
}).strict();
const GrantFields = {
  id: IdSchema,
  pageId: IdSchema,
  role: RoleSchema,
  includeDescendants: z.boolean(),
  revision: RevisionSchema,
  revoked: z.boolean(),
};
export const MemberGrantSchema = z.object({
  ...GrantFields,
  identityId: IdSchema,
});
export const GroupGrantSchema = z.object({ ...GrantFields, groupId: IdSchema });
export const MemberGroupSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: NameSchema,
  revision: RevisionSchema,
  memberIds: z.array(IdSchema),
});
export const WorkspaceMemberSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  owner: z.boolean(),
  revoked: z.boolean(),
  devices: z.array(
    z.object({ id: IdSchema, name: z.string(), revoked: z.boolean() }),
  ),
  grants: z.array(MemberGrantSchema),
  groupIds: z.array(IdSchema),
});
export const WorkspaceMembersSchema = z.object({
  ownIdentityId: IdSchema,
  members: z.array(WorkspaceMemberSchema),
  groups: z.array(MemberGroupSchema),
  groupGrants: z.array(GroupGrantSchema),
});
export type MemberGroup = z.infer<typeof MemberGroupSchema>;
export type GroupGrant = z.infer<typeof GroupGrantSchema>;
export type MemberGrant = z.infer<typeof MemberGrantSchema>;
export type MemberGroupInput = z.infer<typeof MemberGroupInputSchema>;
export type MemberGrantInput = z.infer<typeof MemberGrantInputSchema>;
export type GroupGrantInput = z.infer<typeof GroupGrantInputSchema>;
export type MemberRevision = z.infer<typeof MemberRevisionSchema>;
export type MemberOperation = z.infer<typeof MemberOperationSchema>;
export type MemberProfileInput = z.infer<typeof MemberProfileInputSchema>;
export type WorkspaceMembers = z.infer<typeof WorkspaceMembersSchema>;
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type MemberProfile = z.infer<typeof MemberProfileSchema>;
