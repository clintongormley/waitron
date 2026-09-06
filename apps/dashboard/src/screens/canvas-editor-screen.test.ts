import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./canvas-editor-screen.js";
import type { CanvasEditorScreen } from "./canvas-editor-screen.js";
import type { Canvas, DashboardApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

const originalUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
});
const canvases: Canvas[] = [
  {
    id: "c1",
    name: "Counter till",
    definition: {
      formFactor: "till",
      tabs: [
        {
          key: "counter",
          title: "Counter",
          columns: 12,
          cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: {} }],
        },
      ],
    },
  },
];
function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listCanvases: vi.fn().mockResolvedValue(canvases),
    getCanvas: vi.fn().mockResolvedValue(canvases[0]),
    createCanvas: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCanvas: vi.fn().mockResolvedValue(undefined),
    deleteCanvas: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: CanvasEditorScreen) {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

describe("canvas-editor-screen list mode", () => {
  it("lists canvases with name, form-factor badge, counts and a thumbnail", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    expect(api.listCanvases).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("[data-test=canvas-row-c1]")).toBeTruthy();
    expect(
      el.shadowRoot!.querySelector("[data-test=canvas-thumb-c1] canvas-grid-preview"),
    ).toBeTruthy();
  });

  it("renders a neutral placeholder (not a throw) for a malformed definition", async () => {
    const api = stubApi({
      listCanvases: vi
        .fn()
        .mockResolvedValue([{ id: "bad", name: "X", definition: { nope: true } }]),
    });
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    expect(
      el.shadowRoot!.querySelector("[data-test=canvas-thumb-bad] [data-test=no-preview]"),
    ).toBeTruthy();
  });

  it("shows a placeholder when there are no canvases", async () => {
    const api = stubApi({ listCanvases: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-canvases]")).toBeTruthy();
  });

  it("Eliminar confirms then calls deleteCanvas and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-c1]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    expect(api.deleteCanvas).toHaveBeenCalledWith("c1");
    expect(api.listCanvases).toHaveBeenCalledTimes(2);
  });

  it("Duplicar creates a copy under a new name from the same definition", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=duplicate-c1]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector("[data-test=duplicate-name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Counter till (copy)" },
        bubbles: true,
        composed: true,
      }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-duplicate]")!.click();
    await flush(el);
    expect(api.createCanvas).toHaveBeenCalledWith("Counter till (copy)", canvases[0]!.definition);
  });

  it("Duplicar does not create a canvas when the name is cleared to whitespace", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=duplicate-c1]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector("[data-test=duplicate-name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "   " },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-duplicate]")!.click();
    await flush(el);
    expect(api.createCanvas).not.toHaveBeenCalled();
    // The dialog stayed open (target retained), so correcting the name and confirming still works.
    el.shadowRoot!.querySelector("[data-test=duplicate-name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Counter till (copy)" },
        bubbles: true,
        composed: true,
      }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-duplicate]")!.click();
    await flush(el);
    expect(api.createCanvas).toHaveBeenCalledWith("Counter till (copy)", canvases[0]!.definition);
  });

  it("Duplicar prefills the name field with '<name> (copy)'", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=duplicate-c1]")!.click();
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=duplicate-name]",
    )!;
    expect(input.value).toBe(`Counter till${t("canvas_editor.copy_suffix", "es-ES")}`);
  });

  it("Crear seeds a draft from the default canvas and enters editor mode", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector("[data-test=create-name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Phone floor" },
        bubbles: true,
        composed: true,
      }),
    );
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=create-form-factor]",
    )!;
    select.value = "phone-portrait";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-create]")!.click();
    await el.updateComplete;
    // Create only enters editor mode; the save is B7 — no API write here, and the list is gone.
    expect(api.createCanvas).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=canvas-row-c1]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=create-name]")).toBeNull();
    const placeholder = el.shadowRoot!.querySelector("[data-test=editor-placeholder]")!;
    expect(placeholder).toBeTruthy();
    // A fresh create carries no id yet and seeds from the chosen form factor's default.
    expect(placeholder.getAttribute("data-editing-id")).toBeNull();
    expect(placeholder.getAttribute("data-form-factor")).toBe("phone-portrait");
  });

  it("Editar loads the canvas via getCanvas and enters editor mode", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
    await flush(el); // getCanvas resolves, mode → editor
    // Edit-open fetches the freshest definition rather than reusing the list snapshot (spec §6.2).
    expect(api.getCanvas).toHaveBeenCalledWith("c1");
    expect(el.shadowRoot!.querySelector("[data-test=canvas-row-c1]")).toBeNull();
    const placeholder = el.shadowRoot!.querySelector("[data-test=editor-placeholder]")!;
    expect(placeholder.getAttribute("data-editing-id")).toBe("c1");
    expect(placeholder.getAttribute("data-form-factor")).toBe("till");
  });

  it("Editar shows the error banner and stays in list mode when getCanvas fails", async () => {
    const api = stubApi({ getCanvas: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
    // Stayed in list mode — no editor UI, the row is still shown.
    expect(el.shadowRoot!.querySelector("[data-test=editor-placeholder]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=canvas-row-c1]")).toBeTruthy();
  });

  it("Editar shows the error banner and stays in list mode when the fetched definition is malformed", async () => {
    const api = stubApi({
      getCanvas: vi.fn().mockResolvedValue({ id: "c1", name: "X", definition: { nope: true } }),
    });
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("[data-test=editor-placeholder]")).toBeNull();
  });

  it("shows the load error in a banner", async () => {
    const api = stubApi({ listCanvases: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });

  it("shows a mutation error in a banner when a delete fails", async () => {
    const api = stubApi({ deleteCanvas: vi.fn().mockRejectedValue({ code: "canvas.not_found" }) });
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-c1]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });
});

describe("canvas-editor-screen editor mode", () => {
  async function openEditor(api = stubApi()) {
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
    await flush(el); // getCanvas resolves, mode → editor
    return el;
  }
  function selectCard(el: CanvasEditorScreen, index: number) {
    el.shadowRoot!.querySelector("canvas-grid-preview")!.dispatchEvent(
      new CustomEvent("select-card", { detail: { index }, bubbles: true, composed: true }),
    );
  }
  // The tiles live in <canvas-grid-preview>'s OWN shadow root — querySelectorAll does not cross a
  // shadow boundary, so the brief's flat `canvas-grid-preview [data-test^=tile-]` selector matches
  // nothing; pierce into the preview's shadow root to count/read the rendered tiles as intended.
  function previewRoot(el: CanvasEditorScreen): ShadowRoot {
    return el.shadowRoot!.querySelector("canvas-grid-preview")!.shadowRoot!;
  }
  function tiles(el: CanvasEditorScreen) {
    return previewRoot(el).querySelectorAll("[data-test^=tile-]");
  }
  function tile(el: CanvasEditorScreen, index: number) {
    return previewRoot(el).querySelector<HTMLElement>(`[data-test=tile-${index}]`)!;
  }

  it("loads the canvas into the editor with its tabs and cards", async () => {
    const el = await openEditor();
    expect(el.shadowRoot!.querySelector("[data-test=tab-btn-counter]")).toBeTruthy();
    expect(tiles(el).length).toBe(1);
  });

  it("adds a card from the palette at its default spans", async () => {
    const el = await openEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=palette-held-orders]")!.click();
    await el.updateComplete;
    expect(tiles(el).length).toBe(2);
  });

  it("selecting a tile then editing colSpan updates the draft", async () => {
    const el = await openEditor();
    selectCard(el, 0);
    await el.updateComplete;
    el.shadowRoot!.querySelector("[data-test=card-colspan]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "6" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(tile(el, 0).style.gridColumn).toBe("span 6");
  });

  it("clamps colSpan to the tab's column count (high) and to 1 (low)", async () => {
    const el = await openEditor();
    selectCard(el, 0);
    await el.updateComplete;
    el.shadowRoot!.querySelector("[data-test=card-colspan]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "99" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(tile(el, 0).style.gridColumn).toBe("span 12");
    el.shadowRoot!.querySelector("[data-test=card-colspan]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "0" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(tile(el, 0).style.gridColumn).toBe("span 1");
  });

  it("editing rowSpan updates the draft (min 1)", async () => {
    const el = await openEditor();
    selectCard(el, 0);
    await el.updateComplete;
    el.shadowRoot!.querySelector("[data-test=card-rowspan]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "3" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(tile(el, 0).style.gridRow).toBe("span 3");
  });

  it("ignores a non-numeric span entry", async () => {
    const el = await openEditor();
    selectCard(el, 0);
    await el.updateComplete;
    el.shadowRoot!.querySelector("[data-test=card-colspan]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "abc" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    // The card's colSpan was 8 in the fixture and stays there.
    expect(tile(el, 0).style.gridColumn).toBe("span 8");
  });

  it("removes the selected card", async () => {
    const el = await openEditor();
    selectCard(el, 0);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=card-remove]")!.click();
    await el.updateComplete;
    expect(tiles(el).length).toBe(0);
  });

  it("reorders the selected card with the down/up controls", async () => {
    const el = await openEditor();
    // Add a second card so there is something to reorder: product-grid (span 8) then held-orders (span 4).
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=palette-held-orders]")!.click();
    await el.updateComplete;
    selectCard(el, 0);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=card-down]")!.click();
    await el.updateComplete;
    // product-grid moved to index 1; held-orders now at index 0.
    expect(tile(el, 0).style.gridColumn).toBe("span 4");
    expect(tile(el, 1).style.gridColumn).toBe("span 8");
    // Selection followed the card to index 1; move it back up.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=card-up]")!.click();
    await el.updateComplete;
    expect(tile(el, 0).style.gridColumn).toBe("span 8");
  });

  function fireIntent(el: CanvasEditorScreen, type: string, detail: unknown) {
    el.shadowRoot!.querySelector("canvas-grid-preview")!.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }

  it("applies a move-card intent by splicing the card to its new index and following it", async () => {
    const el = await openEditor();
    // product-grid (span 8) at 0, then held-orders (span 4) at 1.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=palette-held-orders]")!.click();
    await el.updateComplete;
    fireIntent(el, "move-card", { from: 0, to: 1 });
    await el.updateComplete;
    // product-grid spliced to index 1; held-orders now leads.
    expect(tile(el, 0).style.gridColumn).toBe("span 4");
    expect(tile(el, 1).style.gridColumn).toBe("span 8");
    // Selection followed the moved card to index 1 — its property panel is shown with colSpan 8.
    const colspan = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=card-colspan]",
    )!;
    expect(colspan.value).toBe("8");
  });

  it("applies a resize-card intent through the existing span clamp (grow)", async () => {
    const el = await openEditor();
    fireIntent(el, "resize-card", { index: 0, colSpan: 10, rowSpan: 9 });
    await el.updateComplete;
    expect(tile(el, 0).style.gridColumn).toBe("span 10");
    expect(tile(el, 0).style.gridRow).toBe("span 9");
  });

  it("clamps a resize-card intent to the tab columns (high) and to 1 (low)", async () => {
    const el = await openEditor();
    fireIntent(el, "resize-card", { index: 0, colSpan: 99, rowSpan: 0 });
    await el.updateComplete;
    expect(tile(el, 0).style.gridColumn).toBe("span 12"); // clamped to columns
    expect(tile(el, 0).style.gridRow).toBe("span 1"); // clamped to >= 1
    fireIntent(el, "resize-card", { index: 0, colSpan: -3, rowSpan: 4 });
    await el.updateComplete;
    expect(tile(el, 0).style.gridColumn).toBe("span 1"); // clamped to >= 1
  });

  it("does not rebuild the draft on resize moves that stay pinned at the clamp bound", async () => {
    // The resize drag re-emits raw spans each cell it crosses; dragging PAST the max-column bound
    // (raw colSpan 13, 14, 15…) snaps to the SAME clamped result each step. The owner must rebuild
    // the draft only when the clamped spans actually change, not on every beyond-bound move.
    // (Prove-by-deletion: without the skip in #setSpans, each beyond-bound move rebuilds the draft to
    // an identical clamped result, so the active-tab object identity changes and this test fails.)
    const el = await openEditor();
    const preview = el.shadowRoot!.querySelector("canvas-grid-preview") as HTMLElement & {
      tab: object | null;
    };
    // Card 0 starts at colSpan 8 (columns 12). First beyond-bound move clamps 13 → 12: a genuine
    // change, so it rebuilds once.
    fireIntent(el, "resize-card", { index: 0, colSpan: 13, rowSpan: 6 });
    await el.updateComplete;
    expect(tile(el, 0).style.gridColumn).toBe("span 12");
    const tabAtClamp = preview.tab; // the draft's active tab, once the clamp is reached
    // Further beyond-bound moves all clamp to the same 12 — the owner must NOT rebuild.
    fireIntent(el, "resize-card", { index: 0, colSpan: 14, rowSpan: 6 });
    await el.updateComplete;
    fireIntent(el, "resize-card", { index: 0, colSpan: 15, rowSpan: 6 });
    await el.updateComplete;
    expect(preview.tab).toBe(tabAtClamp); // same object identity: no #updateActiveTab clone
    expect(tile(el, 0).style.gridColumn).toBe("span 12"); // output unchanged, only wasted work removed
    // A genuine change still rewrites — the skip must not over-suppress.
    fireIntent(el, "resize-card", { index: 0, colSpan: 5, rowSpan: 6 });
    await el.updateComplete;
    expect(preview.tab).not.toBe(tabAtClamp);
    expect(tile(el, 0).style.gridColumn).toBe("span 5");
  });

  it("refuses to move the first card up (no-op at the boundary)", async () => {
    const el = await openEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=palette-held-orders]")!.click();
    await el.updateComplete;
    selectCard(el, 0);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=card-up]")!.click();
    await el.updateComplete;
    expect(tile(el, 0).style.gridColumn).toBe("span 8");
  });

  it("adds a tab (empty) and switches the active canvas between tabs", async () => {
    const el = await openEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-tab]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=tab-btn-]").length).toBe(2);
    // The new tab is active and empty.
    expect(previewRoot(el).querySelector("[data-test=empty-grid]")).toBeTruthy();
    // Switch back to the original tab — its one card is shown again.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=tab-btn-counter]")!.click();
    await el.updateComplete;
    expect(tiles(el).length).toBe(1);
  });

  it("Cancelar returns to the list and clears the draft", async () => {
    const el = await openEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-cancel]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=canvas-row-c1]")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("[data-test=editor-placeholder]")).toBeNull();
  });
});

// A COMPLETE, client-valid `till` definition (all four sale-critical cards present) — the fixture the
// happy-path save + property-panel tests edit and save back. Distinct from the module-level `canvases`
// fixture, whose c1 is deliberately a single-card, single-tab till (structural-edit tests read it) that
// would FAIL the client validator, so it cannot exercise a successful save. `held-orders` at index 4
// carries a `visibleWhen` so the visibility-toggle test has a card with visibility states to edit.
const validTillDefinition = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
        { type: "total", colSpan: 4, rowSpan: 1, config: {} },
        { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
        { type: "held-orders", colSpan: 8, rowSpan: 2, config: {}, visibleWhen: ["has-parked"] },
      ],
    },
  ],
};

describe("canvas-editor-screen property panel + save (B7)", () => {
  function selectCard(el: CanvasEditorScreen, index: number) {
    el.shadowRoot!.querySelector("canvas-grid-preview")!.dispatchEvent(
      new CustomEvent("select-card", { detail: { index }, bubbles: true, composed: true }),
    );
  }
  function change(el: CanvasEditorScreen, testId: string, value: string) {
    el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  }
  function toggle(el: CanvasEditorScreen, testId: string, checked: boolean) {
    el.shadowRoot!.querySelector(`[data-test=${testId}]`)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
    );
  }
  // Open the editor on a canvas the caller supplies (default: the complete, valid till).
  async function openValidEditor(overrides: Partial<DashboardApi> = {}) {
    const api = stubApi({
      getCanvas: vi
        .fn()
        .mockResolvedValue({ id: "c1", name: "Counter till", definition: validTillDefinition }),
      ...overrides,
    });
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
    await flush(el);
    return { el, api };
  }
  // Enter editor mode via Crear (no id yet → a save creates), seeding from a form factor's default.
  async function openNewEditor(name: string, formFactor = "till") {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    change(el, "create-name", name);
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=create-form-factor]",
    )!;
    select.value = formFactor;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-create]")!.click();
    await el.updateComplete;
    return { el, api };
  }

  it("shows the config field for product-grid and 'no config' for a card without one", async () => {
    const { el } = await openValidEditor();
    selectCard(el, 0); // product-grid
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=config-columns]")).toBeTruthy();
    selectCard(el, 1); // basket — no config fields
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=no-config]")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("[data-test=config-columns]")).toBeNull();
  });

  it("edits product-grid.columns config and saves it into the definition", async () => {
    const { el, api } = await openValidEditor();
    selectCard(el, 0);
    await el.updateComplete;
    change(el, "config-columns", "4");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    expect(api.updateCanvas).toHaveBeenCalledTimes(1);
    const definition = (api.updateCanvas as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(definition.tabs[0].cards[0].config.columns).toBe(4);
  });

  it("toggles a card's visibleWhen membership and omits the key when emptied", async () => {
    const { el, api } = await openValidEditor();
    selectCard(el, 4); // held-orders — visibleWhen ["has-parked"]
    await el.updateComplete;
    // Turn on 'empty', turn off the pre-set 'has-parked'.
    toggle(el, "visible-empty", true);
    await el.updateComplete;
    toggle(el, "visible-has-parked", false);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    const definition = (api.updateCanvas as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(definition.tabs[0].cards[4].visibleWhen).toEqual(["empty"]);
  });

  it("omits visibleWhen entirely once the last state is turned off", async () => {
    const { el, api } = await openValidEditor();
    selectCard(el, 4); // held-orders — visibleWhen ["has-parked"]
    await el.updateComplete;
    toggle(el, "visible-has-parked", false);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    const definition = (api.updateCanvas as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect("visibleWhen" in definition.tabs[0].cards[4]).toBe(false);
  });

  it("shows a permission note for a card that requires a permission", async () => {
    const { el } = await openValidEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=palette-table-layout-editor]")!.click();
    await el.updateComplete;
    selectCard(el, 5);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=permission-note]")).toBeTruthy();
  });

  it("edits the active tab's title and columns via tab settings", async () => {
    const { el, api } = await openValidEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=tab-settings]")!.click();
    await el.updateComplete;
    change(el, "tab-title", "Barra");
    await el.updateComplete;
    change(el, "tab-columns", "10");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    const definition = (api.updateCanvas as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(definition.tabs[0].title).toBe("Barra");
    expect(definition.tabs[0].columns).toBe(10);
  });

  it("disables tab-delete when only one tab remains (last-tab guard)", async () => {
    const { el } = await openValidEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=tab-settings]")!.click();
    await el.updateComplete;
    const del = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=tab-delete]",
    )!;
    expect(del.hasAttribute("disabled")).toBe(true);
  });

  it("deletes a tab when more than one remains", async () => {
    const { el } = await openValidEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-tab]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=tab-btn-]").length).toBe(2);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=tab-settings]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=tab-delete]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-test^=tab-btn-]").length).toBe(1);
  });

  it("edits the canvas name and form factor in canvas settings", async () => {
    // Capabilities are no longer edited here — they relocated onto the device profile (Task 9), so
    // canvas settings offers only the name + form factor now.
    const { el, api } = await openValidEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=canvas-settings]")!.click();
    await el.updateComplete;
    change(el, "canvas-name", "Renamed");
    await el.updateComplete;
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=canvas-form-factor]",
    )!;
    select.value = "kds";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    const [id, name, definition] = (api.updateCanvas as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe("c1");
    expect(name).toBe("Renamed");
    expect(definition.formFactor).toBe("kds");
    // The saved definition carries no capabilities key (relocated to the device profile, Task 9).
    expect("capabilities" in definition).toBe(false);
  });

  it("Save on a new canvas calls createCanvas with the name and definition, and returns to the list", async () => {
    const { el, api } = await openNewEditor("Fresh till");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    expect(api.createCanvas).toHaveBeenCalledTimes(1);
    const [name, definition] = (api.createCanvas as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(name).toBe("Fresh till");
    expect(definition.formFactor).toBe("till");
    // Returned to the list (the placeholder is gone, a row is shown).
    expect(el.shadowRoot!.querySelector("[data-test=editor-placeholder]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=canvas-row-c1]")).toBeTruthy();
  });

  it("Save on an existing canvas calls updateCanvas and returns to the list", async () => {
    const { el, api } = await openValidEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    expect(api.updateCanvas).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("[data-test=editor-placeholder]")).toBeNull();
  });

  it("blocks Save on a client-invalid draft (removes a sale-critical card) and shows the banner", async () => {
    const { el, api } = await openValidEditor();
    selectCard(el, 0); // product-grid (sale-critical)
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=card-remove]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    expect(api.updateCanvas).not.toHaveBeenCalled();
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain(codeMessage("canvas_editor.err_missing_required"));
    // Stayed in editor mode.
    expect(el.shadowRoot!.querySelector("[data-test=editor-placeholder]")).toBeTruthy();
  });

  it("blocks Save when the name is empty and shows the banner", async () => {
    const { el, api } = await openNewEditor(""); // create with an empty name
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    expect(api.createCanvas).not.toHaveBeenCalled();
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain(codeMessage("canvas_editor.err_no_name"));
  });

  it("surfaces a server canvas.name_taken rejection in the banner", async () => {
    const { el } = await openValidEditor({
      updateCanvas: vi.fn().mockRejectedValue({ code: "canvas.name_taken" }),
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain(codeMessage("canvas.name_taken"));
  });

  it("clamps product-grid.columns to 1..12 and ignores a non-numeric entry", async () => {
    const { el, api } = await openValidEditor();
    selectCard(el, 0);
    await el.updateComplete;
    change(el, "config-columns", "99"); // above the max → clamps to 12
    await el.updateComplete;
    change(el, "config-columns", "abc"); // non-numeric → ignored (stays 12)
    await el.updateComplete;
    change(el, "config-columns", "0"); // below the min → clamps to 1
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    const definition = (api.updateCanvas as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(definition.tabs[0].cards[0].config.columns).toBe(1);
  });

  it("clears product-grid.columns when the field is emptied", async () => {
    const { el, api } = await openValidEditor();
    selectCard(el, 0);
    await el.updateComplete;
    change(el, "config-columns", "5");
    await el.updateComplete;
    change(el, "config-columns", ""); // emptied → the key is removed, not stored as a value
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    const definition = (api.updateCanvas as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect("columns" in definition.tabs[0].cards[0].config).toBe(false);
  });

  it("adds a visibleWhen state to a card that started with none", async () => {
    const { el, api } = await openValidEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=palette-prep-queue]")!.click(); // no visibleWhen yet
    await el.updateComplete;
    selectCard(el, 5);
    await el.updateComplete;
    toggle(el, "visible-empty", true);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    const definition = (api.updateCanvas as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(definition.tabs[0].cards[5].visibleWhen).toEqual(["empty"]);
  });

  it("canvas settings no longer renders a Capabilities section (relocated to the device profile, Task 9)", async () => {
    // Capabilities editing moved to the device-profile editor. Canvas settings offers only the name +
    // form factor, so neither the section nor any capability switch is present.
    const { el } = await openValidEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=canvas-settings]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=capabilities]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=cap-integrated-card-payment]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=cap-act-as-kds]")).toBeNull();
  });

  it("clamps a tab's column count to 1..24 and ignores a non-numeric entry", async () => {
    const { el, api } = await openValidEditor();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=tab-settings]")!.click();
    await el.updateComplete;
    change(el, "tab-columns", "99"); // above the max → clamps to 24
    await el.updateComplete;
    change(el, "tab-columns", "abc"); // non-numeric → ignored (stays 24)
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    const definition = (api.updateCanvas as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(definition.tabs[0].columns).toBe(24);
  });
});

describe("canvas editor URL tabs", () => {
  it("reopens a saved canvas and its selected tab, then follows tab history", async () => {
    const canvas = {
      ...canvases[0]!,
      definition: {
        formFactor: "till",
        tabs: [
          { key: "counter", title: "Counter", columns: 12, cards: [] },
          { key: "floor", title: "Floor", columns: 12, cards: [] },
        ],
      },
    };
    const url = new URL(location.href);
    url.pathname = "/manage/canvas-editor/canvas/c1/tab/floor";
    history.replaceState(null, "", url);
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", {
      api: stubApi({ getCanvas: vi.fn().mockResolvedValue(canvas) }),
    });
    await flush(el);
    expect(
      el.shadowRoot!.querySelector('[data-test="tab-btn-floor"]')?.getAttribute("variant"),
    ).toBe("primary");
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="tab-btn-counter"]')!.click();
    await el.updateComplete;
    expect(location.pathname).toBe("/manage/canvas-editor/canvas/c1/tab/counter");
    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await back;
    await flush(el);
    expect(
      el.shadowRoot!.querySelector('[data-test="tab-btn-floor"]')?.getAttribute("variant"),
    ).toBe("primary");
  });
});

it("Enter in a tab title saves the edited canvas draft", async () => {
  const api = stubApi({
    getCanvas: vi.fn().mockResolvedValue({ ...canvases[0], definition: validTillDefinition }),
  });
  const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
  await flush(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
  await flush(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=tab-settings]")!.click();
  await el.updateComplete;
  const field =
    el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("[data-test=tab-title]")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = "Lunch";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  input.focus();
  await userEvent.keyboard("{Enter}");
  await flush(el);
  expect(api.updateCanvas).toHaveBeenCalledExactlyOnceWith(
    "c1",
    "Counter till",
    expect.objectContaining({
      formFactor: "till",
      tabs: [expect.objectContaining({ key: "counter", title: "Lunch", columns: 12 })],
    }),
  );
});

describe("canvas navigation during requests", () => {
  it.each(["missing", "invalid"])(
    "returns to the list when history opens a %s canvas",
    async (failure) => {
      history.replaceState(null, "", "/manage/canvas-editor/canvas/c2");
      history.pushState(null, "", "/manage/canvas-editor/canvas/c1");
      const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", {
        api: stubApi({
          getCanvas: vi.fn(async (id: string) => {
            if (id === "c1") return canvases[0]!;
            if (failure === "missing") throw { code: "canvas.not_found" };
            return { id: "c2", name: "Broken canvas", definition: null };
          }),
        }),
      });
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=editor-name]")?.textContent).toBe(
        "Counter till",
      );
      const back = new Promise<void>((done) =>
        window.addEventListener("popstate", () => done(), { once: true }),
      );
      history.back();
      await back;
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=editor-name]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=canvas-row-c1]")).not.toBeNull();
      expect(location.pathname).toBe("/manage/canvas-editor");
      expect(el.shadowRoot!.textContent).toContain(
        codeMessage(failure === "missing" ? "canvas.not_found" : "canvas.invalid"),
      );
    },
  );

  it("keeps the list after Back cancels a pending canvas open", async () => {
    let resolve!: (value: Canvas) => void;
    const getCanvas = vi.fn(
      () =>
        new Promise<Canvas>((done) => {
          resolve = done;
        }),
    );
    const list = new URL(location.href);
    list.pathname = "/manage/canvas-editor";
    history.replaceState(null, "", list);
    const editor = new URL(list);
    editor.pathname = "/manage/canvas-editor/canvas/c1";
    history.pushState(null, "", editor);
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", {
      api: stubApi({ getCanvas }),
    });
    await flush(el);
    expect(getCanvas).toHaveBeenCalledWith("c1");
    const back = new Promise<void>((done) =>
      window.addEventListener("popstate", () => done(), { once: true }),
    );
    history.back();
    await back;
    await flush(el);
    resolve(canvases[0]!);
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-test="editor-name"]')).toBeNull();
    expect(location.pathname).toBe("/manage/canvas-editor");
  });

  it("keeps the newer canvas open when an earlier save finishes", async () => {
    let resolve!: () => void;
    const updateCanvas = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const getCanvas = vi.fn(async (id: string) => ({
      id,
      name: id,
      definition: validTillDefinition,
    }));
    const url = new URL(location.href);
    url.pathname = "/manage/canvas-editor/canvas/c2";
    history.replaceState(null, "", url);
    url.pathname = "/manage/canvas-editor/canvas/c1";
    history.pushState(null, "", url);
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", {
      api: stubApi({ getCanvas, updateCanvas }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
    await flush(el);
    expect(updateCanvas).toHaveBeenCalledTimes(1);
    const back = new Promise<void>((done) =>
      window.addEventListener("popstate", () => done(), { once: true }),
    );
    history.back();
    await back;
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-test="editor-name"]')?.textContent).toBe("c2");
    resolve();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-test="editor-name"]')?.textContent).toBe("c2");
    expect(location.pathname).toMatch(/^\/manage\/canvas-editor\/canvas\/c2(?:\/|$)/);
  });
});

it("does not save twice before the disabled state renders", async () => {
  let resolve!: () => void;
  const updateCanvas = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const url = new URL(location.href);
  url.pathname = "/manage/canvas-editor/canvas/c1";
  history.replaceState(null, "", url);
  const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", {
    api: stubApi({
      getCanvas: vi
        .fn()
        .mockResolvedValue({ id: "c1", name: "Counter", definition: validTillDefinition }),
      updateCanvas,
    }),
  });
  await flush(el);
  const save = el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!;
  save.click();
  save.click();
  try {
    expect(updateCanvas).toHaveBeenCalledTimes(1);
  } finally {
    resolve();
    await flush(el);
  }
});

it("invalidates an outstanding open when history returns to the canvas already displayed", async () => {
  let resolve!: (value: Canvas) => void;
  const getCanvas = vi.fn((id: string) =>
    id === "c2"
      ? new Promise<Canvas>((done) => {
          resolve = done;
        })
      : Promise.resolve(canvases[0]!),
  );
  const url = new URL(location.href);
  url.pathname = "/manage/canvas-editor/canvas/c1";
  history.replaceState(null, "", url);
  const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", {
    api: stubApi({ getCanvas }),
  });
  await flush(el);
  url.pathname = "/manage/canvas-editor/canvas/c2";
  history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await flush(el);
  const back = new Promise<void>((done) =>
    window.addEventListener("popstate", () => done(), { once: true }),
  );
  history.back();
  await back;
  await flush(el);
  resolve({ ...canvases[0]!, id: "c2", name: "Other canvas" });
  await flush(el);
  expect(el.shadowRoot!.querySelector('[data-test="editor-name"]')?.textContent).toBe(
    "Counter till",
  );
  expect(location.pathname).toMatch(/^\/manage\/canvas-editor\/canvas\/c1(?:\/|$)/);
});

it("updates the created canvas when its draft was edited during the first save", async () => {
  let resolve!: (value: { id: string }) => void;
  const createCanvas = vi.fn(
    () =>
      new Promise<{ id: string }>((done) => {
        resolve = done;
      }),
  );
  const updateCanvas = vi.fn().mockResolvedValue(undefined);
  const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", {
    api: stubApi({ createCanvas, updateCanvas }),
  });
  await flush(el);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="create"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector('[data-test="create-name"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "New counter" }, bubbles: true }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-create"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await flush(el);
  expect(createCanvas).toHaveBeenCalledTimes(1);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="canvas-settings"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector('[data-test="canvas-name"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Renamed while saving" }, bubbles: true }),
  );
  await el.updateComplete;
  resolve({ id: "new-canvas" });
  await flush(el);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await flush(el);
  expect(createCanvas).toHaveBeenCalledTimes(1);
  expect(updateCanvas).toHaveBeenCalledWith(
    "new-canvas",
    "Renamed while saving",
    expect.any(Object),
  );
});

it("keeps added and reselected unsaved tabs out of URLs and history", async () => {
  history.replaceState(null, "", "/manage/canvas-editor/canvas/c1/tab/counter");
  const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", {
    api: stubApi(),
  });
  await flush(el);
  const push = vi.spyOn(history, "pushState");
  const replace = vi.spyOn(history, "replaceState");
  try {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-tab]")!.click();
    await el.updateComplete;
    const tabs = el.shadowRoot!.querySelectorAll<HTMLElement>('[data-test^="tab-btn-"]');
    expect(tabs).toHaveLength(2);
    expect(location.pathname).toBe("/manage/canvas-editor/canvas/c1/tab/counter");
    tabs[0]!.click();
    await el.updateComplete;
    tabs[1]!.click();
    await el.updateComplete;
    expect(tabs[1]!.getAttribute("variant")).toBe("primary");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  } finally {
    push.mockRestore();
    replace.mockRestore();
  }
});

it("makes persisted tabs navigable while retaining edits made during their save", async () => {
  history.replaceState(null, "", "/manage/canvas-editor/canvas/c1/tab/counter");
  let resolve!: () => void;
  const updateCanvas = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", {
    api: stubApi({
      getCanvas: vi.fn().mockResolvedValue({ ...canvases[0], definition: validTillDefinition }),
      updateCanvas,
    }),
  });
  await flush(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-tab]")!.click();
  await el.updateComplete;
  const savedTab = el.shadowRoot!.querySelectorAll<HTMLElement>('[data-test^="tab-btn-"]')[1]!;
  const savedKey = savedTab.getAttribute("data-test")!.slice("tab-btn-".length);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await flush(el);
  expect(updateCanvas).toHaveBeenCalledTimes(1);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-tab]")!.click();
  await el.updateComplete;
  resolve();
  await flush(el);
  const tabs = el.shadowRoot!.querySelectorAll<HTMLElement>('[data-test^="tab-btn-"]');
  expect(tabs).toHaveLength(3);
  tabs[1]!.click();
  await el.updateComplete;
  expect(location.pathname).toBe(`/manage/canvas-editor/canvas/c1/tab/${savedKey}`);
  tabs[2]!.click();
  await el.updateComplete;
  expect(location.pathname).toBe(`/manage/canvas-editor/canvas/c1/tab/${savedKey}`);
});
