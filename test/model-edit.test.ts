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


test("structural Local Model creation is staged until Apply and can be cancelled", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager([], () => "2026-10-04T23:20:00.000Z");
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const before = store.text;
  const newId = "part-20261004232000000skellyspencer";

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
    kind: "part",
    localId: newId,
    heading: "K2",
    fields: { definition: "[[Main Contactor]]", identifier: "K2" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(staged.transaction.status, "draft");
  assert.equal(store.text, before, "staging must not write the vault");
  assert.match(staged.plan.after, /#### K2/);

  const review = service.reviewLocalCreate(staged.transaction.id);
  assert.equal(review.transaction.status, "draft");
  assert.equal(review.transaction.issues.length, 0);

  const cancelled = service.cancelLocalCreate(staged.transaction.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.text, before);
  assert.equal(transactions.history().length, 0);
});

test("structural Local Model creation applies only after Review and enters shared undo/redo history", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager([], () => "2026-10-04T23:21:00.000Z");
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const newId = "part-20261004232100000skellyspencer";

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
    kind: "part",
    localId: newId,
    heading: "K2",
    fields: { definition: "[[Main Contactor]]", identifier: "K2" },
  });
  service.reviewLocalCreate(staged.transaction.id);
  await service.applyLocalCreate(staged.transaction.id);

  assert.match(store.text, /#### K2/);
  assert.equal(transactions.history().length, 1);
  assert.equal(transactions.history()[0].scope, "structural");
  assert.equal(transactions.history()[0].changes[0].kind, "local.create");

  await transactions.undo();
  assert.equal(store.text, note());
  await transactions.redo();
  assert.match(store.text, /#### K2/);
});

test("stale structural Apply is blocked and leaves the proposal staged", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const newId = "part-20261004232200000skellyspencer";

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
    kind: "part",
    localId: newId,
    heading: "K2",
    fields: { definition: "[[Main Contactor]]", identifier: "K2" },
  });
  store.text += "\nexternal change";

  await assert.rejects(service.applyLocalCreate(staged.transaction.id), /changed while/);
  assert.equal(transactions.history().length, 0);
  assert.equal(service.reviewLocalCreate(staged.transaction.id).transaction.status, "draft");
  assert.doesNotMatch(store.text, /#### K2/);
  service.cancelLocalCreate(staged.transaction.id);
});

test("invalid structural creation is rejected before a transaction can write anything", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const before = store.text;

  await assert.rejects(
    service.stageLocalRecordCreate("Assembly.md", {
      kind: "part",
      localId: "part-20261004232300000skellyspencer",
      heading: "K2",
      fields: {},
    }),
    /requires a definition/,
  );
  assert.equal(store.text, before);
  assert.equal(transactions.history().length, 0);
});


test("structural Apply is blocked when staged Local Model findings contain errors", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const newId = "part-20261004233100000skellyspencer";

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
    kind: "part",
    localId: newId,
    heading: "K2",
    fields: { definition: "[[Main Contactor]]", usage: "not-a-valid-usage" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.severity === "error"));
  await assert.rejects(service.applyLocalCreate(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(transactions.history().length, 0);
  assert.doesNotMatch(store.text, /#### K2/);
  service.cancelLocalCreate(staged.transaction.id);
});


function noteWithEndpointDependency(): string {
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
    "^" + localId,
    "",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- part: [[#^" + localId + "|K1]]",
    "^ep-20261003133512743skellyspencer",
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("clean part deletion is staged, applied, and joins shared undo/redo history", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageLocalRecordDelete("Assembly.md", localId);
  assert.equal(staged.transaction.scope, "structural");
  assert.equal(staged.plan.impacts.length, 0);
  assert.equal(staged.externalImpacts.length, 0);
  assert.match(store.text, /#### K1/, "staging must not mutate the source");

  await service.applyLocalDelete(staged.transaction.id);
  assert.doesNotMatch(store.text, /#### K1/);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.delete");

  await transactions.undo();
  assert.match(store.text, /#### K1/);
  await transactions.redo();
  assert.doesNotMatch(store.text, /#### K1/);
});

test("same-note Local Model dependency blocks part deletion", async () => {
  const store = new MemoryStore(noteWithEndpointDependency());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageLocalRecordDelete("Assembly.md", localId);
  assert.ok(staged.plan.impacts.some((impact) => impact.sourceKind === "endpoint" && impact.field === "part"));
  await assert.rejects(service.applyLocalDelete(staged.transaction.id), /dependent model reference/);
  assert.match(store.text, /#### K1/);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalDelete(staged.transaction.id);
});

test("indexed note-level local reference blocks part deletion", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(
    store,
    () => ownerUid,
    transactions,
    () => [{ path: "Requirements/REQ-1.md", field: "appliesTo" }],
  );

  const staged = await service.stageLocalRecordDelete("Assembly.md", localId);
  assert.deepEqual(staged.externalImpacts, [{ path: "Requirements/REQ-1.md", field: "appliesTo" }]);
  await assert.rejects(service.applyLocalDelete(staged.transaction.id), /dependent model reference/);
  assert.match(store.text, /#### K1/);
  service.cancelLocalDelete(staged.transaction.id);
});

test("Apply rechecks cross-note dependencies added after delete Review", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  let external: Array<{ path: string; field: string }> = [];
  const service = new ModelEditService(store, () => ownerUid, transactions, () => external);

  const staged = await service.stageLocalRecordDelete("Assembly.md", localId);
  assert.equal(staged.externalImpacts.length, 0);
  external = [{ path: "Requirements/REQ-2.md", field: "appliesTo" }];

  await assert.rejects(service.applyLocalDelete(staged.transaction.id), /dependent model reference/);
  assert.match(store.text, /#### K1/);
  assert.equal(service.reviewLocalDelete(staged.transaction.id).externalImpacts.length, 1);
  service.cancelLocalDelete(staged.transaction.id);
});

test("cancelled part deletion leaves source and semantic history untouched", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const before = store.text;

  const staged = await service.stageLocalRecordDelete("Assembly.md", localId);
  const cancelled = service.cancelLocalDelete(staged.transaction.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.text, before);
  assert.equal(transactions.history().length, 0);
});
