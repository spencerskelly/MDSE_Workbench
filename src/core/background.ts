export const BACKGROUND_RESUME_QUIET_MS = 3000;
export const BACKGROUND_MAX_DEFERRAL_MS = 30000;

export interface BackgroundWorkState {
  unloaded: boolean;
  ready: boolean;
  building: boolean;
  rebuildPending: boolean;
  liveUpdatePending: number;
  quietForMs: number;
  minimumQuietMs: number;
  /** Age of the pending background request; only the quiet-window rule may age out. */
  waitingForMs?: number;
  maxDeferralMs?: number;
}

/** Shared policy for optional/background work that must yield to foreground model activity. */
export function canRunBackgroundWork(state: BackgroundWorkState): boolean {
  return (
    !state.unloaded &&
    state.ready &&
    !state.building &&
    !state.rebuildPending &&
    state.liveUpdatePending === 0 &&
    (
      state.quietForMs >= state.minimumQuietMs ||
      (
        state.maxDeferralMs !== undefined &&
        state.waitingForMs !== undefined &&
        state.waitingForMs >= state.maxDeferralMs
      )
    )
  );
}


export const RuntimeWorkPriority = {
  cacheWrite: 100,
  assurance: 200,
  backgroundHydration: 300,
  requestedHydration: 400,
  indexing: 500,
} as const;

export type RuntimeWorkKind = keyof typeof RuntimeWorkPriority;

/** Highest-numbered work wins. Lower-priority work may start only when no higher-priority work is active. */
export function canStartRuntimeWork(requested: RuntimeWorkKind, active: readonly RuntimeWorkKind[]): boolean {
  const requestedPriority = RuntimeWorkPriority[requested];
  return !active.some((kind) => RuntimeWorkPriority[kind] > requestedPriority);
}
