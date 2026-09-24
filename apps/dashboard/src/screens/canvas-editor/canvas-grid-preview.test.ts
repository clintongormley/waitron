import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../../widgets/test-helpers.js";
import { t } from "../../i18n/t.js";
import "./canvas-grid-preview.js";
import type { CanvasGridPreview } from "./canvas-grid-preview.js";
import { EDITOR_ROW_HEIGHT, type TabDef } from "./card-contracts.js";

afterEach(cleanupWidgets);
const tab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
  ],
};

describe("canvas-grid-preview", () => {
  it("renders one tile per card with the tab's column count and per-card spans", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", { tab });
    await el.updateComplete;
    const grid = el.shadowRoot!.querySelector<HTMLElement>("[data-test=grid]")!;
    expect(grid.style.gridTemplateColumns).toContain("repeat(12,");
    const tiles = el.shadowRoot!.querySelectorAll("[data-test^=tile-]");
    expect(tiles.length).toBe(2);
    expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-0]")!.style.gridColumn).toBe(
      "span 8",
    );
    expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-0]")!.style.gridRow).toBe(
      "span 6",
    );
  });
  it("emits select-card with the index when interactive and a tile is clicked", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: true,
    });
    await el.updateComplete;
    let got = -1;
    el.addEventListener("select-card", (e) => {
      got = (e as CustomEvent<{ index: number }>).detail.index;
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-1]")!.click();
    expect(got).toBe(1);
  });
  it("marks the selected tile and is inert (aria-hidden, no buttons) when not interactive", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: false,
      selectedIndex: 0,
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=grid]")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(el.shadowRoot!.querySelectorAll("button").length).toBe(0);
  });
  it("renders nothing when tab is null (caller between selections)", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", { tab: null });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=grid]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=empty-grid]")).toBeNull();
  });
  it("renders an empty-grid affordance for a tab with no cards", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab: { ...tab, cards: [] },
      interactive: true,
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=empty-grid]")).toBeTruthy();
  });
});

// ── Direct manipulation (pointer drag-to-reorder + resize handle) ──────────────────────────────────
// `setPointerCapture` fails on a synthetic pointer (guarded in the element), so each whole gesture
// (down → move → up) is dispatched on the source element.
function pointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
  pointerId = 1,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId,
      button: 0,
      bubbles: true,
      composed: true,
    }),
  );
}
function centre(el: Element): [number, number] {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

describe("canvas-grid-preview drag-to-reorder", () => {
  async function mountInteractive(selectedIndex = -1) {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: true,
      selectedIndex,
    });
    await el.updateComplete;
    return el;
  }
  function tileEl(el: CanvasGridPreview, index: number): HTMLElement {
    return el.shadowRoot!.querySelector<HTMLElement>(`[data-test=tile-${index}]`)!;
  }

  it("emits move-card {from,to} when a tile is dragged past a neighbour", async () => {
    const el = await mountInteractive();
    let detail: { from: number; to: number } | null = null;
    el.addEventListener("move-card", (e) => {
      detail = (e as CustomEvent<{ from: number; to: number }>).detail;
    });
    const t0 = tileEl(el, 0);
    const t1 = tileEl(el, 1);
    const [x0, y0] = centre(t0);
    const r1 = t1.getBoundingClientRect();
    pointer(t0, "pointerdown", x0, y0);
    // Drag well past tile-1's centre (towards its right edge) so it lands after it.
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2);
    pointer(t0, "pointerup", r1.right - 4, r1.top + r1.height / 2);
    expect(detail).toEqual({ from: 0, to: 1 });
  });

  it("emits move-card {from:1,to:0} when a later tile is dragged before an earlier one", async () => {
    const el = await mountInteractive();
    let detail: { from: number; to: number } | null = null;
    el.addEventListener("move-card", (e) => {
      detail = (e as CustomEvent<{ from: number; to: number }>).detail;
    });
    const t0 = tileEl(el, 0);
    const t1 = tileEl(el, 1);
    const [x1, y1] = centre(t1);
    const r0 = t0.getBoundingClientRect();
    pointer(t1, "pointerdown", x1, y1);
    pointer(t1, "pointermove", r0.left + 4, r0.top + r0.height / 2);
    pointer(t1, "pointerup", r0.left + 4, r0.top + r0.height / 2);
    expect(detail).toEqual({ from: 1, to: 0 });
  });

  it("does NOT emit move-card for a below-threshold gesture; a plain click still selects", async () => {
    const el = await mountInteractive();
    let moved = false;
    let selected = -1;
    el.addEventListener("move-card", () => (moved = true));
    el.addEventListener("select-card", (e) => {
      selected = (e as CustomEvent<{ index: number }>).detail.index;
    });
    const t0 = tileEl(el, 0);
    const [x0, y0] = centre(t0);
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", x0 + 3, y0); // < 5px threshold
    pointer(t0, "pointerup", x0 + 3, y0);
    t0.click();
    expect(moved).toBe(false);
    expect(selected).toBe(0);
  });

  it("swallows the click that trails a real drag, then selects normally on the next click", async () => {
    const el = await mountInteractive();
    const selections: number[] = [];
    el.addEventListener("select-card", (e) => {
      selections.push((e as CustomEvent<{ index: number }>).detail.index);
    });
    const t0 = tileEl(el, 0);
    const t1 = tileEl(el, 1);
    const [x0, y0] = centre(t0);
    const r1 = t1.getBoundingClientRect();
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2);
    pointer(t0, "pointerup", r1.right - 4, r1.top + r1.height / 2);
    t0.click(); // the synthetic click a real drag leaves behind — must NOT select
    expect(selections).toEqual([]);
    t0.click(); // a fresh, unrelated click selects as usual
    expect(selections).toEqual([0]);
  });

  it("marks the dragged tile and an insertion point while dragging", async () => {
    const el = await mountInteractive();
    const t0 = tileEl(el, 0);
    const t1 = tileEl(el, 1);
    const [x0, y0] = centre(t0);
    const r1 = t1.getBoundingClientRect();
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2);
    await el.updateComplete;
    expect(tileEl(el, 0).classList.contains("dragging")).toBe(true);
    // Dropping after tile-1 (the last non-dragged tile) marks it as the trailing insertion point.
    expect(tileEl(el, 1).classList.contains("drop-after")).toBe(true);
    pointer(t0, "pointerup", r1.right - 4, r1.top + r1.height / 2);
    await el.updateComplete;
    // Cleared after the gesture ends.
    expect(el.shadowRoot!.querySelector(".dragging")).toBeNull();
  });

  it("marks a leading insertion point when dropping before the first tile", async () => {
    const el = await mountInteractive();
    const t0 = tileEl(el, 0);
    const t1 = tileEl(el, 1);
    const [x1, y1] = centre(t1);
    const r0 = t0.getBoundingClientRect();
    pointer(t1, "pointerdown", x1, y1);
    pointer(t1, "pointermove", r0.left + 4, r0.top + r0.height / 2);
    await el.updateComplete;
    expect(tileEl(el, 0).classList.contains("drop-before")).toBe(true);
    pointer(t1, "pointerup", r0.left + 4, r0.top + r0.height / 2);
  });

  it("resets click-suppression on a new gesture: a drag with no trailing click never swallows the next click", async () => {
    // Capture releasing over a different tile means the browser fires NO trailing click on the source,
    // leaving #suppressClick stuck true. The next gesture's pointerdown must clear it.
    const el = await mountInteractive();
    const selections: number[] = [];
    el.addEventListener("select-card", (e) => {
      selections.push((e as CustomEvent<{ index: number }>).detail.index);
    });
    const t0 = tileEl(el, 0);
    const t1 = tileEl(el, 1);
    const [x0, y0] = centre(t0);
    const r1 = t1.getBoundingClientRect();
    // A REAL drag past the threshold — but NO trailing click is dispatched on t0.
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2);
    pointer(t0, "pointerup", r1.right - 4, r1.top + r1.height / 2);
    // The NEXT gesture: its pointerdown must reset the stuck flag, so this legitimate click selects.
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointerup", x0, y0);
    t0.click();
    expect(selections).toEqual([0]);
  });

  it("starts each gesture from clean drag state after a MISSED pointerup (no wedge at 0)", async () => {
    // A missed pointerup leaves draggingIndex set into the next gesture, which then skips measuring
    // and wedges dropIndex at 0. The reset in #onTilePointerDown clears that.
    const el = await mountInteractive();
    let detail: { from: number; to: number } | null = null;
    el.addEventListener("move-card", (e) => {
      detail = (e as CustomEvent<{ from: number; to: number }>).detail;
    });
    const t0 = tileEl(el, 0);
    const t1 = tileEl(el, 1);
    const [x0, y0] = centre(t0);
    const r1 = t1.getBoundingClientRect();
    // FIRST gesture: cross the threshold so draggingIndex is set — but NO pointerup (the missed case).
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2);
    // SECOND gesture: a fresh drag of tile-0 past tile-1 must measure tiles and land AFTER it, not
    // wedge at 0.
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2);
    pointer(t0, "pointerup", r1.right - 4, r1.top + r1.height / 2);
    expect(detail).toEqual({ from: 0, to: 1 });
  });

  it("clears drag state and emits no move-card when the pointer stream is cancelled", async () => {
    // A cancelled gesture is abandoned: drag state cleared, capture released, and NO move-card.
    const el = await mountInteractive();
    let moved = false;
    el.addEventListener("move-card", () => (moved = true));
    const t0 = tileEl(el, 0);
    const t1 = tileEl(el, 1);
    const [x0, y0] = centre(t0);
    const r1 = t1.getBoundingClientRect();
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2); // past threshold → dragging
    await el.updateComplete;
    expect(tileEl(el, 0).classList.contains("dragging")).toBe(true);
    expect(el.shadowRoot!.querySelector(".drop-before, .drop-after")).toBeTruthy();
    pointer(t0, "pointercancel", r1.right - 4, r1.top + r1.height / 2);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".dragging")).toBeNull();
    expect(el.shadowRoot!.querySelector(".drop-before, .drop-after")).toBeNull();
    expect(moved).toBe(false);
  });

  it("does not emit move-card from the inert thumbnail (drag is gated to interactive)", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: false,
    });
    await el.updateComplete;
    let moved = false;
    el.addEventListener("move-card", () => (moved = true));
    const t0 = el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-0]")!;
    const t1 = el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-1]")!;
    const [x0, y0] = centre(t0);
    const [x1, y1] = centre(t1);
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", x1, y1);
    pointer(t0, "pointerup", x1, y1);
    expect(moved).toBe(false);
  });
});

describe("canvas-grid-preview resize handle", () => {
  async function mountInteractive(selectedIndex: number) {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: true,
      selectedIndex,
    });
    await el.updateComplete;
    return el;
  }

  it("renders a resize handle only on the selected interactive tile", async () => {
    const el = await mountInteractive(0);
    const t0 = el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-0]")!;
    const t1 = el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-1]")!;
    expect(t0.querySelector("[data-test=resize-handle]")).toBeTruthy();
    expect(t1.querySelector("[data-test=resize-handle]")).toBeNull();
  });

  it("renders no resize handle when nothing is selected", async () => {
    const el = await mountInteractive(-1);
    expect(el.shadowRoot!.querySelector("[data-test=resize-handle]")).toBeNull();
  });

  it("renders no resize handle on an inert thumbnail even with a selectedIndex", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: false,
      selectedIndex: 0,
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=resize-handle]")).toBeNull();
  });

  it("emits resize-card with a grown colSpan when the handle is dragged right", async () => {
    const el = await mountInteractive(0);
    let detail: { index: number; colSpan: number; rowSpan: number } | null = null;
    el.addEventListener("resize-card", (e) => {
      detail = (e as CustomEvent<{ index: number; colSpan: number; rowSpan: number }>).detail;
    });
    const handle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=resize-handle]")!;
    const [hx, hy] = centre(handle);
    pointer(handle, "pointerdown", hx, hy);
    pointer(handle, "pointermove", hx + 400, hy); // several columns to the right
    pointer(handle, "pointerup", hx + 400, hy);
    expect(detail).not.toBeNull();
    expect(detail!.index).toBe(0);
    expect(detail!.colSpan).toBeGreaterThan(8); // started at 8
    expect(detail!.rowSpan).toBe(6); // no vertical movement
  });

  it("does not re-emit resize-card when a pointermove lands on the same snapped spans", async () => {
    const el = await mountInteractive(0);
    let count = 0;
    el.addEventListener("resize-card", () => (count += 1));
    const handle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=resize-handle]")!;
    const [hx, hy] = centre(handle);
    pointer(handle, "pointerdown", hx, hy);
    pointer(handle, "pointermove", hx + 400, hy); // crosses a column boundary → emits once
    pointer(handle, "pointermove", hx + 400, hy); // identical spans → no second emit
    expect(count).toBe(1);
    pointer(handle, "pointermove", hx + 400, hy + 400); // rows change → emits again
    expect(count).toBe(2);
  });

  it("cancels the resize on pointercancel: a later pointermove on the handle emits no resize-card", async () => {
    // A cancelled resize must not be resumed by a later stray pointermove on the handle.
    const el = await mountInteractive(0);
    let count = 0;
    el.addEventListener("resize-card", () => (count += 1));
    const handle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=resize-handle]")!;
    const [hx, hy] = centre(handle);
    pointer(handle, "pointerdown", hx, hy); // starts the resize
    pointer(handle, "pointercancel", hx, hy); // OS/browser takeover — resize abandoned
    pointer(handle, "pointermove", hx + 400, hy); // a stray move must NOT resume the resize
    expect(count).toBe(0);
  });

  it("resize-handle pointerdown starts a resize, not a drag (emits resize-card, never move-card)", async () => {
    const el = await mountInteractive(0);
    let moved = false;
    let resized = false;
    el.addEventListener("move-card", () => (moved = true));
    el.addEventListener("resize-card", () => (resized = true));
    const handle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=resize-handle]")!;
    const [hx, hy] = centre(handle);
    pointer(handle, "pointerdown", hx, hy);
    pointer(handle, "pointermove", hx + 400, hy);
    pointer(handle, "pointerup", hx + 400, hy);
    expect(moved).toBe(false);
    expect(resized).toBe(true);
  });
});

// ── Representative card silhouettes ────────────────────────────────────────────────────────────────
describe("canvas-grid-preview card silhouettes", () => {
  function tileEl(el: CanvasGridPreview, index: number): HTMLElement {
    return el.shadowRoot!.querySelector<HTMLElement>(`[data-test=tile-${index}]`)!;
  }

  it("draws each card type's silhouette in the interactive canvas", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: true,
    });
    await el.updateComplete;
    expect(tileEl(el, 0).querySelector('[data-preview="product-grid"]')).toBeTruthy();
    expect(tileEl(el, 1).querySelector('[data-preview="basket"]')).toBeTruthy();
  });

  it("draws silhouettes in the inert thumbnail too", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: false,
    });
    await el.updateComplete;
    expect(tileEl(el, 0).querySelector('[data-preview="product-grid"]')).toBeTruthy();
    expect(tileEl(el, 1).querySelector('[data-preview="basket"]')).toBeTruthy();
  });

  it("keeps the card-type name as the tile's accessible caption alongside the silhouette", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: true,
    });
    await el.updateComplete;
    // The visible caption text supplies the button's accessible name; the silhouette is aria-hidden.
    expect(tileEl(el, 0).querySelector(".name")!.textContent!.trim()).toBe(
      t("canvas_editor.card.product-grid"),
    );
  });

  it("marks the silhouette decorative: aria-hidden and pointer-events:none so drag/select is never intercepted", async () => {
    // Without `pointer-events: none` on the preview wrapper the silhouette would swallow
    // pointerdown/click meant for the draggable button; without `aria-hidden` its inner divs would leak
    // into the button's accessible name.
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: true,
    });
    await el.updateComplete;
    const preview = tileEl(el, 0).querySelector<HTMLElement>("[data-test=preview-0]")!;
    expect(preview.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(preview).pointerEvents).toBe("none");
  });

  it("keeps the resize handle hittable above the silhouette", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: true,
      selectedIndex: 0,
    });
    await el.updateComplete;
    const handle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=resize-handle]")!;
    expect(handle).toBeTruthy();
    expect(getComputedStyle(handle).pointerEvents).not.toBe("none");
  });

  it("renders the same memoized silhouette into TWO sibling tiles of the same type as independent, complete DOM subtrees", async () => {
    // `cardPreview("product-grid")` returns ONE memoized TemplateResult for every product-grid tile;
    // each tile must still get its OWN full silhouette, not one shared node leaving the other empty.
    const twoSame: TabDef = {
      ...tab,
      cards: [
        { type: "product-grid", colSpan: 6, rowSpan: 6, config: {} },
        { type: "product-grid", colSpan: 6, rowSpan: 6, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
      ],
    };
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab: twoSame,
      interactive: true,
    });
    await el.updateComplete;
    const s0 = tileEl(el, 0).querySelector<HTMLElement>('[data-preview="product-grid"]');
    const s1 = tileEl(el, 1).querySelector<HTMLElement>('[data-preview="product-grid"]');
    expect(s0, "tile-0 has its own product-grid silhouette").toBeTruthy();
    expect(s1, "tile-1 has its own product-grid silhouette").toBeTruthy();
    // Each subtree is complete: the full six-cell mini grid, not a shared/emptied node.
    expect(s0!.querySelectorAll(".cp-cell").length).toBe(6);
    expect(s1!.querySelectorAll(".cp-cell").length).toBe(6);
    // Two independent DOM nodes, even though one TemplateResult backs both tiles.
    expect(s0).not.toBe(s1);
  });

  it("still emits move-card when a tile bearing a silhouette is dragged past a neighbour", async () => {
    // The decorative silhouette must not break drag-to-reorder.
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: true,
    });
    await el.updateComplete;
    let detail: { from: number; to: number } | null = null;
    el.addEventListener("move-card", (e) => {
      detail = (e as CustomEvent<{ from: number; to: number }>).detail;
    });
    const t0 = tileEl(el, 0);
    const t1 = tileEl(el, 1);
    const [x0, y0] = centre(t0);
    const r1 = t1.getBoundingClientRect();
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2);
    pointer(t0, "pointerup", r1.right - 4, r1.top + r1.height / 2);
    expect(detail).toEqual({ from: 0, to: 1 });
  });
});

describe("canvas-grid-preview gestures at the edges", () => {
  async function mountInteractive(target: TabDef = tab, selectedIndex = -1) {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab: target,
      interactive: true,
      selectedIndex,
    });
    await el.updateComplete;
    return el;
  }
  function tileEl(el: CanvasGridPreview, index: number): HTMLElement {
    return el.shadowRoot!.querySelector<HTMLElement>(`[data-test=tile-${index}]`)!;
  }
  function handleOf(el: CanvasGridPreview): HTMLElement {
    return el.shadowRoot!.querySelector<HTMLElement>("[data-test=resize-handle]")!;
  }
  function record(el: CanvasGridPreview, name: string): unknown[] {
    const seen: unknown[] = [];
    el.addEventListener(name, (e) => seen.push((e as CustomEvent).detail));
    return seen;
  }

  it("drags a lone card with no insertion marker, emits no move-card and swallows its click", async () => {
    const el = await mountInteractive({ ...tab, cards: [tab.cards[0]!] });
    const moves = record(el, "move-card");
    const selects = record(el, "select-card");
    const t0 = tileEl(el, 0);
    const [x, y] = centre(t0);
    pointer(t0, "pointerdown", x, y);
    pointer(t0, "pointermove", x + 40, y);
    await el.updateComplete;
    expect(t0.classList.contains("dragging")).toBe(true);
    expect(el.shadowRoot!.querySelector(".drop-before, .drop-after")).toBeNull();
    pointer(t0, "pointerup", x + 40, y);
    t0.click();
    expect(moves).toEqual([]);
    expect(selects).toEqual([]);
  });

  it("follows the pointer across successive moves and drops a card back where it started", async () => {
    const el = await mountInteractive();
    const moves = record(el, "move-card");
    const t0 = tileEl(el, 0);
    const [x0, y0] = centre(t0);
    const r1 = tileEl(el, 1).getBoundingClientRect();
    pointer(t0, "pointerdown", x0, y0);
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2);
    await el.updateComplete;
    expect(tileEl(el, 1).classList.contains("drop-after")).toBe(true);
    pointer(t0, "pointermove", x0, y0);
    await el.updateComplete;
    expect(tileEl(el, 1).classList.contains("drop-after")).toBe(false);
    expect(tileEl(el, 1).classList.contains("drop-before")).toBe(true);
    pointer(t0, "pointerup", x0, y0);
    expect(moves).toEqual([]);
  });

  it("releases the pointer capture a real click took", async () => {
    const el = await mountInteractive();
    const selects = record(el, "select-card");
    const t1 = tileEl(el, 1);
    const release = vi.spyOn(t1, "releasePointerCapture");
    await userEvent.click(t1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(t1.hasPointerCapture(release.mock.calls[0]![0])).toBe(false);
    expect(selects).toEqual([{ index: 1 }]);
  });

  it("does not select the tile when its resize handle is clicked", async () => {
    const el = await mountInteractive(tab, 0);
    const selects = record(el, "select-card");
    handleOf(el).click();
    expect(selects).toEqual([]);
  });

  it("starts no drag from a secondary button press on a tile", async () => {
    const el = await mountInteractive();
    const moves = record(el, "move-card");
    const t0 = tileEl(el, 0);
    const [x0, y0] = centre(t0);
    const r1 = tileEl(el, 1).getBoundingClientRect();
    t0.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: x0,
        clientY: y0,
        pointerId: 1,
        button: 2,
        bubbles: true,
        composed: true,
      }),
    );
    pointer(t0, "pointermove", r1.right - 4, r1.top + r1.height / 2);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".dragging")).toBeNull();
    pointer(t0, "pointerup", r1.right - 4, r1.top + r1.height / 2);
    expect(moves).toEqual([]);
  });

  it("starts no resize from a secondary button press on the handle", async () => {
    const el = await mountInteractive(tab, 0);
    const resizes = record(el, "resize-card");
    const handle = handleOf(el);
    const [hx, hy] = centre(handle);
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: hx,
        clientY: hy,
        pointerId: 1,
        button: 2,
        bubbles: true,
        composed: true,
      }),
    );
    pointer(handle, "pointermove", hx + 400, hy);
    expect(resizes).toEqual([]);
  });

  it.each([
    { name: "the tab was cleared", next: null },
    { name: "its card was removed", next: { ...tab, cards: [tab.cards[0]!] } },
  ])(
    "starts no resize from a handle pressed before the re-render after $name",
    async ({ next }) => {
      const el = await mountInteractive(tab, 1);
      const resizes = record(el, "resize-card");
      const handle = handleOf(el);
      const [hx, hy] = centre(handle);
      el.tab = next;
      pointer(handle, "pointerdown", hx, hy);
      pointer(handle, "pointermove", hx + 400, hy + 400);
      expect(resizes).toEqual([]);
    },
  );

  it("ignores another pointer lifting or cancelling during a resize", async () => {
    const el = await mountInteractive(tab, 0);
    const resizes = record(el, "resize-card");
    const handle = handleOf(el);
    const [hx, hy] = centre(handle);
    pointer(handle, "pointerdown", hx, hy, 1);
    pointer(handle, "pointerup", hx, hy, 2);
    pointer(handle, "pointercancel", hx, hy, 2);
    pointer(handle, "pointermove", hx, hy + 400, 1);
    expect(resizes).toEqual([{ index: 0, colSpan: 8, rowSpan: expect.any(Number) }]);
    expect((resizes[0] as { rowSpan: number }).rowSpan).toBeGreaterThan(6);
    pointer(handle, "pointerup", hx, hy + 400, 1);
  });

  it("resizes in whole cells when the grid's gap does not resolve to a length", async () => {
    // No design tokens: the grid's `gap: var(--wt-space-2)` computes to `normal`.
    const el = document.createElement("canvas-grid-preview");
    el.tab = tab;
    el.interactive = true;
    el.selectedIndex = 0;
    document.body.appendChild(el);
    try {
      await el.updateComplete;
      const grid = el.shadowRoot!.querySelector<HTMLElement>("[data-test=grid]")!;
      expect(getComputedStyle(grid).columnGap).toBe("normal");
      expect(getComputedStyle(grid).rowGap).toBe("normal");
      const resizes = record(el, "resize-card");
      const handle = handleOf(el);
      const [hx, hy] = centre(handle);
      const column = grid.getBoundingClientRect().width / tab.columns;
      pointer(handle, "pointerdown", hx, hy);
      pointer(handle, "pointermove", hx + column * 2, hy + EDITOR_ROW_HEIGHT);
      pointer(handle, "pointerup", hx + column * 2, hy + EDITOR_ROW_HEIGHT);
      expect(resizes).toEqual([{ index: 0, colSpan: 10, rowSpan: 7 }]);
    } finally {
      el.remove();
    }
  });
});
