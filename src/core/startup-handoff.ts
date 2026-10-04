export type CancelStartupHandoff = () => void;

/**
 * Queue startup outside the current layout-ready call stack.
 * The callback passed by Obsidian must return before any Workbench startup work executes.
 */
export function scheduleStartupHandoff(
  schedule: (run: () => void) => unknown,
  cancel: (handle: unknown) => void,
  run: () => void,
): { cancel: CancelStartupHandoff } {
  let active = true;
  const handle = schedule(() => {
    if (!active) return;
    active = false;
    run();
  });
  return {
    cancel: () => {
      if (!active) return;
      active = false;
      cancel(handle);
    },
  };
}
