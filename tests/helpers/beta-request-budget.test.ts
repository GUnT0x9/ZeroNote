import { afterEach, expect, it, vi } from "vitest";
import { BetaRequestBudget } from "./beta-request-budget";

afterEach(() => vi.useRealTimers());

it("allows the first ten reservations without waiting", async () => {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout"] });
  const budget = new BetaRequestBudget();
  await Promise.all(Array.from({ length: 10 }, () => budget.reserve()));
  expect(vi.getTimerCount()).toBe(0);
});

it("holds concurrent overflow until a slot expires", async () => {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout"] });
  const budget = new BetaRequestBudget();
  await Promise.all(Array.from({ length: 10 }, () => budget.reserve()));
  const completed: number[] = [];
  const overflow = Promise.all([
    budget.reserve().then(() => completed.push(11)),
    budget.reserve().then(() => completed.push(12)),
  ]);
  await vi.advanceTimersByTimeAsync(64_999);
  expect(completed).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await overflow;
  expect(completed).toEqual([11, 12]);
  expect(vi.getTimerCount()).toBe(0);
});
