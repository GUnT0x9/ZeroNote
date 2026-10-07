import { z } from "zod";
import { PageTagSchema } from "./page-tags";

export const MAX_TASK_LABELS = 30;
export const MAX_TASK_DEPENDENCIES = 50;
export const MAX_TASK_ESTIMATE_MINUTES = 365 * 24 * 60;
export const MAX_TASK_TEMPLATES = 20;
export const TaskEstimateSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_TASK_ESTIMATE_MINUTES)
  .nullable();
// Readers retain concurrently merged entries above the write limit so they can be removed.
export const TaskExtensionShape = {
  parentTaskId: z.uuid().nullable().default(null),
  estimateMinutes: TaskEstimateSchema.default(null),
  dependencyIds: z.array(z.uuid()).default([]),
  labels: z.array(PageTagSchema).default([]),
};
function validateTaskEstimate(minutes: number | null): number | null {
  const result = TaskEstimateSchema.safeParse(minutes);
  if (!result.success)
    throw new Error(
      `Estimate는 0–${MAX_TASK_ESTIMATE_MINUTES}분 범위의 정수로 입력해주세요.`,
    );
  return result.data;
}

export function parseTaskEstimate(input: string): number | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/시간/g, "h")
    .replace(/분/g, "m")
    .replace(/\s/g, "");
  if (!text) return null;
  if (/^\d+$/.test(text)) return validateTaskEstimate(Number(text));
  const parts = /^(?:(\d+(?:\.\d{1,4})?)h)?(?:(\d+)m)?$/.exec(text);
  if (!parts || (!parts[1] && !parts[2]))
    throw new Error("시간과 분으로 입력해주세요. 예: 1h 30m 또는 90");
  const [whole, fraction = ""] = (parts[1] ?? "0").split(".");
  const scale = 10 ** fraction.length;
  const numerator = (Number(whole) * scale + Number(fraction || 0)) * 60;
  if (numerator % scale)
    throw new Error("Estimate는 정수 분 단위로 입력해주세요.");
  return validateTaskEstimate(numerator / scale + Number(parts[2] ?? 0));
}
export function formatTaskEstimate(minutes: number | null): string {
  const value = validateTaskEstimate(minutes);
  if (value === null) return "미지정";
  const hours = Math.floor(value / 60),
    rest = value % 60;
  return [hours ? `${hours}시간` : "", rest || !hours ? `${rest}분` : ""]
    .filter(Boolean)
    .join(" ");
}
