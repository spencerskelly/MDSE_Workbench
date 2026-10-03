# Workbench Test Sheet (plugin 0.1.16)

> **Occurrence-model safety note (W-298 / WB-105):** 0.1.15 still does not index Local Model records. It now refuses ordinary body editing when a governed Local Model START marker is present; WB-106 is still required for parsing/indexing and occurrence-aware views. This sheet remains a regression test for the pre-occurrence plugin; the next pilot sheet must use the synchronized importer/base output and the occurrence-aware Workbench build. W-319 defines 0.2 as canonical new output while Workbench must read 0.1 and 0.2. Parser tests must include missing, duplicate, nested and mismatched marker cases.

Run in `20260930`. About 50 minutes. The steps are ordered so the biggest unknowns come first; if a step fails, note it and carry on unless it says **stop**. Tick `[x]` on pass; write what happened next to a failure.

Counts below come from a run outside Obsidian on the same notes. Obsidian may differ by a note or two (it resolves duplicate note names its own way); a difference of more than a few is a finding.

## 0. Setup (2 min)
- [ ] Pull `20260930`. Settings → Community plugins: MDSE Workbench shows **0.1.16**. Turn it off and on.
- [ ] Open any Markdown note (commands in this sheet only appear while a note is the active tab, not while a canvas is).
- [ ] Wait until Workbench has finished indexing (a diagnostics run in step 1 says so).

## 1. It loads and sees the model (3 min)
- [ ] **Show diagnostics**: no error; Review counts as before: Missing inverses 5, Inverses with no forward link 6, Off-rule 240, Provisional 242, Unresolved ~7,184.
- [ ] **Check Canvas support**: look at the row **Card elements (note details popup)**. Write it here: ______ (this decides whether the popup click works the direct way or the fallback way).

## 2. The popup opens (3 min) — **stop here if nothing opens**
- [ ] Open `Cable - 2 twisted pair Strip and Strip`, run **Explore structure of current note**. A canvas opens; notice says **17 notes (12 undefined)**; a `+24 more` card.
- [ ] Click the cable card: a popup opens at the top right with its text. Click the `Wire - Strip and Strip` card: the popup changes to it.
- [ ] If nothing opens: open the developer console (Ctrl/Cmd+Shift+I), copy any red message, and send it with the Card elements row.

## 3. The eleven views (12 min)
Open each note, run the command (or **Explore view of current note…** and pick the view), compare the notice. Also check on every view: a relationship name on every link; arrows run the way the link is stored (an assembly points at its part, a verification at its requirement, an item flow's port at the flow); red appears only on undefined cards; **Check whether this view is current** says current.

| View | Note | Expect |
|---|---|---|
| Structure | `Cable - 2 twisted pair Strip and Strip` | 17 notes, 12 undefined, `hasPart (duplicate ×6)` and `(duplicate ×27)` |
| Functional | `Antenna - WiFi` | 3 notes |
| Functional | `Manage Communication w- LIN Bus` | 11 notes, +3 more, no requirements |
| Requirements | `2.4.6.19 Minimum EQ Minutes` | 15 notes, +26 more |
| Requirements | `Accept User Input` (a Function) | 13 notes, 4 undefined |
| Where Used | `Wire - Strip and Strip` | 14 notes, +5 more |
| Where Used | `Process Signal` | 57 notes, +22 more |
| Interfaces | `Product` | 32 notes, +19 more; `interfaces` links have **no arrowhead** |
| Interfaces | `iUser - AmbientLight` (a Port) | 14 notes, +4 more |
| Verification | `TP0004 - Battery Charge Test (Wired)` | 37 notes, +103 more |
| Design | `GSE Charger` | 80 notes, 15 undefined, "stopped at the 80-note limit" |
| Scenario | `View data from all chargers on tarmac` | 15 notes |
| Behavior | `Pre-Charge` (a State) | 17 notes |
| Failure and risk | `Wrong Configuration` (an Issue) | 3 notes |
| Evidence | `UL 486 A-B Table 9 Dielectric-withstand test sequence` | 14 notes, +24 more |

- [ ] All rows match (list any that do not): ______
- [ ] Cards: a name that wraps to two lines is not cut off.
- [ ] **Explore view of current note…** on a Requirement lists Requirements, Where Used, Verification, Failure and risk, Evidence (and not Interfaces, Scenario, Behavior).

## 4. The popup (8 min)
On the cable view:
- [ ] Open **Relationships** in the popup: `hasPart (2)`, the wire shows `(duplicate ×27)`, the jacket `(duplicate ×6)`, undefined ports are red and not clickable. **Properties** opens too.
- [ ] Click a link in the popup: it shows that note; **‹** goes back. **Open note** opens the note in a tab (the popup closes). Esc closes it.
- [ ] Drag a card, and shift-click two cards: the popup does **not** open.
- [ ] Click a red undefined card: the popup says it is undefined.
- [ ] **View…**: pick **Where Used** for the clicked card; a new canvas opens; the popup stays and follows the next card clicked.
- [ ] Switch to a normal note tab: the popup closes.

## 5. Editing (12 min)
Use `Antenna - WiFi`. This changes the note; run `git restore` on it afterwards.
- [ ] Click its card, press **Edit**. The border changes, an "editing" chip shows, Properties and Relationships open. `type`, `id`, `uid` are plain text (not boxes).
- [ ] Change **status** to `Active` and press Tab: notice "Saved status". Add a **tag** (`test`) the same way. Pick a **subtype** from the dropdown.
- [ ] Edit the **text**, press **Save text**: saved; the properties are untouched.
- [ ] Press **✕** on one relationship: confirmation names the inverse; confirm; it disappears. Press **Undo**: it comes back, and so does the inverse on the other note.
- [ ] **Add relationship…**: pick a note, then a relationship; it appears; **Undo** removes it.
- [ ] **Key safety:** select a card on the canvas, click in the text box in the popup and press **Delete** and **Backspace**: the card must **not** be deleted from the canvas. ______
- [ ] Type in the text box and click another card: it asks before discarding.
- [ ] **Git check:** open the git diff of `Antenna - WiFi`. How many lines changed besides the ones you edited? ______ (this decides whether to keep Obsidian's property rewrite.)

## 5A. Governed Local Model safety
- [ ] On a test note that contains a governed Local Model START marker, entering Edit must not present the ordinary body text editor. It should explain that region-aware editing is part of WB-106.
- [ ] Confirm the note is unchanged.

## 6. Review (10 min)
- [ ] **Open Review** (ribbon icon): counts as in step 1.
- [ ] Missing Inverses: open a finding. It says the link breaks its endpoint rule and offers **no** Write button.
- [ ] Provisional Relationships: open a finding, **Open source** first, note the fields. **Replace relationship**, pick one: the `tracesTo` is gone, the new link and its inverse are there, the count is 241.
- [ ] **Undo last Workbench edit** (give it a hotkey) twice: both notes as before, count 242.
- [ ] Refusal: do a Replace, hand-edit the target note (add a space to the body), then Undo. It should refuse with "Not undone". Copy the exact message: ______

## 7. Tidy up
- [ ] `git restore` the notes you edited; delete the generated canvases you do not want (the views folder is `Workbench Views`).

## What to send back
For each failed step: the step number, a screenshot, and any notice text or console error. Everything that passes needs nothing.

## 0.1.16 additions: links and Local Model (WB-111, WB-112)

Run after the first v0.8.6 import, in the imported vault. About 15 minutes.

- [ ] Open a note whose file name is shared with another note (for example a `~2` duplicate or a requirement clause like `1.0 Purpose`). Use **Relate current note to another note** to link it to a note whose name is not unique. In the note's properties the new entry is the shortest unique path, not the bare name, and the link opens the note you picked.
- [ ] Relate two notes, then Undo. The property returns to exactly what it was.
- [ ] Open a note that already links to a target as `[[Folder/Name]]` and relate it to the same target again: Workbench reports that the link already exists and adds nothing.
- [ ] Run **MDSE Workbench: Check Local Model (write findings report)**. Time it (the Notice shows seconds). `Workbench Views/Local Model Findings.md` opens. Record the counts: notes with a region, records, errors, warnings, and the table of finding codes.
- [ ] For each finding code in the table, open two examples through their links. Each should land on the record the message names. Write down any code that looks like a reader mistake rather than a model fault; those are Workbench bugs.
- [ ] Open a note that has a Local Model region and try to edit its text from the note popup: editing is refused.
