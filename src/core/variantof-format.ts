/** Read-only raw frontmatter shape check for single-target variantOf. */
export function variantOfFormatError(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return "variantOf must be a single wikilink scalar, not a YAML sequence.";
  if (typeof value !== "string") return "variantOf must be a wikilink string.";
  const text = value.trim();
  if (!/^\[\[[^\[\]\r\n|#]+(?:\|[^\[\]\r\n]*)?\]\]$/.test(text))
    return "variantOf must contain exactly one note-level [[Target]] link.";
  return null;
}

/** The metadata-cache boundary: use the raw frontmatter object, not frontmatterLinks. */
export function variantOfMetadataFinding(frontmatter: Record<string, unknown> | null | undefined): string | undefined {
  return variantOfFormatError(frontmatter?.variantOf) ?? undefined;
}
