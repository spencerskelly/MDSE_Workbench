import CDP from "chrome-remote-interface";

const expectedVaultPath = process.argv[2];
const port = Number(process.argv[3] ?? 9225);
const expectedPlugin = process.argv[4] ?? "";
if (!expectedVaultPath) throw new Error("vault path required");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requiredCommands = [
  "diagnostics",
  "rebuild-index",
  "explore-structure",
  "explore-internal",
  "explore-functional",
  "explore-requirements",
  "explore-pick",
  "relate",
  "open-review",
].map((id) => `mdse-workbench:${id}`);

for (let attempt = 0; attempt < 240; attempt++) {
  let pages = [];
  try { pages = (await CDP.List({ port })).filter((t) => t.type === "page"); } catch {}
  for (const target of pages) {
    let client;
    try {
      client = await CDP({ target, port });
      await client.Runtime.enable();
      const probe = await client.Runtime.evaluate({
        expression: `(() => {
          if (typeof app === "undefined" || !app?.vault?.adapter) return null;
          const base = app.vault.adapter.getBasePath?.() ?? "";
          if (base !== ${JSON.stringify(expectedVaultPath)}) return { base, wrongVault: true };
          const workbench = app.plugins.plugins?.["mdse-workbench"];
          const candidate = ${JSON.stringify(expectedPlugin)};
          const commandIds = Object.keys(app.commands?.commands ?? {});
          return {
            base,
            workbenchEnabled: app.plugins.enabledPlugins.has("mdse-workbench"),
            candidateEnabled: candidate ? app.plugins.enabledPlugins.has(candidate) : true,
            candidate,
            commandIds: commandIds.filter((id) => id.startsWith("mdse-workbench:")),
            workbenchCoreReady: !!workbench?.indexer?.stats,
            workbenchMode: workbench?.indexer?.stats?.mode ?? null,
            files: workbench?.indexer?.stats?.files ?? null,
            elements: workbench?.indexer?.stats?.elements ?? null,
            links: workbench?.indexer?.stats?.links ?? null,
          };
        })()`,
        returnByValue: true,
      });
      const value = probe.result.value;
      if (value?.base === expectedVaultPath) {
        const commandsReady = requiredCommands.every((id) => value.commandIds?.includes(id));
        if (value.workbenchEnabled && value.candidateEnabled && value.workbenchCoreReady && commandsReady) {
          console.log(JSON.stringify({ ...value, commandsReady }, null, 2));
          await client.close();
          process.exit(0);
        }
      }
    } catch {}
    try { await client?.close(); } catch {}
  }
  await sleep(250);
}
throw new Error(`Could not verify Workbench/candidate capability for ${expectedPlugin || "baseline"}`);
