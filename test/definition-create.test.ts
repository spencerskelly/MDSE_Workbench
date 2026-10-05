import assert from "node:assert/strict";
import test from "node:test";
import { definitionTypeForLocalKind, nextAvailableDefinitionUid, nextDefinitionUid, normalizeAuthorSuffix, planDefinitionCreation } from "../src/core/definition-create";

const uid = "20261005052400000skellyspencer";

test("definition creation maps occurrence kinds to governed reusable-definition classes", () => {
  assert.equal(definitionTypeForLocalKind("part"), "Object");
  assert.equal(definitionTypeForLocalKind("endpoint"), "Port");
  assert.equal(definitionTypeForLocalKind("flow"), "Item Flow");
  assert.equal(definitionTypeForLocalKind("connection"), null);
});

test("definition creation renders canonical sparse Markdown without inventing relationships", () => {
  const plan = planDefinitionCreation({
    localKind: "endpoint",
    name: "  CAN Service Port  ",
    uid,
    path: "40_Interfaces/CAN Service Port.md",
  });

  assert.equal(plan.type, "Port");
  assert.equal(plan.name, "CAN Service Port");
  assert.equal(plan.path, "40_Interfaces/CAN Service Port.md");
  assert.equal(
    plan.text,
    [
      "---",
      "type: Port",
      "uid: " + uid,
      "---",
      "",
      "# CAN Service Port",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(plan.text, /partOf|hasPart|subtypeOf|definition:/);
});

test("definition creation refuses kinds without a governed reusable-definition class", () => {
  assert.throws(
    () => planDefinitionCreation({
      localKind: "connection",
      name: "Harness",
      uid,
      path: "Harness.md",
    }),
    /do not have a governed reusable-definition class/,
  );
});

test("definition creation requires governed durable identity and a Markdown destination", () => {
  assert.throws(
    () => planDefinitionCreation({ localKind: "part", name: "Contactor", uid: "short", path: "Contactor.md" }),
    /30-character/,
  );
  assert.throws(
    () => planDefinitionCreation({ localKind: "part", name: "Contactor", uid, path: "Contactor" }),
    /Markdown file path/,
  );
  assert.throws(
    () => planDefinitionCreation({ localKind: "part", name: "   ", uid, path: "Contactor.md" }),
    /name is required/,
  );
});


import { DefinitionCreationService, type DefinitionDocumentStore } from "../src/core/definition-create";
import { TransactionManager } from "../src/core/transaction";

class MemoryDefinitionStore implements DefinitionDocumentStore {
  files = new Map<string, string>();
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(path + " does not exist");
    return text;
  }
  async create(path: string, text: string): Promise<void> {
    if (this.files.has(path)) throw new Error(path + " already exists");
    this.files.set(path, text);
  }
  async remove(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(path + " does not exist");
  }
}

test("definition creation is staged until reviewed and applied", async () => {
  const store = new MemoryDefinitionStore();
  const tx = new TransactionManager([], () => "2026-10-05T05:30:00.000Z");
  const service = new DefinitionCreationService(store, () => false, tx);
  const staged = service.stageAndReview({
    localKind: "part",
    name: "Main Contactor",
    uid,
    path: "30_Objects/Main Contactor.md",
  });

  assert.equal(staged.transaction.scope, "structural");
  assert.equal(staged.transaction.status, "reviewed");
  assert.equal(await store.exists(staged.plan.path), false);

  await service.apply(staged.transaction.id);
  assert.equal(await store.exists(staged.plan.path), true);
  assert.equal(tx.history().length, 1);
  assert.equal(tx.history()[0].changes[0].kind, "definition.create");
  assert.deepEqual(tx.history()[0].changes[0].refs, [{ kind: "note", uid }]);
});

test("definition creation cancel leaves storage and history untouched", async () => {
  const store = new MemoryDefinitionStore();
  const tx = new TransactionManager();
  const service = new DefinitionCreationService(store, () => false, tx);
  const staged = service.stageAndReview({
    localKind: "flow",
    name: "CAN Status",
    uid,
    path: "50_Flows/CAN Status.md",
  });

  const cancelled = service.cancel(staged.transaction.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(await store.exists(staged.plan.path), false);
  assert.equal(tx.history().length, 0);
});

test("definition creation rechecks path collision at Apply and keeps proposal open", async () => {
  const store = new MemoryDefinitionStore();
  const tx = new TransactionManager();
  const service = new DefinitionCreationService(store, () => false, tx);
  const staged = service.stageAndReview({
    localKind: "endpoint",
    name: "CAN Port",
    uid,
    path: "40_Ports/CAN Port.md",
  });
  store.files.set(staged.plan.path, "external");

  await assert.rejects(service.apply(staged.transaction.id), /already exists/);
  assert.equal(store.files.get(staged.plan.path), "external");
  assert.equal(tx.history().length, 0);
  assert.equal(service.review(staged.transaction.id).transaction.status, "reviewed");
  service.cancel(staged.transaction.id);
});

test("definition creation rejects reused UID both at stage and Apply", async () => {
  const store = new MemoryDefinitionStore();
  const tx1 = new TransactionManager();
  const stageBlocked = new DefinitionCreationService(store, (candidate) => candidate === uid, tx1);
  assert.throws(
    () => stageBlocked.stage({
      localKind: "part",
      name: "Contactor",
      uid,
      path: "Contactor.md",
    }),
    /already in use/,
  );

  let used = false;
  const tx2 = new TransactionManager();
  const applyBlocked = new DefinitionCreationService(store, () => used, tx2);
  const staged = applyBlocked.stageAndReview({
    localKind: "part",
    name: "Contactor",
    uid,
    path: "Contactor.md",
  });
  used = true;
  await assert.rejects(applyBlocked.apply(staged.transaction.id), /uid .* now in use/);
  assert.equal(await store.exists(staged.plan.path), false);
  assert.equal(tx2.history().length, 0);
  serviceCleanup(applyBlocked, staged.transaction.id);
});

function serviceCleanup(service: DefinitionCreationService, transactionId: string): void {
  try { service.cancel(transactionId); } catch { /* already closed */ }
}

test("definition creation undo/redo is guarded against later file changes", async () => {
  const store = new MemoryDefinitionStore();
  const tx = new TransactionManager();
  const service = new DefinitionCreationService(store, () => false, tx);
  const staged = service.stageAndReview({
    localKind: "flow",
    name: "Status Flow",
    uid,
    path: "Status Flow.md",
  });
  await service.apply(staged.transaction.id);

  await tx.undo();
  assert.equal(await store.exists(staged.plan.path), false);
  await tx.redo();
  assert.equal(await store.exists(staged.plan.path), true);

  store.files.set(staged.plan.path, (await store.read(staged.plan.path)) + "\nexternal");
  await assert.rejects(tx.undo(), /changed after/);
  assert.equal(await store.exists(staged.plan.path), true);
});


test("creator identity normalizes to the governed 13-letter suffix", () => {
  assert.equal(normalizeAuthorSuffix("Skelly-Spencer"), "skellyspencer");
  assert.throws(() => normalizeAuthorSuffix("Spencer"), /13 ASCII letters/);
});

test("definition UIDs use UTC timestamp plus creator identity", () => {
  assert.equal(
    nextDefinitionUid("skellyspencer", new Date("2026-10-05T05:30:45.123Z")),
    "20261005053045123skellyspencer",
  );
});

test("definition UID allocation retries collisions by +1 ms", () => {
  const now = new Date("2026-10-05T05:30:45.123Z");
  const first = nextDefinitionUid("skellyspencer", now);
  const second = nextDefinitionUid("skellyspencer", new Date(now.getTime() + 1));
  assert.equal(
    nextAvailableDefinitionUid("skellyspencer", (candidate) => candidate === first, now),
    second,
  );
});


test("definition rollback only reverses its own latest semantic history entry", async () => {
  const store = new MemoryDefinitionStore();
  const tx = new TransactionManager();
  const service = new DefinitionCreationService(store, () => false, tx);
  const staged = service.stageAndReview({
    localKind: "part",
    name: "Contactor",
    uid,
    path: "Contactor.md",
  });
  await service.apply(staged.transaction.id);
  assert.equal(await store.exists(staged.plan.path), true);

  await service.rollbackApplied(staged.transaction.id);
  assert.equal(await store.exists(staged.plan.path), false);
  assert.equal(tx.history().length, 0);
});

test("definition rollback refuses to cross a newer semantic edit", async () => {
  const store = new MemoryDefinitionStore();
  const tx = new TransactionManager();
  const service = new DefinitionCreationService(store, () => false, tx);
  const staged = service.stageAndReview({
    localKind: "flow",
    name: "Status Flow",
    uid,
    path: "Status Flow.md",
  });
  await service.apply(staged.transaction.id);

  tx.recordApplied(
    "newer",
    "newer edit",
    "atomic",
    [{ kind: "test", summary: "newer", refs: [] }],
    { async undo() {}, async redo() {} },
  );

  await assert.rejects(
    service.rollbackApplied(staged.transaction.id),
    /newer semantic edit/,
  );
  assert.equal(await store.exists(staged.plan.path), true);
});


test("definition creation undo refuses active references added outside semantic history", async () => {
  const store = new MemoryDefinitionStore();
  const tx = new TransactionManager();
  let referenced = false;
  const service = new DefinitionCreationService(
    store,
    () => false,
    tx,
    async (path) => ({
      definitionPath: path,
      noteUses: referenced ? [{ fromPath: "System.md", field: "hasPart" }] : [],
      occurrenceUses: [],
    }),
  );
  const staged = service.stageAndReview({
    localKind: "part",
    name: "Contactor",
    uid,
    path: "Contactor.md",
  });
  await service.apply(staged.transaction.id);

  referenced = true;
  await assert.rejects(tx.undo(), /active reference/);
  assert.equal(await store.exists(staged.plan.path), true);
  assert.equal(tx.history().length, 1);
});


test("definition creation redo refuses UID collision introduced after undo", async () => {
  const store = new MemoryDefinitionStore();
  const tx = new TransactionManager();
  let uidCollision = false;
  const service = new DefinitionCreationService(store, () => uidCollision, tx);
  const staged = service.stageAndReview({
    localKind: "part",
    name: "Contactor",
    uid,
    path: "Contactor.md",
  });
  await service.apply(staged.transaction.id);
  await tx.undo();

  uidCollision = true;
  await assert.rejects(tx.redo(), /uid .* is in use/);
  assert.equal(await store.exists(staged.plan.path), false);
  assert.equal(tx.history().length, 0);
});
