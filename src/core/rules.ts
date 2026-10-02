/**
 * Endpoint rules (workspace decisions W-272 to W-288). The rules say what a person, AI or
 * Workbench may create; links already in the vault that break them are Review findings.
 */
import type { Endpoint, RelationshipDef, Schema } from "./schema";

const inEndpoint = (e: Endpoint, cls: string) => e === "any" || e.includes(cls);

export interface RuleResult {
  ok: boolean;
  reason?: string;
}

/** Can `def` be written on a note of class `fromClass` pointing at a note of class `toClass`? */
export function allows(def: RelationshipDef, fromClass: string, toClass: string): RuleResult {
  if (!inEndpoint(def.from, fromClass)) {
    return { ok: false, reason: `${def.field} is not written on a ${fromClass}.` };
  }
  if (!inEndpoint(def.to, toClass)) {
    return { ok: false, reason: `${def.field} does not point at a ${toClass}.` };
  }
  if (def.sameClass && fromClass !== toClass) {
    return { ok: false, reason: `${def.field} connects two notes of the same class only.` };
  }
  if (def.excludePairs.some(([f, t]) => f === fromClass && t === toClass)) {
    return { ok: false, reason: `${fromClass} to ${toClass} uses another relationship, not ${def.field}.` };
  }
  return { ok: true };
}

export interface RelationshipOption {
  def: RelationshipDef;
  /** The note the forward field is written on. */
  ownerIsFirst: boolean;
}

/**
 * Every relationship that may be created between two selected notes, in either direction.
 * Temporary relationships are left out: they exist only to keep the import mechanical.
 * The provisional relationship (tracesTo) is offered last (WB-054, W-288).
 */
export function optionsBetween(schema: Schema, firstClass: string, secondClass: string): RelationshipOption[] {
  const out: RelationshipOption[] = [];
  for (const def of schema.relationships) {
    if (def.temporary) continue;
    const forward = allows(def, firstClass, secondClass).ok;
    const backward = allows(def, secondClass, firstClass).ok;
    if (forward) out.push({ def, ownerIsFirst: true });
    // A symmetric field is the same link both ways; offer it once.
    if (backward && !(def.kind === "symmetric" && forward)) out.push({ def, ownerIsFirst: false });
  }
  return out.sort((a, b) => Number(a.def.provisional) - Number(b.def.provisional) || a.def.order - b.def.order);
}
