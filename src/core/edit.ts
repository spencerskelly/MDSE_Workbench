/**
 * Pure rules for editing a note from the details popup (WB-101): which properties may be edited and how,
 * how a list or number is read back from text, and how the note text is replaced without touching the
 * properties block.
 */
import { bodyOf } from "./detail";

/** Never edited by hand: the class, the human id and the unique id (AI_INSTRUCTIONS, W-18). */
export const PROTECTED_PROPERTIES: ReadonlySet<string> = new Set(["type", "id", "uid"]);

export type PropertyEditor =
  | { kind: "readonly"; why: string }
  | { kind: "text" }
  /** Free text with the values used so far offered as suggestions (no complete list exists yet). */
  | { kind: "status"; suggestions: string[] }
  | { kind: "select"; options: string[] }
  | { kind: "list" };

export interface EditContext {
  relationFields: ReadonlySet<string>;
  /** Properties the translator writes (for example `eaType`). */
  translatedOnly: ReadonlySet<string>;
  /** Allowed subtypes of the note's class; null when the class is unknown. */
  subtypes: string[] | null;
}

const scalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

export function propertyEditor(key: string, value: unknown, ctx: EditContext): PropertyEditor {
  if (PROTECTED_PROPERTIES.has(key)) return { kind: "readonly", why: "type, id and uid are never edited by hand" };
  if (ctx.relationFields.has(key)) return { kind: "readonly", why: "relationships are edited under Relationships" };
  if (ctx.translatedOnly.has(key)) return { kind: "readonly", why: "written by the translator" };
  if (key === "subtype") {
    if (!ctx.subtypes || ctx.subtypes.length === 0) return { kind: "readonly", why: "this class has no subtypes" };
    const current = typeof value === "string" && value !== "" && !ctx.subtypes.includes(value) ? [value] : [];
    return { kind: "select", options: ["", ...ctx.subtypes, ...current] };
  }
  if (key === "status") return { kind: "status", suggestions: ["Draft", "Active", "Retired"] };
  if (Array.isArray(value)) return value.every(scalar) ? { kind: "list" } : { kind: "readonly", why: "not a simple list" };
  if (scalar(value) || value === undefined) return { kind: "text" };
  return { kind: "readonly", why: "not a simple value" };
}

/** `a, b ,, c, a` → `["a", "b", "c"]`. */
export function parseListInput(input: string): string[] {
  return [...new Set(input.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** Reads typed text back into the type the property already had (number, boolean) or a string. */
export function coerceValue(original: unknown, input: string): string | number | boolean {
  const t = input.trim();
  if (typeof original === "number" && t !== "" && !Number.isNaN(Number(t))) return Number(t);
  if (typeof original === "boolean" && (t === "true" || t === "false")) return t === "true";
  return t;
}

/** The text of a note with its body replaced; the properties block and the blank line after it stay exactly as they were. */
export function replaceBody(text: string, newBody: string): string {
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const head = fm ? fm[0] : "";
  const rest = text.slice(head.length);
  const lead = /^\s*\n/.exec(rest)?.[0] ?? "";
  return head + lead + newBody.replace(/^\s*\n/, "");
}

/** Is the body still what the popup loaded? Guards a save against changes made elsewhere in the meantime. */
export function bodyUnchanged(currentText: string, loadedBody: string): boolean {
  return bodyOf(currentText) === loadedBody;
}
