/**
 * Generated views: bounded traversal (WB-026 to WB-028, WB-082), deterministic layout,
 * and native JSON Canvas output (WB-034). Pure TypeScript.
 */
import type { Edge, ModelIndex } from "./model";

export type Direction = "out" | "in";

export interface ViewProfile {
  name: string;
  /** Relationship fields followed, in priority order. */
  steps: Array<{ field: string; direction: Direction }>;
  depth: number;
  /** Node cap; it wins over depth (WB-082). */
  nodeCap: number;
}

/** Spike default. View Profiles become vault configuration later (WB-001, review item 6). */
export const STRUCTURE_PROFILE: ViewProfile = {
  name: "Structure",
  steps: [
    { field: "hasPart", direction: "out" },
    { field: "hasChild", direction: "out" },
    { field: "includes", direction: "out" },
    { field: "hasPort", direction: "out" },
    { field: "exposes", direction: "out" },
    { field: "hasFlow", direction: "out" },
  ],
  depth: 2,
  nodeCap: 150,
};

export interface ViewResult {
  profile: string;
  starts: string[];
  /** Included note paths with their distance from the nearest start. */
  depthOf: Map<string, number>;
  /** Every profile edge between included notes (all valid paths within bounds, WB-027). */
  edges: Edge[];
  /** Neighbors not shown, per note, because a bound was reached (WB-028). */
  omitted: Map<string, number>;
  capReached: boolean;
}

export function traverse(index: ModelIndex, starts: string[], profile: ViewProfile): ViewResult {
  const nameOf = (p: string) => index.notes.get(p)?.name ?? p;
  const depthOf = new Map<string, number>();
  const omitted = new Map<string, number>();
  let capReached = false;

  // All starting elements first, so several starts share one context (WB-025).
  let frontier = [...new Set(starts)].filter((s) => index.notes.has(s));
  for (const s of frontier) depthOf.set(s, 0);

  const neighbours = (p: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const step of profile.steps) {
      const edges = step.direction === "out" ? index.out(p) : index.in(p);
      const next = edges
        .filter((e) => e.field === step.field)
        .map((e) => (step.direction === "out" ? e.to : e.from))
        .filter((n) => index.notes.has(n) && !seen.has(n))
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      for (const n of next) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  };

  for (let d = 0; d < profile.depth && frontier.length; d++) {
    const next: string[] = [];
    for (const p of frontier) {
      for (const n of neighbours(p)) {
        if (depthOf.has(n)) continue;
        if (depthOf.size >= profile.nodeCap) {
          capReached = true;
          omitted.set(p, (omitted.get(p) ?? 0) + 1);
          continue;
        }
        depthOf.set(n, d + 1);
        next.push(n);
      }
    }
    frontier = next;
  }
  // Depth bound: count what lies beyond the last layer.
  for (const p of frontier) {
    const beyond = neighbours(p).filter((n) => !depthOf.has(n)).length;
    if (beyond) omitted.set(p, (omitted.get(p) ?? 0) + beyond);
  }

  const fields = new Set(profile.steps.map((s) => s.field));
  const edges: Edge[] = [];
  for (const p of depthOf.keys()) {
    for (const e of index.out(p)) {
      if (fields.has(e.field) && depthOf.has(e.to)) edges.push(e);
    }
  }
  return { profile: profile.name, starts: [...depthOf.keys()].filter((p) => depthOf.get(p) === 0), depthOf, edges, omitted, capReached };
}

/** Stable fingerprint of a view's content, for stale-view detection (WB-035). */
export function signature(view: ViewResult): string {
  const nodes = [...view.depthOf.keys()].sort().join("\n");
  const edges = view.edges.map((e) => `${e.from}|${e.field}|${e.to}`).sort().join("\n");
  let h = 2166136261;
  for (const ch of `${view.profile}\n${nodes}\n${edges}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

const NODE_W = 360;
const NODE_H = 90;
const COL_GAP = 140;
const ROW_GAP = 30;
const MAX_ROWS = 20;

export interface CanvasNode {
  id: string;
  type: "file" | "text";
  file?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}
export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: "right" | "left" | "top" | "bottom";
  toSide: "right" | "left" | "top" | "bottom";
  label?: string;
}
export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * Deterministic layered layout (WB-034): one band of columns per distance from the start,
 * notes sorted by name, wrapping every MAX_ROWS. The same model gives the same picture.
 */
export function toCanvas(index: ModelIndex, view: ViewResult): CanvasData {
  const nameOf = (p: string) => index.notes.get(p)?.name ?? p;
  const layers = new Map<number, string[]>();
  for (const [p, d] of view.depthOf) {
    let l = layers.get(d);
    if (!l) layers.set(d, (l = []));
    l.push(p);
  }
  const nodes: CanvasNode[] = [];
  const idOf = new Map<string, string>();
  let x = 0;
  for (const d of [...layers.keys()].sort((a, b) => a - b)) {
    const members = (layers.get(d) ?? []).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const cols = Math.max(1, Math.ceil(members.length / MAX_ROWS));
    members.forEach((p, i) => {
      const id = `n${nodes.length}`;
      idOf.set(p, id);
      nodes.push({
        id,
        type: "file",
        file: p,
        x: x + Math.floor(i / MAX_ROWS) * (NODE_W + COL_GAP / 2),
        y: (i % MAX_ROWS) * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        color: d === 0 ? "4" : undefined,
      });
    });
    x += cols * (NODE_W + COL_GAP / 2) + COL_GAP;
  }
  const edges: CanvasEdge[] = view.edges.map((e, i) => ({
    id: `e${i}`,
    fromNode: idOf.get(e.from) as string,
    toNode: idOf.get(e.to) as string,
    fromSide: "right",
    toSide: "left",
    label: e.field,
  }));
  // Omission indicators: never imply the view is complete when it is not (WB-028).
  for (const [p, n] of [...view.omitted].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])))) {
    const owner = nodes.find((nd) => nd.id === idOf.get(p));
    if (!owner) continue;
    const id = `o${nodes.length}`;
    nodes.push({
      id,
      type: "text",
      text: `${n} more not shown`,
      x: owner.x + NODE_W + 40,
      y: owner.y + NODE_H + 10,
      width: 200,
      height: 50,
      color: "3",
    });
    edges.push({ id: `e${edges.length}`, fromNode: owner.id, toNode: id, fromSide: "bottom", toSide: "left" });
  }
  return { nodes, edges };
}
