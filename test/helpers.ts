import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { parseSchema, type Schema } from "../src/core/schema";
import { ModelIndex, type NoteRecord } from "../src/core/model";

export function fixtureSchema(): Schema {
  const read = (f: string) => parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
  return parseSchema(read("relationships.yaml"), read("element-types.yaml"));
}

export function note(path: string, type: string | undefined, fields: Record<string, string[]> = {}): NoteRecord {
  return { path, name: path.replace(/\.md$/, ""), type, fields: new Map(Object.entries(fields)), unresolved: 0 };
}

export function indexOf(schema: Schema, notes: NoteRecord[]): ModelIndex {
  const i = new ModelIndex(schema);
  for (const n of notes) i.upsert(n);
  return i;
}
