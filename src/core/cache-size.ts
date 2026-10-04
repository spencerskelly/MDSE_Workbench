export interface CacheSizeEntry {
  size: number;
}

export interface CacheSizeStorage {
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  stat(path: string): Promise<CacheSizeEntry | null>;
}

/** Measure a derived cache tree without reading file contents into memory. */
export async function cacheTreeSizeBytes(storage: CacheSizeStorage, root: string): Promise<number> {
  let total = 0;
  const pending = [root];

  while (pending.length) {
    const folder = pending.pop() as string;
    const listed = await storage.list(folder);
    pending.push(...listed.folders);
    for (const file of listed.files) {
      const stat = await storage.stat(file);
      if (stat && Number.isFinite(stat.size) && stat.size >= 0) total += stat.size;
    }
  }
  return total;
}

export function formatCacheBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unavailable";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(mib < 10 ? 1 : 0)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(gib < 10 ? 2 : 1)} GiB`;
}
