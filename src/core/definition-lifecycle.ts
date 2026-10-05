export interface DefinitionNoteUse {
  fromPath: string;
  field: string;
}

export interface DefinitionOccurrenceUse {
  ownerPath: string;
  localId: string;
  kind: "part" | "endpoint" | "connection" | "flow";
  identifier: string;
}

export interface DefinitionDeletionImpact {
  definitionPath: string;
  noteUses: DefinitionNoteUse[];
  occurrenceUses: DefinitionOccurrenceUse[];
}

export interface DefinitionDeletionAssessment {
  allowed: boolean;
  blockers: string[];
  noteUseCount: number;
  occurrenceUseCount: number;
}

/**
 * Pure WB-106 lifecycle guard for destructive definition deletion.
 *
 * Reusable definitions are never silently repaired or detached. Any active indexed note
 * relationship or Local Model occurrence reference blocks deletion. Retirement/supersession are
 * separate lifecycle operations and must resolve these blockers explicitly.
 */
export function assessDefinitionDeletion(impact: DefinitionDeletionImpact): DefinitionDeletionAssessment {
  const noteUses = [...impact.noteUses].sort((a, b) =>
    a.fromPath.localeCompare(b.fromPath) || a.field.localeCompare(b.field)
  );
  const occurrenceUses = [...impact.occurrenceUses].sort((a, b) =>
    a.ownerPath.localeCompare(b.ownerPath) ||
    a.kind.localeCompare(b.kind) ||
    a.identifier.localeCompare(b.identifier) ||
    a.localId.localeCompare(b.localId)
  );

  const blockers = [
    ...noteUses.map((use) => `MODEL: ${use.fromPath} references this definition through ${use.field}.`),
    ...occurrenceUses.map((use) =>
      `LOCAL: ${use.ownerPath} contains ${use.kind} "${use.identifier}" (^${use.localId}) using this definition.`
    ),
  ];

  return {
    allowed: blockers.length === 0,
    blockers,
    noteUseCount: noteUses.length,
    occurrenceUseCount: occurrenceUses.length,
  };
}
