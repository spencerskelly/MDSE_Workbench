/** Small keyed single-flight registry: concurrent callers for one key share one promise. */
export class SingleFlightByKey<K, V> {
  private readonly active = new Map<K, Promise<V>>();

  get size(): number {
    return this.active.size;
  }

  keys(): K[] {
    return [...this.active.keys()];
  }

  get(key: K): Promise<V> | undefined {
    return this.active.get(key);
  }

  run(key: K, start: () => Promise<V>): Promise<V> {
    const existing = this.active.get(key);
    if (existing) return existing;
    let task: Promise<V>;
    task = start().finally(() => {
      if (this.active.get(key) === task) this.active.delete(key);
    });
    this.active.set(key, task);
    return task;
  }

  clear(): void {
    this.active.clear();
  }
}
