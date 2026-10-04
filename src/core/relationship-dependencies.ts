/**
 * Derived reverse dependency indexes for relationship resolution.
 *
 * Source Markdown/authored link evidence remains authoritative. These indexes only answer
 * which source notes can be affected when one or more target paths change.
 */
export class ReversePathDependencyIndex {
  private readonly byTarget = new Map<string, Set<string>>();
  private readonly byAuthoredKey = new Map<string, Set<string>>();
  private readonly bySource = new Map<string, Set<string>>();
  private readonly authoredBySource = new Map<string, Set<string>>();

  set(sourcePath: string, targetPaths: Iterable<string>, authoredLinkpaths: Iterable<string> = []): void {
    this.remove(sourcePath);

    const targets = new Set([...targetPaths].filter((path) => path && path !== sourcePath));
    if (targets.size) {
      this.bySource.set(sourcePath, targets);
      for (const target of targets) addReverse(this.byTarget, target, sourcePath);
    }

    const authoredKeys = new Set<string>();
    for (const linkpath of authoredLinkpaths) for (const key of linkpathKeys(linkpath)) authoredKeys.add(key);
    if (authoredKeys.size) {
      this.authoredBySource.set(sourcePath, authoredKeys);
      for (const key of authoredKeys) addReverse(this.byAuthoredKey, key, sourcePath);
    }
  }

  remove(sourcePath: string): void {
    removeReverseSource(this.byTarget, this.bySource.get(sourcePath), sourcePath);
    removeReverseSource(this.byAuthoredKey, this.authoredBySource.get(sourcePath), sourcePath);
    this.bySource.delete(sourcePath);
    this.authoredBySource.delete(sourcePath);
  }

  dependentsOf(targetPaths: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const target of targetPaths) {
      for (const source of this.byTarget.get(target) ?? []) out.add(source);
    }
    return [...out].sort();
  }

  /**
   * Conservative candidate lookup for add/delete/rename. It unions currently resolved target
   * dependencies with authored linkpath keys so newly resolvable links are not missed.
   */
  candidatesForPathChanges(paths: Iterable<string>): string[] {
    const out = new Set<string>(this.dependentsOf(paths));
    for (const path of paths) {
      for (const key of linkpathKeys(path)) {
        for (const source of this.byAuthoredKey.get(key) ?? []) out.add(source);
      }
    }
    return [...out].sort();
  }

  targetsOf(sourcePath: string): string[] {
    return [...(this.bySource.get(sourcePath) ?? [])].sort();
  }

  clear(): void {
    this.byTarget.clear();
    this.byAuthoredKey.clear();
    this.bySource.clear();
    this.authoredBySource.clear();
  }

  get targetCount(): number {
    return this.byTarget.size;
  }

  get sourceCount(): number {
    return new Set([...this.bySource.keys(), ...this.authoredBySource.keys()]).size;
  }
}

function addReverse(index: Map<string, Set<string>>, key: string, sourcePath: string): void {
  let sources = index.get(key);
  if (!sources) index.set(key, (sources = new Set()));
  sources.add(sourcePath);
}

function removeReverseSource(index: Map<string, Set<string>>, keys: Set<string> | undefined, sourcePath: string): void {
  if (!keys) return;
  for (const key of keys) {
    const sources = index.get(key);
    if (!sources) continue;
    sources.delete(sourcePath);
    if (!sources.size) index.delete(key);
  }
}

function linkpathKeys(value: string): string[] {
  const clean = value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "");
  if (!clean) return [];
  const slash = clean.lastIndexOf("/");
  const base = slash >= 0 ? clean.slice(slash + 1) : clean;
  return base === clean ? [clean] : [clean, base];
}
