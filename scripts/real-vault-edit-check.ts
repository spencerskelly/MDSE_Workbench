import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { ModelEditService, type TextDocumentStore } from "../src/core/model-edit";
import { nextAvailableLocalId } from "../src/core/localmodel-edit";
import { parseLocalModel } from "../src/core/localmodel";
import { TransactionManager } from "../src/core/transaction";

const root = process.argv[2];
const reportPath = process.argv[3];
if (!root) {
  console.error("Usage: npm run accept:real-vault:edits -- <vault-path> [report-json]");
  process.exit(2);
}

const SOURCE_OWNER =
  "00 Product Abstract/02 Module/04 IPC Accessory & Option/PCOM 1.0/PCBA - PCOM Adapter/PCBA - PCE Adapter.md";

class FileStore implements TextDocumentStore {
  constructor(private readonly dir: string) {}
  async read(path: string): Promise<string> {
    return readFile(join(this.dir, path), "utf8");
  }
  async write(path: string, text: string): Promise<void> {
    await writeFile(join(this.dir, path), text, "utf8");
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function ownerUid(text: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? "";
  const uid = /^uid:\s*["']?([^"'\n#]+)["']?\s*(?:#.*)?$/m.exec(fm)?.[1]?.trim() ?? "";
  if (!/^\d{17}[a-z-]{13}$/.test(uid)) throw new Error("Representative owner does not have a governed 30-character uid.");
  return uid;
}

function localLink(localId: string, heading: string): string {
  return "[[#^" + localId + "|" + heading + "]]";
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectReject(action: () => Promise<unknown>, pattern: RegExp, label: string): Promise<string> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) throw new Error(label + " rejected for the wrong reason: " + message);
    return message;
  }
  throw new Error(label + " unexpectedly succeeded.");
}

async function main(): Promise<void> {
  const started = Date.now();
  const sourcePath = join(root, SOURCE_OWNER);
  const sourceBefore = await readFile(sourcePath, "utf8");
  const sourceHashBefore = sha256(sourceBefore);
  const uid = ownerUid(sourceBefore);
  const originalRegion = parseLocalModel(sourceBefore);
  assert(originalRegion?.structured && originalRegion.schemaVersion === "0.4", "Representative owner is not a structured Local Model 0.4 note.");

  const realEndpoints = originalRegion.records.filter((r) => r.kind === "endpoint" && r.localId);
  assert(realEndpoints.length >= 2, "Representative owner needs at least two real Interfaces for the reconnect check.");

  const fixtureDir = await mkdtemp(join(tmpdir(), "wb128-gate4-"));
  const fixtureName = basename(SOURCE_OWNER);
  const fixturePath = join(fixtureDir, fixtureName);
  await writeFile(fixturePath, sourceBefore, "utf8");

  const store = new FileStore(fixtureDir);
  const transactions = new TransactionManager();
  const service = new ModelEditService(store, (path) => path === fixtureName ? uid : null, transactions);
  const existingIds = new Set(originalRegion.records.map((r) => r.localId).filter(Boolean));
  const endpointId = nextAvailableLocalId("endpoint", uid, existingIds, new Date("2026-10-06T03:15:00.000Z"));
  existingIds.add(endpointId);
  const connectionId = nextAvailableLocalId("connection", uid, existingIds, new Date("2026-10-06T03:15:00.001Z"));
  existingIds.add(connectionId);
  const cancelledEndpointId = nextAvailableLocalId("endpoint", uid, existingIds, new Date("2026-10-06T03:15:00.002Z"));

  const endpointA = realEndpoints[0];
  const endpointB = realEndpoints[1];
  const events: Array<Record<string, unknown>> = [];

  try {
    // CREATE + mandatory Review + Apply + Undo/Redo.
    const beforeCreate = await store.read(fixtureName);
    const create = await service.stageLocalRecordCreate(fixtureName, {
      kind: "endpoint",
      localId: endpointId,
      heading: "WB128 Gate4 Interface",
      fields: {},
    });
    assert(create.transaction.status === "draft", "Create did not begin as a draft.");
    assert(await store.read(fixtureName) === beforeCreate, "Create staging mutated the fixture.");
    const preReviewError = await expectReject(
      () => service.applyLocalCreate(create.transaction.id),
      /must be reviewed before Apply/,
      "Unreviewed structural create",
    );
    const reviewedCreate = service.reviewLocalCreate(create.transaction.id);
    assert(reviewedCreate.transaction.status === "reviewed", "Create did not enter reviewed state.");
    await service.applyLocalCreate(create.transaction.id);
    assert((await store.read(fixtureName)).includes("^" + endpointId), "Create Apply did not write the new Interface.");
    await transactions.undo();
    assert(await store.read(fixtureName) === beforeCreate, "Create undo did not restore the exact real-note copy.");
    await transactions.redo();
    assert((await store.read(fixtureName)).includes("^" + endpointId), "Create redo did not restore the Interface.");
    events.push({ operation: "create endpoint", preReviewBlocked: true, preReviewError, undoRedo: "PASS" });

    // CREATE a disposable connection using the new Interface plus one real Interface.
    const beforeConnection = await store.read(fixtureName);
    const createConnection = await service.stageAndReviewLocalRecordCreate(fixtureName, {
      kind: "connection",
      localId: connectionId,
      heading: "WB128 Gate4 Connection",
      fields: {
        endpointA: localLink(endpointId, "WB128 Gate4 Interface"),
        endpointB: localLink(endpointA.localId, endpointA.identifier),
      },
    });
    assert(await store.read(fixtureName) === beforeConnection, "Connection staging mutated the fixture.");
    await service.applyLocalCreate(createConnection.transaction.id);
    let region = parseLocalModel(await store.read(fixtureName));
    let testConnection = region?.records.find((r) => r.localId === connectionId);
    assert(testConnection?.kind === "connection", "Connection Apply did not create the disposable Connection.");
    await transactions.undo();
    assert(await store.read(fixtureName) === beforeConnection, "Connection undo did not restore the fixture.");
    await transactions.redo();
    assert(parseLocalModel(await store.read(fixtureName))?.records.some((r) => r.localId === connectionId), "Connection redo failed.");
    events.push({ operation: "create connection", reviewApply: "PASS", undoRedo: "PASS" });

    // EDIT/PATCH the disposable Interface.
    const beforePatch = await store.read(fixtureName);
    const patch = await service.stageLocalRecordPatch(fixtureName, endpointId, { heading: "WB128 Gate4 Interface Edited" });
    assert(patch.transaction.status === "draft", "Patch did not begin as a draft.");
    assert(await store.read(fixtureName) === beforePatch, "Patch staging mutated the fixture.");
    service.reviewLocalPatch(patch.transaction.id);
    await service.applyLocalPatch(patch.transaction.id);
    assert((await store.read(fixtureName)).includes("#### WB128 Gate4 Interface Edited"), "Patch Apply did not update the heading.");
    await transactions.undo();
    assert(await store.read(fixtureName) === beforePatch, "Patch undo did not restore the fixture.");
    await transactions.redo();
    assert((await store.read(fixtureName)).includes("#### WB128 Gate4 Interface Edited"), "Patch redo failed.");
    events.push({ operation: "patch endpoint", reviewApply: "PASS", undoRedo: "PASS" });

    // RECONNECT only the disposable Connection, from real endpoint A to real endpoint B.
    const beforeReconnect = await store.read(fixtureName);
    const reconnect = await service.stageAndReviewLocalRecordPatch(fixtureName, connectionId, {
      fields: { endpointB: localLink(endpointB.localId, endpointB.identifier) },
    });
    assert(await store.read(fixtureName) === beforeReconnect, "Reconnect staging mutated the fixture.");
    await service.applyLocalPatch(reconnect.transaction.id);
    region = parseLocalModel(await store.read(fixtureName));
    testConnection = region?.records.find((r) => r.localId === connectionId);
    assert(testConnection?.endpointB?.blockId === endpointB.localId, "Reconnect Apply did not move endpointB.");
    await transactions.undo();
    region = parseLocalModel(await store.read(fixtureName));
    testConnection = region?.records.find((r) => r.localId === connectionId);
    assert(testConnection?.endpointB?.blockId === endpointA.localId, "Reconnect undo did not restore endpointB.");
    await transactions.redo();
    region = parseLocalModel(await store.read(fixtureName));
    testConnection = region?.records.find((r) => r.localId === connectionId);
    assert(testConnection?.endpointB?.blockId === endpointB.localId, "Reconnect redo did not restore the new endpointB.");
    events.push({
      operation: "reconnect connection",
      from: endpointA.localId,
      to: endpointB.localId,
      reviewApply: "PASS",
      undoRedo: "PASS",
    });

    // CANCEL must not mutate or enter semantic history.
    const beforeCancel = await store.read(fixtureName);
    const historyBeforeCancel = transactions.history().length;
    const cancel = await service.stageAndReviewLocalRecordCreate(fixtureName, {
      kind: "endpoint",
      localId: cancelledEndpointId,
      heading: "WB128 Gate4 Cancelled Interface",
      fields: {},
    });
    const cancelled = service.cancelLocalCreate(cancel.transaction.id);
    assert(cancelled.status === "cancelled", "Cancel did not close the transaction as cancelled.");
    assert(await store.read(fixtureName) === beforeCancel, "Cancel changed the fixture.");
    assert(transactions.history().length === historyBeforeCancel, "Cancel polluted semantic history.");
    events.push({ operation: "cancel create", sourceUnchanged: true, historyUnchanged: true });

    // DELETE disposable Connection, then disposable Interface; both must support Undo/Redo.
    const beforeDeleteConnection = await store.read(fixtureName);
    const deleteConnection = await service.stageAndReviewLocalRecordDelete(fixtureName, connectionId);
    assert(deleteConnection.plan.impacts.length === 0, "Disposable Connection unexpectedly has dependent local records.");
    await service.applyLocalDelete(deleteConnection.transaction.id);
    assert(!parseLocalModel(await store.read(fixtureName))?.records.some((r) => r.localId === connectionId), "Connection delete failed.");
    await transactions.undo();
    assert(await store.read(fixtureName) === beforeDeleteConnection, "Connection delete undo failed.");
    await transactions.redo();
    assert(!parseLocalModel(await store.read(fixtureName))?.records.some((r) => r.localId === connectionId), "Connection delete redo failed.");
    events.push({ operation: "delete connection", reviewApply: "PASS", undoRedo: "PASS" });

    const beforeDeleteEndpoint = await store.read(fixtureName);
    const deleteEndpoint = await service.stageAndReviewLocalRecordDelete(fixtureName, endpointId);
    assert(deleteEndpoint.plan.impacts.length === 0, "Disposable Interface unexpectedly still has local dependents.");
    await service.applyLocalDelete(deleteEndpoint.transaction.id);
    assert(!parseLocalModel(await store.read(fixtureName))?.records.some((r) => r.localId === endpointId), "Interface delete failed.");
    await transactions.undo();
    assert(await store.read(fixtureName) === beforeDeleteEndpoint, "Interface delete undo failed.");
    await transactions.redo();
    assert(!parseLocalModel(await store.read(fixtureName))?.records.some((r) => r.localId === endpointId), "Interface delete redo failed.");
    events.push({ operation: "delete endpoint", reviewApply: "PASS", undoRedo: "PASS" });

    const finalFixture = await store.read(fixtureName);
    const finalRegion = parseLocalModel(finalFixture);
    assert(finalRegion?.structured === true, "Final disposable fixture is not structurally readable.");
    assert(finalRegion.findings.filter((f) => f.severity === "error").length === 0, "Final disposable fixture has Local Model errors.");

    const sourceAfter = await readFile(sourcePath, "utf8");
    const sourceHashAfter = sha256(sourceAfter);
    assert(sourceHashAfter === sourceHashBefore, "Real imported owner changed during Gate 4.");

    const memory = process.memoryUsage();
    const result = {
      status: "PASS",
      mode: "disposable-real-note-edit-check",
      workbenchVersion: "0.1.18",
      sourceOwner: SOURCE_OWNER,
      sourceHashBefore,
      sourceHashAfter,
      sourceUnchanged: true,
      fixtureOnly: true,
      existingEndpointA: { localId: endpointA.localId, identifier: endpointA.identifier },
      existingEndpointB: { localId: endpointB.localId, identifier: endpointB.identifier },
      createdIds: { endpointId, connectionId, cancelledEndpointId },
      operations: events,
      semanticHistoryEntries: transactions.history().length,
      finalFixtureStructured: true,
      finalFixtureErrorFindings: 0,
      elapsedMs: Date.now() - started,
      memoryRssMiB: Math.round(memory.rss / 1024 / 1024),
      failures: [],
    };
    const json = JSON.stringify(result, null, 2) + "\n";
    if (reportPath) await writeFile(reportPath, json, "utf8");
    console.log("WB128_REAL_VAULT_EDIT_RESULT_BEGIN");
    console.log(json.trimEnd());
    console.log("WB128_REAL_VAULT_EDIT_RESULT_END");
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
