import { parseDocument, stringify } from "yaml";
import { noteRef } from "./localmodel";
import type { DefinitionDeletionImpact } from "./definition-lifecycle";
import { planDefinitionSupersession, type DefinitionSupersessionPlan } from "./definition-supersede";
import { TransactionManager, type EditTransaction } from "./transaction";

export interface DefinitionSupersessionStore {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

export interface DefinitionSupersessionRequest {
  replacedPath: string;
  replacedUid: string;
  replacedType: string;
  replacementPath: string;
  replacementUid: string;
  replacementType: string;
  replacementStatus?: string | null;
}

export interface StagedDefinitionSupersession {
  transaction: EditTransaction;
  plan: DefinitionSupersessionPlan;
}

interface PendingDefinitionSupersession {
  request: DefinitionSupersessionRequest;
  plan: DefinitionSupersessionPlan;
  replacedBefore: string;
  replacementBefore: string;
  replacedAfter: string;
  replacementAfter: string;
  impactSignature: string;
  label: string;
}

function frontmatter(text: string): { doc: ReturnType<typeof parseDocument>; body: string } {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error("Definition note must begin with YAML frontmatter.");
  return { doc: parseDocument(match[1]), body: text.slice(match[0].length) };
}

function withRelationship(text: string, field: string, targetPath: string): string {
  const { doc, body } = frontmatter(text);
  const existing = doc.get(field);
  const link = `[[${targetPath.replace(/\.md$/i, "")}]]`;
  const values = Array.isArray(existing)
    ? existing.map((value) => String(value))
    : existing === undefined || existing === null || existing === ""
      ? []
      : [String(existing)];
  if (!values.some((value) => value === link)) values.push(link);
  values.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  doc.set(field, values);
  const yaml = stringify(doc.toJS()).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

function impactSignature(impact: DefinitionDeletionImpact): string {
  const note = impact.noteUses
    .map((use) => `${use.fromPath}|${use.field}`)
    .sort()
    .join("\n");
  const occurrence = impact.occurrenceUses
    .map((use) => `${use.ownerPath}|${use.kind}|${use.identifier}|${use.localId}`)
    .sort()
    .join("\n");
  return `${note}\n--\n${occurrence}`;
}

/**
 * Governed structural supersession transaction.
 *
 * Apply writes only the replacement relationship pair: replacement.supersedes -> replaced and
 * replaced.supersededBy -> replacement. Current dependents are never rewritten. Their complete
 * inventory is reviewed and must remain unchanged between Review and Apply.
 */
export class DefinitionSupersessionService {
  private sequence = 0;
  private readonly pending = new Map<string, PendingDefinitionSupersession>();

  constructor(
    private readonly store: DefinitionSupersessionStore,
    private readonly impactFor: (path: string) => Promise<DefinitionDeletionImpact>,
    private readonly transactions: TransactionManager,
  ) {}

  async stage(request: DefinitionSupersessionRequest): Promise<StagedDefinitionSupersession> {
    if (!(await this.store.exists(request.replacedPath))) throw new Error(`${request.replacedPath} does not exist.`);
    if (!(await this.store.exists(request.replacementPath))) throw new Error(`${request.replacementPath} does not exist.`);

    const impact = await this.impactFor(request.replacedPath);
    const plan = planDefinitionSupersession({
      replacedPath: request.replacedPath,
      replacedType: request.replacedType,
      replacementPath: request.replacementPath,
      replacementType: request.replacementType,
      replacementStatus: request.replacementStatus,
      impact,
    });
    if (!plan.valid) throw new Error(plan.blockers.join(" "));

    const replacedBefore = await this.store.read(request.replacedPath);
    const replacementBefore = await this.store.read(request.replacementPath);
    const replacementAfter = withRelationship(replacementBefore, "supersedes", request.replacedPath);
    const replacedAfter = withRelationship(replacedBefore, "supersededBy", request.replacementPath);

    const id = `definition-supersede-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `supersede ${request.replacedPath} with ${request.replacementPath}`;
    this.transactions.begin(id, label, "structural");
    const transaction = this.transactions.add(id, {
      id: id + "-relationship",
      label,
      changes: [{
        kind: "definition.supersede",
        summary: label,
        refs: [noteRef(request.replacementUid), noteRef(request.replacedUid)],
        metadata: {
          replacedPath: request.replacedPath,
          replacementPath: request.replacementPath,
          migrationCandidates: plan.migrationCandidates.length,
          rewritesReferences: false,
        },
      }],
    });

    this.pending.set(id, {
      request,
      plan,
      replacedBefore,
      replacementBefore,
      replacedAfter,
      replacementAfter,
      impactSignature: impactSignature(impact),
      label,
    });
    return { transaction, plan };
  }

  async stageAndReview(request: DefinitionSupersessionRequest): Promise<StagedDefinitionSupersession> {
    const staged = await this.stage(request);
    return this.review(staged.transaction.id);
  }

  review(transactionId: string): StagedDefinitionSupersession {
    const pending = this.requirePending(transactionId);
    return { transaction: this.transactions.review(transactionId), plan: pending.plan };
  }

  async apply(transactionId: string): Promise<void> {
    const pending = this.requirePending(transactionId);
    const latestImpact = await this.impactFor(pending.request.replacedPath);
    if (impactSignature(latestImpact) !== pending.impactSignature) {
      throw new Error("Dependent usage changed after Review. Reopen supersession review before Apply.");
    }
    if (!(await this.store.exists(pending.request.replacedPath)) || !(await this.store.exists(pending.request.replacementPath))) {
      throw new Error("One of the supersession definitions no longer exists.");
    }
    if (await this.store.read(pending.request.replacedPath) !== pending.replacedBefore) {
      throw new Error(`${pending.request.replacedPath} changed after Review.`);
    }
    if (await this.store.read(pending.request.replacementPath) !== pending.replacementBefore) {
      throw new Error(`${pending.request.replacementPath} changed after Review.`);
    }

    await this.transactions.apply(transactionId, {
      apply: async () => {
        const latest = await this.impactFor(pending.request.replacedPath);
        if (impactSignature(latest) !== pending.impactSignature) {
          throw new Error("Dependent usage changed after Review.");
        }
        await this.store.write(pending.request.replacementPath, pending.replacementAfter);
        try {
          await this.store.write(pending.request.replacedPath, pending.replacedAfter);
        } catch (error) {
          await this.store.write(pending.request.replacementPath, pending.replacementBefore);
          throw error;
        }
        return {
          undo: async () => {
            if (await this.store.read(pending.request.replacementPath) !== pending.replacementAfter) throw new Error(`${pending.request.replacementPath} changed after supersession.`);
            if (await this.store.read(pending.request.replacedPath) !== pending.replacedAfter) throw new Error(`${pending.request.replacedPath} changed after supersession.`);
            await this.store.write(pending.request.replacementPath, pending.replacementBefore);
            await this.store.write(pending.request.replacedPath, pending.replacedBefore);
          },
          redo: async () => {
            if (await this.store.read(pending.request.replacementPath) !== pending.replacementBefore) throw new Error(`${pending.request.replacementPath} changed after undoing supersession.`);
            if (await this.store.read(pending.request.replacedPath) !== pending.replacedBefore) throw new Error(`${pending.request.replacedPath} changed after undoing supersession.`);
            await this.store.write(pending.request.replacementPath, pending.replacementAfter);
            try {
              await this.store.write(pending.request.replacedPath, pending.replacedAfter);
            } catch (error) {
              await this.store.write(pending.request.replacementPath, pending.replacementBefore);
              throw error;
            }
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

  private requirePending(transactionId: string): PendingDefinitionSupersession {
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error(`Definition supersession transaction ${transactionId} does not exist.`);
    return pending;
  }
}
