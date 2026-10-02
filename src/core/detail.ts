/**
 * Pure helpers for the note detail popup (WB-099): splitting a note into properties and body, reading
 * the position Obsidian gives a Canvas card, and matching that card to a node of the canvas file.
 */

/** The note text without its leading YAML properties block. */
export function bodyOf(text: string, frontmatterEnd?: number): string {
  if (typeof frontmatterEnd === "number" && frontmatterEnd > 0 && frontmatterEnd <= text.length) return text.slice(frontmatterEnd).replace(/^\s*\n/, "");
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return (m ? text.slice(m[0].length) : text).replace(/^\s*\n/, "");
}

/** `translate(12px, -40.5px)` from a Canvas card's inline style. */
export function parseTranslate(style: string | null | undefined): { x: number; y: number } | null {
  const m = /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(style ?? "");
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

export interface CanvasNodeJson {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  file?: string;
  text?: string;
}

/** The canvas-file node at a position (within a pixel), used when Obsidian's own node objects are not reachable. */
export function nodeAt(nodes: CanvasNodeJson[], x: number, y: number): CanvasNodeJson | undefined {
  return nodes.find((n) => Math.abs(n.x - x) < 1 && Math.abs(n.y - y) < 1);
}

/** The name an undefined card (WB-092) stands for, from its text `**name**\n*undefined*`. */
export function undefinedName(text: string | undefined): string | null {
  if (!text || !/\*undefined\*\s*$/.test(text)) return null;
  const m = /^\*\*([\s\S]*?)\*\*/.exec(text);
  return m ? m[1] : null;
}

export interface PropertyRow {
  key: string;
  /** Distinct entries in the row. */
  count: number;
  /** Plain text and note links in order, so the popup can make the links clickable. */
  parts: Array<{ text: string; link?: string }>;
}

function linkParts(item: unknown): PropertyRow["parts"] {
  const s = typeof item === "object" ? JSON.stringify(item) : String(item);
  const parts: PropertyRow["parts"] = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index) });
    parts.push({ text: (m[2] ?? m[1]).trim(), link: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ text: s.slice(last) });
  return parts;
}

function rowsFrom(fm: Record<string, unknown> | null | undefined, include: (key: string) => boolean, collapse: boolean, keepEmpty = false): PropertyRow[] {
  if (!fm) return [];
  const rows: PropertyRow[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (key === "position" || !include(key)) continue;
    let items = (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== undefined && v !== "");
    // A note listed several times is one entry with explicit duplicate-source evidence. This is not engineering quantity.
    const counts = new Map<string, number>();
    if (collapse) {
      for (const v of items) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
      items = [...new Set(items.map(String))];
    }
    const parts: PropertyRow["parts"] = [];
    items.forEach((item, i) => {
      if (i > 0) parts.push({ text: ", " });
      parts.push(...linkParts(item));
      const n = counts.get(String(item)) ?? 1;
      if (n > 1) parts.push({ text: ` (duplicate ×${n})` });
    });
    if (parts.length || keepEmpty) rows.push({ key, parts, count: items.length });
  }
  return rows;
}

/** One row per property, skipping some (empty ones too unless `keepEmpty`, which editing needs): arrays joined with commas, `[[note]]` and `[[note|alias]]` split out as links. */
export function propertyRows(fm: Record<string, unknown> | null | undefined, skip: ReadonlySet<string> = new Set(), keepEmpty = false): PropertyRow[] {
  return rowsFrom(fm, (k) => !skip.has(k), false, keepEmpty);
}

/** One row per relationship field. Repeated identical targets are collapsed for display and labeled as duplicate evidence, never quantity. */
export function relationshipRows(fm: Record<string, unknown> | null | undefined, fields: ReadonlySet<string>): PropertyRow[] {
  return rowsFrom(fm, (k) => fields.has(k), true);
}
