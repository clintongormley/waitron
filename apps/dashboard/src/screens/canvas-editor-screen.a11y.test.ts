import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./canvas-editor-screen.js";
import type { CanvasEditorScreen } from "./canvas-editor-screen.js";
import type { Canvas, DashboardApi } from "../api/client.js";

/**
 * The Lienzos (canvas editor) screen scanned by axe in both themes, in two states: LIST mode (the
 * gallery of canvases, its Crear button, per-row Editar/Duplicar/Eliminar controls and thumbnails),
 * and EDITOR mode with a card selected (the tab bar, the interactive canvas, the palette and the card
 * property panel with its span steppers, config, visibility toggles and reorder/remove controls).
 * Mounted by ASSIGNING the `api` STUB as a property (never bare markup), exactly as the sibling screen
 * a11y suites do: `connectedCallback` fires `void this.#load()` → `listCanvases()`, so the stub must
 * resolve it (and `getCanvas`, reached when the editor opens) or a stray rejection pollutes the run.
 */
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
          cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } }],
        },
      ],
    },
  },
];

function stubApi(): DashboardApi {
  return {
    listCanvases: vi.fn().mockResolvedValue(canvases),
    getCanvas: vi.fn().mockResolvedValue(canvases[0]),
    createCanvas: vi.fn().mockResolvedValue({ id: "c9" }),
    updateCanvas: vi.fn().mockResolvedValue(undefined),
    deleteCanvas: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

/** Settles the in-flight load and the follow-up render. */
async function flush(el: CanvasEditorScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("canvas-editor-screen a11y (%s theme)", (theme) => {
  it("renders the canvas gallery with its controls and thumbnails accessibly", async () => {
    const { el, host } = await mountWidget<CanvasEditorScreen>(
      "dashboard-canvas-editor-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the editor with a card selected accessibly", async () => {
    const { el, host } = await mountWidget<CanvasEditorScreen>(
      "dashboard-canvas-editor-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    // Open the canvas in the editor (getCanvas resolves, mode → editor)...
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-c1]")!.click();
    await flush(el);
    // ...then select the first tile so the card property panel is in the a11y tree.
    el.shadowRoot!.querySelector("canvas-grid-preview")!.dispatchEvent(
      new CustomEvent("select-card", { detail: { index: 0 }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
