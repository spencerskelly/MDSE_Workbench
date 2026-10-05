import { localRef, type ModelRef } from "./localmodel";
import { planLocalFlowMove, planLocalRecordCreate, planLocalRecordDelete, planLocalRecordPatch, type LocalRecordPatch, type NewLocalRecord, type PlannedLocalDelete, type PlannedLocalEdit } from "./localmodel-edit";
import { TransactionManager, type AppliedEdit, type EditTransaction } from "./transaction";

export interface TextDocumentStore {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

export interface LocalPatchResult {
  changed: boolean;
  plan: PlannedLocalEdit;
}

export interface StagedLocalCreate {
  transaction: EditTransaction;
  plan: PlannedLocalEdit;
  path: string;
}

export interface StagedLocalPatch {
  transaction: EditTransaction;
  plan: PlannedLocalEdit;
  path: string;
}

interface PendingLocalPatch {
  path: string;
  plan: PlannedLocalEdit;
  label: string;
  semanticGuard?: () => Promise<void>;
}

interface PendingLocalCreate {
  path: string;
  plan: PlannedLocalEdit;
  label: string;
}

export interface ExternalLocalDeleteImpact {
  path: string;
  field: string;
}

export interface StagedLocalDelete {
  transaction: EditTransaction;
  plan: PlannedLocalDelete;
  path: string;
  externalImpacts: ExternalLocalDeleteImpact[];
}

interface PendingLocalDelete {
  path: string;
  plan: PlannedLocalDelete;
  label: string;
  ownerUid: string;
}

function assertIndexedOwnerUidMatchesSource(path: string, before: string, indexedUid: string): void {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(before);
  const sourceUid = frontmatterMatch
    ? /^uid:\s*["']?([^"'\n#]+)["']?\s*(?:#.*)?$/m.exec(frontmatterMatch[1])?.[1]?.trim() ?? ""
    : "";
  if (!sourceUid || sourceUid !== indexedUid) {
    throw new Error(
      `Cannot stage structural Local Model edit for ${path}: indexed uid ${indexedUid} does not match source uid ${sourceUid || "none"}.`,
    );
  }
}

/**
 * WB-114 atomic Local Model editor.
 *
 * The pure planner owns Local Model syntax. This service owns the semantic transaction and guarded
 * file application. UI and Canvas callers submit semantic intent here; they never edit Markdown
 * directly.
 */
export class ModelEditService {
  private sequence = 0;
  private readonly pendingCreates = new Map<string, PendingLocalCreate>();
  private readonly pendingPatches = new Map<string, PendingLocalPatch>();
  private readonly pendingDeletes = new Map<string, PendingLocalDelete>();

  constructor(
    private readonly store: TextDocumentStore,
    private readonly ownerUid: (path: string) => string | null,
    private readonly transactions: TransactionManager,
    private readonly externalLocalDeleteImpacts: (ownerPath: string, localId: string) => ExternalLocalDeleteImpact[] = () => [],
  ) {}

  async patchLocalRecord(path: string, localId: string, patch: LocalRecordPatch): Promise<LocalPatchResult> {
    const before = await this.store.read(path);
    const plan = planLocalRecordPatch(before, localId, patch);
    if (!plan.changed) return { changed: false, plan };

    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    assertIndexedOwnerUidMatchesSource(path, before, uid);
    const ref = localRef(uid, plan.kind, localId);
    const label = `edit ${plan.kind} ${localId}`;
    const txId = `local-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;

    this.transactions.begin(txId, label, "atomic");
    this.transactions.add(txId, {
      id: txId + "-patch",
      label,
      changes: [{
        kind: "local.patch",
        summary: label,
        refs: [ref],
        metadata: { path, localId, localKind: plan.kind },
      }],
    });

    try {
      await this.transactions.apply(txId, {
        apply: async () => this.applyGuarded(path, plan.before, plan.after, label),
      });
    } catch (error) {
      // apply() leaves a failed transaction as a draft. Nothing has been committed to history, so
      // discard the draft before surfacing the failure.
      try { this.transactions.cancel(txId); } catch { /* already closed */ }
      throw error;
    }

    return { changed: true, plan };
  }

  async stageLocalRecordPatch(
    path: string,
    localId: string,
    patch: LocalRecordPatch,
    semanticGuard?: () => Promise<void>,
  ): Promise<StagedLocalPatch> {
    const before = await this.store.read(path);
    const plan = planLocalRecordPatch(before, localId, patch, { allowInvalidTarget: true });
    if (!plan.changed) throw new Error("This structural edit would not change the Local Model.");

    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    assertIndexedOwnerUidMatchesSource(path, before, uid);

    const txId = `local-patch-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `reassign ${plan.kind} ${localId}`;
    this.transactions.begin(txId, label, "structural");
    const transaction = this.transactions.add(txId, {
      id: txId + "-patch",
      label,
      changes: [{
        kind: "local.patch",
        summary: label,
        refs: [localRef(uid, plan.kind, localId)],
        metadata: { path, localId, localKind: plan.kind },
      }],
    });
    this.pendingPatches.set(txId, { path, plan, label, semanticGuard });
    return { transaction, plan, path };
  }

  async stageAndReviewLocalRecordPatch(
    path: string,
    localId: string,
    patch: LocalRecordPatch,
    semanticGuard?: () => Promise<void>,
  ): Promise<StagedLocalPatch> {
    const staged = await this.stageLocalRecordPatch(path, localId, patch, semanticGuard);
    return this.reviewLocalPatch(staged.transaction.id);
  }

  async stageAndReviewLocalFlowMove(path: string, flowId: string, connectionId: string): Promise<StagedLocalPatch> {
    const before = await this.store.read(path);
    const plan = planLocalFlowMove(before, flowId, connectionId);
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    assertIndexedOwnerUidMatchesSource(path, before, uid);

    const txId = `local-move-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `move flow ${flowId} to ${connectionId}`;
    this.transactions.begin(txId, label, "structural");
    this.transactions.add(txId, {
      id: txId + "-move",
      label,
      changes: [{
        kind: "local.move",
        summary: label,
        refs: [localRef(uid, "flow", flowId), localRef(uid, "connection", connectionId)],
        metadata: { path, localId: flowId, localKind: "flow", connectionId },
      }],
    });
    this.pendingPatches.set(txId, { path, plan, label });
    return {
      transaction: this.transactions.review(txId),
      plan,
      path,
    };
  }

  reviewLocalPatch(transactionId: string): StagedLocalPatch {
    const pending = this.requirePendingPatch(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      plan: pending.plan,
      path: pending.path,
    };
  }

  async applyLocalPatch(transactionId: string): Promise<void> {
    const pending = this.requirePendingPatch(transactionId);
    const blocking = pending.plan.findings.filter((finding) => finding.severity === "error");
    if (blocking.length) {
      throw new Error(
        `Cannot apply ${pending.label}: ${blocking.length} blocking Local Model finding${blocking.length === 1 ? "" : "s"} — ${blocking.map((finding) => finding.message).join(" ")}`,
      );
    }
    await this.transactions.apply(transactionId, {
      apply: async () => this.applyGuarded(
        pending.path,
        pending.plan.before,
        pending.plan.after,
        pending.label,
        pending.semanticGuard,
      ),
    });
    this.pendingPatches.delete(transactionId);
  }

  cancelLocalPatch(transactionId: string): EditTransaction {
    this.requirePendingPatch(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pendingPatches.delete(transactionId);
    return cancelled;
  }

  private requirePendingPatch(transactionId: string): PendingLocalPatch {
    const pending = this.pendingPatches.get(transactionId);
    if (!pending) throw new Error(`Structural Local Model patch transaction ${transactionId} does not exist.`);
    return pending;
  }

  /**
   * Stage creation of one Local Model record. Planning and validation happen now, but the vault is
   * untouched until applyLocalCreate(). This is the first structural Review / Apply / Cancel path.
   */
  async stageLocalRecordCreate(path: string, input: NewLocalRecord): Promise<StagedLocalCreate> {
    const before = await this.store.read(path);
    const plan = planLocalRecordCreate(before, input);
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    assertIndexedOwnerUidMatchesSource(path, before, uid);

    const txId = `local-struct-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `create ${input.kind} ${input.heading.trim()}`;
    this.transactions.begin(txId, label, "structural");
    const transaction = this.transactions.add(txId, {
      id: txId + "-create",
      label,
      changes: [{
        kind: "local.create",
        summary: label,
        refs: [localRef(uid, input.kind, input.localId)],
        metadata: { path, localId: input.localId, localKind: input.kind },
      }],
    });
    this.pendingCreates.set(txId, { path, plan, label });
    return { transaction, plan, path };
  }

  async stageAndReviewLocalRecordCreate(path: string, input: NewLocalRecord): Promise<StagedLocalCreate> {
    const staged = await this.stageLocalRecordCreate(path, input);
    return this.reviewLocalCreate(staged.transaction.id);
  }

  reviewLocalCreate(transactionId: string): StagedLocalCreate {
    const pending = this.requirePendingCreate(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      plan: pending.plan,
      path: pending.path,
    };
  }

  async applyLocalCreate(transactionId: string): Promise<void> {
    const pending = this.requirePendingCreate(transactionId);
    const blocking = pending.plan.findings.filter((finding) => finding.severity === "error");
    if (blocking.length) {
      throw new Error(
        `Cannot apply ${pending.label}: ${blocking.length} blocking Local Model finding${blocking.length === 1 ? "" : "s"} — ${blocking.map((finding) => finding.message).join(" ")}`,
      );
    }
    try {
      await this.transactions.apply(transactionId, {
        apply: async () => this.applyGuarded(pending.path, pending.plan.before, pending.plan.after, pending.label),
      });
      this.pendingCreates.delete(transactionId);
    } catch (error) {
      // Keep a stale/failed structural proposal available for Review or Cancel. Apply never mutates
      // semantic history unless the guarded storage write succeeds.
      throw error;
    }
  }

  cancelLocalCreate(transactionId: string): EditTransaction {
    this.requirePendingCreate(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pendingCreates.delete(transactionId);
    return cancelled;
  }

  private requirePendingCreate(transactionId: string): PendingLocalCreate {
    const pending = this.pendingCreates.get(transactionId);
    if (!pending) throw new Error(`Structural Local Model transaction ${transactionId} does not exist.`);
    return pending;
  }

  async stageLocalRecordDelete(path: string, localId: string): Promise<StagedLocalDelete> {
    const before = await this.store.read(path);
    const plan = planLocalRecordDelete(before, localId);
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    assertIndexedOwnerUidMatchesSource(path, before, uid);

    const txId = `local-delete-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `delete ${plan.kind} ${plan.identifier}`;
    this.transactions.begin(txId, label, "structural");
    const transaction = this.transactions.add(txId, {
      id: txId + "-delete",
      label,
      changes: [{
        kind: "local.delete",
        summary: label,
        refs: [localRef(uid, plan.kind, plan.localId)],
        metadata: { path, localId: plan.localId, localKind: plan.kind },
      }],
    });
    this.pendingDeletes.set(txId, { path, plan, label, ownerUid: uid });
    return {
      transaction,
      plan,
      path,
      externalImpacts: this.externalLocalDeleteImpacts(path, localId),
    };
  }

  async stageAndReviewLocalRecordDelete(path: string, localId: string): Promise<StagedLocalDelete> {
    const staged = await this.stageLocalRecordDelete(path, localId);
    return this.reviewLocalDelete(staged.transaction.id);
  }

  reviewLocalDelete(transactionId: string): StagedLocalDelete {
    const pending = this.requirePendingDelete(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      plan: pending.plan,
      path: pending.path,
      externalImpacts: this.externalLocalDeleteImpacts(pending.path, pending.plan.localId),
    };
  }

  async applyLocalDelete(transactionId: string): Promise<void> {
    const pending = this.requirePendingDelete(transactionId);
    const external = this.externalLocalDeleteImpacts(pending.path, pending.plan.localId);
    const blockingCount = pending.plan.impacts.length + external.length;
    if (blockingCount) {
      throw new Error(
        `Cannot apply ${pending.label}: ${blockingCount} dependent model reference${blockingCount === 1 ? "" : "s"} still target this occurrence.`,
      );
    }
    const blockingFindings = pending.plan.findings.filter((finding) => finding.severity === "error");
    if (blockingFindings.length) {
      throw new Error(
        `Cannot apply ${pending.label}: ${blockingFindings.length} blocking Local Model finding${blockingFindings.length === 1 ? "" : "s"}.`,
      );
    }
    await this.transactions.apply(transactionId, {
      apply: async () => this.applyGuarded(pending.path, pending.plan.before, pending.plan.after, pending.label),
    });
    this.pendingDeletes.delete(transactionId);
  }

  cancelLocalDelete(transactionId: string): EditTransaction {
    this.requirePendingDelete(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pendingDeletes.delete(transactionId);
    return cancelled;
  }

  private requirePendingDelete(transactionId: string): PendingLocalDelete {
    const pending = this.pendingDeletes.get(transactionId);
    if (!pending) throw new Error(`Structural Local Model delete transaction ${transactionId} does not exist.`);
    return pending;
  }

  private async applyGuarded(
    path: string,
    before: string,
    after: string,
    label: string,
    semanticGuard?: () => Promise<void>,
  ): Promise<AppliedEdit> {
    if (semanticGuard) await semanticGuard();
    const current = await this.store.read(path);
    if (current !== before) {
      throw new Error(`${path} changed while "${label}" was being prepared. Reopen the context and try again.`);
    }
    await this.store.write(path, after);

    return {
      undo: async () => {
        const latest = await this.store.read(path);
        if (latest !== after) throw new Error(`${path} changed after "${label}".`);
        await this.store.write(path, before);
      },
      redo: async () => {
        if (semanticGuard) await semanticGuard();
        const latest = await this.store.read(path);
        if (latest !== before) throw new Error(`${path} changed after undoing "${label}".`);
        await this.store.write(path, after);
      },
    };
  }
}

export function localPatchRef(ownerUid: string, plan: Pick<PlannedLocalEdit, "kind" | "localId">): ModelRef {
  return localRef(ownerUid, plan.kind, plan.localId);
}
