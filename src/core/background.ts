export interface BackgroundWorkState {
  unloaded: boolean;
  ready: boolean;
  building: boolean;
  rebuildPending: boolean;
  liveUpdatePending: number;
  quietForMs: number;
  minimumQuietMs: number;
}

/** Shared policy for optional/background work that must yield to foreground model activity. */
export function canRunBackgroundWork(state: BackgroundWorkState): boolean {
  return (
    !state.unloaded &&
    state.ready &&
    !state.building &&
    !state.rebuildPending &&
    state.liveUpdatePending === 0 &&
    state.quietForMs >= state.minimumQuietMs
  );
}
