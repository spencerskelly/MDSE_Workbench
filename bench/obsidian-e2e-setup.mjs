import CDP from "chrome-remote-interface";

const vaultPath = process.argv[2];
if (!vaultPath) throw new Error("vault path required");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTargets() {
  const list = await CDP.List({ port: 9222 });
  return list.filter((t) => t.type === "page");
}

let targets = [];
for (let i = 0; i < 120 && targets.length === 0; i++) {
  try { targets = await pageTargets(); } catch {}
  if (!targets.length) await sleep(250);
}
if (!targets.length) throw new Error("Obsidian renderer did not expose a CDP page");

const launcher = await CDP({ target: targets[0], port: 9222 });
await launcher.Runtime.enable();
await launcher.Runtime.evaluate({
  expression: `require('electron').ipcRenderer.sendSync('vaultOpen', ${JSON.stringify(vaultPath)}, false)`,
  awaitPromise: true,
});
await launcher.close();

let vaultTarget = null;
for (let i = 0; i < 120; i++) {
  const pages = await pageTargets();
  vaultTarget = pages[pages.length - 1] ?? null;
  if (vaultTarget && pages.length >= 1) {
    try {
      const client = await CDP({ target: vaultTarget, port: 9222 });
      await client.Runtime.enable();
      const probe = await client.Runtime.evaluate({ expression: "typeof app !== 'undefined' && !!app.vault", returnByValue: true });
      if (probe.result.value) {
        await client.Runtime.evaluate({
          expression: "(async()=>{await app.plugins.setEnable(true); await app.plugins.enablePlugin('mdse-workbench'); return true;})()",
          awaitPromise: true,
          returnByValue: true,
        });
        await client.close();
        console.log("Disposable vault opened; community plugins enabled; mdse-workbench enabled.");
        process.exit(0);
      }
      await client.close();
    } catch {}
  }
  await sleep(250);
}
throw new Error("Could not enable mdse-workbench in the disposable vault");
