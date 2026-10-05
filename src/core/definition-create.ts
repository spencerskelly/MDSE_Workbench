import type { LocalKind } from "./localmodel";

const UID = /^\d{17}[A-Za-z]{13}$/;

export interface DefinitionCreationRequest {
  localKind: LocalKind;
  name: string;
  uid: string;
  /** Canonical vault-relative Markdown path chosen by the creation workflow. */
  path: string;
}

export interface PlannedDefinitionCreation {
  path: string;
  name: string;
  type: string;
  uid: string;
  text: string;
}

/**
 * Canonical reusable-definition class for a Local Model occurrence kind.
 *
 * This intentionally mirrors the compatibility rules used by Local Model validation. A
 * connection has no governed reusable-definition class today, so Workbench must not invent one.
 */
export function definitionTypeForLocalKind(kind: LocalKind): string | null {
  if (kind === "part") return "Object";
  if (kind === "endpoint") return "Port";
  if (kind === "flow") return "Item Flow";
  return null;
}

/**
 * Pure WB-106 planner for a new reusable definition note.
 *
 * Storage location and durable UID are supplied by the governed creation workflow. The planner
 * owns semantic compatibility and canonical Markdown shape only; it performs no vault I/O.
 */
export function planDefinitionCreation(request: DefinitionCreationRequest): PlannedDefinitionCreation {
  const name = request.name.trim();
  const path = request.path.trim();
  const uid = request.uid.trim();
  const type = definitionTypeForLocalKind(request.localKind);

  if (!type) {
    throw new Error(`Local Model ${request.localKind} occurrences do not have a governed reusable-definition class.`);
  }
  if (!name) throw new Error("Definition name is required.");
  if (!path || !path.toLowerCase().endsWith(".md")) throw new Error("Definition path must be a Markdown file path.");
  if (!UID.test(uid)) throw new Error("Definition uid must be the governed 30-character UTC timestamp + author suffix token.");

  const text = [
    "---",
    `type: ${type}`,
    `uid: ${uid}`,
    "---",
    "",
    `# ${name}`,
    "",
  ].join("\n");

  return { path, name, type, uid, text };
}
