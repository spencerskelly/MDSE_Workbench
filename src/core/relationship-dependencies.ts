/**
 * Derived reverse dependency index for relationship resolution.
 *
 * Source Markdown/authored link evidence remains authoritative. This index only answers:
 * "which source notes currently depend on this resolved target path?"
 */
export class ReversePathDependencyIndex {
  private readonly byTarget = new Map<string, Set<string>>();
  private readonly bySource = new Map<string, Set<string>>();

  set(sourcePath: string, targetPaths: Iterable<string>): void {
    this.remove(sourcePath);
    const targets = new Set([...targetPaths].filter((path) => path && path !== sourcePath));
    if (!targets.size) return;
    this.bySource.set(sourcePath, targets);
    for (const target of targets) {
      let sources = this.byTarget.get(target);
      if (!sources) this.byTarget.set(target, (sources = new Set()));
      sources.add(sourcePath);
    }
  }

  remove(sourcePath: string): void {
    const targets = this.bySource.get(sourcePath);
    if (!targets) return;
    this.bySource.delete(sourcePath);
    for (const target of targets) {
      const sources = this.byTarget.get(target);
      if (!sources) continue;
      sources.delete(sourcePath);
      if (!sources.size) this.byTarget.delete(target);
    }
  }

  dependentsOf(targetPaths: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const target of targetPaths) {
      for (const source of this.byTarget.get(target) ?? []) out.add(source);
    }
    return [...out].sort();
  }

  targetsOf(sourcePath: string): string[] {
    return [...(this.bySource.get(sourcePath) ?? [])].sort();
  }

  clear(): void {
    this.byTarget.clear();
    this.bySource.clear();
  }

  get targetCount(): number {
    return this.byTarget.size;
  }

  get sourceCount(): number {
    return this.bySource.size;
  }
}
