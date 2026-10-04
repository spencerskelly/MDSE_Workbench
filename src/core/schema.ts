/**
 * Schema loading. Workbench never embeds model rules (WB-001, WB-071): everything here
 * is read from the vault's `relationships.yaml` and `element-types.yaml`.
 * Pure TypeScript with no Obsidian or Node imports, so it runs in tests and on mobile (WB-087).
 */

export type Endpoint = "any" | string[];
export type RelationshipKind = "paired" | "temporary" | "symmetric" | "oneWay";

export interface RelationshipDef {
  /** The field written on the owner-side note. For symmetric fields, written on both notes. */
  field: string;
  /** Generated field on the other note (paired and temporary pairs only). */
  inverse?: string;
  kind: RelationshipKind;
  from: Endpoint;
  to: Endpoint;
  sameClass: boolean;
  excludePairs: Array<[string, string]>;
  /** Every link is a Review finding until replaced (W-288: tracesTo). */
  provisional: boolean;
  /** Temporary in stage 1 (hasClassifier, equals). */
  temporary: boolean;
  /** Position in relationships.yaml, used for property order (W-126). */
  order: number;
}

export interface ElementClass {
  name: string;
  prefix?: string;
  subtypes: string[];
}

export interface Schema {
  relationshipsVersion: string;
  elementTypesVersion: string;
  classes: ElementClass[];
  classNames: Set<string>;
  commonProperties: string[];
  /** Sparse governed frontmatter properties declared by element-types.yaml; omitted when default. */
  optionalProperties: string[];
  translatedOnlyProperties: string[];
  relationships: RelationshipDef[];
  /** Forward (or symmetric/one-way) field name → definition. */
  byField: Map<string, RelationshipDef>;
  /** Inverse field name → definition of its forward pair. */
  byInverse: Map<string, RelationshipDef>;
  /** Problems found while reading; empty when the schema is usable as-is. */
  warnings: string[];
}

/** Lowest schema versions this build understands (WB-069). Endpoint rules arrived in 1.25. */
export const MIN_RELATIONSHIPS_VERSION = "1.25";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function endpoint(v: unknown, where: string, warnings: string[]): Endpoint {
  if (v === undefined) return "any"; // no rule written: not restricted (W-277)
  if (v === "any") return "any";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  warnings.push(`${where}: endpoint is neither "any" nor a list of classes; treated as any.`);
  return "any";
}

function pairs(v: unknown, where: string, warnings: string[]): Array<[string, string]> {
  if (v === undefined) return [];
  if (Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "string"))) {
    return v as Array<[string, string]>;
  }
  warnings.push(`${where}: excludePairs is not a list of [from, to] pairs; ignored.`);
  return [];
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function parseSchema(relationshipsYaml: unknown, elementTypesYaml: unknown): Schema {
  const warnings: string[] = [];
  if (!isObj(relationshipsYaml)) throw new Error("relationships.yaml did not parse to a mapping.");
  if (!isObj(elementTypesYaml)) throw new Error("element-types.yaml did not parse to a mapping.");

  const rels: RelationshipDef[] = [];
  let order = 0;
  const add = (raw: unknown, kind: RelationshipKind, section: string) => {
    if (!isObj(raw)) {
      warnings.push(`${section}: an entry is not a mapping; skipped.`);
      return;
    }
    const field = (kind === "paired" || kind === "temporary" ? raw.forward : raw.field) as unknown;
    if (typeof field !== "string") {
      warnings.push(`${section}: an entry has no field name; skipped.`);
      return;
    }
    const where = `${section}.${field}`;
    const between = kind === "symmetric" ? endpoint(raw.between, where, warnings) : undefined;
    rels.push({
      field,
      inverse: typeof raw.inverse === "string" ? raw.inverse : undefined,
      kind,
      from: between ?? endpoint(raw.from, where, warnings),
      to: between ?? endpoint(raw.to, where, warnings),
      sameClass: raw.sameClass === true,
      excludePairs: pairs(raw.excludePairs, where, warnings),
      provisional: raw.provisional === true,
      temporary: kind === "temporary" || raw.temporary === true,
      order: order++,
    });
  };

  const section = (name: string, kind: RelationshipKind) => {
    const list = relationshipsYaml[name];
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      warnings.push(`relationships.yaml: "${name}" is not a list; skipped.`);
      return;
    }
    for (const raw of list) {
      // Older files listed one-way fields as plain names (before W-280).
      add(kind === "oneWay" && typeof raw === "string" ? { field: raw } : raw, kind, name);
    }
  };
  section("paired", "paired");
  section("temporaryPairs", "temporary");
  section("symmetric", "symmetric");
  section("oneWay", "oneWay");

  const byField = new Map<string, RelationshipDef>();
  const byInverse = new Map<string, RelationshipDef>();
  for (const r of rels) {
    if (byField.has(r.field)) warnings.push(`relationships.yaml: field "${r.field}" is listed twice.`);
    byField.set(r.field, r);
    if (r.inverse) byInverse.set(r.inverse, r);
  }

  const rawClasses = elementTypesYaml.classes;
  const classes: ElementClass[] = Array.isArray(rawClasses)
    ? rawClasses.filter(isObj).flatMap((c) =>
        typeof c.name === "string"
          ? [{
              name: c.name,
              prefix: typeof c.prefix === "string" ? c.prefix : undefined,
              subtypes: Array.isArray(c.subtype) ? c.subtype.filter((s): s is string => typeof s === "string") : [],
            }]
          : [],
      )
    : [];
  if (classes.length === 0) warnings.push("element-types.yaml: no classes found.");
  const classNames = new Set(classes.map((c) => c.name));

  // Endpoint rules must name real classes.
  for (const r of rels) {
    for (const side of [r.from, r.to]) {
      if (side === "any") continue;
      for (const c of side) {
        if (!classNames.has(c)) warnings.push(`relationships.yaml: "${r.field}" names unknown class "${c}".`);
      }
    }
  }

  const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const relationshipsVersion = String(relationshipsYaml.schemaVersion ?? "0");
  if (compareVersions(relationshipsVersion, MIN_RELATIONSHIPS_VERSION) < 0) {
    warnings.push(
      `relationships.yaml is version ${relationshipsVersion}; this Workbench needs ${MIN_RELATIONSHIPS_VERSION} or later. Editing is disabled.`,
    );
  }

  return {
    relationshipsVersion,
    elementTypesVersion: String(elementTypesYaml.schemaVersion ?? "0"),
    classes,
    classNames,
    commonProperties: strList(elementTypesYaml.commonProperties),
    optionalProperties: Array.isArray(elementTypesYaml.optionalProperties)
      ? elementTypesYaml.optionalProperties.flatMap((v) => {
          if (typeof v === "string") return [v];
          if (isObj(v) && typeof v.name === "string") return [v.name];
          return [];
        })
      : [],
    translatedOnlyProperties: strList(elementTypesYaml.translatedOnlyProperties),
    relationships: rels,
    byField,
    byInverse,
    warnings,
  };
}

/** True when the schema is too old or broken for safe edits (WB-069). */
export function editingBlocked(schema: Schema): boolean {
  return compareVersions(schema.relationshipsVersion, MIN_RELATIONSHIPS_VERSION) < 0;
}


/**
 * Deterministic semantic fingerprint for cache compatibility (W-343).
 * It intentionally derives from the parsed rules, not YAML bytes, so comments/formatting do
 * not invalidate the cache while any rule/class/property change does.
 */
export function schemaSignature(schema: Schema): string {
  const endpoint = (v: Endpoint) => v === "any" ? "any" : v.join(",");
  const rows = [
    `relationshipsVersion=${schema.relationshipsVersion}`,
    `elementTypesVersion=${schema.elementTypesVersion}`,
    `common=${schema.commonProperties.join(",")}`,
    `optional=${schema.optionalProperties.join(",")}`,
    `translatedOnly=${schema.translatedOnlyProperties.join(",")}`,
    ...schema.classes.map((c) => `class|${c.name}|${c.prefix ?? ""}|${c.subtypes.join(",")}`),
    ...schema.relationships.map((r) =>
      [
        "rel", r.order, r.field, r.inverse ?? "", r.kind,
        endpoint(r.from), endpoint(r.to),
        r.sameClass ? "1" : "0",
        r.excludePairs.map((p) => p.join(">")).join(","),
        r.provisional ? "1" : "0",
        r.temporary ? "1" : "0",
      ].join("|"),
    ),
  ].join("\n");
  let h = 2166136261;
  for (const ch of rows) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
