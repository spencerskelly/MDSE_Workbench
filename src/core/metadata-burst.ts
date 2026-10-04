/** Tracks distinct changed paths within a rolling metadata-event burst. */
export class MetadataChangeBurst {
  private startedAt = 0;
  private readonly paths = new Set<string>();

  constructor(private readonly windowMs: number) {
    if (!(windowMs > 0) || !Number.isFinite(windowMs)) throw new Error("Metadata burst window must be a positive finite number.");
  }

  record(path: string, now: number): { distinct: boolean; uniquePaths: number } {
    if (!this.startedAt || now - this.startedAt > this.windowMs) {
      this.startedAt = now;
      this.paths.clear();
    }
    const distinct = !this.paths.has(path);
    this.paths.add(path);
    return { distinct, uniquePaths: this.paths.size };
  }

  reset(): void {
    this.startedAt = 0;
    this.paths.clear();
  }
}
