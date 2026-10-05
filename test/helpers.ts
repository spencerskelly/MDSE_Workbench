import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { parseSchema, type Schema } from "../src/core/schema";
import { ModelIndex, type NoteRecord } from "../src/core/model";

function schemaFixture(relationships: string, elements: string): Schema {
  const read = (f: string) => parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
  return parseSchema(read(relationships), read(elements));
}

/** Frozen pre-W-384 schema used by the broad historical regression suite. */
export function fixtureSchema(): Schema {
  return schemaFixture("relationships-legacy.yaml", "element-types-legacy.yaml");
}

/** Current governed schema; focused W-384 tests use this explicitly. */
export function currentFixtureSchema(): Schema {
  return schemaFixture("relationships.yaml", "element-types.yaml");
}

export function note(path: string, type: string | undefined, fields: Record<string, string[]> = {}): NoteRecord {
  return { path, name: path.replace(/\.md$/, ""), type, fields: new Map(Object.entries(fields)), unresolved: 0 };
}

export function indexOf(schema: Schema, notes: NoteRecord[]): ModelIndex {
  const i = new ModelIndex(schema);
  for (const n of notes) i.upsert(n);
  return i;
}
