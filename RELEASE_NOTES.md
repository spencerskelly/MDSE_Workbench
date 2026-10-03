# 0.1.17

WB-106 keepability-gate build for MDSE v0.8. This completes the required read/navigation surface over the governed Local Model while keeping Markdown/YAML authoritative.

- **Occurrence-aware Structure.** Local part occurrences are shown as contextual derived cards with their native block link, reusable definition, multiplicity and usage. The definition stays a link; Workbench does not flatten the definition's internal structure into the occurrence.
- **Occurrence-aware Interfaces.** Object interface views show local endpoints, exposure/parent links, connections and connection-scoped flows. Port and Item Flow definitions can show the contextual occurrences that use them.
- **Occurrence-aware Where Used.** Reusable definitions now include Local Model occurrences across owner notes.
- **Occurrence-aware Requirements.** A Requirement that `appliesTo [[Owner#^local-id]]` resolves to that exact occurrence. The block-targeted relationship is no longer also treated as a note-to-note edge, so applicability to one part cannot silently become applicability to its whole owner note.
- **Canvas local records.** Local records render as derived text cards that link to their native Obsidian block IDs; no duplicate notes are created. Local occurrence data participates in stale-view signatures.
- **Read-only Local Model details.** Clicking a generated local-record card opens a Workbench details popup with owner, local ID, definition and contextual fields plus **Open owner** and **Open occurrence**. Structured Local Model editing remains deferred.
- **Review integration.** Local Model validation findings now appear as a sixth Review category alongside note-level model findings. They are read-only in this release.
- **Incremental Local Model index.** Workbench keeps parsed governed regions alongside the note index, reading bodies only for notes whose metadata indicates a Local Model region and updating changed notes without a whole-vault rescan.
- **Compatibility.** Reads Local Model 0.1 and 0.2; writes no Local Model records. Current Workbench fixtures exactly match relationships 1.35, element-types 1.17 and local-model 0.2.

**Still deferred:** structured Local Model editing, persisted named configurations, topology variation, model-number/product-code mapping, new local behavior occurrence kinds, and other W-314 configuration follow-on work.

# 0.1.16

Alignment build for importer v0.8.6 (W-324) and the first part of WB-106.

- **Links are written the way Obsidian writes them.** Relate, Replace and Write missing inverse used to write `[[File name]]` always. Where two notes share a name that link points at the wrong one. A link is now the file name when it is unique, otherwise the shortest unique path, and an existing link is matched by the note it resolves to, so a repeat or a removal no longer misses a note linked in the other form.
- **Local Model reader (WB-106, part 1).** Reads the governed `## Local Model` region of a note, schema 0.1 and 0.2: records (part, endpoint, connection, flow), native block IDs, same-note and cross-note block links, usage, `ModelRef` identity (note UID plus local block ID). 0.1 is read as standard usage and never rewritten; an unknown future schema leaves the text readable and structured use off.
- **Local Model findings.** New command **Check Local Model (write findings report)** reads every note that has a region, runs the WB-106 checks across the vault and writes `Local Model Findings.md` in the (git-ignored) views folder, grouped by finding code with links to the record. Checks: marker errors, unsupported schema, duplicate or malformed block IDs, identity-token collisions across note UIDs and records, broken same-note and cross-note block links, wrong link kinds, part and parent together, parent cycles, connection ends, flow roles, orphan flows, missing or incompatible definitions, usage values, usage on a connection or flow, a standard occurrence on an abstract definition, variant or option with no concrete candidate, specialization cycles, invalid `abstract`, and relationship fields that point at a block that has no record.
- **Candidates.** `subtypeOf` specialization candidates are derived transitively through abstract and concrete notes, concrete only, with cycle protection. Never stored.
- **Indexing.** `abstract` and block-link targets in relationship fields (`[[Note#^id]]`) are indexed.

**Not in 0.1.16 (WB-106 is not complete):** the Structure, Interfaces, Where Used and Requirements views do not yet show local occurrences; there is no Local Model popup (WB-105); the Review screen does not list Local Model findings (the report does). The release manifest keeps `wb106Version` empty until the views are done. Ordinary body editing stays refused on a note that has a governed region.

# 0.1.15

Safety/alignment build for the MDSE v0.8 contract. Repeated note-level relationship targets are no longer presented as engineering quantity, governed Local Model regions are protected from the ordinary body editor, and schema-defined sparse optional properties are ordered before relationship fields.

Pilot build of the MDSE Workbench plugin for Obsidian. Read-mostly, with a governed editing path; not yet piloted with engineers.

**What it does**
- **Review:** a screen with five finding categories (provisional relationships, missing inverses, inverses with no forward link, off-rule links, broken references), search and filters, a finding window with Previous and Next, **Replace relationship**, and **Write missing inverse** where the link itself follows its endpoint rule.
- **Views:** eleven generated Canvas views from a note (Structure, Functional, Requirements, Where Used, Interfaces, Verification, Design, Scenario, Behavior, Failure and risk, Evidence), each bounded (12 children per note, 80 notes), with arrows in the stored direction, a relationship label on every link; repeated identical targets are shown only as duplicate-source evidence, never engineering quantity, undefined cards for missing notes, and a stale-view check. **Explore view of current note…** lists the views that fit the note.
- **Note details popup:** click a note on a generated view to see its properties, relationships and text without opening it; **View…** starts another view from it; **Edit** changes the text, the ordinary properties and the relationships through the relationship service (endpoint rules, inverses, one Undo for every edit).
- **Relationships from a note:** **Relate current note to another note** and **Undo last Workbench edit**.

**Install:** in a test vault, create `.obsidian/plugins/mdse-workbench/`, put `main.js`, `manifest.json` and `styles.css` from this release in it, then turn on MDSE Workbench under Settings → Community plugins. After updating the files, turn the plugin off and on.

**Known limits:** clicking a card and the Canvas selection menu rely on Canvas internals that Obsidian does not document, so check them on each Obsidian version. Property and relationship edits go through Obsidian's own property writer, which rewrites a note's whole properties block in its own style the first time a note is edited. Create (M2) is not built. Needs a vault with `relationships.yaml` schema 1.25 or later (1.35 for `hasState`). **Occurrence-model safety:** 0.1.15 still does not index governed Local Model records, but it refuses ordinary body editing when a governed Local Model START marker is present. WB-106 remains required for Local Model 0.1/0.2 parsing, ModelRef identity, block-fragment resolution, occurrence-aware views and structured Local Model interaction.

`synthetic-vault-60k.zip` is a generated 60,000-note vault with the schema in place, for measuring Workbench before a real vault exists. Unzip it, open the `vault` folder as a vault, install the plugin there, and run **MDSE Workbench: Show diagnostics**.
