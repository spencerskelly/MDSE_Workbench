import { localRef, type ModelRef } from "./localmodel";
import { planLocalRecordPatch, type LocalRecordPatch, type PlannedLocalEdit } from "./localmodel-edit";
import { TransactionManager, type AppliedEdit } from "./transaction";

export interface TextDocumentStore {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

export interface LocalPatchResult {
  changed: boolean;
  plan: PlannedLocalEdit;
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
