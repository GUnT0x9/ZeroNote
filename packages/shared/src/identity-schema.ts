import { z } from "zod";

export const Roles = ["editor", "commenter", "viewer"] as const;
export const RoleSchema = z.enum(Roles);
export const IdSchema = z.uuid();
export const MAX_IDENTITY_NAME_LENGTH = 160;
export const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_IDENTITY_NAME_LENGTH);
