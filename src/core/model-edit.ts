import { localRef, type ModelRef } from "./localmodel";
import { planLocalRecordCreate, planLocalRecordPatch, type LocalRecordPatch, type NewLocalRecord, type PlannedLocalEdit } from "./localmodel-edit";
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

interface PendingLocalCreate {
  path: string;
  plan: PlannedLocalEdit;
  label: string;
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

  constructor(
    private readonly store: TextDocumentStore,
    private readonly ownerUid: (path: string) => string | null,
    private readonly transactions: TransactionManager,
  ) {}

  async patchLocalRecord(path: string, localId: string, patch: LocalRecordPatch): Promise<LocalPatchResult> {
    const before = await this.store.read(path);
    const plan = planLocalRecordPatch(before, localId, patch);
    if (!plan.changed) return { changed: false, plan };

    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
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

  /**
   * Stage creation of one Local Model record. Planning and validation happen now, but the vault is
   * untouched until applyLocalCreate(). This is the first structural Review / Apply / Cancel path.
   */
  async stageLocalRecordCreate(path: string, input: NewLocalRecord): Promise<StagedLocalCreate> {
    const before = await this.store.read(path);
    const plan = planLocalRecordCreate(before, input);
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);

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

  private async applyGuarded(path: string, before: string, after: string, label: string): Promise<AppliedEdit> {
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
