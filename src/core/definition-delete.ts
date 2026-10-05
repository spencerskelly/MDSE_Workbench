import { parseDocument } from "yaml";
import { noteRef } from "./localmodel";
import { assessDefinitionDeletion, type DefinitionDeletionImpact, type DefinitionDeletionAssessment } from "./definition-lifecycle";
import { TransactionManager, type EditTransaction } from "./transaction";

export interface DefinitionDeleteStore {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  create(path: string, text: string): Promise<void>;
}

export interface StagedDefinitionDelete {
  transaction: EditTransaction;
  path: string;
  uid: string;
  impact: DefinitionDeletionAssessment;
}

interface PendingDefinitionDelete {
  path: string;
  uid: string;
  before: string;
  label: string;
  impact: DefinitionDeletionAssessment;
}

export class DefinitionDeletionService {
  private sequence = 0;
  private readonly pending = new Map<string, PendingDefinitionDelete>();

  constructor(
    private readonly store: DefinitionDeleteStore,
    private readonly impactFor: (path: string) => Promise<DefinitionDeletionImpact>,
    private readonly transactions: TransactionManager,
    private readonly uidInUse?: (uid: string) => boolean,
  ) {}

  async stage(path: string, uid: string): Promise<StagedDefinitionDelete> {
    if (!(await this.store.exists(path))) throw new Error(`${path} does not exist.`);
    const before = await this.store.read(path);
    const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(before);
    if (!frontmatterMatch) throw new Error(`${path} must begin with YAML frontmatter.`);
    const doc = parseDocument(frontmatterMatch[1]);
    if (doc.errors.length) throw new Error(`${path} frontmatter is invalid YAML.`);
    const storedUid = String(doc.get("uid") ?? "").trim();
    if (!storedUid || storedUid !== uid) {
      throw new Error(`Cannot stage deletion of ${path}: expected uid ${uid}, found ${storedUid || "none"}.`);
    }
    const impact = assessDefinitionDeletion(await this.impactFor(path));
    const id = `definition-delete-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `delete definition ${path}`;

    this.transactions.begin(id, label, "structural");
    const transaction = this.transactions.add(id, {
      id: id + "-delete",
      label,
      changes: [{
        kind: "definition.delete",
        summary: label,
        refs: [noteRef(uid)],
        metadata: {
          path,
          noteUseCount: impact.noteUseCount,
          occurrenceUseCount: impact.occurrenceUseCount,
        },
      }],
    });

    this.pending.set(id, { path, uid, before, label, impact });
    return { transaction, path, uid, impact };
  }

  async stageAndReview(path: string, uid: string): Promise<StagedDefinitionDelete> {
    const staged = await this.stage(path, uid);
    return this.review(staged.transaction.id);
  }

  review(transactionId: string): StagedDefinitionDelete {
    const pending = this.requirePending(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      path: pending.path,
      uid: pending.uid,
      impact: pending.impact,
    };
  }

  async apply(transactionId: string): Promise<void> {
    const pending = this.requirePending(transactionId);

    const latestImpact = assessDefinitionDeletion(await this.impactFor(pending.path));
    if (!latestImpact.allowed) {
      throw new Error(
        `Cannot apply ${pending.label}: ${latestImpact.noteUseCount + latestImpact.occurrenceUseCount} active reference${latestImpact.noteUseCount + latestImpact.occurrenceUseCount === 1 ? "" : "s"} remain.`,
      );
    }
    if (!(await this.store.exists(pending.path))) throw new Error(`Cannot apply ${pending.label}: definition no longer exists.`);
    const current = await this.store.read(pending.path);
    if (current !== pending.before) throw new Error(`Cannot apply ${pending.label}: definition changed after Review.`);

    await this.transactions.apply(transactionId, {
      apply: async () => {
        const impact = assessDefinitionDeletion(await this.impactFor(pending.path));
        if (!impact.allowed) throw new Error(`Cannot apply ${pending.label}: active references appeared after Review.`);
        if (!(await this.store.exists(pending.path))) throw new Error(`${pending.path} no longer exists.`);
        const latest = await this.store.read(pending.path);
        if (latest !== pending.before) throw new Error(`${pending.path} changed after Review.`);
        await this.store.remove(pending.path);
        return {
          undo: async () => {
            if (await this.store.exists(pending.path)) throw new Error(`${pending.path} already exists; cannot restore deleted definition.`);
            if (this.uidInUse?.(pending.uid)) {
              throw new Error(`Cannot undo ${pending.label}: uid ${pending.uid} is now in use.`);
            }
            await this.store.create(pending.path, pending.before);
          },
          redo: async () => {
            const impactNow = assessDefinitionDeletion(await this.impactFor(pending.path));
            if (!impactNow.allowed) throw new Error(`Cannot redo ${pending.label}: active references exist.`);
            if (!(await this.store.exists(pending.path))) throw new Error(`${pending.path} no longer exists before redo.`);
            const restored = await this.store.read(pending.path);
            if (restored !== pending.before) throw new Error(`${pending.path} changed after undoing ${pending.label}.`);
            await this.store.remove(pending.path);
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

  private requirePending(transactionId: string): PendingDefinitionDelete {
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error(`Definition deletion transaction ${transactionId} does not exist.`);
    return pending;
  }
}
