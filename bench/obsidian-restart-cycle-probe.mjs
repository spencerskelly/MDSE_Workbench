import CDP from "chrome-remote-interface";

const expectedVaultPath = process.argv[2];
const port = Number(process.argv[3] ?? 9253);
const label = process.argv[4] ?? "restart-cycle";
if (!expectedVaultPath) throw new Error("vault path required");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let attempt = 0; attempt < 240; attempt++) {
  let pages = [];
  try { pages = (await CDP.List({ port })).filter((t) => t.type === "page"); } catch {}
  for (const target of pages) {
    let client;
    try {
      client = await CDP({ target, port });
      await client.Runtime.enable();
      await client.Performance.enable();
      const expression = "(async () => { const expectedVault = " + JSON.stringify(expectedVaultPath) + "; const cycleLabel = " + JSON.stringify(label) + "; if (typeof app === \"undefined\" || app.vault.adapter.getBasePath?.() !== expectedVault) return null; const plugin = app.plugins.plugins?.[\"mdse-workbench\"]; const indexer = plugin?.indexer; if (!plugin?.isReady?.() || !indexer?.stats) return { waiting: true }; await indexer.whenSourceSettled(); await Promise.race([indexer.whenLocalSettled(true), new Promise((_, reject) => setTimeout(() => reject(new Error(\"timed out waiting for occurrence settlement\")), 30000))]); if (typeof globalThis.gc === \"function\") { globalThis.gc(); await new Promise((r) => setTimeout(r, 100)); } return { accepted: true, label: cycleLabel, mode: indexer.stats.mode, files: indexer.stats.files, notes: indexer.stats.notes, elements: indexer.stats.elements, links: indexer.stats.links, indexMs: indexer.stats.ms, warmRestore: plugin.lastWarmRestore ?? null, sourcePending: indexer.sourceReconciliationPending, livePending: indexer.liveUpdatePending, occurrencePending: indexer.localHydrationPending, occurrenceQueued: indexer.localHydrationQueued, occurrenceActive: indexer.localHydrationActive, occurrenceDemanded: indexer.localHydrationDemanded, localReadErrors: indexer.localReadErrorCount, relationshipHistory: indexer.relationshipReresolutionHistory?.length ?? 0, dependencySize: indexer.relationshipDependencySize ?? null }; })()";
      const result = await client.Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "renderer evaluation failed";
        await client.close();
        throw new Error(detail);
      }
      const value = result.result.value;
      if (value?.waiting) { await client.close(); break; }
      if (value?.accepted) {
        const metrics = await client.Performance.getMetrics();
        const metric = (name) => metrics.metrics.find((m) => m.name === name)?.value ?? null;
        const heap = await client.Runtime.getHeapUsage();
        await client.close();
        const out = { ...value, jsHeapUsedBytes: heap.usedSize, jsHeapTotalBytes: heap.totalSize, metrics: { JSHeapUsedSize: metric("JSHeapUsedSize"), JSHeapTotalSize: metric("JSHeapTotalSize"), Nodes: metric("Nodes"), Documents: metric("Documents"), JSEventListeners: metric("JSEventListeners") } };
        console.log(JSON.stringify(out, null, 2));
        process.exit(0);
      }
      await client.close();
    } catch (e) {
      try { await client?.close(); } catch {}
      throw e;
    }
  }
  await sleep(250);
}
throw new Error("Could not complete restart-cycle probe");
