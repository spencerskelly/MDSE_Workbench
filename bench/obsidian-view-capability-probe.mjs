import CDP from "chrome-remote-interface";

const expectedVaultPath = process.argv[2];
const port = Number(process.argv[3] ?? 9241);
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

          const waitFor = async (fn, timeout = 10000) => {
            const start = Date.now();
            while (Date.now() - start < timeout) {
              if (await fn()) return;
              await new Promise((r) => setTimeout(r, 50));
            }
            throw new Error("timed out waiting for view acceptance condition");
          };
          const exists = (p) => app.vault.adapter.exists(p);
          const remove = async (p) => { try { if (await exists(p)) await app.vault.adapter.remove(p); } catch {} };
          const open = async (p) => {
            const file = app.vault.getAbstractFileByPath(p);
            if (!file) throw new Error("missing fixture file " + p);
            await app.workspace.getLeaf(false).openFile(file);
          };
          const runCommand = async (id) => {
            const ok = app.commands.executeCommandById("mdse-workbench:" + id);
            if (!ok) throw new Error("command unavailable: " + id);
          };

          const originalOwners = indexer.hydrateLocalOwners.bind(indexer);
          const originalSettled = indexer.whenLocalSettled.bind(indexer);
          const tests = [];

          const runCoreOnly = async (id, startPath, canvasPath) => {
            let release;
            const gate = new Promise((resolve) => { release = resolve; });
            const calls = [];
            indexer.hydrateLocalOwners = async (...args) => {
              calls.push({ kind: "owners", owners: args[0] });
              await gate;
              return await originalOwners(...args);
            };
            indexer.whenLocalSettled = async (...args) => {
              calls.push({ kind: "global" });
              await gate;
              return await originalSettled(...args);
            };
            await remove(canvasPath);
            await open(startPath);
            await runCommand(id);
            await waitFor(() => exists(canvasPath), 5000);
            const completedWhileOccurrenceBlocked = await exists(canvasPath);
            const hydrationCallsBeforeRelease = calls.slice();
            release();
            await new Promise((r) => setTimeout(r, 50));
            indexer.hydrateLocalOwners = originalOwners;
            indexer.whenLocalSettled = originalSettled;
            if (!completedWhileOccurrenceBlocked) throw new Error(id + " did not complete while occurrence capability was blocked");
            if (hydrationCallsBeforeRelease.length) throw new Error(id + " unexpectedly requested occurrence hydration");
            tests.push({ id, class: "core-only", completedWhileOccurrenceBlocked, hydrationCalls: hydrationCallsBeforeRelease });
          };

          const runOccurrence = async (id, startPath, canvasPath, expectedKind, marker) => {
            let release;
            const gate = new Promise((resolve) => { release = resolve; });
            const calls = [];
            indexer.hydrateLocalOwners = async (...args) => {
              calls.push({ kind: "owners", owners: args[0] });
              await gate;
              return await originalOwners(...args);
            };
            indexer.whenLocalSettled = async (...args) => {
              calls.push({ kind: "global" });
              await gate;
              return await originalSettled(...args);
            };
            await remove(canvasPath);
            await open(startPath);
            await runCommand(id);
            await waitFor(() => calls.length > 0, 5000);
            await new Promise((r) => setTimeout(r, 200));
            const publishedBeforeOccurrenceReady = await exists(canvasPath);
            if (publishedBeforeOccurrenceReady) throw new Error(id + " published before required occurrence capability was released");
            if (!calls.some((c) => c.kind === expectedKind)) {
              throw new Error(id + " used the wrong occurrence gate: " + JSON.stringify(calls));
            }
            release();
            await waitFor(() => exists(canvasPath), 10000);
            const json = await app.vault.adapter.read(canvasPath);
            indexer.hydrateLocalOwners = originalOwners;
            indexer.whenLocalSettled = originalSettled;
            if (!json.includes(marker)) throw new Error(id + " canvas did not include expected local occurrence marker " + marker);
            tests.push({
              id,
              class: "occurrence-aware",
              expectedKind,
              hydrationCalls: calls,
              publishedBeforeOccurrenceReady,
              markerPresent: true,
            });
          };

          try {
            await runCoreOnly("explore-functional", "Acceptance/Fixture Object.md", "Workbench Views/Fixture Object - Functional.canvas");
            await runCoreOnly("explore-design", "Acceptance/Fixture Object.md", "Workbench Views/Fixture Object - Design.canvas");

            await runOccurrence(
              "explore-internal",
              "Acceptance/Fixture Object.md",
              "Workbench Views/Fixture Object - Internal.canvas",
              "owners",
              "part-20261004210000002acceptfixture",
            );
            await runOccurrence(
              "explore-structure",
              "Acceptance/Fixture Object.md",
              "Workbench Views/Fixture Object - Structure.canvas",
              "owners",
              "part-20261004210000002acceptfixture",
            );
            await runOccurrence(
              "explore-interfaces",
              "Acceptance/Fixture Object.md",
              "Workbench Views/Fixture Object - Interfaces.canvas",
              "global",
              "ep-20261004210000003acceptfixture",
            );
            await runOccurrence(
              "explore-where-used",
              "Acceptance/Fixture Child.md",
              "Workbench Views/Fixture Child - Where Used.canvas",
              "global",
              "part-20261004210000002acceptfixture",
            );
            await runOccurrence(
              "explore-requirements",
              "Acceptance/Fixture Requirement.md",
              "Workbench Views/Fixture Requirement - Requirements.canvas",
              "owners",
              "part-20261004210000002acceptfixture",
            );
          } finally {
            indexer.hydrateLocalOwners = originalOwners;
            indexer.whenLocalSettled = originalSettled;
          }

          return {
            accepted: true,
            mode: indexer.stats.mode,
            files: indexer.stats.files,
            elements: indexer.stats.elements,
            localPendingAfter: indexer.localHydrationPending,
            tests,
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      const value = result.result.value;
      await client.close();
      if (value?.waiting) break;
      if (value?.accepted) {
        console.log(JSON.stringify(value, null, 2));
        process.exit(0);
      }
    } catch (error) {
      try { await client?.close(); } catch {}
      throw error;
    }
  }
  await sleep(250);
}
throw new Error("Could not complete occurrence-view capability acceptance");
