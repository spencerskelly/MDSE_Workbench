import CDP from "chrome-remote-interface";

const expectedVaultPath = process.argv[2];
const port = Number(process.argv[3] ?? 9242);
if (!expectedVaultPath) throw new Error("vault path required");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let attempt = 0; attempt < 480; attempt++) {
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
          const note = (path) => indexer.index.notes.get(path);
          const edges = (path) => indexer.index.out(path).map((e) => ({ field: e.field, to: e.to }));
          const localCount = (path) => indexer.local.recordsOf(path).length;
          const results = [];
          const progress = async (stage, extra = {}) => {
            try {
              await app.vault.adapter.write(".mdse_live_edit_progress.json", JSON.stringify({
                stage,
                at: Date.now(),
                sourcePending: indexer.sourceReconciliationPending,
                livePending: indexer.liveUpdatePending,
                occurrencePending: indexer.localHydrationPending,
                occurrenceActive: indexer.localHydrationActive,
                ...extra,
              }, null, 2) + "\\n");
            } catch {}
          };
          const withTimeout = async (promise, timeout, label) => await Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("timed out waiting for " + label)), timeout)),
          ]);

          // Slow only the disposable background Local Model fixtures so background occurrence
          // work is observably active while foreground edits arrive.
          const originalCachedRead = app.vault.cachedRead.bind(app.vault);
          app.vault.cachedRead = async (file) => {
            if (file?.path?.startsWith("Background/")) await new Promise((r) => setTimeout(r, 25));
            return await originalCachedRead(file);
          };
          indexer.setBackgroundIdleCheck(() => true);

          const ensureBackgroundActive = async (label) => {
            indexer.beginDeferredLocalHydration(true);
            await waitFor(() => indexer.localHydrationActive > 0, 5000, label + " background hydration active");
            return {
              active: indexer.localHydrationActive,
              pending: indexer.localHydrationPending,
              queued: indexer.localHydrationQueued,
            };
          };

          const settleSource = async (label) => {
            await progress(label + ":source-wait");
            await withTimeout(indexer.whenSourceSettled(), 15000, label + " source barrier");
            await waitFor(() => indexer.liveUpdatePending === 0 && !indexer.sourceReconciliationPending, 10000, label + " source settled");
            await progress(label + ":source-settled");
          };

          try {
            const anchor = "Acceptance/Live Anchor.md";
            const fn = "Acceptance/Live Function.md";
            const added = "Acceptance/Live Target.md";
            const renamed = "Acceptance/Live Target Renamed.md";
            const moved = "Acceptance/Moved/Live Target Renamed.md";
            const partId = "part-20261004220000003liveeditfixture";

            // ADD: unresolved authored hasPart must become resolved while background occurrence
            // hydration is active.
            await progress("add:begin");
            const addBg = await ensureBackgroundActive("add");
            const targetText = [
              "---",
              "type: Object",
              "id: LIVE-TARGET",
              "uid: 20261004220000002liveeditfixture",
              "status: Draft",
              "---",
              "# Live Target",
              "",
              "## Local Model",
              "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
              "",
              "### Part Occurrences",
              "",
              "#### Nested occurrence",
              "- definition: [[Live Function]]",
              "^" + partId,
              "",
              "<!-- MDSE:LOCAL-MODEL END -->",
              "",
            ].join("\\n");
            await withTimeout(app.vault.create(added, targetText), 10000, "add vault create");
            await settleSource("add");
            await waitFor(() => note(added), 10000, "added note indexed");
            await waitFor(() => edges(anchor).some((e) => e.field === "hasPart" && e.to === added), 10000, "anchor add relationship resolved");
            await withTimeout(indexer.hydrateLocalOwners([added]), 10000, "add targeted occurrence hydration");
            if (localCount(added) !== 1) throw new Error("added Local Model occurrence was not published");
            results.push({ op: "add", background: addBg, path: added, relationshipResolved: true, localRecords: localCount(added) });
            await progress("add:done");

            // EDIT: semantic frontmatter relationship must update, and the Local Model body must
            // remain authoritative after the edit cancels/requeues background work.
            await progress("edit:begin");
            const editBg = await ensureBackgroundActive("edit");
            const file1 = app.vault.getAbstractFileByPath(added);
            const edited = targetText.replace("status: Draft", "status: Active\\nperforms:\\n  - \\"[[Live Function]]\\"").replace("#### Nested occurrence", "#### Nested occurrence edited");
            await withTimeout(app.vault.modify(file1, edited), 10000, "edit vault modify");
            await settleSource("edit");
            await waitFor(() => edges(added).some((e) => e.field === "performs" && e.to === fn), 10000, "edited relationship indexed");
            await withTimeout(indexer.hydrateLocalOwners([added]), 10000, "edit targeted occurrence hydration");
            if (localCount(added) !== 1) throw new Error("edited Local Model occurrence disappeared");
            results.push({ op: "edit", background: editBg, path: added, performsResolved: true, localRecords: localCount(added) });
            await progress("edit:done");

            // RENAME: old path must disappear, new path must own the same semantic note/local
            // region after source reconciliation.
            await progress("rename:begin");
            const renameBg = await ensureBackgroundActive("rename");
            const file2 = app.vault.getAbstractFileByPath(added);
            await withTimeout(app.vault.rename(file2, renamed), 10000, "rename file");
            await settleSource("rename");
            await waitFor(() => !note(added) && !!note(renamed), 10000, "rename path convergence");
            await waitFor(() => edges(renamed).some((e) => e.field === "performs" && e.to === fn), 10000, "renamed note relationship convergence");
            await withTimeout(indexer.hydrateLocalOwners([renamed]), 10000, "rename targeted occurrence hydration");
            if (localCount(added) !== 0 || localCount(renamed) !== 1) throw new Error("Local Model did not migrate cleanly on rename");
            results.push({ op: "rename", background: renameBg, oldPathRemoved: true, newPath: renamed, localRecords: localCount(renamed) });
            await progress("rename:done");

            // MOVE: folder-qualified path change must converge without a stale old path.
            await progress("move:begin");
            const moveBg = await ensureBackgroundActive("move");
            if (!app.vault.getAbstractFileByPath("Acceptance/Moved")) await app.vault.createFolder("Acceptance/Moved");
            const file3 = app.vault.getAbstractFileByPath(renamed);
            await withTimeout(app.vault.rename(file3, moved), 10000, "move file");
            await settleSource("move");
            await waitFor(() => !note(renamed) && !!note(moved), 10000, "move path convergence");
            await waitFor(() => edges(moved).some((e) => e.field === "performs" && e.to === fn), 10000, "moved note relationship convergence");
            await withTimeout(indexer.hydrateLocalOwners([moved]), 10000, "move targeted occurrence hydration");
            if (localCount(renamed) !== 0 || localCount(moved) !== 1) throw new Error("Local Model did not migrate cleanly on move");
            results.push({ op: "move", background: moveBg, oldPathRemoved: true, newPath: moved, localRecords: localCount(moved) });
            await progress("move:done");

            // DELETE: note, occurrence region, and resolved graph target must all disappear.
            await progress("delete:begin");
            const deleteBg = await ensureBackgroundActive("delete");
            const file4 = app.vault.getAbstractFileByPath(moved);
            await withTimeout(app.vault.delete(file4), 10000, "delete file");
            await settleSource("delete");
            await waitFor(() => !note(moved), 10000, "deleted note removed");
            await waitFor(() => !edges(anchor).some((e) => e.field === "hasPart" && e.to === moved), 10000, "deleted relationship removed");
            if (localCount(moved) !== 0) throw new Error("deleted Local Model region remained published");
            results.push({ op: "delete", background: deleteBg, pathRemoved: true, relationshipRemoved: true, localRecords: localCount(moved) });
            await progress("delete:done");

            // Let the interrupted/requeued background work finish after the edit sequence and
            // prove no source lane or occurrence lane was stranded.
            app.vault.cachedRead = originalCachedRead;
            indexer.setBackgroundIdleCheck(() => true);
            await progress("final:settle-begin");
            await withTimeout(indexer.whenLocalSettled(true), 30000, "final occurrence settlement");
            await withTimeout(indexer.whenSourceSettled(), 15000, "final source settlement");
            await progress("final:settled");

            return {
              accepted: true,
              mode: indexer.stats.mode,
              files: indexer.stats.files,
              elements: indexer.stats.elements,
              sourcePendingAfter: indexer.sourceReconciliationPending,
              livePendingAfter: indexer.liveUpdatePending,
              occurrencePendingAfter: indexer.localHydrationPending,
              localReadErrorsAfter: indexer.localReadErrorCount,
              anchorEdgesAfter: edges(anchor),
              results,
            };
          } finally {
            app.vault.cachedRead = originalCachedRead;
          }
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
    } catch (error) {
      try { await client?.close(); } catch {}
      throw error;
    }
  }
  await sleep(250);
}
throw new Error("Could not complete live-edit acceptance");
