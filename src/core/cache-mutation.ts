/**
 * Serializes destructive cache clearing against background persistence.
 *
 * A clear request closes the write gate immediately, waits for any write that was already
 * active, then performs deletion. New writes stay suppressed until deletion finishes.
 */
export class CacheMutationGate {
  private clearTask: Promise<void> | null = null;

  get clearing(): boolean {
    return this.clearTask !== null;
  }

  writesAllowed(): boolean {
    return this.clearTask === null;
  }

  clear(activeWrite: Promise<unknown> | null, remove: () => Promise<void>): Promise<void> {
    if (this.clearTask) return this.clearTask;

    let task: Promise<void>;
    task = (async () => {
      if (activeWrite) await activeWrite;
      await remove();
    })().finally(() => {
      if (this.clearTask === task) this.clearTask = null;
    });

    this.clearTask = task;
    return task;
  }
}
