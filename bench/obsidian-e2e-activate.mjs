import CDP from "chrome-remote-interface";

const expectedVaultPath = process.argv[2];
const port = Number(process.argv[3] ?? 9223);
const extraPluginId = process.argv[4] ?? "";
if (!expectedVaultPath) throw new Error("vault path required");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let attempt = 0; attempt < 180; attempt++) {
  let pages = [];
  try { pages = (await CDP.List({ port })).filter((t) => t.type === "page"); } catch {}
  for (const target of pages) {
    try {
      const client = await CDP({ target, port });
      await client.Runtime.enable();
      const probe = await client.Runtime.evaluate({
        expression: `(() => {
          if (typeof app === "undefined" || !app?.vault?.adapter) return null;
          return { base: app.vault.adapter.getBasePath?.() ?? "" };
        })()`,
        returnByValue: true,
      });
      if (probe.result.value?.base !== expectedVaultPath) { await client.close(); continue; }
      const activated = await client.Runtime.evaluate({
        expression: `(async () => {
          const readablePath = ".mdse_integration_readable.json";
          try {
            if (!(await app.vault.adapter.exists(readablePath))) {
              await app.vault.adapter.write(readablePath, JSON.stringify({ at: Date.now(), source: "controller-renderer-vault-ready" }) + "\\n");
            }
          } catch {}
          const path = ".mdse_integration_metadata.json";
          const record = async (source) => {
            try { await app.vault.adapter.write(path, JSON.stringify({ at: Date.now(), source }) + "\\n"); } catch {}
          };
          const resolvedCount = Object.keys(app.metadataCache?.resolvedLinks ?? {}).length;
          if (resolvedCount > 0) await record("already-resolved-at-activation");
          else app.metadataCache.on("resolved", () => { void record("resolved-event"); });
          await app.plugins.setEnable(true);
          await app.plugins.enablePlugin("mdse-workbench");
          const extraPluginId = ${JSON.stringify(extraPluginId)};
          if (extraPluginId) await app.plugins.enablePlugin(extraPluginId);
          return {
            restrictedModeOff: app.plugins.isEnabled(),
            pluginEnabled: app.plugins.enabledPlugins.has("mdse-workbench"),
            extraPluginId,
            extraPluginEnabled: !extraPluginId || app.plugins.enabledPlugins.has(extraPluginId),
            resolvedCount
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      await client.close();
      const value = activated.result.value;
      console.log("Cold-run controlled plugin activation:", value);
      if (value?.restrictedModeOff && value?.pluginEnabled && value?.extraPluginEnabled) process.exit(0);
      // The renderer can become reachable before Restricted Mode/plugin activation has fully
      // settled. Treat that as transient and retry rather than failing the measured run.
    } catch {}
  }
  await sleep(250);
}
throw new Error("Could not confirm mdse-workbench activation in the measured cold vault");
