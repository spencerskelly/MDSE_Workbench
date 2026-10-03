import assert from "node:assert/strict";
import test from "node:test";
import { noteRef } from "../src/core/localmodel";
import { TransactionManager, type EditExecutor, type TransactionValidator } from "../src/core/transaction";

const ref = noteRef("20261003133512742skellyspencer");

test("atomic edit applies and participates in semantic undo/redo", async () => {
  let state = 0;
  const manager = new TransactionManager([], () => "2026-10-03T20:00:00.000Z");
  manager.begin("tx-1", "Set status", "atomic");
  manager.add("tx-1", {
    id: "op-1",
    label: "Set status",
    changes: [{ kind: "property.set", summary: "Set status to Active", refs: [ref] }],
  });

  const executor: EditExecutor = {
    async apply() {
      state = 1;
      return {
        async undo() { state = 0; },
        async redo() { state = 1; },
      };
    },
  };

  const history = await manager.apply("tx-1", executor);
  assert.equal(state, 1);
  assert.equal(history.scope, "atomic");
  assert.equal(manager.canUndo, true);
  assert.equal(manager.history().length, 1);

  await manager.undo();
  assert.equal(state, 0);
  assert.equal(manager.canRedo, true);

  await manager.redo();
  assert.equal(state, 1);
});

test("blocking validation may exist while staged but prevents Apply", async () => {
  const validate: TransactionValidator = (tx) =>
    tx.operations.some((op) => op.label === "Move occurrence")
      ? [{ code: "structure.invalid", severity: "error", message: "Occurrence has no valid parent." }]
      : [];

  const manager = new TransactionManager([validate]);
  manager.begin("tx-2", "Restructure assembly", "structural");
  const draft = manager.add("tx-2", {
    id: "op-2",
    label: "Move occurrence",
    changes: [{ kind: "structure.move", summary: "Move K1", refs: [ref] }],
  });

  assert.equal(draft.issues.length, 1);
  assert.equal(manager.canApply("tx-2"), false);

  const executor: EditExecutor = {
    async apply() {
      throw new Error("executor must not run");
    },
  };
  await assert.rejects(manager.apply("tx-2", executor), /blocking validation issue/);
});

test("warnings do not block apply and cancel never invokes storage", async () => {
  let applied = 0;
  const validate: TransactionValidator = () => [{ code: "impact.review", severity: "warning", message: "Review usages." }];
  const manager = new TransactionManager([validate]);
  manager.begin("tx-3", "Rename occurrence", "atomic");
  manager.add("tx-3", {
    id: "op-3",
    label: "Rename",
    changes: [{ kind: "occurrence.rename", summary: "Rename K1 to Main K1", refs: [ref] }],
  });
  assert.equal(manager.canApply("tx-3"), true);
  manager.cancel("tx-3");

  const executor: EditExecutor = {
    async apply() {
      applied++;
      return { async undo() {} };
    },
  };
  assert.equal(applied, 0);
  await assert.rejects(manager.apply("tx-3", executor), /does not exist/);
});

test("a non-reversible semantic change is retained in history but cannot undo", async () => {
  const manager = new TransactionManager();
  manager.begin("tx-4", "External migration", "structural");
  manager.add("tx-4", {
    id: "op-4",
    label: "Migrate",
    changes: [{ kind: "migration", summary: "External migration", refs: [ref], reversible: false }],
  });
  await manager.apply("tx-4", { async apply() { return { async undo() {} }; } });
  assert.equal(manager.canUndo, false);
  await assert.rejects(manager.undo(), /non-reversible/);
});
