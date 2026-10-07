import { expect, it } from "vitest";
import { graphPositions } from "./graph-layout";
it("centers the first Page and places subsequent Pages on distinct reproducible rings", () => {
  const nodes = Array.from({ length: 200 }, (_, index) => ({
    id: String(index),
    title: String(index),
    workspaceId: "workspace",
    kind: "document" as const,
  }));
  const positions = graphPositions(nodes);
  expect(positions.get("0")).toEqual({ x: 0, y: 0 });
  expect(
    Math.hypot(positions.get("13")!.x, positions.get("13")!.y),
  ).toBeCloseTo(500);
  expect(
    new Set([...positions.values()].map((point) => `${point.x}:${point.y}`))
      .size,
  ).toBe(200);
  expect(graphPositions(nodes)).toEqual(positions);
  expect(graphPositions([]).size).toBe(0);
});
