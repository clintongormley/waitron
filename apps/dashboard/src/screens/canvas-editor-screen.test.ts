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
