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


test("staged endpoint creation stays unwritten until Apply and preserves part binding", async () => {
  const store = new MemoryStore(note());
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);
  const endpointId = "ep-20261004234800000skellyspencer";
  const before = store.text;

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
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

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
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

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", endpointId);
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", endpointId);
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", endpointId);
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", endpointId);
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
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

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
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

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
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

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", connectionId);
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", connectionId);
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", connectionId);
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", connectionId);
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

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
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
    service.stageLocalRecordCreate("Assembly.md", {
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

  const staged = await service.stageLocalRecordCreate("Assembly.md", {
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", flowId);
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", flowId);
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

  const staged = await service.stageLocalRecordDelete("Assembly.md", flowId);
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "^" + partA,
    "",
    "#### K2",
    "- definition: [[Main Contactor]]",
    "^" + partB,
    "",
    "### Local Interfaces",
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", endpointId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", endpointId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", endpointId, {
    fields: { part: "[[#^" + targetPartId + "|K2]]" },
  });
  store.text += "\nexternal change";

  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /changed while/);
  assert.equal(transactions.history().length, 0);
  assert.equal(service.reviewLocalPatch(staged.transaction.id).transaction.status, "draft");
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled endpoint part reassignment leaves source and history untouched", async () => {
  const endpointId = "ep-20261005004000002skellyspencer";
  const targetPartId = "part-20261005004000001skellyspencer";
  const original = noteWithReassignableEndpoint();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageLocalRecordPatch("Assembly.md", endpointId, {
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "^" + partId,
    "",
    "### Local Interfaces",
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", endpointId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", endpointId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", endpointId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", endpointId, {
    fields: { parent: "[[#^" + newParentId + "|J3]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});


function noteWithEditableExposures(): string {
  const source = "ep-20261005008000000skellyspencer";
  const exposedA = "ep-20261005008000001skellyspencer";
  const exposedB = "ep-20261005008000002skellyspencer";
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
    "### Local Interfaces",
    "#### Boundary",
    "- definition: [[CAN Port]]",
    "- exposes: [[#^" + exposedA + "|J1]]",
    "^" + source,
    "",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + exposedA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + exposedB,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

test("staged endpoint exposure add stays unwritten until Apply and supports undo/redo", async () => {
  const sourceId = "ep-20261005008000000skellyspencer";
  const firstId = "ep-20261005008000001skellyspencer";
  const secondId = "ep-20261005008000002skellyspencer";
  const original = noteWithEditableExposures();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageLocalRecordPatch("Assembly.md", sourceId, {
    fields: { exposes: "[[#^" + firstId + "|J1]] [[#^" + secondId + "|J2]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- exposes: [[#^" + firstId + "|J1]] [[#^" + secondId + "|J2]]"));
  assert.equal(transactions.history().at(-1)?.changes[0].kind, "local.patch");

  await transactions.undo();
  assert.equal(store.text, original);
  await transactions.redo();
  assert.ok(store.text.includes("- exposes: [[#^" + firstId + "|J1]] [[#^" + secondId + "|J2]]"));
});

test("staged endpoint exposure removal can clear the field entirely", async () => {
  const sourceId = "ep-20261005008000000skellyspencer";
  const original = noteWithEditableExposures();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageLocalRecordPatch("Assembly.md", sourceId, {
    fields: { exposes: null },
  });

  await service.applyLocalPatch(staged.transaction.id);
  assert.doesNotMatch(store.text, /- exposes:/);
  await transactions.undo();
  assert.equal(store.text, original);
});

test("staged endpoint exposure edit blocks missing target at Apply", async () => {
  const sourceId = "ep-20261005008000000skellyspencer";
  const original = noteWithEditableExposures();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageLocalRecordPatch("Assembly.md", sourceId, {
    fields: { exposes: "[[#^ep-20261005008100099skellyspencer|Missing]]" },
  });

  assert.ok(staged.plan.findings.some((finding) => finding.severity === "error"));
  await assert.rejects(service.applyLocalPatch(staged.transaction.id), /blocking Local Model finding/);
  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
  service.cancelLocalPatch(staged.transaction.id);
});

test("cancelled endpoint exposure edit leaves source and history untouched", async () => {
  const sourceId = "ep-20261005008000000skellyspencer";
  const secondId = "ep-20261005008000002skellyspencer";
  const original = noteWithEditableExposures();
  const store = new MemoryStore(original);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, () => ownerUid, transactions);

  const staged = await service.stageLocalRecordPatch("Assembly.md", sourceId, {
    fields: { exposes: "[[#^" + secondId + "|J2]]" },
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### Boundary",
    "- definition: [[CAN Port]]",
    "- equals: [[#^" + equalA + "|J1]]",
    "^" + source,
    "",
    "#### J1",
    "- definition: [[CAN Port]]",
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", sourceId, {
    fields: { equals: "[[#^" + firstId + "|J1]] [[#^" + secondId + "|J2]]" },
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(store.text, original);
  assert.equal(staged.plan.findings.filter((finding) => finding.severity === "error").length, 0);

  await service.applyLocalPatch(staged.transaction.id);
  assert.ok(store.text.includes("- equals: [[#^" + firstId + "|J1]] [[#^" + secondId + "|J2]]"));
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", sourceId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", sourceId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", sourceId, {
    fields: { equals: "[[#^" + secondId + "|J2]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", connectionId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", connectionId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", connectionId, {
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

  const staged = await service.stageLocalRecordPatch("Assembly.md", connectionId, {
    fields: { endpointA: "[[#^" + endpointC + "|J3]]" },
  });
  service.cancelLocalPatch(staged.transaction.id);

  assert.equal(store.text, original);
  assert.equal(transactions.history().length, 0);
});
