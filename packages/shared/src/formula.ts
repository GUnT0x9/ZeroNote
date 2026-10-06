export type FormulaValue = string | number | boolean | string[] | null;
export type FormulaNode =
  | { type: "literal"; value: string | number | boolean | null }
  | { type: "property"; propertyId: string }
  | { type: "unary"; operator: "+" | "-" | "!"; operand: FormulaNode }
  | { type: "binary"; operator: string; left: FormulaNode; right: FormulaNode }
  | { type: "call"; name: string; arguments: FormulaNode[] };
export const MAX_FORMULA_LENGTH = 2000;
export const MAX_FORMULA_NODES = 256;
export const MAX_FORMULA_DEPTH = 32;
export function formatFormula(
  node: unknown,
  properties: { id: string; name: string }[],
): string {
  assertFormulaNode(node);
  const names = new Map(
    properties.map((property) => [property.id, property.name]),
  );
  const format = (current: FormulaNode): string => {
    if (current.type === "literal") return JSON.stringify(current.value);
    if (current.type === "property")
      return `prop(${JSON.stringify(names.get(current.propertyId) ?? `삭제된 속성 ${current.propertyId}`)})`;
    if (current.type === "unary")
      return `${current.operator}(${format(current.operand)})`;
    if (current.type === "binary")
      return `(${format(current.left)} ${current.operator} ${format(current.right)})`;
    return `${current.name}(${current.arguments.map(format).join(", ")})`;
  };
  return format(node);
}
const MAX_FORMULA_ARGUMENTS = 16;
const MAX_FORMULA_STRING_LENGTH = 10000;
const FORMULA_FUNCTIONS = new Set([
  "if",
  "abs",
  "round",
  "floor",
  "ceil",
  "min",
  "max",
  "sum",
  "length",
  "concat",
  "contains",
  "empty",
  "lower",
  "upper",
  "format",
  "toNumber",
]);
const PRECEDENCE: Readonly<Record<string, number>> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  ">": 4,
  ">=": 4,
  "<": 4,
  "<=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};
type Token = {
  kind: "string" | "number" | "name" | "symbol" | "end";
  text: string;
  position: number;
};
export class FormulaError extends Error {
  constructor(
    readonly code:
      "syntax" | "type" | "limit" | "division_by_zero" | "reference" | "cycle",
    message: string,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}
function formulaSyntax(position: number, message: string): never {
  throw new FormulaError("syntax", `${position + 1}번째 문자: ${message}`);
}
function scanQuotedString(
  source: string,
  position: number,
): { token: Token; end: number } {
  const quote = source[position];
  let text = "",
    index = position + 1;
  while (index < source.length) {
    const character = source[index++]!;
    if (character === quote)
      return { token: { kind: "string", text, position }, end: index };
    if (character !== "\\") {
      text += character;
      continue;
    }
    const escaped = source[index++];
    if (escaped === undefined) formulaSyntax(index - 1, "문자열을 닫아주세요.");
    const escapes: Readonly<Record<string, string>> = {
      n: "\n",
      r: "\r",
      t: "\t",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    if (!Object.hasOwn(escapes, escaped))
      formulaSyntax(index - 1, "지원하지 않는 문자열 Escape입니다.");
    text += escapes[escaped];
  }
  return formulaSyntax(position, "문자열을 닫아주세요.");
}
function formulaTokens(source: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < source.length) {
    const tail = source.slice(position),
      character = source[position]!;
    if (/\s/.test(character)) {
      position++;
      continue;
    }
    if (character === "'" || character === '"') {
      const quoted = scanQuotedString(source, position);
      tokens.push(quoted.token);
      position = quoted.end;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(tail)?.[0];
    const name = /^[A-Za-z_][A-Za-z_0-9]*/.exec(tail)?.[0];
    const symbol = /^(?:==|!=|>=|<=|&&|\|\||[+*/%<>!(),-])/.exec(tail)?.[0];
    const text = number ?? name ?? symbol;
    if (!text) formulaSyntax(position, "지원하지 않는 연산입니다.");
    tokens.push({
      kind: number ? "number" : name ? "name" : "symbol",
      text,
      position,
    });
    position += text.length;
    if (tokens.length > MAX_FORMULA_NODES * 3)
      throw new FormulaError("limit", "수식이 너무 복잡합니다.");
  }
  tokens.push({ kind: "end", text: "", position });
  return tokens;
}
class FormulaParser {
  private position = 0;
  private nodes = 0;
  constructor(
    private tokens: Token[],
    private properties: readonly { id: string; name: string }[],
  ) {}
  private current(): Token {
    return this.tokens[this.position]!;
  }
  private expect(symbol: string): void {
    if (this.current().text !== symbol)
      formulaSyntax(this.current().position, `${symbol}가 필요합니다.`);
    this.position++;
  }
  private node(node: FormulaNode): FormulaNode {
    if (++this.nodes > MAX_FORMULA_NODES)
      throw new FormulaError("limit", "수식이 너무 복잡합니다.");
    return node;
  }
  parse(): FormulaNode {
    const result = this.expression(0, 0);
    if (this.current().kind !== "end")
      formulaSyntax(
        this.current().position,
        "수식 뒤에 불필요한 내용이 있습니다.",
      );
    return result;
  }
  private expression(minimum: number, depth: number): FormulaNode {
    if (depth > MAX_FORMULA_DEPTH)
      throw new FormulaError("limit", "수식의 중첩이 너무 깊습니다.");
    let left = this.primary(depth + 1);
    while (
      Object.hasOwn(PRECEDENCE, this.current().text) &&
      PRECEDENCE[this.current().text]! >= minimum
    ) {
      const operator = this.current().text,
        precedence = PRECEDENCE[operator]!;
      this.position++;
      left = this.node({
        type: "binary",
        operator,
        left,
        right: this.expression(precedence + 1, depth + 1),
      });
    }
    return left;
  }
  private primary(depth: number): FormulaNode {
    if (depth > MAX_FORMULA_DEPTH)
      throw new FormulaError("limit", "수식의 중첩이 너무 깊습니다.");
    const token = this.current();
    this.position++;
    if (token.kind === "string")
      return this.node({ type: "literal", value: token.text });
    if (token.kind === "number") {
      const value = Number(token.text);
      if (!Number.isFinite(value))
        formulaSyntax(token.position, "유한한 숫자를 입력해주세요.");
      return this.node({ type: "literal", value });
    }
    if (["true", "false", "null"].includes(token.text) && token.kind === "name")
      return this.node({
        type: "literal",
        value: token.text === "null" ? null : token.text === "true",
      });
    if (token.text === "(") {
      const value = this.expression(0, depth);
      this.expect(")");
      return value;
    }
    if (["+", "-", "!"].includes(token.text))
      return this.node({
        type: "unary",
        operator: token.text as "+" | "-" | "!",
        operand: this.primary(depth + 1),
      });
    if (token.kind !== "name")
      return formulaSyntax(token.position, "값이나 함수를 입력해주세요.");
    return this.call(token, depth);
  }
  private call(token: Token, depth: number): FormulaNode {
    if (token.text !== "prop" && !FORMULA_FUNCTIONS.has(token.text))
      formulaSyntax(token.position, "지원하지 않는 함수입니다.");
    this.expect("(");
    const arguments_: FormulaNode[] = [];
    if (this.current().text !== ")") {
      while (true) {
        arguments_.push(this.expression(0, depth + 1));
        if (arguments_.length > MAX_FORMULA_ARGUMENTS)
          throw new FormulaError("limit", "함수 인수가 너무 많습니다.");
        if (this.current().text !== ",") break;
        this.position++;
      }
    }
    this.expect(")");
    if (token.text !== "prop")
      return this.node({
        type: "call",
        name: token.text,
        arguments: arguments_,
      });
    const argument = arguments_[0];
    if (
      arguments_.length !== 1 ||
      argument?.type !== "literal" ||
      typeof argument.value !== "string"
    )
      formulaSyntax(token.position, 'prop("속성 이름")으로 입력해주세요.');
    const matches = this.properties.filter(
      (property) => property.name === argument.value,
    );
    if (matches.length !== 1)
      throw new FormulaError(
        "reference",
        matches.length ? "속성 이름이 중복됩니다." : "속성을 찾을 수 없습니다.",
      );
    return this.node({ type: "property", propertyId: matches[0]!.id });
  }
}
export function compileFormula(
  source: string,
  properties: readonly { id: string; name: string }[],
): FormulaNode {
  if (source.length > MAX_FORMULA_LENGTH)
    throw new FormulaError("limit", "수식은 최대 2,000자입니다.");
  if (!source.trim()) throw new FormulaError("syntax", "수식을 입력해주세요.");
  const node = new FormulaParser(formulaTokens(source), properties).parse();
  assertFormulaNode(node);
  return node;
}

/** Check persisted JSON before interpreting it; bound depth before recursive work. */
export function assertFormulaNode(
  value: unknown,
): asserts value is FormulaNode {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let count = 0;
  const malformed = (): never => {
    throw new FormulaError("syntax", "저장된 수식 형식이 올바르지 않습니다.");
  };
  while (stack.length) {
    const current = stack.pop()!;
    if (++count > MAX_FORMULA_NODES || current.depth > MAX_FORMULA_DEPTH)
      throw new FormulaError("limit", "수식이 너무 복잡합니다.");
    if (
      !current.value ||
      typeof current.value !== "object" ||
      Array.isArray(current.value)
    )
      malformed();
    const node = current.value as Record<string, unknown>;
    if (seen.has(node))
      throw new FormulaError("limit", "수식이 너무 복잡합니다.");
    seen.add(node);
    const exact = (keys: string[]) => {
      if (
        Object.keys(node).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(node, key))
      )
        malformed();
    };
    const child = (entry: unknown) =>
      stack.push({ value: entry, depth: current.depth + 1 });
    if (node.type === "literal") {
      exact(["type", "value"]);
      if (
        node.value !== null &&
        typeof node.value !== "boolean" &&
        typeof node.value !== "string" &&
        typeof node.value !== "number"
      )
        malformed();
      checkedFormulaValue(node.value as FormulaValue);
    } else if (node.type === "property") {
      exact(["type", "propertyId"]);
      if (
        typeof node.propertyId !== "string" ||
        !node.propertyId.length ||
        node.propertyId.length > 80
      )
        malformed();
    } else if (node.type === "unary") {
      exact(["type", "operator", "operand"]);
      if (
        typeof node.operator !== "string" ||
        !["!", "-", "+"].includes(node.operator)
      )
        malformed();
      child(node.operand);
    } else if (node.type === "binary") {
      exact(["type", "operator", "left", "right"]);
      if (
        typeof node.operator !== "string" ||
        !Object.hasOwn(PRECEDENCE, node.operator)
      )
        malformed();
      child(node.left);
      child(node.right);
    } else if (node.type === "call") {
      exact(["type", "name", "arguments"]);
      if (
        typeof node.name !== "string" ||
        !FORMULA_FUNCTIONS.has(node.name) ||
        !Array.isArray(node.arguments)
      )
        malformed();
      if ((node.arguments as unknown[]).length > MAX_FORMULA_ARGUMENTS)
        throw new FormulaError("limit", "함수 인수가 너무 많습니다.");
      for (const argument of node.arguments as unknown[]) child(argument);
    } else malformed();
  }
}
function numberValue(value: FormulaValue): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new FormulaError("type", "숫자가 필요한 연산입니다.");
  return value;
}
function stringValue(value: FormulaValue): string {
  if (typeof value !== "string")
    throw new FormulaError("type", "문자열이 필요한 연산입니다.");
  return value;
}
function booleanValue(value: FormulaValue): boolean {
  if (typeof value !== "boolean")
    throw new FormulaError("type", "참 또는 거짓이 필요한 연산입니다.");
  return value;
}
function checkedFormulaValue(value: FormulaValue): FormulaValue {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new FormulaError("type", "계산 결과가 유한한 숫자가 아닙니다.");
  if (
    (typeof value === "string" && value.length > MAX_FORMULA_STRING_LENGTH) ||
    (Array.isArray(value) && value.length > 50)
  )
    throw new FormulaError("limit", "계산 결과가 너무 큽니다.");
  return value;
}
function displayFormulaValue(value: FormulaValue): string {
  return value === null
    ? ""
    : Array.isArray(value)
      ? value.join(", ")
      : String(value);
}
function calculateBinary(
  operator: string,
  left: FormulaValue,
  right: FormulaValue,
): FormulaValue {
  if (operator === "==" || operator === "!=") {
    const equal =
      Array.isArray(left) && Array.isArray(right)
        ? left.length === right.length &&
          left.every((entry, index) => entry === right[index])
        : left === right;
    return operator === "==" ? equal : !equal;
  }
  if ([">", ">=", "<", "<="].includes(operator)) {
    if (
      (typeof left !== "number" && typeof left !== "string") ||
      typeof left !== typeof right
    )
      throw new FormulaError(
        "type",
        "같은 종류의 숫자나 문자열을 비교해주세요.",
      );
    const comparison =
      typeof left === "number"
        ? left - numberValue(right)
        : left.localeCompare(stringValue(right));
    return operator === ">"
      ? comparison > 0
      : operator === ">="
        ? comparison >= 0
        : operator === "<"
          ? comparison < 0
          : comparison <= 0;
  }
  if (operator === "+" && typeof left === "string" && typeof right === "string")
    return left + right;
  const a = numberValue(left),
    b = numberValue(right);
  if ((operator === "/" || operator === "%") && b === 0)
    throw new FormulaError("division_by_zero", "0으로 나눌 수 없습니다.");
  if (operator === "+") return a + b;
  if (operator === "-") return a - b;
  if (operator === "*") return a * b;
  if (operator === "/") return a / b;
  if (operator === "%") return a % b;
  throw new FormulaError("syntax", "지원하지 않는 연산입니다.");
}
function calculateFunction(name: string, values: FormulaValue[]): FormulaValue {
  if (!FORMULA_FUNCTIONS.has(name))
    throw new FormulaError("syntax", "지원하지 않는 함수입니다.");
  const first = values[0] ?? null;
  const multiple = ["min", "max", "sum", "concat"].includes(name);
  if (
    (multiple && (!values.length || values.length > MAX_FORMULA_ARGUMENTS)) ||
    (name === "contains"
      ? values.length !== 2
      : !multiple &&
        values.length !== 1 &&
        !(name === "round" && values.length === 2))
  )
    throw new FormulaError("type", "함수 인수 개수를 확인해주세요.");
  if (name === "empty")
    return (
      first === null || first === "" || (Array.isArray(first) && !first.length)
    );
  if (name === "format") return displayFormulaValue(first);
  if (name === "concat") return values.map(displayFormulaValue).join("");
  if (name === "length")
    return Array.isArray(first) ? first.length : stringValue(first).length;
  if (name === "lower" || name === "upper")
    return name === "lower"
      ? stringValue(first).toLowerCase()
      : stringValue(first).toUpperCase();
  if (name === "contains")
    return Array.isArray(first)
      ? first.includes(stringValue(values[1] ?? null))
      : stringValue(first).includes(stringValue(values[1] ?? null));
  if (name === "toNumber") {
    if (
      (typeof first !== "string" && typeof first !== "number") ||
      (typeof first === "string" && !first.trim())
    )
      throw new FormulaError("type", "숫자로 변환할 수 없습니다.");
    return numberValue(Number(first));
  }
  if (["min", "max", "sum"].includes(name)) {
    const numbers = values.map(numberValue);
    return name === "min"
      ? Math.min(...numbers)
      : name === "max"
        ? Math.max(...numbers)
        : numbers.reduce((sum, value) => sum + value, 0);
  }
  const number = numberValue(first);
  if (name === "abs") return Math.abs(number);
  if (name === "floor") return Math.floor(number);
  if (name === "ceil") return Math.ceil(number);
  if (name === "round") {
    const digits = values.length === 2 ? numberValue(values[1] ?? null) : 0;
    if (!Number.isInteger(digits) || digits < 0 || digits > 10)
      throw new FormulaError("type", "소수 자릿수는 0–10의 정수입니다.");
    const scale = 10 ** digits;
    return Math.round(number * scale) / scale;
  }
  throw new FormulaError("syntax", "지원하지 않는 함수입니다.");
}
export type FormulaResult =
  | { value: FormulaValue; error: null }
  | { value: null; error: { code: FormulaError["code"]; message: string } };
export function evaluateFormula(
  node: unknown,
  readProperty: (id: string) => FormulaValue,
): FormulaResult {
  let visited = 0;
  const evaluate = (entry: FormulaNode, depth: number): FormulaValue => {
    if (++visited > MAX_FORMULA_NODES || depth > MAX_FORMULA_DEPTH)
      throw new FormulaError("limit", "수식 계산 제한을 초과했습니다.");
    if (entry.type === "literal") return checkedFormulaValue(entry.value);
    if (entry.type === "property")
      return checkedFormulaValue(readProperty(entry.propertyId));
    if (entry.type === "unary") {
      if (!["!", "-", "+"].includes(entry.operator))
        throw new FormulaError("syntax", "지원하지 않는 연산입니다.");
      const operand = evaluate(entry.operand, depth + 1);
      return entry.operator === "!"
        ? !booleanValue(operand)
        : entry.operator === "-"
          ? -numberValue(operand)
          : numberValue(operand);
    }
    if (entry.type === "binary") {
      const left = evaluate(entry.left, depth + 1);
      if (entry.operator === "&&")
        return (
          booleanValue(left) && booleanValue(evaluate(entry.right, depth + 1))
        );
      if (entry.operator === "||")
        return (
          booleanValue(left) || booleanValue(evaluate(entry.right, depth + 1))
        );
      return checkedFormulaValue(
        calculateBinary(entry.operator, left, evaluate(entry.right, depth + 1)),
      );
    }
    if (entry.arguments.length > MAX_FORMULA_ARGUMENTS)
      throw new FormulaError("limit", "함수 인수가 너무 많습니다.");
    if (entry.name === "if") {
      if (entry.arguments.length !== 3)
        throw new FormulaError(
          "type",
          "if 함수에는 조건과 두 결과가 필요합니다.",
        );
      return evaluate(
        entry.arguments[
          booleanValue(evaluate(entry.arguments[0]!, depth + 1)) ? 1 : 2
        ]!,
        depth + 1,
      );
    }
    return checkedFormulaValue(
      calculateFunction(
        entry.name,
        entry.arguments.map((argument) => evaluate(argument, depth + 1)),
      ),
    );
  };
  try {
    assertFormulaNode(node);
    return { value: evaluate(node, 0), error: null };
  } catch (error) {
    const problem =
      error instanceof FormulaError
        ? error
        : new FormulaError(
            "reference",
            "수식에 필요한 속성을 읽을 수 없습니다.",
          );
    return {
      value: null,
      error: { code: problem.code, message: problem.message },
    };
  }
}
