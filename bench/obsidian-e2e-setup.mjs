import CDP from "chrome-remote-interface";

const expectedVaultPath = process.argv[2];
const extraPlugin = process.argv[3] ?? "";
if (!expectedVaultPath) throw new Error("vault path required");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTargets() {
  const list = await CDP.List({ port: 9222 });
  return list.filter((t) => t.type === "page");
}

for (let attempt = 0; attempt < 180; attempt++) {
  let pages = [];
  try { pages = await pageTargets(); } catch {}
  for (const target of pages) {
    try {
      const client = await CDP({ target, port: 9222 });
      await client.Runtime.enable();
      const probe = await client.Runtime.evaluate({
        expression: `(() => {
          if (typeof app === "undefined" || !app?.vault?.adapter) return null;
          const base = app.vault.adapter.getBasePath?.() ?? "";
          return { base, name: app.vault.getName?.() ?? "" };
        })()`,
        returnByValue: true,
      });
      const value = probe.result.value;
      if (value && value.base === expectedVaultPath) {
        const enabled = await client.Runtime.evaluate({
          expression: `(async () => {
            await app.plugins.setEnable(true);
            await app.plugins.enablePlugin("mdse-workbench");
            const extraPlugin = ${JSON.stringify(extraPlugin)};
            if (extraPlugin) await app.plugins.enablePlugin(extraPlugin);
            return {
              restrictedModeOff: app.plugins.isEnabled(),
              enabled: app.plugins.enabledPlugins.has("mdse-workbench"),
              extraPlugin,
              extraEnabled: extraPlugin ? app.plugins.enabledPlugins.has(extraPlugin) : true,
              vault: app.vault.adapter.getBasePath?.() ?? ""
            };
          })()`,
          awaitPromise: true,
          returnByValue: true,
        });
        await client.close();
        const result = enabled.result.value;
        if (!result?.restrictedModeOff || !result?.enabled || !result?.extraEnabled) {
          throw new Error("Obsidian did not enable required community plugins");
        }
        console.log("Disposable vault opened and mdse-workbench enabled:", result);
        process.exit(0);
      }
      await client.close();
    } catch {
      // Renderer may disappear/reload while Restricted Mode changes; retry all current pages.
    }
  }
  await sleep(250);
}
throw new Error("Could not find the registered disposable vault renderer or enable mdse-workbench");
