import type { RelationshipDef } from "./schema";

export interface DefinitionNoteMigrationRequest {
  ownerPath: string;
  field: string;
  replacedPath: string;
  replacementPath: string;
  relationship: RelationshipDef;
  /** Freshly resolved targets currently authored in owner.field. */
  currentTargets: string[];
}

export interface DefinitionNoteMigrationPlan {
  ownerPath: string;
  field: string;
  replacedPath: string;
  replacementPath: string;
  inverseField: string | null;
  symmetric: boolean;
  /** True when owner.field is the inverse side of a paired relationship. */
  authoredAsInverse: boolean;
  sourceMutation: { removeTarget: string; addTarget: string };
  inverseMutations: Array<{ path: string; field: string; removeTarget?: string; addTarget?: string }>;
}

/**
 * Pure planner for migrating one authored model relationship from a superseded definition.
 *
 * The caller supplies fresh resolved targets from owner.field. Planning fails unless the old
 * definition is still present and the replacement is not already present. Paired/symmetric
 * inverse movement is explicit so the later structural service can update every required file
 * in one reviewed transaction instead of relying on derivative repair.
 */
export function planDefinitionNoteMigration(request: DefinitionNoteMigrationRequest): DefinitionNoteMigrationPlan {
  const ownerPath = request.ownerPath.trim();
  const field = request.field.trim();
  const replacedPath = request.replacedPath.trim();
  const replacementPath = request.replacementPath.trim();
  const currentTargets = [...request.currentTargets];

  if (!ownerPath) throw new Error("Relationship owner path is required.");
  if (!field) throw new Error("Relationship field is required.");
  if (!replacedPath || !replacementPath) throw new Error("Both superseded and replacement definition paths are required.");
  if (replacedPath === replacementPath) throw new Error("Superseded and replacement definitions must be different.");
  const symmetric = request.relationship.kind === "symmetric";
  const authoredAsForward = request.relationship.field === field;
  const authoredAsInverse = !symmetric && !!request.relationship.inverse && request.relationship.inverse === field;
  if (!authoredAsForward && !authoredAsInverse) {
    const expected = request.relationship.inverse
      ? `${request.relationship.field} or ${request.relationship.inverse}`
      : request.relationship.field;
    throw new Error(`Relationship schema mismatch: expected ${expected}, got ${field}.`);
  }
  if (!currentTargets.includes(replacedPath)) {
    throw new Error(`Relationship changed from the superseded definition; ${field} no longer targets ${replacedPath}.`);
  }
  if (currentTargets.includes(replacementPath)) {
    throw new Error(`Relationship already targets replacement definition ${replacementPath}.`);
  }

  const inverseField = symmetric
    ? field
    : authoredAsInverse
      ? request.relationship.field
      : request.relationship.inverse ?? null;
  const inverseMutations: DefinitionNoteMigrationPlan["inverseMutations"] = [];

  if (inverseField) {
    inverseMutations.push({
      path: replacedPath,
      field: inverseField,
      removeTarget: ownerPath,
    });
    inverseMutations.push({
      path: replacementPath,
      field: inverseField,
      addTarget: ownerPath,
    });
  }

  return {
    ownerPath,
    field,
    replacedPath,
    replacementPath,
    inverseField,
    symmetric,
    authoredAsInverse,
    sourceMutation: { removeTarget: replacedPath, addTarget: replacementPath },
    inverseMutations,
  };
}
