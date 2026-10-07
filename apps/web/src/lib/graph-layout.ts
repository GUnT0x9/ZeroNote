import type { KnowledgeNode } from "@zeronote/shared";
const RING_CAPACITY = 12;
const RING_DISTANCE = 250;
export interface GraphPoint {
  x: number;
  y: number;
}
export function graphPositions(
  nodes: KnowledgeNode[],
): Map<string, GraphPoint> {
  const positions = new Map<string, GraphPoint>();
  if (nodes[0]) positions.set(nodes[0].id, { x: 0, y: 0 });
  let offset = 1,
    ring = 1;
  while (offset < nodes.length) {
    const count = Math.min(RING_CAPACITY * ring, nodes.length - offset),
      radius = ring * RING_DISTANCE;
    for (let index = 0; index < count; index++) {
      const angle = (index * Math.PI * 2) / count - Math.PI / 2;
      positions.set(nodes[offset + index]!.id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    offset += count;
    ring++;
  }
  return positions;
}
