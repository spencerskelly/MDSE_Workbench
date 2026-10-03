# MDSE Workbench

## Purpose

This folder is the living product-definition workspace for the **MDSE Workbench**: a practical Obsidian interface that helps engineers create, explore, review, and graphically work with the existing MDSE model without requiring them to become modeling specialists.

The Workbench is an **interface to the model**, not a replacement metamodel and not a second source of model semantics.

## Current direction

The Workbench is intended to become the primary everyday MDSE user interface in Obsidian.

V1 centers on three activities:

1. **Create** — quickly create valid MDSE elements using compact modal forms.
2. **Explore** — select one or more model elements and generate useful engineering Canvas views.
3. **Review** — surface model-health findings and work through them in a focused review workflow.

The normal engineer should be able to use the vault without understanding schema files, plugin internals, Git mechanics, or formal SysML tooling.

**Local Model interface (WB-105 / W-298):** addressable part occurrences, endpoints, connections, flows and local applicability stay inside their owning note but appear in Workbench as a separate **Local Model** dropdown/surface. They are not ordinary note text and are not flattened into frontmatter relationships. The body contract is governed by `local-model.yaml` 0.2, with reader compatibility for 0.1. Workbench 0.1.15 still does not index those records; WB-106 adds the parser/index/view foundation. Ordinary text editing must never modify the governed region.

## Current v0.8 contract

Model-side authority is `MDSE v0.8 Cross-Repository Reconciliation - 2026-10-02.md` plus Workspace Decision Log W-315 through W-319 (Local Model), W-324 (links by file name) and W-325 (release chain). Next Workbench steps: [[MDSE Plan - Path to a Golden Model]], section 9.

Current target:
- relationships 1.35;
- element-types 1.17;
- Local Model writer 0.2, reader 0.1 + 0.2;
- globally unique 30-character identity tokens across notes and local reference points;
- Workbench WB-106 before a full v0.8 import is accepted.

## Start here

1. [[01 - Workbench Product Definition]] — what Workbench is, plus the dashboard, Canvas/view and Review experience (Parts A to C)
2. [[02 - Workbench Decision Log]] — every decision (`WB-` IDs), open questions, history
3. [[03 - Build Outline and Roadmap]] — V1 scope, release path (M0 to M7), risks, acceptance scenarios, later roadmap
4. [[04 - Architecture and Model Boundary]] — how Workbench relates to the model and the vault
5. [[05 - Reference Plugin Findings]] — what existing plugins showed, and license cautions
6. [[06 - Test Sheet]] — the checks to run in Obsidian against the current plugin build, in order

History is in the Git log and the Decision Log's History section; there is no separate change log or handoff note.

## Authority

This folder is authoritative for the **Workbench product/interface direction** once decisions are approved through the normal Git review process.

It is **not authoritative for MDSE model semantics**. Current element definitions, relationships, templates, and modeling rules remain governed by the vault's existing ruleset and schema files under `99_System`.

If this folder conflicts with the MDSE schema, the schema remains authoritative until a separate model-governance decision changes it.

## Design boundary

Workbench should:

- read the model;
- use the current vault-defined schema;
- create and edit model content through the approved semantics;
- validate user actions;
- provide useful graphical and tabular views;
- make model-health issues visible;
- keep engineers close to normal Obsidian workflows.

Workbench should not:

- invent new model semantics;
- silently infer relationships;
- redefine element-type mechanics;
- turn folder placement into model meaning;
- require users to understand implementation details to perform normal engineering work.

## Working-before-perfection principle

V1 should solve the common engineering workflow with the least interface complexity that can scale. More advanced behavior should be added only after real use shows value.

Where a future capability is already valuable, V1 should preserve an architectural path to it without requiring the full feature immediately.

## Known ruleset reconciliation item

MDSE Modeling Ruleset 1.23 (section 9) currently says every model-facing folder contains a Views and Bases note, Folder Contents base, and Folder Map canvas.

The newer Workbench direction intentionally moves away from requiring a prebuilt Canvas in every folder and uses generated views instead.

This folder therefore contains a README and local Base only. The navigation rule should be reconciled separately in the modeling ruleset ([[02 - Workbench Decision Log#WB-079 — Folder-navigation ruleset reconciliation|WB-079]]); this Workbench package does not silently change model governance.

## Resuming design work

- **Do not restart with metamodel design.** The goal is a good interface to the existing model. A drift into property inheritance was stopped; it is model governance, not a Workbench requirement (WB-070, WB-071).
- **Method:** one focused question at a time; explain the impact; offer clear options; recommend the simplest scalable one; record the decision; move on. Do not reopen settled decisions without new information.
- **Implementation details** (WB-072 to WB-078) are decided during the build, not one at a time up front (WB-089).
- **Whenever the UI needs a model fact,** read it from the governed schema/configuration rather than embedding a copy in the plugin.
- **A good next step** either resolves an open decision or implements and tests one user journey or milestone. A poor next step adds model complexity that does not improve the engineer's interface.
- **Now:** standalone Workbench 0.1.16 is in `spencerskelly/MDSE_Workbench`. It contains the W-310/W-319 safety corrections, the Local Model reader and findings report (WB-111) and Obsidian-style link writing (WB-112); `WB106_IMPLEMENTATION_CONTRACT.md` is the next coding handoff. Its README lists the M0 questions, the commands that answer them and the first measurements on a synthetic 60,000-note vault. First results are in the Decision Log (2026-09-30): performance passes; the Canvas selection menu works; gate R0 is decided: go (2026-10-01). Open items: the release pipeline, Canvas hook rechecks per Obsidian version, and the R1 pilot setup.

## Status

Initial consolidated definition created 2026-09-30 from the Workbench/dashboard design discussion. Consolidated and extended with release-path proposals the same day (see the Decision Log History). The release-path proposals were approved the same day.
