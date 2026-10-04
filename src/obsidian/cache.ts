/**
 * Obsidian adapter for the portable semantic-cache storage contract (W-343 / RTA-2).
 *
 * This layer deliberately contains no model semantics. It only maps the core cache store
 * to Obsidian's DataAdapter and keeps all derived data under the plugin's git-ignored cache path.
 */
import type { App } from "obsidian";
import type { CacheStorage } from "../core/cache-storage";
import { cacheTreeSizeBytes } from "../core/cache-size";

export const WORKBENCH_CACHE_ROOT = ".obsidian/plugins/mdse-workbench/cache";

export class ObsidianCacheStorage implements CacheStorage {
  constructor(private readonly app: App) {}

  async mkdir(path: string): Promise<void> {
    if (!(await this.app.vault.adapter.exists(path))) await this.app.vault.adapter.mkdir(path);
  }

  async write(path: string, content: string): Promise<void> {
    await this.app.vault.adapter.write(path, content);
  }

  async read(path: string): Promise<string> {
    return this.app.vault.adapter.read(path);
  }
}


/** Delete only Workbench's disposable derived cache. Model files and plugin settings are untouched. */
export async function clearWorkbenchCache(app: App): Promise<void> {
  const a = app.vault.adapter;
  if (await a.exists(WORKBENCH_CACHE_ROOT)) await a.rmdir(WORKBENCH_CACHE_ROOT, true);
}


/** Size of the disposable Workbench semantic cache on disk, for explicit diagnostics only. */
export async function workbenchCacheSizeBytes(app: App): Promise<number | null> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(WORKBENCH_CACHE_ROOT))) return 0;
  try {
    return await cacheTreeSizeBytes(adapter, WORKBENCH_CACHE_ROOT);
  } catch {
    return null;
  }
}
