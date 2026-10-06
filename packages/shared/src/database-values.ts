import { z } from "zod";

export const PropertyValueSchema = z.union([
  z.string().max(10000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(80)).max(50),
  z.null(),
]);
export type PropertyValue = z.infer<typeof PropertyValueSchema>;
export const FilterOperators = [
  "contains",
  "equals",
  "not_equals",
  "empty",
  "not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;
export const DatabaseFilterSchema = z
  .object({
    propertyId: z.string(),
    operator: z.enum(FilterOperators),
    value: PropertyValueSchema,
  })
  .strict();
export type DatabaseFilter = z.infer<typeof DatabaseFilterSchema>;
