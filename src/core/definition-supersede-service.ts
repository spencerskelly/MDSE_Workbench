import { isSeq, parseDocument } from "yaml";
import { linkTarget } from "./frontmatter";
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

function frontmatter(text: string): { yaml: string; body: string; prefixLength: number } {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error("Definition note must begin with YAML frontmatter.");
  return { yaml: match[1], body: text.slice(match[0].length), prefixLength: match[0].length };
}

/**
 * Add one relationship without serializing unrelated frontmatter. Supersession is a two-field
 * structural edit; comments, property order, scalar quoting, blank lines and the note body must
 * remain byte-for-byte unchanged outside the relationship value being changed.
 */
function withRelationship(
  text: string,
  sourcePath: string,
  field: string,
  targetPath: string,
  resolve: (target: string, fromPath: string) => string | null,
  linkText: (targetPath: string, fromPath: string) => string,
): string {
  const parsed = frontmatter(text);
  const doc = parseDocument(parsed.yaml);
  if (doc.errors.length) throw new Error(`Definition frontmatter is invalid YAML: ${doc.errors[0]?.message ?? "parse error"}`);

  const link = `[[${linkText(targetPath, sourcePath)}]]`;
  const node = doc.get(field, true);
  if (node === undefined || node === null) {
    const addition = `${parsed.yaml.endsWith("\n") || parsed.yaml.length === 0 ? "" : "\n"}${field}:\n  - "${link}"`;
    return `---\n${parsed.yaml}${addition}\n---\n${parsed.body}`;
  }

  const nodeValue = (value: unknown): unknown => {
    if (typeof value === "object" && value !== null && "toJSON" in value) {
      const toJSON = (value as { toJSON?: () => unknown }).toJSON;
      if (typeof toJSON === "function") return toJSON.call(value);
    }
    return value;
  };
  const values = isSeq(node)
    ? node.items.map((item) => String(nodeValue(item) ?? ""))
    : [String(nodeValue(node) ?? "")];
  for (const value of values) {
    const target = linkTarget(value);
    if (!target) continue;
    const resolved = resolve(target, sourcePath);
    if (!resolved) {
      throw new Error(
        `Cannot safely update ${field}; existing relationship target "${target}" cannot be resolved from ${sourcePath}.`,
      );
    }
    if (resolved === targetPath) return text;
  }
  values.push(link);
  values.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const range = (node as { range?: [number, number, number?] }).range;
  if (!range) throw new Error(`Cannot safely update ${field}; YAML source range is unavailable.`);
  const replacement = values.length === 1
    ? `"${values[0]}"`
    : `\n${values.map((value) => `  - "${value}"`).join("\n")}`;
  const yaml = parsed.yaml.slice(0, range[0]) + replacement + parsed.yaml.slice(range[1]);
  return `---\n${yaml}\n---\n${parsed.body}`;
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
    private readonly resolve: (target: string, fromPath: string) => string | null,
    private readonly linkText: (targetPath: string, fromPath: string) => string,
    private readonly transactions: TransactionManager,
  ) {}

  async stage(request: DefinitionSupersessionRequest): Promise<StagedDefinitionSupersession> {
    if (!(await this.store.exists(request.replacedPath))) throw new Error(`${request.replacedPath} does not exist.`);
    if (!(await this.store.exists(request.replacementPath))) throw new Error(`${request.replacementPath} does not exist.`);

    const replacedBefore = await this.store.read(request.replacedPath);
    const replacementBefore = await this.store.read(request.replacementPath);
    const sourceSemantics = (text: string, path: string): { uid: string; type: string; status: string | null } => {
      const parsed = frontmatter(text);
      const doc = parseDocument(parsed.yaml);
      if (doc.errors.length) throw new Error(`${path} frontmatter is invalid YAML.`);
      const uid = String(doc.get("uid") ?? "").trim();
      const type = String(doc.get("type") ?? "").trim();
      const rawStatus = doc.get("status");
      const status = rawStatus === undefined || rawStatus === null ? null : String(rawStatus).trim();
      return { uid, type, status };
    };
    const replacedSource = sourceSemantics(replacedBefore, request.replacedPath);
    const replacedSourceUid = replacedSource.uid;
    if (!replacedSourceUid || replacedSourceUid !== request.replacedUid) {
      throw new Error(`Cannot stage supersession: expected ${request.replacedPath} uid ${request.replacedUid}, found ${replacedSourceUid || "none"}.`);
    }
    const replacementSource = sourceSemantics(replacementBefore, request.replacementPath);
    const replacementSourceUid = replacementSource.uid;
    if (!replacementSourceUid || replacementSourceUid !== request.replacementUid) {
      throw new Error(`Cannot stage supersession: expected ${request.replacementPath} uid ${request.replacementUid}, found ${replacementSourceUid || "none"}.`);
    }

    const impact = await this.impactFor(request.replacedPath);
    const plan = planDefinitionSupersession({
      replacedPath: request.replacedPath,
      replacedType: replacedSource.type,
      replacementPath: request.replacementPath,
      replacementType: replacementSource.type,
      replacementStatus: replacementSource.status,
      impact,
    });
    if (!plan.valid) throw new Error(plan.blockers.join(" "));

    const replacementAfter = withRelationship(
      replacementBefore, request.replacementPath, "supersedes", request.replacedPath, this.resolve, this.linkText,
    );
    const replacedAfter = withRelationship(
      replacedBefore, request.replacedPath, "supersededBy", request.replacementPath, this.resolve, this.linkText,
    );

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
            const latestImpact = await this.impactFor(pending.request.replacedPath);
            if (impactSignature(latestImpact) !== pending.impactSignature) {
              throw new Error(`Cannot redo ${pending.label}: dependent usage changed after Review.`);
            }
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
