/**
 * Warm restore is disposable. Recovery always discards provisional semantic state before
 * entering the authoritative cold-build path.
 */
export async function recoverWithColdBuild<T>(
  discardProvisionalState: () => void,
  coldBuild: () => Promise<T>,
): Promise<T> {
  discardProvisionalState();
  return await coldBuild();
}
