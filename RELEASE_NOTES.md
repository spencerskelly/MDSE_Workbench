Pilot build of the MDSE Workbench plugin for Obsidian. Read-mostly, with a governed editing path; not yet piloted with engineers.

**What it does**
- **Review:** a screen with five finding categories (provisional relationships, missing inverses, inverses with no forward link, off-rule links, broken references), search and filters, a finding window with Previous and Next, **Replace relationship**, and **Write missing inverse** where the link itself follows its endpoint rule.
- **Views:** eleven generated Canvas views from a note (Structure, Functional, Requirements, Where Used, Interfaces, Verification, Design, Scenario, Behavior, Failure and risk, Evidence), each bounded (12 children per note, 80 notes), with arrows in the stored direction, a relationship label and a quantity on every link, undefined cards for missing notes, and a stale-view check. **Explore view of current note…** lists the views that fit the note.
- **Note details popup:** click a note on a generated view to see its properties, relationships and text without opening it; **View…** starts another view from it; **Edit** changes the text, the ordinary properties and the relationships through the relationship service (endpoint rules, inverses, one Undo for every edit).
- **Relationships from a note:** **Relate current note to another note** and **Undo last Workbench edit**.

**Install:** in a test vault, create `.obsidian/plugins/mdse-workbench/`, put `main.js`, `manifest.json` and `styles.css` from this release in it, then turn on MDSE Workbench under Settings → Community plugins. After updating the files, turn the plugin off and on.

**Known limits:** clicking a card and the Canvas selection menu rely on Canvas internals that Obsidian does not document, so check them on each Obsidian version. Property and relationship edits go through Obsidian's own property writer, which rewrites a note's whole properties block in its own style the first time a note is edited. Create (M2) is not built. Needs a vault with `relationships.yaml` schema 1.25 or later (1.35 for `hasState`).

`synthetic-vault-60k.zip` is a generated 60,000-note vault with the schema in place, for measuring Workbench before a real vault exists. Unzip it, open the `vault` folder as a vault, install the plugin there, and run **MDSE Workbench: Show diagnostics**.
