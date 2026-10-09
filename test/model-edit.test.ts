import assert from "node:assert/strict";
import test from "node:test";
import { ModelEditService, type TextDocumentStore } from "../src/core/model-edit";
import { parseLocalModel } from "../src/core/localmodel";
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Parts",
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

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "part",
    localId: newId,
    heading: "K2",
    fields: { definition: "[[Main Contactor]]", identifier: "K2" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(staged.transaction.status, "reviewed");
  assert.equal(store.text, before, "staging must not write the vault");
  assert.match(staged.plan.after, /#### K2/);

  const review = service.reviewLocalCreate(staged.transaction.id);
  assert.equal(review.transaction.status, "reviewed");
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

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
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

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "part",
    localId: newId,
    heading: "K2",
    fields: { definition: "[[Main Contactor]]", identifier: "K2" },
  });
  store.text += "\nexternal change";

  await assert.rejects(service.applyLocalCreate(staged.transaction.id), /changed while/);
  assert.equal(transactions.history().length, 0);
  assert.equal(service.reviewLocalCreate(staged.transaction.id).transaction.status, "reviewed");
  assert.doesNotMatch(store.text, /#### K2/);
  service.cancelLocalCreate(staged.transaction.id);
});

test("invalid structural creation is rejected before a transaction can write anything", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const before = store.text;

  await assert.rejects(
    service.stageAndReviewLocalRecordCreate("Assembly.md", {
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

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Parts",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "^" + localId,
    "",
    "### Interfaces",
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

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", localId);
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

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", localId);
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

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", localId);
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

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", localId);
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

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", localId);
  const cancelled = service.cancelLocalDelete(staged.transaction.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.text, before);
  assert.equal(transactions.history().length, 0);
});


test("staged endpoint creation stays unwritten until Apply and preserves part binding", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const endpointId = "ep-20261004234800000skellyspencer";
  const before = store.text;

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "endpoint",
    localId: endpointId,
    heading: "J1",
    fields: {
      definition: "[[CAN Port]]",
      part: "[[#^" + localId + "|K1]]",
      kind: "physical",
    },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, before);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalCreate(staged.transaction.id);
  assert.match(store.text, /#### J1/);
  assert.ok(store.text.includes("- part: [[#^" + localId + "|K1]]"));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.create");

  await transactions.undo();
  assert.equal(store.text, before);
  await transactions.redo();
  assert.match(store.text, /#### J1/);
});

test("staged endpoint creation with a missing part is blocked at Apply", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const endpointId = "ep-20261004234800001skellyspencer";

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "endpoint",
    localId: endpointId,
    heading: "JX",
    fields: {
      definition: "[[CAN Port]]",
      part: "[[#^part-20261004234800099skellyspencer|Missing]]",
    },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.severity === "error"));
  await assert.rejects(service.applyLocalCreate(staged.transaction.id), /blocking Local Model finding/);
  assert.doesNotMatch(store.text, /#### JX/);
  service.cancelLocalCreate(staged.transaction.id);
});

test("cancelled endpoint creation leaves source and semantic history untouched", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const before = store.text;

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "endpoint",
    localId: "ep-20261004234800002skellyspencer",
    heading: "J2",
    fields: {
      definition: "[[CAN Port]]",
      part: "[[#^" + localId + "|K1]]",
    },
  });
  service.cancelLocalCreate(staged.transaction.id);

  assert.equal(store.text, before);
  assert.equal(transactions.history().length, 0);
});


function noteWithCleanEndpoint(): string {
  const endpointId = "ep-20261004235700000skellyspencer";
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Interfaces",
    "#### Service Port",
    "- definition: [[CAN Port]]",
    "^" + endpointId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("clean endpoint deletion stages, applies, and joins shared undo/redo history", async () => {
  const endpointId = "ep-20261004235700000skellyspencer";
  const original = noteWithCleanEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", endpointId);
  assert.equal(staged.plan.kind, "endpoint");
  assert.equal(staged.plan.impacts.length, 0);
  assert.equal(staged.externalImpacts.length, 0);
  assert.equal(store.text, original);

  await service.applyLocalDelete(staged.transaction.id);
  assert.doesNotMatch(store.text, /#### Service Port/);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.delete");
  assert.equal(transactions.history().at(-1)?.changes[0].refs[0].kind, "local");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.doesNotMatch(store.text, /#### Service Port/);
});

test("same-note connection dependency blocks endpoint deletion", async () => {
  const endpointId = "ep-20261004235800000skellyspencer";
  const otherId = "ep-20261004235800001skellyspencer";
  const connectionId = "conn-20261004235800002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointId,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + otherId,
    "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointId + "|J1]]",
    "- endpointB: [[#^" + otherId + "|J2]]",
    "^" + connectionId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
  const store = new MemoryStore(text);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", endpointId);
  assert.ok(staged.plan.impacts.some((impact) => impact.sourceKind === "connection" && impact.field === "endpointA"));
  await assert.rejects(service.applyLocalDelete(staged.transaction.id), /dependent model reference/);
  assert.match(store.text, /#### J1/);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalDelete(staged.transaction.id);
});

test("indexed external reference blocks endpoint deletion and is rechecked at Apply", async () => {
  const endpointId = "ep-20261004235700000skellyspencer";
  const store = new MemoryStore(noteWithCleanEndpoint());
  const transactions = new TransactionManager();
  let external: Array<{ path: string; field: string }> = [];
  const service = new ModelEditService(store, () => ownerUid, transactions, () => external);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", endpointId);
  assert.equal(staged.externalImpacts.length, 0);
  external = [{ path: "Requirements/REQ-ENDPOINT.md", field: "appliesTo" }];

  await assert.rejects(service.applyLocalDelete(staged.transaction.id), /dependent model reference/);
  const review = service.reviewLocalDelete(staged.transaction.id);
  assert.deepEqual(review.externalImpacts, [{ path: "Requirements/REQ-ENDPOINT.md", field: "appliesTo" }]);
  assert.match(store.text, /#### Service Port/);
  service.cancelLocalDelete(staged.transaction.id);
});

test("cancelled endpoint deletion leaves source and history untouched", async () => {
  const endpointId = "ep-20261004235700000skellyspencer";
  const original = noteWithCleanEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", endpointId);
  service.cancelLocalDelete(staged.transaction.id);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


function noteWithTwoEndpoints(): string {
  const endpointA = "ep-20261005000200000skellyspencer";
  const endpointB = "ep-20261005000200001skellyspencer";
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + endpointB,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged connection creation stays unwritten until Apply and supports undo/redo", async () => {
  const endpointA = "ep-20261005000200000skellyspencer";
  const endpointB = "ep-20261005000200001skellyspencer";
  const connectionId = "conn-20261005000200002skellyspencer";
  const original = noteWithTwoEndpoints();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "connection",
    localId: connectionId,
    heading: "Harness",
    fields: {
      endpointA: "[[#^" + endpointA + "|J1]]",
      endpointB: "[[#^" + endpointB + "|J2]]",
    },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);
  assert.equal(store.text, original);

  await service.applyLocalCreate(staged.transaction.id);
  assert.match(store.text, /#### Harness/);
  assert.ok(store.text.includes("- endpointA: [[#^" + endpointA + "|J1]]"));
  assert.ok(store.text.includes("- endpointB: [[#^" + endpointB + "|J2]]"));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.create");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.match(store.text, /#### Harness/);
});

test("staged connection creation with a missing endpoint is blocked at Apply", async () => {
  const endpointA = "ep-20261005000200000skellyspencer";
  const connectionId = "conn-20261005000300002skellyspencer";
  const store = new MemoryStore(noteWithTwoEndpoints());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "connection",
    localId: connectionId,
    heading: "Broken Harness",
    fields: {
      endpointA: "[[#^" + endpointA + "|J1]]",
      endpointB: "[[#^ep-20261005000300099skellyspencer|Missing]]",
    },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.severity === "error"));
  await assert.rejects(service.applyLocalCreate(staged.transaction.id), /blocking Local Model finding/);
  assert.doesNotMatch(store.text, /#### Broken Harness/);
  service.cancelLocalCreate(staged.transaction.id);
});

test("cancelled connection creation leaves source and history untouched", async () => {
  const endpointA = "ep-20261005000200000skellyspencer";
  const endpointB = "ep-20261005000200001skellyspencer";
  const original = noteWithTwoEndpoints();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "connection",
    localId: "conn-20261005000400000skellyspencer",
    heading: "Harness",
    fields: {
      endpointA: "[[#^" + endpointA + "|J1]]",
      endpointB: "[[#^" + endpointB + "|J2]]",
    },
  });
  service.cancelLocalCreate(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


function noteWithCleanConnection(includeFlow = false): string {
  const endpointA = "ep-20261005001200000skellyspencer";
  const endpointB = "ep-20261005001200001skellyspencer";
  const connectionId = "conn-20261005001200002skellyspencer";
  const flowId = "flow-20261005001200003skellyspencer";
  const lines = [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + endpointB,
    "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointA + "|J1]]",
    "- endpointB: [[#^" + endpointB + "|J2]]",
    "^" + connectionId,
  ];
  if (includeFlow) lines.push(
    "##### Commands",
    "- definition: [[CAN Data]]",
    "- endpointA: transmit",
    "- endpointB: receive",
    "^" + flowId,
  );
  lines.push("<!-- MDSE:LOCAL-MODEL END -->");
  return lines.join("\n");
}

test("clean connection deletion stages, applies, and joins shared undo/redo history", async () => {
  const connectionId = "conn-20261005001200002skellyspencer";
  const original = noteWithCleanConnection(false);
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", connectionId);
  assert.equal(staged.plan.kind, "connection");
  assert.equal(staged.plan.impacts.length, 0);
  assert.equal(staged.externalImpacts.length, 0);
  assert.equal(store.text, original);

  await service.applyLocalDelete(staged.transaction.id);
  assert.doesNotMatch(store.text, /#### Harness/);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.delete");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.doesNotMatch(store.text, /#### Harness/);
});

test("child flow blocks connection deletion", async () => {
  const connectionId = "conn-20261005001200002skellyspencer";
  const flowId = "flow-20261005001200003skellyspencer";
  const store = new MemoryStore(noteWithCleanConnection(true));
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", connectionId);
  assert.ok(staged.plan.impacts.some((impact) =>
    impact.sourceKind === "flow" &&
    impact.sourceLocalId === flowId &&
    impact.field === "connection"
  ));
  await assert.rejects(service.applyLocalDelete(staged.transaction.id), /dependent model reference/);
  assert.match(store.text, /#### Harness/);
  assert.match(store.text, /##### Commands/);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalDelete(staged.transaction.id);
});

test("indexed external reference blocks connection deletion and is rechecked at Apply", async () => {
  const connectionId = "conn-20261005001200002skellyspencer";
  const store = new MemoryStore(noteWithCleanConnection(false));
  const transactions = new TransactionManager();
  let external: Array<{ path: string; field: string }> = [];
  const service = new ModelEditService(store, () => ownerUid, transactions, () => external);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", connectionId);
  assert.equal(staged.externalImpacts.length, 0);
  external = [{ path: "Requirements/REQ-CONNECTION.md", field: "appliesTo" }];

  await assert.rejects(service.applyLocalDelete(staged.transaction.id), /dependent model reference/);
  assert.deepEqual(
    service.reviewLocalDelete(staged.transaction.id).externalImpacts,
    [{ path: "Requirements/REQ-CONNECTION.md", field: "appliesTo" }],
  );
  assert.match(store.text, /#### Harness/);
  service.cancelLocalDelete(staged.transaction.id);
});

test("cancelled connection deletion leaves source and history untouched", async () => {
  const connectionId = "conn-20261005001200002skellyspencer";
  const original = noteWithCleanConnection(false);
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", connectionId);
  service.cancelLocalDelete(staged.transaction.id);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("staged flow creation stays unwritten until Apply and supports undo/redo", async () => {
  const connectionId = "conn-20261005001200002skellyspencer";
  const flowId = "flow-20261005002300000skellyspencer";
  const original = noteWithCleanConnection(false);
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "flow",
    localId: flowId,
    connectionId,
    heading: "Commands",
    fields: {
      definition: "[[CAN Data]]",
      endpointA: "transmit",
      endpointB: "receive",
    },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);
  assert.equal(store.text, original);

  await service.applyLocalCreate(staged.transaction.id);
  assert.match(store.text, /##### Commands/);
  assert.ok(store.text.includes("- endpointA: transmit"));
  assert.ok(store.text.includes("- endpointB: receive"));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.create");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.match(store.text, /##### Commands/);
});


test("staged flow creation with missing owner connection is rejected before transaction", async () => {
  const original = noteWithCleanConnection(false);
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  await assert.rejects(
    service.stageAndReviewLocalRecordCreate("Assembly.md", {
      kind: "flow",
      localId: "flow-20261005002400000skellyspencer",
      connectionId: "conn-20261005002400099skellyspencer",
      heading: "Commands",
      fields: {
        definition: "[[CAN Data]]",
        endpointA: "transmit",
        endpointB: "receive",
      },
    }),
    /parent connection .* does not exist/,
  );

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});

test("cancelled flow creation leaves source and history untouched", async () => {
  const connectionId = "conn-20261005001200002skellyspencer";
  const original = noteWithCleanConnection(false);
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "flow",
    localId: "flow-20261005002500000skellyspencer",
    connectionId,
    heading: "Commands",
    fields: {
      definition: "[[CAN Data]]",
      endpointA: "transmit",
      endpointB: "receive",
    },
  });
  service.cancelLocalCreate(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("clean flow deletion stages, applies, and joins shared undo/redo history", async () => {
  const connectionId = "conn-20261005001200002skellyspencer";
  const flowId = "flow-20261005001200003skellyspencer";
  const original = noteWithCleanConnection(true);
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", flowId);
  assert.equal(staged.plan.kind, "flow");
  assert.equal(staged.plan.impacts.length, 0);
  assert.equal(staged.externalImpacts.length, 0);
  assert.equal(store.text, original);

  await service.applyLocalDelete(staged.transaction.id);
  assert.doesNotMatch(store.text, /##### Commands/);
  assert.match(store.text, /#### Harness/);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.delete");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.doesNotMatch(store.text, /##### Commands/);
  assert.ok(store.text.includes("^" + connectionId));
});


test("indexed external reference blocks flow deletion and is rechecked at Apply", async () => {
  const flowId = "flow-20261005001200003skellyspencer";
  const store = new MemoryStore(noteWithCleanConnection(true));
  const transactions = new TransactionManager();
  let external: Array<{ path: string; field: string }> = [];
  const service = new ModelEditService(store, () => ownerUid, transactions, () => external);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", flowId);
  assert.equal(staged.externalImpacts.length, 0);
  external = [{ path: "Requirements/REQ-FLOW.md", field: "appliesTo" }];

  await assert.rejects(service.applyLocalDelete(staged.transaction.id), /dependent model reference/);
  assert.deepEqual(
    service.reviewLocalDelete(staged.transaction.id).externalImpacts,
    [{ path: "Requirements/REQ-FLOW.md", field: "appliesTo" }],
  );
  assert.match(store.text, /##### Commands/);
  service.cancelLocalDelete(staged.transaction.id);
});


test("cancelled flow deletion leaves source and history untouched", async () => {
  const flowId = "flow-20261005001200003skellyspencer";
  const original = noteWithCleanConnection(true);
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordDelete("Assembly.md", flowId);
  service.cancelLocalDelete(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});



function noteWithReassignableEndpoint(): string {
  const partA = "part-20261005004000000skellyspencer";
  const partB = "part-20261005004000001skellyspencer";
  const endpoint = "ep-20261005004000002skellyspencer";
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Parts",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "^" + partA,
    "",
    "#### K2",
    "- definition: [[Main Contactor]]",
    "^" + partB,
    "",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- part: [[#^" + partA + "|K1]]",
    "^" + endpoint,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged endpoint part reassignment stays unwritten until Apply and supports undo/redo", async () => {
  const endpointId = "ep-20261005004000002skellyspencer";
  const targetPartId = "part-20261005004000001skellyspencer";
  const original = noteWithReassignableEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { part: "[[#^" + targetPartId + "|K2]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- part: [[#^" + targetPartId + "|K2]]"));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- part: [[#^" + targetPartId + "|K2]]"));
});

test("staged endpoint part reassignment blocks missing target at Apply", async () => {
  const endpointId = "ep-20261005004000002skellyspencer";
  const original = noteWithReassignableEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { part: "[[#^part-20261005004100099skellyspencer|Missing]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("stale staged endpoint part reassignment is blocked and remains cancellable", async () => {
  const endpointId = "ep-20261005004000002skellyspencer";
  const targetPartId = "part-20261005004000001skellyspencer";
  const store = new MemoryStore(noteWithReassignableEndpoint());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { part: "[[#^" + targetPartId + "|K2]]" },
  });
  store.text += "\nexternal change";

  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /changed while/);
  assert.equal(transactions.history().length, 0);
  assert.equal(service.reviewLocalPatch(staged.transaction.id).transaction.status, "reviewed");
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled endpoint part reassignment leaves source and history untouched", async () => {
  const endpointId = "ep-20261005004000002skellyspencer";
  const targetPartId = "part-20261005004000001skellyspencer";
  const original = noteWithReassignableEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { part: "[[#^" + targetPartId + "|K2]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


function noteWithParentableEndpoints(): string {
  const partId = "part-20261005006000000skellyspencer";
  const endpointA = "ep-20261005006000001skellyspencer";
  const endpointB = "ep-20261005006000002skellyspencer";
  const endpointC = "ep-20261005006000003skellyspencer";
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Parts",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "^" + partId,
    "",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- parent: [[#^" + endpointB + "|J2]]",
    "^" + endpointA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "- part: [[#^" + partId + "|K1]]",
    "^" + endpointB,
    "",
    "#### J3",
    "- definition: [[CAN Port]]",
    "- part: [[#^" + partId + "|K1]]",
    "^" + endpointC,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged endpoint parent reassignment stays unwritten until Apply and supports undo/redo", async () => {
  const endpointId = "ep-20261005006000001skellyspencer";
  const newParentId = "ep-20261005006000003skellyspencer";
  const original = noteWithParentableEndpoints();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { parent: "[[#^" + newParentId + "|J3]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- parent: [[#^" + newParentId + "|J3]]"));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- parent: [[#^" + newParentId + "|J3]]"));
});

test("staged endpoint parent clear removes only the parent field", async () => {
  const endpointId = "ep-20261005006000001skellyspencer";
  const original = noteWithParentableEndpoints();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { parent: null },
  });

  await service.applyLocalPatch(staged.transaction.id);
  assert.doesNotMatch(store.text, /- parent:/);
  assert.match(store.text, /- part:/);
  await transactions.undo();
  assert.equal(store.text, original);
});

test("staged endpoint parent reassignment blocks missing target at Apply", async () => {
  const endpointId = "ep-20261005006000001skellyspencer";
  const original = noteWithParentableEndpoints();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { parent: "[[#^ep-20261005006100099skellyspencer|Missing]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled endpoint parent reassignment leaves source and history untouched", async () => {
  const endpointId = "ep-20261005006000001skellyspencer";
  const newParentId = "ep-20261005006000003skellyspencer";
  const original = noteWithParentableEndpoints();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { parent: "[[#^" + newParentId + "|J3]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


function noteWithEditableExposures(): string {
  const endpointA = "ep-20261005008000000skellyspencer";
  const endpointB = "ep-20261005008000001skellyspencer";
  const exposedA = "ep-20261005008000002skellyspencer";
  const exposedB = "ep-20261005008000003skellyspencer";
  const connection = "conn-20261005008000004skellyspencer";
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Interfaces",
    "#### J1", "^" + endpointA, "",
    "#### J2", "^" + endpointB, "",
    "#### Boundary A", "^" + exposedA, "",
    "#### Boundary B", "^" + exposedB, "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointA + "|J1]]",
    "- endpointB: [[#^" + endpointB + "|J2]]",
    "- exposes: [[#^" + exposedA + "|Boundary A]]",
    "^" + connection,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged Connection exposure add stays unwritten until Apply and supports undo/redo", async () => {
  const connectionId = "conn-20261005008000004skellyspencer";
  const firstId = "ep-20261005008000002skellyspencer";
  const secondId = "ep-20261005008000003skellyspencer";
  const original = noteWithEditableExposures();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { exposes: "[[#^" + firstId + "|Boundary A]] [[#^" + secondId + "|Boundary B]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- exposes: [[#^" + firstId + "|Boundary A]] [[#^" + secondId + "|Boundary B]]"));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- exposes: [[#^" + firstId + "|Boundary A]] [[#^" + secondId + "|Boundary B]]"));
});

test("staged Connection exposure removal can clear the field entirely", async () => {
  const connectionId = "conn-20261005008000004skellyspencer";
  const original = noteWithEditableExposures();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { exposes: null },
  });

  await service.applyLocalPatch(staged.transaction.id);
  assert.doesNotMatch(store.text, /- exposes:/);
  await transactions.undo();
  assert.equal(store.text, original);
});

test("staged Connection exposure edit blocks missing target at Apply", async () => {
  const connectionId = "conn-20261005008000004skellyspencer";
  const original = noteWithEditableExposures();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { exposes: "[[#^ep-20261005008100099skellyspencer|Missing]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled Connection exposure edit leaves source and history untouched", async () => {
  const connectionId = "conn-20261005008000004skellyspencer";
  const secondId = "ep-20261005008000003skellyspencer";
  const original = noteWithEditableExposures();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { exposes: "[[#^" + secondId + "|Boundary B]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});

function noteWithEditableEquals(): string {
  const source = "ep-20261005010000000skellyspencer";
  const equalA = "ep-20261005010000001skellyspencer";
  const equalB = "ep-20261005010000002skellyspencer";
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Interfaces",
    "#### Boundary",
    "- definition: [[CAN Port]]",
    "- equals: [[#^" + equalA + "|J1]]",
    "^" + source,
    "",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- equals: [[#^" + source + "]]",
    "^" + equalA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + equalB,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged endpoint equals add stays unwritten until Apply and supports undo/redo", async () => {
  const sourceId = "ep-20261005010000000skellyspencer";
  const firstId = "ep-20261005010000001skellyspencer";
  const secondId = "ep-20261005010000002skellyspencer";
  const original = noteWithEditableEquals();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", sourceId, {
    fields: { equals: "[[#^" + firstId + "|J1]] [[#^" + secondId + "|J2]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- equals: [[#^" + firstId + "|J1]] [[#^" + secondId + "|J2]]"));
  assert.ok(parseLocalModel(store.text)?.records.find((r) => r.localId === secondId)?.equals.some((l) => l.blockId === sourceId),
    "new peer receives the reciprocal edge in the same apply");
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- equals: [[#^" + firstId + "|J1]] [[#^" + secondId + "|J2]]"));
});

test("staged endpoint equals removal can clear the field entirely", async () => {
  const sourceId = "ep-20261005010000000skellyspencer";
  const original = noteWithEditableEquals();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", sourceId, {
    fields: { equals: null },
  });

  await service.applyLocalPatch(staged.transaction.id);
  assert.doesNotMatch(store.text, /- equals:/);
  await transactions.undo();
  assert.equal(store.text, original);
});

test("staged endpoint equals edit blocks missing target at Apply", async () => {
  const sourceId = "ep-20261005010000000skellyspencer";
  const original = noteWithEditableEquals();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", sourceId, {
    fields: { equals: "[[#^ep-20261005010100099skellyspencer|Missing]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled endpoint equals edit leaves source and history untouched", async () => {
  const sourceId = "ep-20261005010000000skellyspencer";
  const secondId = "ep-20261005010000002skellyspencer";
  const original = noteWithEditableEquals();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", sourceId, {
    fields: { equals: "[[#^" + secondId + "|J2]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("rejected 0.5 equals proposals leave note and semantic history untouched", async () => {
  const source = "ep-20261005010000000skellyspencer";
  const peer = "ep-20261005010000001skellyspencer";
  const original = noteWithEditableEquals();
  const invalid: Array<[string, string, RegExp]> = [
    ["self", "[[#^" + source + "]]", /cannot equal itself/],
    ["duplicate", "[[#^" + peer + "]] [[#^" + peer + "|J1]]", /duplicate equals target/i],
    ["external owner", "[[Other Assembly#^" + peer + "]]", /same Local Model owner/],
    ["plain text", "not a block link", /only governed Interface block links/],
  ];
  for (const [name, value, reason] of invalid) {
    const store = new MemoryStore(original);
    const transactions = new TransactionManager();
    const service = new ModelEditService(store, () => ownerUid, transactions);
    await assert.rejects(
      service.stageAndReviewLocalRecordPatch("Assembly.md", source, { fields: { equals: value } }),
      reason, name,
    );
    assert.equal(store.text, original, name + " did not modify source");
    assert.equal(transactions.history().length, 0, name + " did not enter history");
  }
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", source, {
    fields: { equals: "[[#^ep-20261005010000999skellyspencer|Missing]]" },
  });
  assert.ok(staged.plan.findings.some((finding) =>
    finding.code === "ref.local-missing" && finding.severity === "error"
  ), "unresolved local target must fail validation");
  assert.equal(store.text, original, "staging a malformed edge is read-only");
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original, "rejected Apply did not write the note");
  assert.equal(transactions.history().length, 0, "rejected Apply did not enter history");
  service.cancelLocalPatch(staged.transaction.id);
});

function noteWithRewirableConnection(): string {
  const endpointA = "ep-20261005012000000skellyspencer";
  const endpointB = "ep-20261005012000001skellyspencer";
  const endpointC = "ep-20261005012000002skellyspencer";
  const connectionId = "conn-20261005012000003skellyspencer";
  const flowId = "flow-20261005012000004skellyspencer";
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + endpointB,
    "",
    "#### J3",
    "- definition: [[CAN Port]]",
    "^" + endpointC,
    "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointA + "|J1]]",
    "- endpointB: [[#^" + endpointB + "|J2]]",
    "^" + connectionId,
    "##### Commands",
    "- definition: [[CAN Data]]",
    "- endpointA: transmit",
    "- endpointB: receive",
    "^" + flowId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged connection endpoint rewire stays unwritten until Apply and preserves child flow", async () => {
  const connectionId = "conn-20261005012000003skellyspencer";
  const endpointB = "ep-20261005012000001skellyspencer";
  const endpointC = "ep-20261005012000002skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { endpointA: "[[#^" + endpointC + "|J3]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- endpointA: [[#^" + endpointC + "|J3]]"));
  assert.ok(store.text.includes("- endpointB: [[#^" + endpointB + "|J2]]"));
  assert.match(store.text, /##### Commands/);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- endpointA: [[#^" + endpointC + "|J3]]"));
  assert.match(store.text, /##### Commands/);
});

test("staged connection endpoint B rewire preserves endpoint A", async () => {
  const connectionId = "conn-20261005012000003skellyspencer";
  const endpointA = "ep-20261005012000000skellyspencer";
  const endpointC = "ep-20261005012000002skellyspencer";
  const store = new MemoryStore(noteWithRewirableConnection());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { endpointB: "[[#^" + endpointC + "|J3]]" },
  });

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- endpointA: [[#^" + endpointA + "|J1]]"));
  assert.ok(store.text.includes("- endpointB: [[#^" + endpointC + "|J3]]"));
  assert.match(store.text, /##### Commands/);
});

test("staged connection endpoint rewire blocks missing target at Apply", async () => {
  const connectionId = "conn-20261005012000003skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { endpointA: "[[#^ep-20261005012100099skellyspencer|Missing]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled connection endpoint rewire leaves source and history untouched", async () => {
  const connectionId = "conn-20261005012000003skellyspencer";
  const endpointC = "ep-20261005012000002skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { endpointA: "[[#^" + endpointC + "|J3]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("staged connection definition change stays unwritten until Apply and preserves topology", async () => {
  const connectionId = "conn-20261005012000003skellyspencer";
  const endpointA = "ep-20261005012000000skellyspencer";
  const endpointB = "ep-20261005012000001skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { definition: "[[CAN Bus]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- definition: [[CAN Bus]]"));
  assert.ok(store.text.includes("- endpointA: [[#^" + endpointA + "|J1]]"));
  assert.ok(store.text.includes("- endpointB: [[#^" + endpointB + "|J2]]"));
  assert.match(store.text, /##### Commands/);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- definition: [[CAN Bus]]"));
  assert.match(store.text, /##### Commands/);
});

test("staged connection definition can be cleared without changing topology", async () => {
  const connectionId = "conn-20261005012000003skellyspencer";
  const endpointA = "ep-20261005012000000skellyspencer";
  const endpointB = "ep-20261005012000001skellyspencer";
  const original = noteWithRewirableConnection().replace(
    "^" + connectionId,
    "- definition: [[CAN Bus]]\n^" + connectionId,
  );
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { definition: null },
  });

  await service.applyLocalPatch(staged.transaction.id);
  assert.doesNotMatch(store.text, /- definition: \[\[CAN Bus\]\]/);
  assert.ok(store.text.includes("- endpointA: [[#^" + endpointA + "|J1]]"));
  assert.ok(store.text.includes("- endpointB: [[#^" + endpointB + "|J2]]"));
  assert.match(store.text, /##### Commands/);
});

test("staged connection definition edit blocks block-fragment definitions at Apply", async () => {
  const connectionId = "conn-20261005012000003skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { definition: "[[CAN Bus#^ep-20261005012000000skellyspencer|Bad]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.code === "definition.incompatible" && finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled connection definition edit leaves source and history untouched", async () => {
  const connectionId = "conn-20261005012000003skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", connectionId, {
    fields: { definition: "[[CAN Bus]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


function noteWithDefinedPartAndEndpoint(): string {
  const partId = "part-20261005015000000skellyspencer";
  const endpointId = "ep-20261005015000001skellyspencer";
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Parts",
    "#### K1",
    "- definition: [[Old Contactor]]",
    "- usage: option",
    "- multiplicity: 2",
    "^" + partId,
    "",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- part: [[#^" + partId + "|K1]]",
    "^" + endpointId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged part definition change stays unwritten until Apply and preserves attached endpoint", async () => {
  const partId = "part-20261005015000000skellyspencer";
  const endpointId = "ep-20261005015000001skellyspencer";
  const original = noteWithDefinedPartAndEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", partId, {
    fields: { definition: "[[New Contactor]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- definition: [[New Contactor]]"));
  assert.ok(store.text.includes("- usage: option"));
  assert.ok(store.text.includes("- multiplicity: 2"));
  assert.ok(store.text.includes("- part: [[#^" + partId + "|K1]]"));
  assert.ok(store.text.includes("^" + endpointId));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- definition: [[New Contactor]]"));
  assert.ok(store.text.includes("- part: [[#^" + partId + "|K1]]"));
});

test("staged part definition edit blocks clearing required definition at Apply", async () => {
  const partId = "part-20261005015000000skellyspencer";
  const original = noteWithDefinedPartAndEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", partId, {
    fields: { definition: null },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.code === "record.missing-definition" && finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("staged part definition edit blocks block-fragment definitions at Apply", async () => {
  const partId = "part-20261005015000000skellyspencer";
  const original = noteWithDefinedPartAndEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", partId, {
    fields: { definition: "[[New Contactor#^ep-20261005015000001skellyspencer|Bad]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.code === "definition.incompatible" && finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled part definition edit leaves source and history untouched", async () => {
  const partId = "part-20261005015000000skellyspencer";
  const original = noteWithDefinedPartAndEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", partId, {
    fields: { definition: "[[New Contactor]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


function noteWithDefinedEndpointAndConnection(): string {
  const partId = "part-20261005017000000skellyspencer";
  const endpointId = "ep-20261005017000001skellyspencer";
  const peerId = "ep-20261005017000002skellyspencer";
  const exposureId = "ep-20261005017000003skellyspencer";
  const equalsId = "ep-20261005017000004skellyspencer";
  const connectionId = "conn-20261005017000005skellyspencer";
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Parts",
    "#### K1",
    "- definition: [[Contactor]]",
    "^" + partId,
    "",
    "### Interfaces",
    "#### J1",
    "- definition: [[Old Port]]",
    "- usage: option",
    "- multiplicity: 2",
    "- part: [[#^" + partId + "|K1]]",
    "- equals: [[#^" + equalsId + "|J4]]",
    "^" + endpointId,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + peerId,
    "",
    "#### J3",
    "- definition: [[CAN Port]]",
    "^" + exposureId,
    "",
    "#### J4",
    "- definition: [[CAN Port]]",
    "- equals: [[#^" + endpointId + "]]",
    "^" + equalsId,
    "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointId + "|J1]]",
    "- endpointB: [[#^" + peerId + "|J2]]",
    "- exposes: [[#^" + exposureId + "|J3]]",
    "^" + connectionId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged endpoint definition change stays unwritten until Apply and preserves topology", async () => {
  const endpointId = "ep-20261005017000001skellyspencer";
  const partId = "part-20261005017000000skellyspencer";
  const connectionId = "conn-20261005017000005skellyspencer";
  const original = noteWithDefinedEndpointAndConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { definition: "[[New Port]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- definition: [[New Port]]"));
  assert.ok(store.text.includes("- usage: option"));
  assert.ok(store.text.includes("- multiplicity: 2"));
  assert.ok(store.text.includes("- part: [[#^" + partId + "|K1]]"));
  assert.ok(store.text.includes("- exposes:"));
  assert.ok(store.text.includes("- equals:"));
  assert.ok(store.text.includes("^" + connectionId));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- definition: [[New Port]]"));
  assert.ok(store.text.includes("^" + connectionId));
});

test("staged endpoint definition edit blocks clearing required definition at Apply", async () => {
  const endpointId = "ep-20261005017000001skellyspencer";
  const original = noteWithDefinedEndpointAndConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { definition: null },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.code === "record.missing-definition" && finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("staged endpoint definition edit blocks block-fragment definitions at Apply", async () => {
  const endpointId = "ep-20261005017000001skellyspencer";
  const original = noteWithDefinedEndpointAndConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { definition: "[[New Port#^ep-20261005017000002skellyspencer|Bad]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.code === "definition.incompatible" && finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled endpoint definition edit leaves source and history untouched", async () => {
  const endpointId = "ep-20261005017000001skellyspencer";
  const original = noteWithDefinedEndpointAndConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: { definition: "[[New Port]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("staged flow definition change stays unwritten until Apply and preserves connection and roles", async () => {
  const flowId = "flow-20261005012000004skellyspencer";
  const connectionId = "conn-20261005012000003skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", flowId, {
    fields: { definition: "[[New Data]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- definition: [[New Data]]"));
  assert.ok(store.text.includes("^" + connectionId));
  assert.ok(store.text.includes("- endpointA: transmit"));
  assert.ok(store.text.includes("- endpointB: receive"));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- definition: [[New Data]]"));
  assert.ok(store.text.includes("- endpointA: transmit"));
  assert.ok(store.text.includes("- endpointB: receive"));
});

test("staged flow definition edit blocks clearing required definition at Apply", async () => {
  const flowId = "flow-20261005012000004skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", flowId, {
    fields: { definition: null },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.code === "record.missing-definition" && finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("staged flow definition edit blocks block-fragment definitions at Apply", async () => {
  const flowId = "flow-20261005012000004skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", flowId, {
    fields: { definition: "[[New Data#^ep-20261005012000000skellyspencer|Bad]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.code === "definition.incompatible" && finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled flow definition edit leaves source and history untouched", async () => {
  const flowId = "flow-20261005012000004skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", flowId, {
    fields: { definition: "[[New Data]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("structural Local Model patch cannot Apply before Review", async () => {
  const endpointId = "ep-20261005004000002skellyspencer";
  const targetPartId = "part-20261005004000001skellyspencer";
  const original = noteWithReassignableEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageLocalRecordPatch("Assembly.md", endpointId, {
    fields: { part: "[[#^" + targetPartId + "|K2]]" },
  });
  assert.equal(staged.transaction.status, "draft");
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /must be reviewed before Apply/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);

  const reviewed = service.reviewLocalPatch(staged.transaction.id);
  assert.equal(reviewed.transaction.status, "reviewed");
  await service.applyLocalPatch(staged.transaction.id);
  assert.notEqual(store.text, original);
});

test("structural Local Model create cannot Apply before Review", async () => {
  const original = note();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const input = {
    kind: "part" as const,
    localId: "part-20261005020000000skellyspencer",
    heading: "K Review",
    fields: { definition: "[[Contactor]]" },
  };

  const staged = await service.stageLocalRecordCreate("Assembly.md", input);
  assert.equal(staged.transaction.status, "draft");
  await assert.rejects(service.applyLocalCreate(staged.transaction.id), /must be reviewed before Apply/);
  assert.equal(store.text, original);

  const reviewed = service.reviewLocalCreate(staged.transaction.id);
  assert.equal(reviewed.transaction.status, "reviewed");
  await service.applyLocalCreate(staged.transaction.id);
  assert.notEqual(store.text, original);
});

test("structural Local Model delete cannot Apply before Review", async () => {
  const original = noteWithCleanConnection(false);
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const connectionId = "conn-20261005001200002skellyspencer";

  const staged = await service.stageLocalRecordDelete("Assembly.md", connectionId);
  assert.equal(staged.transaction.status, "draft");
  await assert.rejects(service.applyLocalDelete(staged.transaction.id), /must be reviewed before Apply/);
  assert.equal(store.text, original);

  const reviewed = service.reviewLocalDelete(staged.transaction.id);
  assert.equal(reviewed.transaction.status, "reviewed");
  await service.applyLocalDelete(staged.transaction.id);
  assert.notEqual(store.text, original);
});


function objectOwnerWithoutLocalModel(): string {
  return [
    "---",
    "type: Object",
    "uid: " + ownerUid,
    "---",
    "",
    "# Empty Assembly",
    "",
    "Narrative only.",
  ].join("\n");
}

test("first part occurrence can create the governed Local Model region on an empty Object owner", async () => {
  const original = objectOwnerWithoutLocalModel();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const partId = "part-20261005021000000skellyspencer";

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "part",
    localId: partId,
    heading: "K1",
    fields: { definition: "[[Main Contactor]]" },
  });

  assert.equal(staged.transaction.status, "reviewed");
  assert.equal(store.text, original, "Review must not write the owner note");
  assert.match(staged.plan.after, /## Local Model/);
  assert.match(staged.plan.after, /<!-- MDSE:LOCAL-MODEL START schema=0\.5 -->/);
  assert.match(staged.plan.after, /### Parts/);
  assert.match(staged.plan.after, /#### K1/);
  assert.ok(staged.plan.after.includes("^" + partId));

  await service.applyLocalCreate(staged.transaction.id);
  assert.match(store.text, /## Local Model/);
  assert.match(store.text, /#### K1/);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.create");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.match(store.text, /#### K1/);
});

test("first part creation remains cancellable before the owner note is changed", async () => {
  const original = objectOwnerWithoutLocalModel();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordCreate("Assembly.md", {
    kind: "part",
    localId: "part-20261005021000001skellyspencer",
    heading: "K1",
    fields: { definition: "[[Main Contactor]]" },
  });

  service.cancelLocalCreate(staged.transaction.id);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("staged endpoint part assignment clears existing parent and supports undo/redo", async () => {
  const partId = "part-20261005006000000skellyspencer";
  const endpointId = "ep-20261005006000001skellyspencer";
  const original = noteWithParentableEndpoints();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
    fields: {
      part: "[[#^" + partId + "|K1]]",
      parent: null,
    },
  });

  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  const applied = parseLocalModel(store.text)?.records.find((record) => record.localId === endpointId);
  assert.equal(applied?.part?.blockId, partId);
  assert.equal(applied?.parent, null);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  const redone = parseLocalModel(store.text)?.records.find((record) => record.localId === endpointId);
  assert.equal(redone?.part?.blockId, partId);
  assert.equal(redone?.parent, null);
});


test("staged flow endpoint-role edit stays unwritten until Apply and preserves definition and connection", async () => {
  const flowId = "flow-20261005012000004skellyspencer";
  const connectionId = "conn-20261005012000003skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", flowId, {
    fields: { endpointA: "exchange", endpointB: "unspecified" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  const applied = parseLocalModel(store.text)?.records.find((record) => record.localId === flowId);
  assert.equal(applied?.roleA, "exchange");
  assert.equal(applied?.roleB, "unspecified");
  assert.equal(applied?.definition?.target, "CAN Data");
  assert.equal(applied?.connectionId, connectionId);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  const redone = parseLocalModel(store.text)?.records.find((record) => record.localId === flowId);
  assert.equal(redone?.roleA, "exchange");
  assert.equal(redone?.roleB, "unspecified");
  assert.equal(redone?.definition?.target, "CAN Data");
  assert.equal(redone?.connectionId, connectionId);
});

test("staged flow endpoint-role edit blocks invalid roles at Apply", async () => {
  const flowId = "flow-20261005012000004skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", flowId, {
    fields: { endpointA: "source", endpointB: "receive" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.code === "ref.flow-role-invalid" && finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled flow endpoint-role edit leaves source and history untouched", async () => {
  const flowId = "flow-20261005012000004skellyspencer";
  const original = noteWithRewirableConnection();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch("Assembly.md", flowId, {
    fields: { endpointA: "exchange", endpointB: "unspecified" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


function noteWithMovableFlow(): string {
  const endpointA = "ep-20261005025000000skellyspencer";
  const endpointB = "ep-20261005025000001skellyspencer";
  const connectionA = "conn-20261005025000002skellyspencer";
  const connectionB = "conn-20261005025000003skellyspencer";
  const flowId = "flow-20261005025000004skellyspencer";
  return [
    "---", "type: Object", "uid: " + ownerUid, "---", "", "# Assembly", "",
    "## Local Model", "<!-- MDSE:LOCAL-MODEL START schema=0.5 -->",
    "### Interfaces",
    "#### J1", "- definition: [[CAN Port]]", "^" + endpointA, "",
    "#### J2", "- definition: [[CAN Port]]", "^" + endpointB, "",
    "### Connections",
    "#### Primary", "- endpointA: [[#^" + endpointA + "|J1]]", "- endpointB: [[#^" + endpointB + "|J2]]", "^" + connectionA,
    "##### Commands", "- definition: [[CAN Data]]", "- endpointA: transmit", "- endpointB: receive", "^" + flowId, "",
    "#### Backup", "- endpointA: [[#^" + endpointA + "|J1]]", "- endpointB: [[#^" + endpointB + "|J2]]", "^" + connectionB,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged flow ownership move stays unwritten until Apply and supports undo/redo", async () => {
  const flowId = "flow-20261005025000004skellyspencer";
  const connectionA = "conn-20261005025000002skellyspencer";
  const connectionB = "conn-20261005025000003skellyspencer";
  const original = noteWithMovableFlow();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalFlowMove("Assembly.md", flowId, connectionB);
  assert.equal(staged.transaction.scope, "structural");
  assert.equal(staged.transaction.status, "reviewed");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  const moved = parseLocalModel(store.text)?.records.find((record) => record.localId === flowId);
  assert.equal(moved?.connectionId, connectionB);
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.move");

  await transactions.undo();
  assert.equal(parseLocalModel(store.text)?.records.find((record) => record.localId === flowId)?.connectionId, connectionA);
  await transactions.redo();
  assert.equal(parseLocalModel(store.text)?.records.find((record) => record.localId === flowId)?.connectionId, connectionB);
});

test("cancelled flow ownership move leaves source and semantic history untouched", async () => {
  const flowId = "flow-20261005025000004skellyspencer";
  const connectionB = "conn-20261005025000003skellyspencer";
  const original = noteWithMovableFlow();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalFlowMove("Assembly.md", flowId, connectionB);
  service.cancelLocalPatch(staged.transaction.id);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("staged Local Model patch semantic guard blocks Apply and Redo when target validity changes", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  let valid = true;
  const guard = async () => {
    if (!valid) throw new Error("replacement definition no longer exists");
  };

  const staged = await service.stageAndReviewLocalRecordPatch(
    "Assembly.md",
    localId,
    { fields: { definition: "[[Replacement Contactor]]" } },
    guard,
  );

  valid = false;
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /replacement definition no longer exists/);
  assert.equal(store.text, note());
  service.cancelLocalPatch(staged.transaction.id);

  valid = true;
  const staged2 = await service.stageAndReviewLocalRecordPatch(
    "Assembly.md",
    localId,
    { fields: { definition: "[[Replacement Contactor]]" } },
    guard,
  );
  await service.applyLocalPatch(staged2.transaction.id);
  await transactions.undo();
  valid = false;
  await assert.rejects(transactions.redo(), /replacement definition no longer exists/);
  assert.equal(store.text, note());
});


test("staged Local Model patch refuses stale indexed owner UID", async () => {
  const endpointId = "ep-20261005004000002skellyspencer";
  const targetPartId = "part-20261005004000001skellyspencer";
  const original = noteWithReassignableEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(
    store,
    () => "20261005004000999skellyspencer",
    transactions,
  );

  await assert.rejects(
    service.stageAndReviewLocalRecordPatch("Assembly.md", endpointId, {
      fields: { part: "[[#^" + targetPartId + "|K2]]" },
    }),
    /indexed uid .* does not match source uid/,
  );
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("staged Local Model patch semantic guard runs at Apply and Redo", async () => {
  const endpointId = "ep-20261005004000002skellyspencer";
  const targetPartId = "part-20261005004000001skellyspencer";
  const original = noteWithReassignableEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  let identityValid = true;
  let checks = 0;
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageAndReviewLocalRecordPatch(
    "Assembly.md",
    endpointId,
    { fields: { part: "[[#^" + targetPartId + "|K2]]" } },
    async () => {
      checks += 1;
      if (!identityValid) throw new Error("definition identity changed");
    },
  );

  await service.applyLocalPatch(staged.transaction.id);
  assert.equal(checks,1);
  await transactions.undo();

  identityValid = false;
  await assert.rejects(transactions.redo(),/definition identity changed/);
  assert.equal(store.text,original);
  assert.equal(checks,2);
});


test("staged Local Model create refuses stale indexed owner UID", async () => {
  const original = note();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(
    store,
    () => "20261005004000999skellyspencer",
    transactions,
  );

  await assert.rejects(
    service.stageAndReviewLocalRecordCreate("Assembly.md", {
      kind: "part",
      localId: "part-20261005040000000skellyspencer",
      heading: "K Identity",
      fields: { definition: "[[Contactor]]" },
    }),
    /indexed uid .* does not match source uid/,
  );
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});

test("staged Local Model flow move refuses stale indexed owner UID", async () => {
  const original = noteWithMovableFlow();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(
    store,
    () => "20261005004000999skellyspencer",
    transactions,
  );

  await assert.rejects(
    service.stageAndReviewLocalFlowMove(
      "Assembly.md",
      "flow-20261005025000004skellyspencer",
      "conn-20261005025000003skellyspencer",
    ),
    /indexed uid .* does not match source uid/,
  );
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


test("staged Local Model delete refuses stale indexed owner UID", async () => {
  const original = noteWithCleanConnection(false);
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(
    store,
    () => "20261005004000999skellyspencer",
    transactions,
  );

  await assert.rejects(
    service.stageAndReviewLocalRecordDelete(
      "Assembly.md",
      "conn-20261005001200002skellyspencer",
    ),
    /indexed uid .* does not match source uid/,
  );
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});

test("atomic Local Model patch refuses stale indexed owner UID", async () => {
  const original = note();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(
    store,
    () => "20261005004000999skellyspencer",
    transactions,
  );

  await assert.rejects(
    service.patchLocalRecord("Assembly.md", localId, {
      fields: { definition: "[[Replacement Contactor]]" },
    }),
    /indexed uid .* does not match source uid/,
  );
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});
