/** Read-only review findings for the optional single-target Object variantOf relationship. */
import type { ModelIndex } from "./model";

export interface VariantOfFinding {
  code: "variant.self" | "variant.multiple" | "variant.target-missing" | "variant.endpoint-invalid" | "variant.cycle" | "variant.duplicate" | "variant.unresolved" | "variant.format";
  path: string;
  target?: string;
}
export function validateVariantOf(index: ModelIndex): VariantOfFinding[] {
  const findings: VariantOfFinding[] = [];
  const next = new Map<string, string>();
  for (const note of index.notes.values()) {
    const targets = note.fields.get("variantOf") ?? [];
    if (note.variantOfFormatError) findings.push({ code: "variant.format", path: note.path });
    const missing = (note.broken ?? []).filter(x => x.field === "variantOf");
    // The resolver collapses repeated links; retain duplicate authored evidence.
    for (const [key, count] of note.repeat ?? []) {
      if (key.startsWith("variantOf|") && count > 1)
        findings.push({ code: "variant.duplicate", path: note.path, target: key.slice("variantOf|".length) });
    }
    for (const item of missing)
      findings.push({ code: "variant.unresolved", path: note.path, target: item.link });
    if (!targets.length && !missing.length) continue;
    if (note.type !== "Object") {
      findings.push({ code: "variant.endpoint-invalid", path: note.path });
    }
    if (targets.length + missing.length > 1) findings.push({ code: "variant.multiple", path: note.path });
    for (const targetPath of targets) {
      if (targetPath === note.path) findings.push({ code: "variant.self", path: note.path, target: targetPath });
      const target = index.notes.get(targetPath);
      if (!target) findings.push({ code: "variant.target-missing", path: note.path, target: targetPath });
      else if (target.type !== "Object") findings.push({ code: "variant.endpoint-invalid", path: note.path, target: targetPath });
    }
    if (note.type === "Object" && targets.length === 1 && !missing.length && targets[0] !== note.path && index.notes.get(targets[0])?.type === "Object") {
      next.set(note.path, targets[0]);
    }
  }
  // Functional graph: each node has at most one outgoing confirmed candidate edge.
  const visited = new Set<string>();
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const trail = new Map<string, number>();
    const path: string[] = [];
    let current: string | undefined = start;
    while (current && !visited.has(current)) {
      if (trail.has(current)) {
        for (const p of path.slice(trail.get(current))) findings.push({ code: "variant.cycle", path: p, target: next.get(p) });
        break;
      }
      trail.set(current, path.length);
      path.push(current);
      current = next.get(current);
    }
    for (const p of path) visited.add(p);
  }
  return findings.sort((a,b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
}
