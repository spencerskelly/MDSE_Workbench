/**
 * Local Model scan (WB-111): reads the governed `## Local Model` region of the notes that have one, runs the
 * WB-106 checks across the vault and writes a findings report to the generated views folder (git-ignored).
 * Read-only on the model: nothing in a note is changed.
 */
import { App, getLinkpath, normalizePath, TFile } from "obsidian";
import { LocalModelIndex, parseLocalModel, renderFindingsReport, validateLocalModels, type LocalFinding } from "../core/localmodel";
import type { ModelIndex } from "../core/model";

export interface LocalScan {
  local: LocalModelIndex;
  findings: LocalFinding[];
  notesWithRegion: number;
  records: number;
  byKind: Record<string, number>;
  ms: number;
}

const BLOCK_PREFIX = /^(part|ep|conn|flow)-/;

/** A note can hold a region when it has the `Local Model` heading or any record block ID; only those are read. */
export function mayHaveRegion(app: App, file: TFile): boolean {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return false;
  if (cache.headings?.some((h) => h.level === 2 && h.heading.trim().toLowerCase() === "local model")) return true;
  return Object.keys(cache.blocks ?? {}).some((id) => BLOCK_PREFIX.test(id));
}

export function analyzeLocalModel(
  index: ModelIndex,
  local: LocalModelIndex,
  resolve: (target: string, from: string) => string | undefined,
): LocalScan {
  const t0 = performance.now();
  const findings = validateLocalModels({ index, local, resolve });
  const byKind: Record<string, number> = {};
  let records = 0;
  for (const region of local.regions.values()) {
    for (const r of region.records) {
      records++;
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    }
  }
  return { local, findings, notesWithRegion: local.regions.size, records, byKind, ms: Math.round(performance.now() - t0) };
}

/**
 * Recovery/independent reread path. Normal Workbench checks should use the already-maintained
 * shared LocalModelIndex through analyzeLocalModel rather than reparsing the whole vault.
 */
export async function scanLocalModel(app: App, index: ModelIndex): Promise<LocalScan> {
  const local = new LocalModelIndex();
  let n = 0;
  for (const file of app.vault.getMarkdownFiles()) {
    if (!mayHaveRegion(app, file)) continue;
    local.set(file.path, parseLocalModel(await app.vault.cachedRead(file)));
    if (++n % 100 === 0) await new Promise((r) => window.setTimeout(r, 0));
  }
  const resolve = (target: string, from: string) => app.metadataCache.getFirstLinkpathDest(getLinkpath(target), from)?.path;
  return analyzeLocalModel(index, local, resolve);
}

/** Writes `Local Model Findings.md` into the views folder and returns the file. */
export async function writeFindingsReport(app: App, viewsFolder: string, scan: LocalScan): Promise<TFile> {
  const folder = normalizePath(viewsFolder);
  if (!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);
  const path = `${folder}/Local Model Findings.md`;
  const text = renderFindingsReport(scan.findings, { notesWithRegion: scan.notesWithRegion, records: scan.records, byKind: scan.byKind }, { generated: new Date().toISOString().slice(0, 10) });
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, text);
    return existing;
  }
  return app.vault.create(path, text);
}
