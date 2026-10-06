/**
 * Generated views: bounded traversal (WB-026 to WB-028, WB-082), deterministic layout,
 * and native JSON Canvas output (WB-034). Pure TypeScript.
 */
import type { Edge, ModelIndex } from "./model";
import { refKey, type LinkRef, type LocalModelIndex, type LocalRecord, type ModelRef } from "./localmodel";
import { buildInternalView } from "./internal-view";

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
  /** Draw the link without an arrowhead: a symmetric relationship such as `interfaces` (WB-102). */
  noArrow?: boolean;
}

export interface ViewProfile {
  name: string;
  /** One line shown in the view picker (WB-102). */
  description?: string;
  /** Relationship fields followed, in priority order. */
  steps: ViewStep[];
  /** Note types the view can start from; any when absent (WB-097). */
  startTypes?: string[];
  depth: number;
  /** Node cap; it wins over depth (WB-082). */
  nodeCap: number;
  /** Children shown per note before the rest are counted as "more" (readability). */
  perParent?: number;
  /** This projection consumes governed Local Model occurrence records and must hydrate them first. */
  needsLocalOccurrences?: boolean;
}

/** Spike default. View Profiles become vault configuration later (WB-001, review item 6). */
export const STRUCTURE_PROFILE: ViewProfile = {
  name: "Structure",
  description: "Definition/navigation hierarchy plus contextual part occurrences. Interface topology belongs in Internal or Interfaces.",
  steps: [
    { field: "hasPart", direction: "out" },
    { field: "hasChild", direction: "out" },
    { field: "hasState", direction: "out" },
    { field: "includes", direction: "out" },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true,
};

export const INTERNAL_PROFILE: ViewProfile = {
  name: "Internal",
  description: "Inside this assembly: contextual part occurrences, boundary interfaces, exposure and local connections.",
  startTypes: ["Object"],
  steps: [],
  depth: 0,
  nodeCap: 200,
  needsLocalOccurrences: true,
};

/**
 * Functional view (WB-097, amended by WB-103): from an Object, the functions it performs and their
 * decomposition and flow; from a Function, who performs it, its parent and sub-functions, and what comes
 * before and after it. The requirements a function satisfies are left to the Requirements view.
 */
export const FUNCTIONAL_PROFILE: ViewProfile = {
  name: "Functional",
  description: "Functions of an Object, or a Function with its performer, parent, sub-functions and order.",
  startTypes: ["Object", "Behavior"],
  steps: [
    { field: "performs", direction: "out", from: ["Object"], to: ["Behavior"], atStartOnly: true, undefinedOk: true },
    { field: "performs", direction: "in", from: ["Behavior"], to: ["Object"] },
    { field: "hasChild", direction: "in", from: ["Behavior"], to: ["Behavior"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Behavior"], to: ["Behavior"] },
    { field: "precedes", direction: "in", from: ["Behavior"], to: ["Behavior"], undefinedOk: false },
    { field: "precedes", direction: "out", from: ["Behavior"], to: ["Behavior"], undefinedOk: true },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
};

const REQ_HOLDERS = ["Object", "Behavior", "Condition", "Use Case", "Verification"];

/**
 * Requirements view (WB-098): from a Requirement, where it sits (owner element, parent requirement), its
 * sub-requirements, what it is derived from or refined by, what it references, what satisfies, verifies,
 * applies to or drives it. From an Object, Function, Design, State, Use Case or Verification, the
 * requirements reached through relationships valid for that class are shown; only Function and Design
 * satisfy Requirements, while State/State Machine reach scoped Requirements through inverse appliesTo.
 */
export const REQUIREMENTS_PROFILE: ViewProfile = {
  name: "Requirements",
  description: "A requirement with its parents, children, derivation, satisfiers and verifiers; or an element with its requirements.",
  startTypes: ["Requirement", ...REQ_HOLDERS],
  steps: [
    { field: "hasChild", direction: "in", from: ["Requirement"], to: ["Requirement", "Object", "Behavior", "Condition"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Requirement"], to: ["Requirement"] },
    { field: "hasChild", direction: "out", from: ["Object", "Behavior", "Condition"], to: ["Requirement"], atStartOnly: true },
    { field: "derivedFrom", direction: "out", from: ["Requirement"], to: ["Requirement"], undefinedOk: true },
    { field: "derivedFrom", direction: "in", from: ["Requirement"], to: ["Requirement"] },
    { field: "refines", direction: "out", from: ["Requirement"], to: ["Requirement"], undefinedOk: true },
    { field: "refines", direction: "in", from: ["Requirement"], to: ["Requirement"] },
    { field: "references", direction: "out", from: ["Requirement"], to: ["Requirement", "Document"] },
    { field: "satisfies", direction: "in", from: ["Requirement"], to: ["Behavior", "Condition"] },
    { field: "satisfies", direction: "out", from: ["Behavior", "Condition"], to: ["Requirement"], atStartOnly: true, undefinedOk: true },
    { field: "verifies", direction: "in", from: ["Requirement"], to: ["Verification"] },
    { field: "verifies", direction: "out", from: ["Verification"], to: ["Requirement"], atStartOnly: true, undefinedOk: true },
    { field: "appliesTo", direction: "out", from: ["Requirement"] },
    { field: "appliesTo", direction: "in", from: REQ_HOLDERS, to: ["Requirement"], atStartOnly: true },
    { field: "drives", direction: "in", from: ["Requirement"], to: ["Use Case"] },
    { field: "drives", direction: "out", from: ["Use Case"], to: ["Requirement"], atStartOnly: true, undefinedOk: true },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true,
};

/** Where Used (WB-102): everything that contains or uses the note, followed upward through assemblies. */
export const WHERE_USED_PROFILE: ViewProfile = {
  name: "Where Used",
  description: "What contains or uses this: parent assemblies, owners, performers, designs, use cases, dependants.",
  steps: [
    { field: "hasPart", direction: "in" },
    { field: "includes", direction: "in" },
    { field: "hasChild", direction: "in" },
    { field: "hasState", direction: "in" },
    { field: "performs", direction: "in", from: ["Behavior"], to: ["Object"] },
    { field: "hasDesign", direction: "in", from: ["Condition"] },
    { field: "realizedBy", direction: "in", from: ["Behavior", "Condition"], to: ["Use Case"] },
    { field: "participants", direction: "in", from: ["Object", "Actor", "Behavior", "Document"], to: ["Use Case"] },
    { field: "dependsOn", direction: "in" },
  ],
  depth: 3,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true,
};

/** Interfaces (WB-128): contextual Interfaces, Connections, exposures and Item Flows come from Local Model. */
export const INTERFACES_PROFILE: ViewProfile = {
  name: "Interfaces",
  description: "Local Interface occurrences, their Connections, exposed boundary Interfaces and carried Item Flows.",
  startTypes: ["Object", "Item Flow"],
  steps: [],
  depth: 3,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true,
};

/** Verification (WB-102): what verifies what, and what a verification covers. */
export const VERIFICATION_PROFILE: ViewProfile = {
  name: "Verification",
  description: "What verifies a requirement, what else a verification covers, and what satisfies those requirements.",
  startTypes: ["Requirement", "Verification", "Behavior", "Condition"],
  steps: [
    { field: "verifies", direction: "in", from: ["Requirement"], to: ["Verification"] },
    { field: "verifies", direction: "out", from: ["Verification"], to: ["Requirement"], undefinedOk: true },
    { field: "appliesTo", direction: "in", from: ["Condition"], to: ["Requirement"], atStartOnly: true },
    { field: "satisfies", direction: "out", from: ["Behavior", "Condition"], to: ["Requirement"], atStartOnly: true, undefinedOk: true },
    { field: "satisfies", direction: "in", from: ["Requirement"], to: ["Behavior", "Condition"] },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
};

/** Design (WB-102): the designs of an Object, their sub-designs and the requirements they satisfy. */
export const DESIGN_PROFILE: ViewProfile = {
  name: "Design",
  description: "The designs of an Object or Document, sub-designs, and the requirements each satisfies.",
  startTypes: ["Object", "Document", "Condition"],
  steps: [
    { field: "hasDesign", direction: "out", from: ["Object", "Document"], to: ["Condition"], undefinedOk: true },
    { field: "hasDesign", direction: "in", from: ["Condition"], to: ["Object", "Document"], atStartOnly: true },
    { field: "hasChild", direction: "in", from: ["Condition"], to: ["Condition"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Condition"], to: ["Condition"] },
    { field: "satisfies", direction: "out", from: ["Condition"], to: ["Requirement"], undefinedOk: true },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
};

/** Scenario (WB-102): a Use Case with its participants, realizing functions, variants and driven requirements. */
export const SCENARIO_PROFILE: ViewProfile = {
  name: "Scenario",
  description: "A use case: participants, the functions and designs that realize it, included and optional use cases, the order of its steps.",
  startTypes: ["Use Case"],
  steps: [
    { field: "participants", direction: "out", from: ["Use Case"], to: ["Object", "Actor", "Behavior", "Document"], undefinedOk: true },
    { field: "realizedBy", direction: "out", from: ["Use Case"], to: ["Behavior", "Condition"], undefinedOk: true },
    { field: "hasChild", direction: "out", from: ["Use Case"], to: ["Use Case"] },
    { field: "hasChild", direction: "in", from: ["Use Case"], to: ["Use Case"], atStartOnly: true },
    { field: "optionOf", direction: "out", from: ["Use Case"], to: ["Use Case"], undefinedOk: true },
    { field: "optionOf", direction: "in", from: ["Use Case"], to: ["Use Case"] },
    { field: "drives", direction: "out", from: ["Use Case"], to: ["Requirement"] },
    { field: "precedes", direction: "in", from: ["Behavior"], to: ["Behavior"] },
    { field: "precedes", direction: "out", from: ["Behavior"], to: ["Behavior"] },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
};

/** Behavior (WB-102): State Machines and States, their order, nesting and triggers. */
export const BEHAVIOR_PROFILE: ViewProfile = {
  name: "Behavior",
  description: "State machines and states: who has them, initial and final states, order, nesting, what triggers them.",
  startTypes: ["Condition", "Object"],
  steps: [
    { field: "hasState", direction: "out", from: ["Object", "Condition"], to: ["Condition"], undefinedOk: true },
    { field: "hasState", direction: "in", from: ["Condition"], to: ["Object", "Condition"], atStartOnly: true },
    { field: "initialState", direction: "out", from: ["Condition"], to: ["Condition"], undefinedOk: true },
    { field: "finalState", direction: "out", from: ["Condition"], to: ["Condition"], undefinedOk: true },
    { field: "hasChild", direction: "out", from: ["Condition"], to: ["Condition"] },
    { field: "hasChild", direction: "in", from: ["Condition"], to: ["Condition"], atStartOnly: true },
    { field: "precedes", direction: "in", from: ["Condition"], to: ["Condition"] },
    { field: "precedes", direction: "out", from: ["Condition"], to: ["Condition"], undefinedOk: true },
    { field: "triggeredBy", direction: "out", from: ["Condition"], to: ["Behavior", "Condition", "Item Flow"] },
    { field: "triggeredBy", direction: "in", from: ["Condition"], to: ["Behavior", "Condition"] },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
};

/** Failure and risk (WB-102): what an Issue or Failure Mode affects, and what affects an element. */
export const FAILURE_PROFILE: ViewProfile = {
  name: "Failure and risk",
  description: "What an issue or failure mode affects, what affects an element, causes, and the requirements around them.",
  steps: [
    { field: "affects", direction: "out", from: ["Issue", "Failure Mode", "Use Case"] },
    { field: "affects", direction: "in", to: ["Issue", "Failure Mode", "Use Case"] },
    { field: "drives", direction: "out", from: ["Issue", "Failure Mode"] },
    { field: "drives", direction: "in", from: ["Issue", "Failure Mode"] },
    { field: "satisfies", direction: "out", from: ["Behavior", "Condition"], to: ["Requirement"], undefinedOk: true },
    { field: "performs", direction: "in", from: ["Behavior"], to: ["Object"] },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
};

/** Evidence (WB-102): the documents, artifacts and notes that describe an element. */
export const EVIDENCE_PROFILE: ViewProfile = {
  name: "Evidence",
  description: "The artifacts, documents and info notes that describe this, and what else each one describes.",
  steps: [
    { field: "describes", direction: "in", to: ["Info", "Artifact", "Document"] },
    { field: "describes", direction: "out", from: ["Info", "Artifact", "Document"] },
    { field: "hasChild", direction: "out", to: ["Artifact", "Info", "Document"] },
    { field: "hasChild", direction: "in", from: ["Artifact", "Info", "Document"], atStartOnly: true },
    { field: "references", direction: "out", from: ["Requirement"], to: ["Document"] },
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
};

export const PROFILES: Record<string, ViewProfile> = {
  [INTERNAL_PROFILE.name]: INTERNAL_PROFILE,
  [STRUCTURE_PROFILE.name]: STRUCTURE_PROFILE,
  [FUNCTIONAL_PROFILE.name]: FUNCTIONAL_PROFILE,
  [REQUIREMENTS_PROFILE.name]: REQUIREMENTS_PROFILE,
  [WHERE_USED_PROFILE.name]: WHERE_USED_PROFILE,
  [INTERFACES_PROFILE.name]: INTERFACES_PROFILE,
  [VERIFICATION_PROFILE.name]: VERIFICATION_PROFILE,
  [DESIGN_PROFILE.name]: DESIGN_PROFILE,
  [SCENARIO_PROFILE.name]: SCENARIO_PROFILE,
  [BEHAVIOR_PROFILE.name]: BEHAVIOR_PROFILE,
  [FAILURE_PROFILE.name]: FAILURE_PROFILE,
  [EVIDENCE_PROFILE.name]: EVIDENCE_PROFILE,
};

/**
 * Read-side compatibility only. Older vaults may still contain pre-W-384
 * first-class behavior/condition types. Treat them as their W-384 semantic
 * class for view filtering without changing or rewriting the source note.
 */
export function semanticViewType(type: string | undefined): string | undefined {
  if (type === "Function" || type === "Step" || type === "Action") return "Behavior";
  if (type === "Design" || type === "State" || type === "State Machine" || type === "Mode") return "Condition";
  return type;
}

/** Does a step apply to a note of type `cur` reaching a note of type `nbr`? */
function stepAllows(step: ViewStep, cur: string | undefined, nbr: string | undefined): boolean {
  cur = semanticViewType(cur);
  nbr = semanticViewType(nbr);
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
  /** How many times the same relationship target was repeated in source data. Duplicate evidence only; never engineering quantity. */
  count: number;
}

export interface LocalViewNode {
  /** Durable semantic identity of the occurrence. */
  ref: ModelRef;
  ownerPath: string;
  record: LocalRecord;
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
  /** Local occurrences shown as derived/text nodes; keyed by refKey(ModelRef). */
  localNodes: Map<string, LocalViewNode>;
  /** Non-tree links between local records, such as connection ends and exposure. */
  localEdges: TreeLink[];
  /** Specialized Canvas layout, used by occurrence-native Internal Structure. */
  specialCanvas?: CanvasData;
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
  const typeOf = (p: string) => semanticViewType(index.notes.get(p)?.type);
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
  return {
    profile: profile.name,
    starts: [...depthOf.keys()].filter((p) => depthOf.get(p) === 0),
    depthOf,
    tree,
    edges,
    cross,
    omitted,
    capReached,
    undefinedCount: [...depthOf.keys()].filter(isUndefinedId).length,
    localNodes: new Map(),
    localEdges: [],
  };
}

/**
 * WB-106 Structure seam: show part occurrences owned by every note already visible in the bounded Structure view.
 * The occurrence is the structural fact. Its reusable definition stays a link on the text card; we deliberately do
 * not flatten the definition's internals into the parent's structure (no parent reach-through).
 */
export function withLocalStructure(index: ModelIndex, local: LocalModelIndex, base: ViewResult, profile: ViewProfile = STRUCTURE_PROFILE): ViewResult {
  if (profile.name !== STRUCTURE_PROFILE.name) return base;
  const depthOf = new Map(base.depthOf);
  const tree = base.tree.slice();
  const omitted = new Map(base.omitted);
  const localNodes = new Map(base.localNodes);
  let capReached = base.capReached;
  const perParent = profile.perParent ?? Infinity;

  const owners = [...depthOf.entries()]
    .filter(([path, depth]) => depth < profile.depth && index.notes.has(path))
    .sort((a, b) => a[1] - b[1] || (index.notes.get(a[0])?.name ?? a[0]).localeCompare(index.notes.get(b[0])?.name ?? b[0]));

  for (const [ownerPath, ownerDepth] of owners) {
    const owner = index.notes.get(ownerPath);
    if (!owner?.uid) continue; // a local ModelRef is not valid without the owner's durable uid
    const records = local.recordsOf(ownerPath, "part")
      .filter((r) => !!r.localId)
      .sort((a, b) => a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId));
    if (!records.length) continue;

    const existingChildren = tree.filter((l) => l.parent === ownerPath).length;
    const roomForParent = Math.max(0, perParent - existingChildren);
    const roomForView = Math.max(0, profile.nodeCap - depthOf.size);
    const show = records.slice(0, Math.min(roomForParent, roomForView));
    for (const record of show) {
      const ref = local.refOf(owner.uid, record);
      if (!ref) continue;
      const id = refKey(ref);
      if (depthOf.has(id)) continue;
      localNodes.set(id, { ref, ownerPath, record });
      depthOf.set(id, ownerDepth + 1);
      tree.push({ parent: ownerPath, child: id, field: "part occurrence", direction: "out", count: 1 });
    }
    const hidden = records.length - show.length;
    if (hidden > 0) {
      omitted.set(ownerPath, (omitted.get(ownerPath) ?? 0) + hidden);
      if (roomForView < records.length) capReached = true;
    }
  }

  return { ...base, depthOf, tree, omitted, capReached, localNodes };
}


export type ResolvePath = (target: string, fromPath: string) => string | undefined;

interface MutableLocalView {
  depthOf: Map<string, number>;
  tree: TreeLink[];
  omitted: Map<string, number>;
  localNodes: Map<string, LocalViewNode>;
  localEdges: TreeLink[];
  capReached: boolean;
}

function mutableLocal(base: ViewResult): MutableLocalView {
  return {
    depthOf: new Map(base.depthOf),
    tree: base.tree.slice(),
    omitted: new Map(base.omitted),
    localNodes: new Map(base.localNodes),
    localEdges: base.localEdges.slice(),
    capReached: base.capReached,
  };
}

function localKeyFor(index: ModelIndex, local: LocalModelIndex, ownerPath: string, record: LocalRecord): string | null {
  const uid = index.notes.get(ownerPath)?.uid;
  const ref = uid ? local.refOf(uid, record) : null;
  return ref ? refKey(ref) : null;
}

function addLocalNode(index: ModelIndex, local: LocalModelIndex, m: MutableLocalView, ownerPath: string, record: LocalRecord, depth: number, profile: ViewProfile): string | null {
  const key = localKeyFor(index, local, ownerPath, record);
  if (!key) return null;
  if (m.depthOf.has(key)) return key;
  if (m.depthOf.size >= profile.nodeCap) {
    m.capReached = true;
    return null;
  }
  const uid = index.notes.get(ownerPath)?.uid;
  const ref = uid ? local.refOf(uid, record) : null;
  if (!ref) return null;
  m.localNodes.set(key, { ref, ownerPath, record });
  m.depthOf.set(key, depth);
  return key;
}

function linkedLocal(index: ModelIndex, local: LocalModelIndex, resolve: ResolvePath, fromPath: string, link: LinkRef | null): { path: string; record: LocalRecord; key: string } | null {
  if (!link?.blockId) return null;
  const path = link.target ? resolve(link.target, fromPath) : fromPath;
  if (!path) return null;
  const record = local.recordsOf(path).find((r) => r.localId === link.blockId);
  if (!record) return null;
  const key = localKeyFor(index, local, path, record);
  return key ? { path, record, key } : null;
}


/** WB-106 Interfaces: materialize the local boundary/topology graph without inventing notes. */
export function withLocalInterfaces(index: ModelIndex, local: LocalModelIndex, resolve: ResolvePath, base: ViewResult, profile: ViewProfile = INTERFACES_PROFILE): ViewResult {
  if (profile.name !== INTERFACES_PROFILE.name) return base;
  const m = mutableLocal(base);
  const starts = base.starts.filter((p) => index.notes.has(p));

  for (const ownerPath of starts.filter((p) => index.notes.get(p)?.type === "Object")) {
    const ownerDepth = m.depthOf.get(ownerPath) ?? 0;
    const records = local.recordsOf(ownerPath);
    const endpoints = records.filter((r) => r.kind === "endpoint" && r.localId)
      .sort((a, b) => a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId));
    const connections = records.filter((r) => r.kind === "connection" && r.localId)
      .sort((a, b) => a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId));
    const flows = records.filter((r) => r.kind === "flow" && r.localId)
      .sort((a, b) => a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId));

    for (const r of endpoints) {
      const k = addLocalNode(index, local, m, ownerPath, r, ownerDepth + 1, profile);
      if (k) m.tree.push({ parent: ownerPath, child: k, field: "interface occurrence", direction: "out", count: 1 });
    }
    for (const r of connections) {
      const k = addLocalNode(index, local, m, ownerPath, r, ownerDepth + 1, profile);
      if (k) m.tree.push({ parent: ownerPath, child: k, field: "connection", direction: "out", count: 1 });
    }
    for (const r of flows) {
      const k = addLocalNode(index, local, m, ownerPath, r, ownerDepth + 2, profile);
      if (!k) continue;
      const parent = r.connectionId ? records.find((x) => x.kind === "connection" && x.localId === r.connectionId) : undefined;
      const pk = parent ? localKeyFor(index, local, ownerPath, parent) : null;
      m.tree.push({ parent: pk && m.depthOf.has(pk) ? pk : ownerPath, child: k, field: "flow occurrence", direction: "out", count: 1 });
    }

    for (const r of endpoints) {
      const a = localKeyFor(index, local, ownerPath, r);
      if (!a || !m.depthOf.has(a)) continue;
      const groups: Array<[string, LinkRef[]]> = [
        ...(r.sourceSchemaVersion==="0.4" ? [] : [["exposes", r.exposes] as [string, LinkRef[]]]),
        ["equals", r.equals],
        ["parent", r.parent ? [r.parent] : []],
      ];
      for (const [field, links] of groups) {
        for (const link of links) {
          const t = linkedLocal(index, local, resolve, ownerPath, link);
          if (!t) continue;
          const alreadyPlaced = m.depthOf.has(t.key);
          addLocalNode(index, local, m, t.path, t.record, ownerDepth + 1, profile);
          if (!m.depthOf.has(t.key)) continue;
          if (alreadyPlaced) m.localEdges.push({ parent: a, child: t.key, field, direction: "out", count: 1 });
          else m.tree.push({ parent: a, child: t.key, field, direction: "out", count: 1 });
        }
      }
    }

    for (const r of connections) {
      const a = localKeyFor(index, local, ownerPath, r);
      if (!a || !m.depthOf.has(a)) continue;
      const ends: Array<[string, LinkRef | null]> = [["endpointA", r.endpointA], ["endpointB", r.endpointB]];
      for (const [field, link] of ends) {
        const t = linkedLocal(index, local, resolve, ownerPath, link);
        if (!t) continue;
        const alreadyPlaced = m.depthOf.has(t.key);
        addLocalNode(index, local, m, t.path, t.record, ownerDepth + 1, profile);
        if (!m.depthOf.has(t.key)) continue;
        if (alreadyPlaced) m.localEdges.push({ parent: a, child: t.key, field, direction: "out", count: 1 });
        else m.tree.push({ parent: a, child: t.key, field, direction: "out", count: 1 });
      }
      if(r.sourceSchemaVersion==="0.4"){
        for(const link of r.exposes){
          const t=linkedLocal(index,local,resolve,ownerPath,link);
          if(!t) continue;
          const alreadyPlaced=m.depthOf.has(t.key);
          addLocalNode(index,local,m,t.path,t.record,ownerDepth+1,profile);
          if(!m.depthOf.has(t.key)) continue;
          if(alreadyPlaced) m.localEdges.push({parent:a,child:t.key,field:"exposes",direction:"out",count:1});
          else m.tree.push({parent:a,child:t.key,field:"exposes",direction:"out",count:1});
        }
      }
    }
  }

  for (const definitionPath of starts.filter((p) => {
    const note=index.notes.get(p);
    return note?.type==="Item Flow" || note?.type==="Port" || (note?.type==="Object"&&note.subtype==="interface");
  })) {
    const d = m.depthOf.get(definitionPath) ?? 0;
    const note=index.notes.get(definitionPath);
    const expected = note?.type==="Item Flow" ? "flow" : "endpoint";
    const occurrences = local.occurrencesOf(definitionPath, resolve)
      .filter(({ record }) => record.kind === expected)
      .sort((a, b) => a.path.localeCompare(b.path) || a.record.identifier.localeCompare(b.record.identifier));
    for (const { path, record } of occurrences) {
      const k = addLocalNode(index, local, m, path, record, d + 1, profile);
      if (k) m.tree.push({ parent: definitionPath, child: k, field: "occurrence", direction: "out", count: 1 });
    }
  }

  return { ...base, ...m };
}


/** WB-106 Where Used: show contextual occurrences of a reusable definition. */
export function withLocalWhereUsed(index: ModelIndex, local: LocalModelIndex, resolve: ResolvePath, base: ViewResult, profile: ViewProfile = WHERE_USED_PROFILE): ViewResult {
  if (profile.name !== WHERE_USED_PROFILE.name) return base;
  const m = mutableLocal(base);
  for (const definitionPath of base.starts.filter((p) => index.notes.has(p))) {
    const d = m.depthOf.get(definitionPath) ?? 0;
    const occurrences = local.occurrencesOf(definitionPath, resolve)
      .sort((a, b) => a.path.localeCompare(b.path) || a.record.kind.localeCompare(b.record.kind) || a.record.identifier.localeCompare(b.record.identifier));
    for (const { path, record } of occurrences) {
      const k = addLocalNode(index, local, m, path, record, d + 1, profile);
      if (k) m.tree.push({ parent: definitionPath, child: k, field: "occurrence", direction: "out", count: 1 });
    }
  }
  return { ...base, ...m };
}

/** WB-106 Requirements: block-targeted appliesTo remains attached to the exact local occurrence. */
export function withLocalRequirements(index: ModelIndex, local: LocalModelIndex, base: ViewResult, profile: ViewProfile = REQUIREMENTS_PROFILE): ViewResult {
  if (profile.name !== REQUIREMENTS_PROFILE.name) return base;
  const m = mutableLocal(base);
  for (const requirementPath of base.starts.filter((p) => index.notes.get(p)?.type === "Requirement")) {
    const d = m.depthOf.get(requirementPath) ?? 0;
    const refs = (index.notes.get(requirementPath)?.localRefs ?? [])
      .filter((r) => r.field === "appliesTo")
      .sort((a, b) => a.path.localeCompare(b.path) || a.localId.localeCompare(b.localId));
    for (const ref of refs) {
      const record = local.recordsOf(ref.path).find((r) => r.localId === ref.localId);
      if (!record) continue;
      const k = addLocalNode(index, local, m, ref.path, record, d + 1, profile);
      if (k) m.tree.push({ parent: requirementPath, child: k, field: "appliesTo", direction: "out", count: 1 });
    }
  }
  return { ...base, ...m };
}

/** Adds Local Model occurrences only for the four WB-106 views that own them. */
export function withLocalInternal(index: ModelIndex, local: LocalModelIndex, resolve: ResolvePath, base: ViewResult, profile: ViewProfile = INTERNAL_PROFILE): ViewResult {
  if (profile.name !== INTERNAL_PROFILE.name) return base;
  const ownerPath = base.starts[0];
  if (!ownerPath || index.notes.get(ownerPath)?.type !== "Object") return base;
  const records = local.recordsOf(ownerPath);
  if (!records.length) return base;

  const m = mutableLocal(base);
  for (const record of records) addLocalNode(index, local, m, ownerPath, record, 1, profile);
  const internal = buildInternalView(index, local, ownerPath, resolve);
  return { ...base, ...m, specialCanvas: internal.canvas };
}


/** True only for views whose semantics include governed Local Model occurrences. */
export function profileNeedsLocalOccurrences(profile: ViewProfile): boolean {
  return profile.needsLocalOccurrences === true;
}

export function withLocalOccurrences(index: ModelIndex, local: LocalModelIndex, resolve: ResolvePath, base: ViewResult, profile: ViewProfile): ViewResult {
  // Definition-only profiles must remain independent from Local Model parsing/hydration.
  if (!profileNeedsLocalOccurrences(profile)) return base;
  switch (profile.name) {
    case "Internal": return withLocalInternal(index, local, resolve, base, profile);
    case "Structure": return withLocalStructure(index, local, base, profile);
    case "Interfaces": return withLocalInterfaces(index, local, resolve, base, profile);
    case "Where Used": return withLocalWhereUsed(index, local, resolve, base, profile);
    case "Requirements": return withLocalRequirements(index, local, base, profile);
    default: return base;
  }
}

/** Stable fingerprint of a view's content, for stale-view detection (WB-035). */
export function signature(view: ViewResult): string {
  const nodes = [...view.depthOf.keys()].sort().join("\n");
  const edges = view.edges.map((e) => `${e.from}|${e.field}|${e.to}`).sort().join("\n");
  const dupes = view.tree.filter((l) => l.count > 1).map((l) => `${l.parent}|${l.field}|${l.child}x${l.count}`).sort().join("\n");
  const more = [...view.omitted].map(([p, n]) => `${p}:${n}`).sort().join("\n");
  const local = [...view.localNodes.entries()].map(([id, n]) => {
    const r = n.record;
    return `${id}|${r.identifier}|${r.definition?.text ?? ""}|${r.multiplicity ?? ""}|${r.usage}`;
  }).sort().join("\n");
  const localEdges = view.localEdges.map((e) => `${e.parent}|${e.field}|${e.child}|${e.direction}`).sort().join("\n");
  let h = 2166136261;
  for (const ch of `${view.profile}\n${nodes}\n${edges}\n${more}\n${dupes}\n${local}\n${localEdges}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Relationship name on every link. Repeated source targets are labeled explicitly as duplicate evidence, not quantity. */
function edgeLabel(field: string, count: number): string | undefined {
  const text = count > 1 ? `${field} (duplicate ×${count})` : field;
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
/** One color per relationship in profile order, all different from the undefined-card red (WB-096): Canvas colors 4, 5, 6, 2, 3, then seven hex colors for the sixth to twelfth. */
const PALETTE = ["4", "5", "6", "2", "3", "#9aa0a6", "#b5835a", "#7f9cf5", "#c9b037", "#5fb3b3", "#a37ed6", "#e0a458"];

export interface CanvasNode {
  id: string;
  type: "file" | "text" | "group";
  file?: string;
  text?: string;
  /** JSON Canvas group label; used by Internal Structure boundaries. */
  label?: string;
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
  /** "none" for a symmetric link (WB-102). */
  toEnd?: "none" | "arrow";
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
  if (profile.name === INTERNAL_PROFILE.name && view.specialCanvas) return view.specialCanvas;
  const nameOf = (p: string) => view.localNodes.get(p)?.record.identifier ?? (isUndefinedId(p) ? undefinedName(p) : index.notes.get(p)?.name ?? p);
  const colorOf = new Map<string, string>();
  for (const s of profile.steps) if (!colorOf.has(s.field)) colorOf.set(s.field, PALETTE[colorOf.size % PALETTE.length]);
  const localFields = [...view.tree, ...view.localEdges].map((l) => l.field);
  for (const field of localFields) if (!colorOf.has(field)) colorOf.set(field, PALETTE[colorOf.size % PALETTE.length]);
  const plainFields = new Set(profile.steps.filter((s) => s.noArrow).map((s) => s.field));
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
        ...(plainFields.has(l.field) ? { toEnd: "none" as const } : {}),
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
    const localNode = view.localNodes.get(p);
    if (localNode) {
      const r = localNode.record;
      const owner = localNode.ownerPath.replace(/\.md$/i, "");
      const selfLink = `[[${owner}#^${r.localId}|${r.identifier}]]`;
      const kind = r.kind === "part" ? "part occurrence" : r.kind === "endpoint" ? "interface occurrence" : r.kind === "flow" ? "flow occurrence" : "connection";
      const context =
        r.kind === "endpoint"
          ? r.part?.text ? `Part: ${r.part.text}` : r.parent?.text ? `Parent: ${r.parent.text}` : "Assembly boundary"
          : "";
      const detail = [
        `**${selfLink}**`,
        `*${kind}*`,
        `Owner: [[${owner}]]`,
        r.definition ? `Definition: ${r.definition.text}` : "",
        context,
        r.multiplicity ? `Multiplicity: ${r.multiplicity}` : "",
        r.usage !== "standard" ? `Usage: ${r.usage}` : "",
      ].filter(Boolean).join("\n");
      nodes.push({ id, type: "text", text: detail, x, y, width: NODE_W, height: NODE_H });
    } else if (isUndefinedId(p)) nodes.push({ id, type: "text", text: `**${undefinedName(p)}**\n*undefined*`, x, y, width: NODE_W, height: NODE_H, color: UNDEFINED_COLOR });
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

  // Local topology links between already placed occurrence cards.
  for (const l of view.localEdges) {
    const a = idOf.get(l.parent);
    const b = idOf.get(l.child);
    if (!a || !b) continue;
    const reverse = l.direction === "in";
    edges.push({
      id: `e${edges.length}`,
      fromNode: reverse ? b : a,
      toNode: reverse ? a : b,
      fromSide: reverse ? "left" : "right",
      toSide: reverse ? "right" : "left",
      label: edgeLabel(l.field, l.count),
      color: colorOf.get(l.field) ?? "#9aa0a6",
      ...(plainFields.has(l.field) || l.field === "equals" ? { toEnd: "none" as const } : {}),
    });
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
