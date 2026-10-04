/**
 * Pure startup cache-restore probe used to verify recovery behavior independently of Obsidian UI.
 *
 * It deliberately does not choose the cold-build fallback. Step 43 owns that runtime policy.
 * This helper only answers whether a complete, compatible core generation can be restored.
 */
import { restoreCoreSemanticState, type CacheScope, type CoreSemanticCache, type RestoredCoreSemanticState } from "./cache";
import type { Schema } from "./schema";

export type CoreCacheStartupResult =
  | { restored: true; state: RestoredCoreSemanticState; cache: CoreSemanticCache }
  | { restored: false; reason: string };

export async function probeCoreCacheStartup(
  read: () => Promise<CoreSemanticCache>,
  schema: Schema,
  scope: CacheScope,
): Promise<CoreCacheStartupResult> {
  try {
    const cache = await read();
    const state = restoreCoreSemanticState(cache, schema, scope);
    return { restored: true, state, cache };
  } catch (error) {
    return {
      restored: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
