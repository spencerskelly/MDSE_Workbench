/**
 * Phase 0 probe for the Canvas-edit gate (WB-080). Obsidian does not document Canvas
 * internals, so this only looks and reports; it changes nothing on its own.
 * Everything touched here is marked `unknown`/`any` on purpose: it is not public API.
 */
import { App, Menu, TFile } from "obsidian";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyCanvas = any;

export function activeCanvas(app: App): AnyCanvas | null {
  const view: any = app.workspace.getMostRecentLeaf()?.view;
  return view?.getViewType?.() === "canvas" ? (view.canvas ?? null) : null;
}

/** Files of the selected file nodes on a canvas, in selection order. */
export function selectedFiles(canvas: AnyCanvas): TFile[] {
  const sel: unknown = canvas?.selection;
  if (!(sel instanceof Set)) return [];
  return [...sel].map((n: any) => n?.file).filter((f: unknown): f is TFile => f instanceof TFile);
}

/** What the running Obsidian exposes, for the go/no-go note in the decision log. */
export function probeReport(app: App): Array<[string, string, boolean?]> {
  const c = activeCanvas(app);
  if (!c) return [["Canvas", "Open a canvas and run this again.", true]];
  const has = (v: unknown) => (v === undefined ? "missing" : typeof v === "function" ? "function" : "present");
  const rows: Array<[string, string, boolean?]> = [
    ["Obsidian version", (app as any).appVersion ?? (window as any).electron?.version ?? "unknown"],
    ["canvas.selection", sel(c)],
    ["canvas.nodes", has(c.nodes)],
    ["canvas.edges", has(c.edges)],
    ["canvas.addEdge", has(c.addEdge)],
    ["canvas.removeEdge", has(c.removeEdge)],
    ["canvas.requestSave", has(c.requestSave)],
    ["canvas.getData", has(c.getData)],
    ["Selected notes now", String(selectedFiles(c).length)],
    ["Card elements (note details popup)", cardElements(c)],
  ];
  return rows;
}

/** Does each Canvas card object expose its element and file, which the note details popup uses? */
function cardElements(c: AnyCanvas): string {
  const nodes: unknown = c.nodes;
  const list: any[] = nodes instanceof Map ? [...nodes.values()] : [];
  if (!list.length) return "no cards to inspect";
  const withEl = list.filter((n) => n?.nodeEl instanceof HTMLElement).length;
  return `${withEl} of ${list.length} cards have an element`;
}

function sel(c: AnyCanvas): string {
  return c.selection instanceof Set ? `Set with ${c.selection.size} item(s)` : "missing";
}

/**
 * Adds "Relate selected notes" to the Canvas selection menu if Obsidian fires the
 * (undocumented) `canvas:selection-menu` event. If the item never appears, that event is
 * not available and Canvas editing fails the gate.
 */
export function registerSelectionMenu(app: App, register: (ref: any) => void, onRelate: (a: TFile, b: TFile) => void): void {
  const ref = (app.workspace as any).on("canvas:selection-menu", (menu: Menu, canvas: AnyCanvas) => {
    const files = selectedFiles(canvas);
    if (files.length !== 2) return;
    menu.addItem((item) =>
      item
        .setTitle("Relate selected notes (Workbench)")
        .setIcon("link")
        .onClick(() => onRelate(files[0], files[1])),
    );
  });
  register(ref);
}
