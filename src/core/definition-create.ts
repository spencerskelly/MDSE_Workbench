import type { LocalKind } from "./localmodel";

const UID = /^\d{17}[A-Za-z]{13}$/;

export interface DefinitionCreationRequest {
  localKind: LocalKind;
  name: string;
  uid: string;
  /** Canonical vault-relative Markdown path chosen by the creation workflow. */
  path: string;
}

export interface PlannedDefinitionCreation {
  path: string;
  name: string;
  type: string;
  uid: string;
  text: string;
}

/**
 * Canonical reusable-definition class for a Local Model occurrence kind.
 *
 * This intentionally mirrors the compatibility rules used by Local Model validation. A
 * connection has no governed reusable-definition class today, so Workbench must not invent one.
 */
export function definitionTypeForLocalKind(kind: LocalKind): string | null {
  if (kind === "part") return "Object";
  if (kind === "endpoint") return "Port";
  if (kind === "flow") return "Item Flow";
  return null;
}

/**
 * Pure WB-106 planner for a new reusable definition note.
 *
 * Storage location and durable UID are supplied by the governed creation workflow. The planner
 * owns semantic compatibility and canonical Markdown shape only; it performs no vault I/O.
 */
export function planDefinitionCreation(request: DefinitionCreationRequest): PlannedDefinitionCreation {
  const name = request.name.trim();
  const path = request.path.trim();
  const uid = request.uid.trim();
  const type = definitionTypeForLocalKind(request.localKind);

  if (!type) {
    throw new Error(`Local Model ${request.localKind} occurrences do not have a governed reusable-definition class.`);
  }
  if (!name) throw new Error("Definition name is required.");
  if (!path || !path.toLowerCase().endsWith(".md")) throw new Error("Definition path must be a Markdown file path.");
  if (!UID.test(uid)) throw new Error("Definition uid must be the governed 30-character UTC timestamp + author suffix token.");

  const text = [
    "---",
    `type: ${type}`,
    `uid: ${uid}`,
    "---",
    "",
    `# ${name}`,
    "",
  ].join("\n");

  return { path, name, type, uid, text };
}


import { noteRef } from "./localmodel";
import { TransactionManager, type EditTransaction } from "./transaction";

export interface DefinitionDocumentStore {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  create(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface StagedDefinitionCreation {
  transaction: EditTransaction;
  plan: PlannedDefinitionCreation;
}

interface PendingDefinitionCreation {
  plan: PlannedDefinitionCreation;
  label: string;
}

/**
 * Governed reusable-definition creation service.
 *
 * Creation is structural: Stage -> Review -> Apply/Cancel. Apply rechecks both path and UID
 * availability. Undo removes only the exact note this transaction created; redo refuses to
 * overwrite a later file.
 */
export class DefinitionCreationService {
  private sequence = 0;
  private readonly pending = new Map<string, PendingDefinitionCreation>();

  constructor(
    private readonly store: DefinitionDocumentStore,
    private readonly uidInUse: (uid: string) => boolean,
    private readonly transactions: TransactionManager,
  ) {}

  stage(request: DefinitionCreationRequest): StagedDefinitionCreation {
    const plan = planDefinitionCreation(request);
    if (this.uidInUse(plan.uid)) throw new Error(`Definition uid ${plan.uid} is already in use.`);

    const id = `definition-create-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `create ${plan.type} definition ${plan.name}`;
    this.transactions.begin(id, label, "structural");
    const transaction = this.transactions.add(id, {
      id: id + "-create",
      label,
      changes: [{
        kind: "definition.create",
        summary: label,
        refs: [noteRef(plan.uid)],
        metadata: { path: plan.path, type: plan.type, uid: plan.uid, name: plan.name },
      }],
    });
    this.pending.set(id, { plan, label });
    return { transaction, plan };
  }

  stageAndReview(request: DefinitionCreationRequest): StagedDefinitionCreation {
    const staged = this.stage(request);
    return this.review(staged.transaction.id);
  }

  review(transactionId: string): StagedDefinitionCreation {
    const pending = this.requirePending(transactionId);
    return { transaction: this.transactions.review(transactionId), plan: pending.plan };
  }

  async apply(transactionId: string): Promise<void> {
    const pending = this.requirePending(transactionId);
    const { plan, label } = pending;
    if (this.uidInUse(plan.uid)) throw new Error(`Cannot apply ${label}: uid ${plan.uid} is now in use.`);
    if (await this.store.exists(plan.path)) throw new Error(`Cannot apply ${label}: ${plan.path} already exists.`);

    await this.transactions.apply(transactionId, {
      apply: async () => {
        if (this.uidInUse(plan.uid)) throw new Error(`Cannot apply ${label}: uid ${plan.uid} is now in use.`);
        if (await this.store.exists(plan.path)) throw new Error(`Cannot apply ${label}: ${plan.path} already exists.`);
        await this.store.create(plan.path, plan.text);
        return {
          undo: async () => {
            if (!(await this.store.exists(plan.path))) throw new Error(`${plan.path} no longer exists after "${label}".`);
            const current = await this.store.read(plan.path);
            if (current !== plan.text) throw new Error(`${plan.path} changed after "${label}".`);
            await this.store.remove(plan.path);
          },
          redo: async () => {
            if (await this.store.exists(plan.path)) throw new Error(`${plan.path} exists after undoing "${label}".`);
            if (this.uidInUse(plan.uid)) throw new Error(`Cannot redo ${label}: uid ${plan.uid} is in use.`);
            await this.store.create(plan.path, plan.text);
          },
        };
      },
    });
    this.pending.delete(transactionId);
  }

  cancel(transactionId: string): EditTransaction {
    this.requirePending(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pending.delete(transactionId);
    return cancelled;
  }

  private requirePending(transactionId: string): PendingDefinitionCreation {
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error(`Definition creation transaction ${transactionId} does not exist.`);
    return pending;
  }
}
