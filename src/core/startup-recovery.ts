/**
 * Warm restore is disposable. Recovery always discards provisional semantic state before
 * entering the authoritative cold-build path.
 */
export async function recoverWithColdBuild<T>(
  discardProvisionalState: () => void | Promise<void>,
  coldBuild: () => Promise<T>,
): Promise<T> {
  await discardProvisionalState();
  return await coldBuild();
}
