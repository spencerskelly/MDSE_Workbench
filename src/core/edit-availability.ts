import { editingBlocked, type Schema } from "./schema";

/**
 * Ordinary Workbench model editing depends only on authoritative core readiness and schema
 * compatibility. Derived subsystems (occurrence, cache, assurance) must never disable editing.
 */
export function editingBlockedReason(coreReady: boolean, schema: Schema | null): string | null {
  if (!coreReady) return "Workbench is still indexing; try again in a moment.";
  if (!schema) return "Workbench schema is not available.";
  if (editingBlocked(schema)) return "The vault's schema is older than this Workbench supports, so editing is off.";
  return null;
}
