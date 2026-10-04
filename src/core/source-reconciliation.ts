export interface SourceReconciliationState {
  building: boolean;
  rebuildPending: boolean;
  livePending: number;
  liveApplyTimerPending: boolean;
  liveApplyActive: boolean;
  relationshipResolvePending: boolean;
  relationshipResolveTimerPending: boolean;
  relationshipResolveActive: boolean;
}

/** True while source-path/index semantics are still changing or scheduled to change. */
export function hasPendingSourceReconciliation(state: SourceReconciliationState): boolean {
  return (
    state.building ||
    state.rebuildPending ||
    state.livePending > 0 ||
    state.liveApplyTimerPending ||
    state.liveApplyActive ||
    state.relationshipResolvePending ||
    state.relationshipResolveTimerPending ||
    state.relationshipResolveActive
  );
}
