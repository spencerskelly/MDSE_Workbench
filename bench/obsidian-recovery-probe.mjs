import CDP from "chrome-remote-interface";

const expectedVaultPath = process.argv[2];
const port = Number(process.argv[3] ?? 9243);
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
      const result = await client.Runtime.evaluate({
        expression: `(async () => {
          const expectedVault = ${JSON.stringify(expectedVaultPath)};
          if (typeof app === "undefined" || app.vault.adapter.getBasePath?.() !== expectedVault) return null;
          const plugin = app.plugins.plugins?.["mdse-workbench"];
          const indexer = plugin?.indexer;
          if (!plugin?.isReady?.() || !indexer?.stats) return { waiting: true };

          const waitFor = async (fn, timeout = 15000, label = "condition") => {
            const start = Date.now();
            while (Date.now() - start < timeout) {
              if (await fn()) return;
              await new Promise((r) => setTimeout(r, 50));
            }
            throw new Error("timed out waiting for " + label);
          };

          const before = {
            mode: indexer.stats.mode,
            warmRestore: plugin.lastWarmRestore ?? null,
            sourcePending: indexer.sourceReconciliationPending,
            occurrencePending: indexer.localHydrationPending,
          };

          // Start genuine background occurrence work, then unload Workbench while it is active.
          const originalCachedRead = app.vault.cachedRead.bind(app.vault);
          app.vault.cachedRead = async (file) => {
            if (file?.path?.startsWith("Background/")) await new Promise((r) => setTimeout(r, 20));
            return await originalCachedRead(file);
          };
          indexer.setBackgroundIdleCheck(() => true);
          indexer.beginDeferredLocalHydration(true);
          await waitFor(() => indexer.localHydrationActive > 0, 5000, "background occurrence active");
          const activeBeforeReload = indexer.localHydrationActive;

          if (typeof app.plugins.disablePluginAndSave === "function") {
            await app.plugins.disablePluginAndSave("mdse-workbench");
          } else {
            await app.plugins.disablePlugin("mdse-workbench");
          }
          await waitFor(() => !app.plugins.enabledPlugins.has("mdse-workbench") && !app.plugins.plugins?.["mdse-workbench"], 10000, "plugin disabled");

          app.vault.cachedRead = originalCachedRead;
          if (typeof app.plugins.enablePluginAndSave === "function") {
            await app.plugins.enablePluginAndSave("mdse-workbench");
          } else {
            await app.plugins.enablePlugin("mdse-workbench");
          }
          await waitFor(() => app.plugins.enabledPlugins.has("mdse-workbench") && !!app.plugins.plugins?.["mdse-workbench"], 10000, "plugin re-enabled");
          await waitFor(() => {
            const p = app.plugins.plugins?.["mdse-workbench"];
            return !!p?.isReady?.() && !!p?.indexer?.stats;
          }, 30000, "plugin reload core ready");

          const reloaded = app.plugins.plugins["mdse-workbench"];
          const ri = reloaded.indexer;
          await Promise.race([
            ri.whenLocalSettled(true),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for reloaded occurrence settlement")), 30000)),
          ]);
          await ri.whenSourceSettled();

          return {
            accepted: true,
            badCacheFallback: {
              mode: before.mode,
              warmRestore: before.warmRestore,
            },
            pluginReload: {
              activeBeforeReload,
              enabledAfter: app.plugins.enabledPlugins.has("mdse-workbench"),
              modeAfter: ri.stats.mode,
              filesAfter: ri.stats.files,
              elementsAfter: ri.stats.elements,
              sourcePendingAfter: ri.sourceReconciliationPending,
              occurrencePendingAfter: ri.localHydrationPending,
              localReadErrorsAfter: ri.localReadErrorCount,
            },
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "renderer evaluation failed";
        await client.close();
        throw new Error(detail);
      }
      const value = result.result.value;
      await client.close();
      if (value?.waiting) break;
      if (value?.accepted) {
        console.log(JSON.stringify(value, null, 2));
        process.exit(0);
      }
    } catch (e) {
      try { await client?.close(); } catch {}
      throw e;
    }
  }
  await sleep(250);
}
throw new Error("Could not complete integrated recovery probe");
