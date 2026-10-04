export interface BackgroundOccurrenceState {
  demanded: boolean;
  backgroundIdle: boolean;
  liveUpdatePending: number;
  requestedActive: number;
}

/** Background occurrence work yields whenever requested occurrence work is active. */
export function shouldPauseBackgroundOccurrence(state: BackgroundOccurrenceState): boolean {
  return (
    !state.demanded &&
    (!state.backgroundIdle || state.liveUpdatePending > 0 || state.requestedActive > 0)
  );
}

/** Epoch + owner revision together prevent stale occurrence publication. */
export function canPublishOccurrence(
  epoch: number,
  currentEpoch: number,
  revision: number,
  currentRevision: number | undefined,
): boolean {
  return epoch === currentEpoch && currentRevision === revision;
}
