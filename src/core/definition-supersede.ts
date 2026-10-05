import type { DefinitionDeletionImpact } from "./definition-lifecycle";

export interface DefinitionSupersessionRequest {
  replacedPath: string;
  replacedType: string;
  replacementPath: string;
  replacementType: string;
  replacementStatus?: string | null;
  impact: DefinitionDeletionImpact;
}

export interface DefinitionMigrationCandidate {
  scope: "note" | "occurrence";
  ownerPath: string;
  field: string;
  localId?: string;
  kind?: "part" | "endpoint" | "connection" | "flow";
  identifier?: string;
}

export interface DefinitionSupersessionPlan {
  replacedPath: string;
  replacementPath: string;
  relationshipField: "supersedes";
  valid: boolean;
  blockers: string[];
  warnings: string[];
  migrationCandidates: DefinitionMigrationCandidate[];
  /** Supersession records replacement intent only; migration stays explicit. */
  rewritesReferences: false;
}

const LIFECYCLE_PROVENANCE_FIELDS = new Set(["supersedes", "supersededBy"]);

/**
 * Convert complete lifecycle impact into the subset that should actually be migrated to a
 * replacement definition. Supersession provenance remains attached to the historical definitions;
 * it is evidence for lifecycle review, not an engineering dependency to retarget.
 */
export function definitionMigrationCandidates(impact: DefinitionDeletionImpact): DefinitionMigrationCandidate[] {
  return [
    ...impact.noteUses
      .filter((use) => !LIFECYCLE_PROVENANCE_FIELDS.has(use.field))
      .map((use) => ({
        scope: "note" as const,
        ownerPath: use.fromPath,
        field: use.field,
      })),
    ...impact.occurrenceUses.map((use) => ({
      scope: "occurrence" as const,
      ownerPath: use.ownerPath,
      field: "definition",
      localId: use.localId,
      kind: use.kind,
      identifier: use.identifier,
    })),
  ].sort((a, b) =>
    a.ownerPath.localeCompare(b.ownerPath) ||
    a.scope.localeCompare(b.scope) ||
    a.field.localeCompare(b.field) ||
    (a.scope === "occurrence" ? a.localId : "").localeCompare(b.scope === "occurrence" ? b.localId : "")
  );
}

/**
 * Pure WB-106 supersession planner.
 *
 * relationships.yaml 1.35 defines supersedes/supersededBy as same-class, with the replacing note
 * owning `supersedes`. This planner never rewrites a dependent note or occurrence. It produces a
 * deterministic migration inventory for later guided, reviewed edits.
 */
export function planDefinitionSupersession(request: DefinitionSupersessionRequest): DefinitionSupersessionPlan {
  const replacedPath = request.replacedPath.trim();
  const replacementPath = request.replacementPath.trim();
  const replacedType = request.replacedType.trim();
  const replacementType = request.replacementType.trim();
  const status = (request.replacementStatus ?? "").trim().toLowerCase();

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!replacedPath || !replacementPath) blockers.push("Both replaced and replacement definition paths are required.");
  if (replacedPath && replacementPath && replacedPath === replacementPath) blockers.push("A definition cannot supersede itself.");
  if (!replacedType || !replacementType) blockers.push("Both definitions must have governed model types.");
  if (replacedType && replacementType && replacedType !== replacementType) {
    blockers.push(`Supersession requires the same model class; ${replacementType} cannot supersede ${replacedType}.`);
  }
  if (status === "retired") warnings.push("The selected replacement definition is already retired.");

  const migrationCandidates = definitionMigrationCandidates(request.impact);

  return {
    replacedPath,
    replacementPath,
    relationshipField: "supersedes",
    valid: blockers.length === 0,
    blockers,
    warnings,
    migrationCandidates,
    rewritesReferences: false,
  };
}
