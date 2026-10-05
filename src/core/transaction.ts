import type { ModelRef } from "./localmodel";

export type EditScope = "atomic" | "structural";
export type EditSeverity = "error" | "warning";
export type TransactionStatus = "draft" | "reviewed" | "applied" | "cancelled";

export interface EditIssue {
  code: string;
  severity: EditSeverity;
  message: string;
  ref?: ModelRef;
  blocking?: boolean;
}

export interface SemanticChange {
  kind: string;
  summary: string;
  refs: ModelRef[];
  /** False only when safe semantic reversal cannot be guaranteed. */
  reversible?: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface EditOperation {
  id: string;
  label: string;
  changes: SemanticChange[];
}

export interface EditTransaction {
  id: string;
  label: string;
  scope: EditScope;
  status: TransactionStatus;
  operations: EditOperation[];
  issues: EditIssue[];
  createdAt: string;
}

export interface SemanticHistoryEntry {
  transactionId: string;
  label: string;
  scope: EditScope;
  appliedAt: string;
  changes: SemanticChange[];
  reversible: boolean;
}

export interface AppliedEdit {
  undo(): Promise<void>;
  /** Omit when redo cannot safely reproduce the applied operation. */
  redo?(): Promise<void>;
}

export interface EditExecutor {
  apply(transaction: Readonly<EditTransaction>): Promise<AppliedEdit>;
}

export type TransactionValidator = (transaction: Readonly<EditTransaction>) => EditIssue[];

interface HistoryState {
  entry: SemanticHistoryEntry;
  applied: AppliedEdit;
}

/**
 * Pure semantic transaction coordinator. It owns transaction state, validation, semantic history and
 * undo/redo orchestration; vault/file mutation stays behind EditExecutor (WB-114).
 */
export class TransactionManager {
  private readonly drafts = new Map<string, EditTransaction>();
  private readonly undoStack: HistoryState[] = [];
  private readonly redoStack: HistoryState[] = [];

  constructor(
    private readonly validators: readonly TransactionValidator[] = [],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  begin(id: string, label: string, scope: EditScope): EditTransaction {
    if (this.drafts.has(id)) throw new Error(`Transaction ${id} already exists.`);
    const tx: EditTransaction = { id, label, scope, status: "draft", operations: [], issues: [], createdAt: this.now() };
    tx.issues = this.validate(tx);
    this.drafts.set(id, tx);
    return this.snapshot(tx);
  }

  add(transactionId: string, operation: EditOperation): EditTransaction {
    const tx = this.requireDraft(transactionId);
    if (tx.operations.some((x) => x.id === operation.id)) throw new Error(`Operation ${operation.id} already exists in ${transactionId}.`);
    tx.operations.push(operation);
    tx.issues = this.validate(tx);
    return this.snapshot(tx);
  }

  replace(transactionId: string, operation: EditOperation): EditTransaction {
    const tx = this.requireDraft(transactionId);
    const i = tx.operations.findIndex((x) => x.id === operation.id);
    if (i < 0) throw new Error(`Operation ${operation.id} does not exist in ${transactionId}.`);
    tx.operations[i] = operation;
    tx.issues = this.validate(tx);
    return this.snapshot(tx);
  }

  remove(transactionId: string, operationId: string): EditTransaction {
    const tx = this.requireDraft(transactionId);
    tx.operations = tx.operations.filter((x) => x.id !== operationId);
    tx.issues = this.validate(tx);
    return this.snapshot(tx);
  }

  review(transactionId: string): EditTransaction {
    const tx = this.requireOpen(transactionId);
    tx.issues = this.validate(tx);
    tx.status = "reviewed";
    return this.snapshot(tx);
  }

  canApply(transactionId: string): boolean {
    const tx = this.requireOpen(transactionId);
    tx.issues = this.validate(tx);
    return (tx.scope === "atomic" || tx.status === "reviewed") && !tx.issues.some(isBlocking);
  }

  async apply(transactionId: string, executor: EditExecutor): Promise<SemanticHistoryEntry> {
    const tx = this.requireOpen(transactionId);
    if (tx.scope === "structural" && tx.status !== "reviewed") {
      throw new Error(`Structural transaction ${tx.label} must be reviewed before Apply.`);
    }
    tx.issues = this.validate(tx);
    const blocking = tx.issues.filter(isBlocking);
    if (blocking.length) throw new Error(`Transaction ${tx.label} has ${blocking.length} blocking validation issue${blocking.length === 1 ? "" : "s"}.`);
    if (!tx.operations.length) throw new Error(`Transaction ${tx.label} has no operations.`);

    const applied = await executor.apply(this.snapshot(tx));
    tx.status = "applied";
    const changes = tx.operations.flatMap((op) => op.changes);
    const entry: SemanticHistoryEntry = {
      transactionId: tx.id,
      label: tx.label,
      scope: tx.scope,
      appliedAt: this.now(),
      changes,
      reversible: changes.every((x) => x.reversible !== false),
    };
    this.undoStack.push({ entry, applied });
    this.redoStack.length = 0;
    this.drafts.delete(tx.id);
    return entry;
  }

  cancel(transactionId: string): EditTransaction {
    const tx = this.requireOpen(transactionId);
    tx.status = "cancelled";
    this.drafts.delete(transactionId);
    return this.snapshot(tx);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1].entry.reversible;
  }

  get canRedo(): boolean {
    const last = this.redoStack[this.redoStack.length - 1];
    return !!last && last.entry.reversible && !!last.applied.redo;
  }

  /**
   * Migration seam for mature writers that already performed a governed edit before the WB-114
   * coordinator existed. New planners should prefer begin/add/apply; existing writers register the
   * same guarded undo/redo action here so all Workbench edits share one chronological history.
   */
  recordApplied(
    transactionId: string,
    label: string,
    scope: EditScope,
    changes: SemanticChange[],
    applied: AppliedEdit,
  ): SemanticHistoryEntry {
    const entry: SemanticHistoryEntry = {
      transactionId,
      label,
      scope,
      appliedAt: this.now(),
      changes: changes.map((x) => ({ ...x, refs: [...x.refs] })),
      reversible: changes.every((x) => x.reversible !== false),
    };
    this.undoStack.push({ entry, applied });
    this.redoStack.length = 0;
    return { ...entry, changes: [...entry.changes] };
  }

  history(): SemanticHistoryEntry[] {
    return this.undoStack.map((x) => ({ ...x.entry, changes: [...x.entry.changes] }));
  }

  async undo(): Promise<SemanticHistoryEntry> {
    const state = this.undoStack[this.undoStack.length - 1];
    if (!state) throw new Error("Nothing to undo.");
    if (!state.entry.reversible) throw new Error(`Cannot undo ${state.entry.label}: it was marked non-reversible.`);
    await state.applied.undo();
    this.undoStack.pop();
    this.redoStack.push(state);
    return { ...state.entry, changes: [...state.entry.changes] };
  }

  async undoIfLatest(transactionId: string): Promise<SemanticHistoryEntry> {
    const state = this.undoStack[this.undoStack.length - 1];
    if (!state) throw new Error(`Cannot roll back ${transactionId}: semantic history is empty.`);
    if (state.entry.transactionId !== transactionId) {
      throw new Error(
        `Cannot roll back ${transactionId}: a newer semantic edit (${state.entry.label}) exists. Use normal Review/Undo rather than reverting through another edit.`,
      );
    }
    return this.undo();
  }

  async redo(): Promise<SemanticHistoryEntry> {
    const state = this.redoStack[this.redoStack.length - 1];
    if (!state) throw new Error("Nothing to redo.");
    if (!state.entry.reversible || !state.applied.redo) throw new Error(`Cannot redo ${state.entry.label}.`);
    await state.applied.redo();
    this.redoStack.pop();
    this.undoStack.push(state);
    return { ...state.entry, changes: [...state.entry.changes] };
  }

  private validate(tx: EditTransaction): EditIssue[] {
    return this.validators.flatMap((validator) => validator(this.snapshot(tx)));
  }

  private require(id: string): EditTransaction {
    const tx = this.drafts.get(id);
    if (!tx) throw new Error(`Transaction ${id} does not exist.`);
    return tx;
  }

  private requireDraft(id: string): EditTransaction {
    const tx = this.require(id);
    if (tx.status !== "draft") throw new Error(`Transaction ${id} is ${tx.status}, not draft.`);
    return tx;
  }

  private requireOpen(id: string): EditTransaction {
    const tx = this.require(id);
    if (tx.status !== "draft" && tx.status !== "reviewed") {
      throw new Error(`Transaction ${id} is ${tx.status}, not open.`);
    }
    return tx;
  }

  private snapshot(tx: EditTransaction): EditTransaction {
    return {
      ...tx,
      operations: tx.operations.map((op) => ({
        ...op,
        changes: op.changes.map((change) => ({ ...change, refs: [...change.refs] })),
      })),
      issues: tx.issues.map((issue) => ({ ...issue })),
    };
  }
}

export function isBlocking(issue: EditIssue): boolean {
  return issue.severity === "error" && issue.blocking !== false;
}
