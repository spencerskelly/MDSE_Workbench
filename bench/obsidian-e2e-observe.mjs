import CDP from "chrome-remote-interface";

const expectedVaultPath = process.argv[2];
const port = Number(process.argv[3] ?? 9223);
if (!expectedVaultPath) throw new Error("vault path required");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let attempt = 0; attempt < 120; attempt++) {
  let pages = [];
  try { pages = (await CDP.List({ port })).filter((t) => t.type === "page"); } catch {}
  for (const target of pages) {
    try {
      const client = await CDP({ target, port });
      await client.Runtime.enable();
      const probe = await client.Runtime.evaluate({
        expression: `(() => {
          if (typeof app === "undefined" || !app?.vault?.adapter) return null;
          return {
            base: app.vault.adapter.getBasePath?.() ?? "",
            name: app.vault.getName?.() ?? "",
            restrictedModeOff: app.plugins?.isEnabled?.() ?? false,
            pluginEnabled: app.plugins?.enabledPlugins?.has?.("mdse-workbench") ?? false
          };
        })()`,
        returnByValue: true,
      });
      await client.close();
      const value = probe.result.value;
      if (value?.base === expectedVaultPath) {
        console.log("Cold-run vault observation:", value);
        process.exit(value.pluginEnabled ? 0 : 2);
      }
    } catch {}
  }
  await sleep(250);
}
throw new Error("Cold-run disposable vault renderer was not observed");
