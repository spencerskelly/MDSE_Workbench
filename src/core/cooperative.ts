/**
 * Cooperative work budget for UI-safe long loops (W-356).
 *
 * Count-based yielding behaves differently on fast and slow machines. This helper yields by
 * elapsed work time instead, so large model operations remain responsive across hardware.
 */
export class CooperativeBudget {
  private startedAt: number;

  constructor(
    private readonly budgetMs = 12,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (!(budgetMs > 0) || !Number.isFinite(budgetMs)) throw new Error("Cooperative budget must be a positive finite number.");
    this.startedAt = this.now();
  }

  shouldYield(): boolean {
    return this.now() - this.startedAt >= this.budgetMs;
  }

  reset(): void {
    this.startedAt = this.now();
  }

  async checkpoint(yieldNow: () => Promise<void>): Promise<boolean> {
    if (!this.shouldYield()) return false;
    await yieldNow();
    this.reset();
    return true;
  }
}
