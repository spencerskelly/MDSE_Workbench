import { validateVariantOf } from "../core/variantof";
/**
 * Shared asynchronous model-assurance service (W-346 / RTA-4).
 *
 * Whole-index and whole-Local-Model validation is expensive enough that each consumer must not
 * recompute it independently. This service memoizes one snapshot by the Indexer's semantic revision,
 * coalesces concurrent requests, and waits for pending Local Model parsing before a scan.
 */
import type { LocalFinding } from "../core/localmodel";
import type { Findings, ModelIndex } from "../core/model";
import { countByCategory, toFindings, type Category, type Finding } from "../core/review";

export interface AssuranceSnapshot {
  revision: number;
  computedAt: number;
  ms: number;
  stale: boolean;
  error: string | null;
  model: Findings;
  local: LocalFinding[];
  all: Finding[];
  counts: Record<Category, number>;
}

export interface AssuranceSource {
  revision(): number;
  settle(): Promise<void>;
  index(): ModelIndex;
  localFindings(): LocalFinding[];
  /** Shared foreground-activity policy for automatic/retry assurance work. */
  waitForBackgroundPermission?(): Promise<void>;
}

export class AssuranceManager {
  private cached: AssuranceSnapshot | null = null;
  private running: Promise<AssuranceSnapshot> | null = null;

  constructor(private readonly source: AssuranceSource) {}

  get active(): boolean {
    return this.running !== null;
  }

  peek(): AssuranceSnapshot | null {
    const s = this.cached;
    return s && s.revision === this.source.revision() ? s : null;
  }

  async get(force = false): Promise<AssuranceSnapshot> {
    if (!force) {
      const cached = this.peek();
      if (cached) return cached;
      if (this.running) return this.running;
    }
    const task = this.compute(force);
    this.running = task;
    try {
      return await task;
    } finally {
      if (this.running === task) this.running = null;
    }
  }

  invalidate(): void {
    this.cached = null;
  }

  private async compute(force: boolean): Promise<AssuranceSnapshot> {
    // One retry handles an edit racing the first scan without allowing assurance to become an
    // unbounded foreground loop while the engineer is actively changing the model.
    let last: AssuranceSnapshot | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Automatic assurance and any stale retry share the same foreground-quiet gate as other
      // optional background work. A manual force may start immediately, but if it races an edit
      // its retry yields to the shared policy before scanning again.
      if ((!force || attempt > 0) && this.source.waitForBackgroundPermission) {
        await this.source.waitForBackgroundPermission();
      }
      await this.source.settle();
      const revision = this.source.revision();
      const t0 = performance.now();
      try {
        const model = this.source.index().findings();
        const local = this.source.localFindings();
        const all = toFindings(model, local, validateVariantOf(this.source.index()));
        const stale = this.source.revision() !== revision;
        last = {
          revision,
          computedAt: Date.now(),
          ms: Math.round(performance.now() - t0),
          stale,
          error: null,
          model,
          local,
          all,
          counts: countByCategory(all),
        };
        if (!stale) {
          this.cached = last;
          return last;
        }
      } catch (e) {
        const model = emptyFindings();
        const all: Finding[] = [];
        last = {
          revision,
          computedAt: Date.now(),
          ms: Math.round(performance.now() - t0),
          stale: this.source.revision() !== revision,
          error: (e as Error).message || String(e),
          model,
          local: [],
          all,
          counts: countByCategory(all),
        };
        // A repeatable validator defect is a scoped subsystem failure, not a reason to crash
        // Workbench. Cache it for this semantic revision; manual force or a model change retries.
        if (!last.stale) {
          this.cached = last;
          return last;
        }
      }
    }
    // Do not cache a racing snapshot. The next request can retry once the model is quiet.
    return last as AssuranceSnapshot;
  }
}


function emptyFindings(): Findings {
  return {
    missingInverse: [],
    orphanInverse: [],
    offRule: [],
    provisional: [],
    unresolvedLinks: 0,
    broken: [],
  };
}
