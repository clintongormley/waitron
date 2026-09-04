import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./canvas-editor-screen.js";
import type { CanvasEditorScreen } from "./canvas-editor-screen.js";
import type { Canvas, DashboardApi } from "../api/client.js";

afterEach(cleanupWidgets);
const canvases: Canvas[] = [
  {
    id: "c1",
    name: "Counter till",
    definition: {
      formFactor: "till",
      capabilities: [],
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
    expect(input.value).toBe("Counter till (copy)");
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

  it("Editar enters editor mode for the chosen canvas", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CanvasEditorScreen>("dashboard-canvas-editor-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=canvas-row-c1]")).toBeNull();
    const placeholder = el.shadowRoot!.querySelector("[data-test=editor-placeholder]")!;
    expect(placeholder.getAttribute("data-editing-id")).toBe("c1");
    expect(placeholder.getAttribute("data-form-factor")).toBe("till");
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

  it("Guardar is an inert seam here (wired in B7 — no API write)", async () => {
    const api = stubApi();
    const el = await openEditor(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=editor-save]")!.click();
    await el.updateComplete;
    expect(api.createCanvas).not.toHaveBeenCalled();
    expect(api.updateCanvas).not.toHaveBeenCalled();
    // Still in editor mode.
    expect(el.shadowRoot!.querySelector("[data-test=editor-placeholder]")).toBeTruthy();
  });
});
