/** Merge unfinished occurrence owners back into the deferred queue deterministically. */
export function requeueHydrationPaths(
  deferred: readonly string[],
  active: readonly string[],
): string[] {
  return [...new Set([...deferred, ...active])].sort();
}
