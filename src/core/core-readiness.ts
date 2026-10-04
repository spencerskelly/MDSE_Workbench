export interface CoreReadyState {
  publicationGate: boolean;
  schemaLoaded: boolean;
  writerReady: boolean;
  statsAvailable: boolean;
  sourceReconciliationPending: boolean;
  building: boolean;
}

/**
 * Core readiness is an explicit publication decision, not an inference from restored/build stats.
 * A warm cache may install valid internal state before source reconciliation finishes; consumers
 * must remain blocked until compatibility and source reconciliation have completed successfully.
 */
export function canPublishCoreReady(state: CoreReadyState): boolean {
  return (
    state.publicationGate &&
    state.schemaLoaded &&
    state.writerReady &&
    state.statsAvailable &&
    !state.sourceReconciliationPending &&
    !state.building
  );
}
