/**
 * Generated views: bounded traversal (WB-026 to WB-028, WB-082), deterministic layout,
 * and native JSON Canvas output (WB-034). Pure TypeScript.
 */
import type { Edge, ModelIndex } from "./model";

export type Direction = "out" | "in";

/** A linked note that does not exist yet is shown as an undefined card (WB-092). Its id is not a vault path. */
const UNDEFINED = "undefined:";
export const undefinedId = (link: string) => `${UNDEFINED}${link}`;
export const isUndefinedId = (id: string) => id.startsWith(UNDEFINED);
const undefinedName = (id: string) => id.slice(UNDEFINED.length);

export interface ViewStep {
  field: string;
  direction: Direction;
  /** Only when the note being expanded has one of these types (WB-097). */
  from?: string[];
  /** Only notes of these types are followed (WB-097). */
  to?: string[];
  /** Only applies to the starting notes, not to notes reached later (WB-097). */
  atStartOnly?: boolean;
  /** Show a link to a missing note as an undefined card even though `to` filters by type: true when the schema allows only those types at that end (WB-097). */
  undefinedOk?: boolean;
}

export interface ViewProfile {
  name: string;
  /** Relationship fields followed, in priority order. */
  steps: ViewStep[];
  /** Note types the view can start from; any when absent (WB-097). */
  startTypes?: string[];
  depth: number;
  /** Node cap; it wins over depth (WB-082). */
  nodeCap: number;
  /** Children shown per note before the rest are counted as "more" (readability). */
  perParent?: number;
}

/** Spike default. View Profiles become vault configuration later (WB-001, review item 6). */
export const STRUCTURE_PROFILE: ViewProfile = {
  name: "Structure",
  steps: [
    { field: "hasPart", direction: "out" },
    { field: "hasChild", direction: "out" },
    { field: "hasState", direction: "out" },
    { field: "includes", direction: "out" },
    { field: "hasPort", direction: "out" },
    { field: "exposes", direction: "out" },
    { field: "hasFlow", direction: "out" },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
};

/**
 * Functional view (WB-097): from an Object, the functions it performs and their decomposition, flow and
 * requirements; from a Function, who performs it, its parent and sub-functions, what comes before and
 * after it, and the requirements it satisfies.
 */
export const FUNCTIONAL_PROFILE: ViewProfile = {
  name: "Functional",
  startTypes: ["Object", "Function"],
  steps: [
    { field: "performs", direction: "out", from: ["Object"], to: ["Function"], atStartOnly: true, undefinedOk: true },
    { field: "performs", direction: "in", from: ["Function"], to: ["Object"] },
    { field: "hasChild", direction: "in", from: ["Function"], to: ["Function"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Function"], to: ["Function"] },
    { field: "precedes", direction: "in", from: ["Function"], to: ["Function"], undefinedOk: false },
    { field: "precedes", direction: "out", from: ["Function"], to: ["Function"], undefinedOk: true },
    { field: "satisfies", direction: "out", from: ["Function"], to: ["Requirement"], undefinedOk: true },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
};

export const PROFILES: Record<string, ViewProfile> = { [STRUCTURE_PROFILE.name]: STRUCTURE_PROFILE, [FUNCTIONAL_PROFILE.name]: FUNCTIONAL_PROFILE };

/** Does a step apply to a note of type `cur` reaching a note of type `nbr`? */
function stepAllows(step: ViewStep, cur: string | undefined, nbr: string | undefined): boolean {
  if (step.from && !(cur && step.from.includes(cur))) return false;
  if (step.to && !(nbr && step.to.includes(nbr))) return false;
  return true;
}

export interface TreeLink {
  parent: string;
  child: string;
  field: string;
  /** "in": the stored link runs from the child to the parent, so the arrow is drawn child to parent (WB-097). */
  direction: Direction;
  /** How many times the parent lists this child in the field (quantity, WB-091). 1 when listed once. */
  count: number;
}

export interface ViewResult {
  profile: string;
  starts: string[];
  /** Included note paths with their distance from the nearest start. */
  depthOf: Map<string, number>;
  /** How each included note was reached: the spine of the picture. */
  tree: TreeLink[];
  /** Every profile edge between included notes (all valid paths within bounds, WB-027). */
  edges: Edge[];
  /** Profile edges between included notes that are not part of the tree. */
  cross: Edge[];
  /** Neighbors not shown, per note, because a bound was reached (WB-028). */
  omitted: Map<string, number>;
  capReached: boolean;
  /** Undefined cards in the view (links to notes that do not exist, WB-092). */
  undefinedCount: number;
}

export function traverse(index: ModelIndex, starts: string[], profile: ViewProfile): ViewResult {
  const nameOf = (p: string) => (isUndefinedId(p) ? undefinedName(p) : index.notes.get(p)?.name ?? p);
  const perParent = profile.perParent ?? Infinity;
  const depthOf = new Map<string, number>();
  const omitted = new Map<string, number>();
  const tree: TreeLink[] = [];
  let capReached = false;

  // All starting elements first, so several starts share one context (WB-025).
  let frontier = [...new Set(starts)].filter((s) => index.notes.has(s));
  for (const s of frontier) depthOf.set(s, 0);

  type Nb = { node: string; field: string; direction: Direction; count?: number };
  const typeOf = (p: string) => index.notes.get(p)?.type;
  const neighbours = (p: string, dist: number): Nb[] => {
    const seen = new Set<string>();
    const out: Nb[] = [];
    for (const step of profile.steps) {
      if (step.atStartOnly && dist > 0) continue;
      if (step.from && !step.from.includes(typeOf(p) ?? "")) continue;
      const edges = step.direction === "out" ? index.out(p) : index.in(p);
      const next = edges
        .filter((e) => e.field === step.field)
        .map((e) => (step.direction === "out" ? e.to : e.from))
        .filter((n) => index.notes.has(n) && !seen.has(n) && stepAllows(step, typeOf(p), typeOf(n)))
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      for (const n of next) {
        seen.add(n);
        out.push({ node: n, field: step.field, direction: step.direction });
      }
      // Links to notes that do not exist yet: undefined cards, after the defined ones in this field (WB-092).
      if (step.direction === "out" && (!step.to || step.undefinedOk)) {
        const missing = new Map<string, number>();
        for (const b of index.notes.get(p)?.broken ?? []) {
          if (b.field === step.field) missing.set(b.link, (missing.get(b.link) ?? 0) + 1);
        }
        for (const [link, count] of [...missing].sort((a, b) => a[0].localeCompare(b[0]))) {
          const id = undefinedId(link);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ node: id, field: step.field, direction: "out", count });
        }
      }
    }
    return out;
  };
  const bump = (p: string, n = 1) => omitted.set(p, (omitted.get(p) ?? 0) + n);

  for (let d = 0; d < profile.depth && frontier.length; d++) {
    // Candidates per parent, in relationship order then name.
    const queues = frontier.map((p) => ({ p, q: neighbours(p, d).filter((n) => !depthOf.has(n.node)), shown: 0 }));
    const picked = new Map<string, Nb[]>();
    // Round-robin across the parents of this level, so the node cap is shared fairly
    // instead of being spent on the first few parents.
    let progress = true;
    while (progress) {
      progress = false;
      for (const s of queues) {
        if (s.shown >= perParent || depthOf.size >= profile.nodeCap) continue;
        while (s.q.length && depthOf.has(s.q[0].node)) s.q.shift(); // claimed by another parent
        const n = s.q.shift();
        if (!n) continue;
        depthOf.set(n.node, d + 1);
        s.shown++;
        progress = true;
        let list = picked.get(s.p);
        if (!list) picked.set(s.p, (list = []));
        list.push(n);
      }
    }
    const next: string[] = [];
    for (const s of queues) {
      const rest = s.q.filter((n) => !depthOf.has(n.node)).length;
      if (rest) {
        bump(s.p, rest);
        if (depthOf.size >= profile.nodeCap) capReached = true;
      }
      // Keep each parent's children in relationship-then-name order.
      for (const n of picked.get(s.p) ?? []) {
        const owner = n.direction === "out" ? s.p : n.node; // the note the field is written on
        const target = n.direction === "out" ? n.node : s.p;
        tree.push({ parent: s.p, child: n.node, field: n.field, direction: n.direction, count: n.count ?? index.notes.get(owner)?.repeat?.get(`${n.field}|${target}`) ?? 1 });
        next.push(n.node);
      }
    }
    frontier = next;
  }
  // Depth bound: count what lies beyond the last layer.
  for (const p of frontier) {
    const beyond = neighbours(p, profile.depth).filter((n) => !depthOf.has(n.node)).length;
    if (beyond) bump(p, beyond);
  }

  const treeKey = new Set(tree.flatMap((l) => [`${l.parent}|${l.field}|${l.child}`, `${l.child}|${l.field}|${l.parent}`]));
  const edges: Edge[] = [];
  const cross: Edge[] = [];
  for (const p of depthOf.keys()) {
    for (const e of index.out(p)) {
      if (!depthOf.has(e.to)) continue;
      const fits = profile.steps.some(
        (s) => s.field === e.field && (s.direction === "out" ? stepAllows(s, typeOf(e.from), typeOf(e.to)) : stepAllows(s, typeOf(e.to), typeOf(e.from))),
      );
      if (!fits) continue;
      edges.push(e);
      if (!treeKey.has(`${e.from}|${e.field}|${e.to}`)) cross.push(e);
    }
  }
  return { profile: profile.name, starts: [...depthOf.keys()].filter((p) => depthOf.get(p) === 0), depthOf, tree, edges, cross, omitted, capReached, undefinedCount: [...depthOf.keys()].filter(isUndefinedId).length };
}

/** Stable fingerprint of a view's content, for stale-view detection (WB-035). */
export function signature(view: ViewResult): string {
  const nodes = [...view.depthOf.keys()].sort().join("\n");
  const edges = view.edges.map((e) => `${e.from}|${e.field}|${e.to}`).sort().join("\n");
  const qty = view.tree.filter((l) => l.count > 1).map((l) => `${l.parent}|${l.field}|${l.child}x${l.count}`).sort().join("\n");
  const more = [...view.omitted].map(([p, n]) => `${p}:${n}`).sort().join("\n");
  let h = 2166136261;
  for (const ch of `${view.profile}\n${nodes}\n${edges}\n${more}\n${qty}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Relationship name on every link (WB-095), plus a quantity (×27) wherever a child is listed more than once. */
function edgeLabel(field: string, count: number): string | undefined {
  const text = [field, count > 1 ? `×${count}` : ""].filter(Boolean).join(" ");
  return text || undefined;
}

/** Canvas color 1 (red) marks a note that still has to be defined (WB-092). */
const UNDEFINED_COLOR = "1";
const NODE_W = 300;
const NODE_H = 80;
const COL_GAP = 160;
const ROW_H = 100;
const MORE_W = 140;
/** Cross links are drawn only when there are few enough to stay readable. */
const MAX_CROSS = 40;
/** One color per relationship in profile order, all different from the undefined-card red (WB-096): Canvas colors 4, 5, 6, 2, 3, then two hex colors for the sixth and seventh. */
const PALETTE = ["4", "5", "6", "2", "3", "#9aa0a6", "#b5835a"];

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
  color?: string;
}
export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * Left-to-right tree layout (WB-034): each note sits next to the note it was reached from,
 * children grouped by relationship in profile order and sorted by name, a parent centred on
 * its children. One label per relationship group, colored by relationship. Deterministic.
 */
export function toCanvas(index: ModelIndex, view: ViewResult, profile: ViewProfile = STRUCTURE_PROFILE): CanvasData {
  const nameOf = (p: string) => (isUndefinedId(p) ? undefinedName(p) : index.notes.get(p)?.name ?? p);
  const colorOf = new Map<string, string>();
  for (const s of profile.steps) if (!colorOf.has(s.field)) colorOf.set(s.field, PALETTE[colorOf.size % PALETTE.length]);
  const kids = new Map<string, TreeLink[]>();
  for (const l of view.tree) {
    let k = kids.get(l.parent);
    if (!k) kids.set(l.parent, (k = []));
    k.push(l); // traverse already ordered them by relationship, then name
  }
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const idOf = new Map<string, string>();
  let cursor = 0;

  // Returns the vertical centre of the placed subtree.
  const place = (p: string, depth: number): number => {
    const x = depth * (NODE_W + COL_GAP);
    const children = kids.get(p) ?? [];
    const more = view.omitted.get(p) ?? 0;
    const centres: number[] = [];
    const mine: Array<{ edge: CanvasEdge; reverse: boolean }> = [];
    for (const l of children) {
      const c = place(l.child, depth + 1);
      centres.push(c);
      const reverse = l.direction === "in"; // stored link runs child to parent: draw the arrow that way (WB-097)
      const edge: CanvasEdge = {
        id: `e${edges.length}`,
        fromNode: reverse ? (idOf.get(l.child) as string) : "", // the other end is filled once the parent has an id
        toNode: reverse ? "" : (idOf.get(l.child) as string),
        fromSide: reverse ? "left" : "right",
        toSide: reverse ? "right" : "left",
        label: edgeLabel(l.field, l.count),
        color: colorOf.get(l.field),
      };
      edges.push(edge);
      mine.push({ edge, reverse });
    }
    let moreId: string | undefined;
    if (more) {
      moreId = `m${nodes.length}`;
      const y = cursor;
      cursor += ROW_H;
      nodes.push({ id: moreId, type: "text", text: `**+${more} more**`, x: x + NODE_W + COL_GAP, y, width: MORE_W, height: NODE_H });
      centres.push(y + NODE_H / 2);
    }
    let centre: number;
    if (centres.length) centre = (centres[0] + centres[centres.length - 1]) / 2;
    else {
      centre = cursor + NODE_H / 2;
      cursor += ROW_H;
    }
    const id = `n${nodes.length}`;
    idOf.set(p, id);
    const y = Math.round(centre - NODE_H / 2);
    if (isUndefinedId(p)) nodes.push({ id, type: "text", text: `**${undefinedName(p)}**\n*undefined*`, x, y, width: NODE_W, height: NODE_H, color: UNDEFINED_COLOR });
    else nodes.push({ id, type: "file", file: p, x, y, width: NODE_W, height: NODE_H, color: depth === 0 ? "4" : undefined });
    // Point this note's child edges at it.
    for (const m of mine) {
      if (m.reverse) m.edge.toNode = id;
      else m.edge.fromNode = id;
    }
    if (moreId) edges.push({ id: `e${edges.length}`, fromNode: id, toNode: moreId, fromSide: "right", toSide: "left" });
    return centre;
  };

  const roots = [...view.starts].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  for (const r of roots) {
    place(r, 0);
    cursor += ROW_H; // gap between starting elements
  }

  // Links between notes already shown, other than the tree: unlabelled and uncoloured.
  if (view.cross.length <= MAX_CROSS) {
    for (const e of view.cross) {
      const from = idOf.get(e.from);
      const to = idOf.get(e.to);
      if (from && to) edges.push({ id: `e${edges.length}`, fromNode: from, toNode: to, fromSide: "right", toSide: "left" });
    }
  } else {
    nodes.push({
      id: "note-cross",
      type: "text",
      text: `${view.cross.length} other links between these notes are not drawn.`,
      x: 0,
      y: -ROW_H - NODE_H,
      width: NODE_W * 1.5,
      height: NODE_H,
    });
  }
  return { nodes, edges };
}
