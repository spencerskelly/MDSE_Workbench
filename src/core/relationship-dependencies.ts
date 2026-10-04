/**
 * Derived reverse dependency indexes for relationship resolution.
 *
 * Source Markdown/authored link evidence remains authoritative. These indexes only answer
 * which source notes can be affected when one or more target paths change.
 */
/**
 * Conservative safety guard for targeted relationship re-resolution.
 *
 * Step 34 established the initial conservative policy. Step 37 measured representative 60k-note
 * add/delete/rename reconciliation and confirmed a 10k candidate set retained a consistent
 * >3x advantage over the cooperative whole-graph path. Candidate sets above this size fall back
 * rather than extending into the lower-margin/noisier 20k region.
 */
export const TARGETED_RELATIONSHIP_RERESOLUTION_MAX_CANDIDATES = 10_000;

export function shouldUseFullRelationshipReresolution(candidateCount: number): boolean {
  return candidateCount > TARGETED_RELATIONSHIP_RERESOLUTION_MAX_CANDIDATES;
}

export interface RelationshipDependencyConsistency {
  complete: boolean;
  issues: string[];
}

export interface RelationshipDependencySize {
  sources: number;
  resolvedTargetKeys: number;
  authoredKeys: number;
  resolvedAssociations: number;
  authoredAssociations: number;
  storedMemberships: number;
}

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

  /**
   * Per-path candidate fan-out used for runtime measurement. This is deliberately diagnostic:
   * it does not choose targeted vs full reconciliation and does not alter dependency semantics.
   */
  candidateFanOutForPathChanges(paths: Iterable<string>): Array<{ path: string; candidates: number }> {
    return [...new Set(paths)]
      .sort()
      .map((path) => ({ path, candidates: this.candidatesForPathChanges([path]).length }));
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

  /**
   * Exact structural size of the derived accelerator.
   *
   * Memory growth is bounded by current source evidence rather than edit history: set() removes a
   * source's prior entries before replacing them. Each resolved source-target association appears
   * once in bySource and once in byTarget. Each normalized authored-key association appears once
   * in authoredBySource and once in byAuthoredKey. linkpathKeys() yields at most two keys.
   */
  size(): RelationshipDependencySize {
    let resolvedAssociations = 0;
    for (const targets of this.bySource.values()) resolvedAssociations += targets.size;
    let authoredAssociations = 0;
    for (const keys of this.authoredBySource.values()) authoredAssociations += keys.size;
    return {
      sources: this.sourceCount,
      resolvedTargetKeys: this.byTarget.size,
      authoredKeys: this.byAuthoredKey.size,
      resolvedAssociations,
      authoredAssociations,
      storedMemberships: 2 * (resolvedAssociations + authoredAssociations),
    };
  }

  /**
   * Fail-closed consistency check for the derived reverse dependency surface.
   *
   * The index is only safe for targeted invalidation when every canonical source-side entry
   * is mirrored by the matching reverse entry and every reverse entry points back to canonical
   * source-side evidence. Any mismatch means the derived accelerator may be incomplete.
   */
  consistency(
    expected: Iterable<{ sourcePath: string; targetPaths: Iterable<string>; authoredLinkpaths?: Iterable<string> }> = [],
  ): RelationshipDependencyConsistency {
    const issues: string[] = [];

    for (const [source, targets] of this.bySource) {
      for (const target of targets) {
        if (!(this.byTarget.get(target)?.has(source) ?? false)) {
          issues.push(`missing reverse target entry: ${source} -> ${target}`);
        }
      }
    }
    for (const [target, sources] of this.byTarget) {
      for (const source of sources) {
        if (!(this.bySource.get(source)?.has(target) ?? false)) {
          issues.push(`orphan reverse target entry: ${target} <- ${source}`);
        }
      }
    }

    for (const [source, keys] of this.authoredBySource) {
      for (const key of keys) {
        if (!(this.byAuthoredKey.get(key)?.has(source) ?? false)) {
          issues.push(`missing reverse authored entry: ${source} -> ${key}`);
        }
      }
    }
    for (const [key, sources] of this.byAuthoredKey) {
      for (const source of sources) {
        if (!(this.authoredBySource.get(source)?.has(key) ?? false)) {
          issues.push(`orphan reverse authored entry: ${key} <- ${source}`);
        }
      }
    }

    for (const row of expected) {
      const expectedTargets = new Set([...row.targetPaths].filter((path) => path && path !== row.sourcePath));
      const actualTargets = this.bySource.get(row.sourcePath) ?? new Set<string>();
      if (!sameSet(expectedTargets, actualTargets)) {
        issues.push(`target evidence mismatch for ${row.sourcePath}`);
      }

      const expectedAuthored = new Set<string>();
      for (const linkpath of row.authoredLinkpaths ?? []) {
        for (const key of linkpathKeys(linkpath)) expectedAuthored.add(key);
      }
      const actualAuthored = this.authoredBySource.get(row.sourcePath) ?? new Set<string>();
      if (!sameSet(expectedAuthored, actualAuthored)) {
        issues.push(`authored evidence mismatch for ${row.sourcePath}`);
      }
    }

    return { complete: issues.length === 0, issues };
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
  // Candidate indexing is deliberately more permissive than authoritative Obsidian resolution.
  // Normalize equivalent path spellings so targeted invalidation cannot miss a source merely
  // because authored evidence includes an alias/fragment, Windows separators, .md, or case drift.
  const withoutAlias = value.split("|", 1)[0];
  const withoutFragment = withoutAlias.split("#", 1)[0];
  const clean = withoutFragment
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.md$/i, "")
    .toLowerCase();
  if (!clean) return [];
  const slash = clean.lastIndexOf("/");
  const base = slash >= 0 ? clean.slice(slash + 1) : clean;
  return base === clean ? [clean] : [clean, base];
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
