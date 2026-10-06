import { z } from "zod";
import { DatabaseFilterSchema } from "./database";

export const MAX_SEARCH_QUERY_LENGTH = 512;
export const MAX_SEARCH_CLAUSES = 32;
export const MAX_SEARCH_TAG_LENGTH = 64;
const SearchFields = ["type", "tag", "workspace", "before", "after"] as const;
export const SearchClauseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      value: z.string().min(1).max(MAX_SEARCH_QUERY_LENGTH),
      phrase: z.boolean(),
      excluded: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("filter"),
      field: z.enum(SearchFields),
      value: z.string().min(1).max(MAX_SEARCH_QUERY_LENGTH),
      excluded: z.boolean(),
    })
    .strict()
    .refine(({ field, value }) => {
      if (!value.trim()) return false;
      if (field === "type") return ["document", "database"].includes(value);
      if (field === "before" || field === "after")
        return z.iso.date().safeParse(value).success;
      return field !== "tag" || value.length <= MAX_SEARCH_TAG_LENGTH;
    }, "검색 필터 값이 올바르지 않습니다."),
  z
    .object({
      kind: z.literal("property"),
      property: z.string().trim().min(1).max(80),
      operator: DatabaseFilterSchema.shape.operator,
      value: DatabaseFilterSchema.shape.value,
      excluded: z.boolean(),
    })
    .strict(),
]);
export const SearchQuerySchema = z
  .object({
    clauses: z.array(SearchClauseSchema).max(MAX_SEARCH_CLAUSES),
  })
  .strict();
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchClause = z.infer<typeof SearchClauseSchema>;
interface SearchPart {
  value: string;
  quoted: boolean;
  end: number;
}
interface SearchToken {
  parts: SearchPart[];
  excluded: boolean;
  start: number;
  end: number;
}

export class SearchSyntaxError extends Error {
  constructor(
    readonly position: number,
    message: string,
  ) {
    super(`${position + 1}번째 문자: ${message}`);
    this.name = "SearchSyntaxError";
  }
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function readQuotedPart(source: string, start: number): SearchPart {
  let value = "",
    index = start + 1;
  while (index < source.length) {
    const character = source[index++]!;
    if (character === '"') return { value, quoted: true, end: index };
    if (character !== "\\") {
      value += character;
      continue;
    }
    const escaped = source[index++];
    if (escaped !== '"' && escaped !== "\\")
      throw new SearchSyntaxError(
        index - 2,
        "따옴표와 역슬래시만 이스케이프할 수 있습니다.",
      );
    value += escaped;
  }
  throw new SearchSyntaxError(start, "따옴표를 닫아주세요.");
}

function readSearchPart(source: string, start: number): SearchPart {
  if (source[start] === '"') {
    const part = readQuotedPart(source, start);
    if (source[part.end] && !/[:\s]/u.test(source[part.end]!))
      throw new SearchSyntaxError(
        part.end,
        "따옴표 뒤에는 공백이나 콜론이 필요합니다.",
      );
    return part;
  }
  let end = start;
  while (end < source.length && !/[:\s]/u.test(source[end]!)) {
    if (source[end] === '"')
      throw new SearchSyntaxError(end, "따옴표는 값의 시작에 사용해주세요.");
    end++;
  }
  return { value: source.slice(start, end), quoted: false, end };
}

function readSearchToken(source: string, start: number): SearchToken {
  const excluded = source[start] === "-";
  let index = start + Number(excluded);
  const parts: SearchPart[] = [];
  for (;;) {
    const part = readSearchPart(source, index);
    if (!part.value.trim())
      throw new SearchSyntaxError(index, "검색 값이 필요합니다.");
    parts.push(part);
    index = part.end;
    if (source[index] !== ":") break;
    index++;
  }
  return { parts, excluded, start, end: index };
}

function propertyClause(token: SearchToken): SearchClause {
  const property = token.parts[1]?.value;
  const operator = DatabaseFilterSchema.shape.operator.safeParse(
    token.parts[2]?.value,
  );
  if (!property || property.length > 80 || !operator.success)
    throw new SearchSyntaxError(
      token.start,
      "prop:속성:연산자:값 형식과 지원 연산자를 사용해주세요.",
    );
  const empty = ["empty", "not_empty"].includes(operator.data);
  if (token.parts.length !== (empty ? 3 : 4))
    throw new SearchSyntaxError(
      token.start,
      empty
        ? "빈 값 조건에는 값을 넣지 않습니다."
        : "속성 조건 값이 필요합니다.",
    );
  const part = token.parts[3];
  let value: string | number | boolean | null = part?.value ?? null;
  if (part && !part.quoted) {
    if (/^(true|false)$/u.test(part.value)) value = part.value === "true";
    else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(part.value))
      value = Number(part.value);
  }
  if (typeof value === "number" && !Number.isFinite(value))
    throw new SearchSyntaxError(token.start, "유한한 숫자를 사용해주세요.");
  return {
    kind: "property",
    property: property.trim(),
    operator: operator.data,
    value,
    excluded: token.excluded,
  };
}

function clauseFromToken(token: SearchToken): SearchClause {
  const first = token.parts[0]!;
  if (
    token.parts.length === 1 ||
    (!first.quoted && /^https?$/iu.test(first.value))
  )
    return {
      kind: "text",
      value: token.parts.map((part) => part.value).join(":"),
      phrase: first.quoted,
      excluded: token.excluded,
    };
  if (!first.quoted && first.value === "prop") return propertyClause(token);
  const field = z.enum(SearchFields).safeParse(first.value);
  if (first.quoted || !field.success || token.parts.length !== 2)
    throw new SearchSyntaxError(
      token.start,
      "지원하지 않는 검색 연산자입니다. 일반 구문은 따옴표로 묶어주세요.",
    );
  let value = token.parts[1]!.value.trim();
  if (field.data === "type") {
    if (!["page", "database"].includes(value))
      throw new SearchSyntaxError(
        token.start,
        "type은 page 또는 database입니다.",
      );
    if (value === "page") value = "document";
  }
  if (
    ["before", "after"].includes(field.data) &&
    !z.iso.date().safeParse(value).success
  )
    throw new SearchSyntaxError(
      token.start,
      "날짜는 실제 YYYY-MM-DD 날짜여야 합니다.",
    );
  if (field.data === "tag") {
    value = normalizeSearchText(value);
    if (value.length > MAX_SEARCH_TAG_LENGTH)
      throw new SearchSyntaxError(token.start, "Tag는 최대 64자입니다.");
  }
  return { kind: "filter", field: field.data, value, excluded: token.excluded };
}

export function parseSearchQuery(source: string): SearchQuery {
  if (source.length > MAX_SEARCH_QUERY_LENGTH)
    throw new SearchSyntaxError(
      MAX_SEARCH_QUERY_LENGTH,
      "검색어는 최대 512자입니다.",
    );
  const clauses: SearchClause[] = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/u.test(source[index]!)) {
      index++;
      continue;
    }
    if (clauses.length >= MAX_SEARCH_CLAUSES)
      throw new SearchSyntaxError(index, "검색 조건은 최대 32개입니다.");
    const token = readSearchToken(source, index);
    clauses.push(clauseFromToken(token));
    index = token.end;
  }
  return SearchQuerySchema.parse({ clauses });
}
