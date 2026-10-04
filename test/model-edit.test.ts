import assert from "node:assert/strict";
import test from "node:test";
import { ModelEditService, type TextDocumentStore } from "../src/core/model-edit";
import { TransactionManager } from "../src/core/transaction";

const ownerUid = "20261003130000000skellyspencer";
const token = "20261003133512742skellyspencer";
const localId = "part-" + token;

function note(): string {
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "- identifier: K1",
    "^" + localId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

class MemoryStore implements TextDocumentStore {
  constructor(public text: string) {}
  async read(): Promise<string> { return this.text; }
  async write(_path: string, text: string): Promise<void> { this.text = text; }
}

test("atomic Local Model patch applies through semantic history and supports undo/redo", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager([], () => "2026-10-04T23:00:00.000Z");
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const result = await service.patchLocalRecord("Assembly.md", localId, {
    heading: "Main K1",
    fields: { identifier: "K1-MAIN" },
  });

  assert.equal(result.changed, true);
  assert.match(store.text, /#### Main K1/);
  assert.match(store.text, /- identifier: K1-MAIN/);
  const history = transactions.history();
  assert.equal(history.length, 1);
  assert.equal(history[0].changes[0].kind, "local.patch");
  assert.deepEqual(history[0].changes[0].refs, [{ kind: "local", ownerUid, localKind: "part", localId }]);

  await transactions.undo();
  assert.equal(store.text, note());
  await transactions.redo();
  assert.match(store.text, /#### Main K1/);
});

test("Local Model patch joins the same chronological history as existing Workbench edits", async () => {
  let legacyState = 1;
  const store = new MemoryStore(note());
  const transactions = new TransactionManager([], () => "2026-10-04T23:01:00.000Z");
  transactions.recordApplied(
    "legacy-relationship",
    "Add relationship",
    "atomic",
    [{ kind: "relationship.add", summary: "A hasPart B", refs: [] }],
    {
      async undo() { legacyState = 0; },
      async redo() { legacyState = 1; },
    },
  );
  const service = new ModelEditService(store, () => ownerUid, transactions);
  await service.patchLocalRecord("Assembly.md", localId, { fields: { identifier: "K1-2" } });

  assert.equal(transactions.history().length, 2);
  await transactions.undo();
  assert.equal(store.text, note(), "the most recent Local Model edit undoes first");
  assert.equal(legacyState, 1);
  await transactions.undo();
  assert.equal(legacyState, 0, "the earlier relationship edit remains on the same stack");
});

test("atomic Local Model patch refuses a stale write and leaves no history entry", async () => {
  class RacingStore extends MemoryStore {
    reads = 0;
    async read(): Promise<string> {
      this.reads++;
      if (this.reads === 2) this.text += "\nexternal change";
      return this.text;
    }
  }
  const store = new RacingStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  await assert.rejects(
    service.patchLocalRecord("Assembly.md", localId, { fields: { identifier: "K1-2" } }),
    /changed while .* was being prepared/,
  );
  assert.equal(transactions.history().length, 0);
  assert.match(store.text, /external change/);
  assert.doesNotMatch(store.text, /identifier: K1-2/);
});

test("atomic Local Model patch requires durable owner identity", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => null, transactions);

  await assert.rejects(
    service.patchLocalRecord("Assembly.md", localId, { fields: { identifier: "K1-2" } }),
    /durable uid/,
  );
  assert.equal(transactions.history().length, 0);
  assert.equal(store.text, note());
});
