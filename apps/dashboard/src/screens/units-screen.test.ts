import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, ProductUsingUnit, Unit } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { UnitsScreen } from "./units-screen.js";
import "./units-screen.js";

afterEach(cleanupWidgets);

const units: Unit[] = [
  { id: "u1", name: { es: "unidad", en: "each" }, precision: 0 },
  { id: "u2", name: { es: "kilogramo", en: "kilogram" }, precision: 3 },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    liveData: new LiveData(),
    background: {
      listUnits: vi.fn().mockResolvedValue(units),
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    },
    listUnits: vi.fn().mockResolvedValue(units),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    createUnit: vi.fn().mockResolvedValue({ id: "u3", name: { es: "caja" }, precision: 0 }),
    updateUnit: vi.fn().mockResolvedValue(units[0]),
    deleteUnit: vi.fn().mockResolvedValue(undefined),
    productsUsingUnit: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as DashboardApi;
}

const inUseProducts: ProductUsingUnit[] = [
  { id: "p1", name: { es: "Café", en: "Coffee" }, available: true },
  { id: "p2", name: { es: "Té", en: "Tea" }, available: false },
];

function inUseApi(products = inUseProducts): DashboardApi {
  return stubApi({
    deleteUnit: vi.fn().mockRejectedValue({ code: "unit.in_use", params: { products } }),
  });
}

async function openInUseModal(el: UnitsScreen): Promise<HTMLElement & { open: boolean }> {
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>("[data-test=delete-u1]")!
    .click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await flush(el);
  return el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
    "[data-test=in-use-dialog]",
  )!;
}

async function flush(el: UnitsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(api = stubApi()): Promise<UnitsScreen> {
  const { el } = await mountWidget<UnitsScreen>("dashboard-units-screen", { api });
  await flush(el);
  return el;
}

describe("units-screen", () => {
  it("lists localized units and filters them", async () => {
    const el = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(table.shadowRoot!.querySelector('[data-row-key="u1"]')).toBeTruthy();
    expect(table.shadowRoot!.textContent).toContain("kilogramo");
    el.shadowRoot!.querySelector("[data-test=search]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "kilo" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect((table.rows as readonly Unit[]).map((unit) => unit.id)).toEqual(["u2"]);
  });

  it("blocks duplicate submissions and closes after a successful create", async () => {
    let resolveCreate!: (unit: Unit) => void;
    const createUnit: DashboardApi["createUnit"] = vi.fn(
      () => new Promise<Unit>((resolve) => (resolveCreate = resolve)),
    );
    const api = stubApi({ createUnit });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    const submit = new CustomEvent("wt-submit", {
      detail: { value: { name: { es: "caja" }, precision: 0 } },
      bubbles: true,
      composed: true,
    });
    form.dispatchEvent(submit);
    form.dispatchEvent(submit);
    expect(api.createUnit).toHaveBeenCalledTimes(1);
    resolveCreate({ id: "u3", name: { es: "caja" }, precision: 0 });
    await flush(el);
    expect(form.open).toBe(false);
  });

  it("retains the editor on a failed write", async () => {
    const api = stubApi({ createUnit: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { name: { es: "caja" }, precision: 0 } },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(form.open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });

  it("places server validation beside the offending field", async () => {
    const api = stubApi({
      createUnit: vi.fn().mockRejectedValue({ code: "unit.precision_invalid" }),
    });
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { name: { es: "caja" }, precision: 2 } },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(form.fieldErrors.precision).toBeTruthy();
  });

  it("keeps the editor closed when refresh fails after a successful write", async () => {
    const background = {
      listUnits: vi.fn().mockRejectedValue({ code: "server.internal" }),
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    };
    const api = stubApi({ background } as unknown as Partial<DashboardApi>);
    const el = await mount(api);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { name: { es: "caja" }, precision: 0 } },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(form.open).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy();
  });

  it("uses the passive client for live refresh and restores focus after Cancel", async () => {
    const api = stubApi();
    const el = await mount(api);
    const create = el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!;
    create.focus();
    create.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector("dashboard-unit-form")!.dispatchEvent(
      new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(el.shadowRoot!.activeElement).toBe(create);

    api.liveData.invalidate([{ type: "units", id: "u1" }]);
    await flush(el);
    expect(api.background.listUnits).toHaveBeenCalled();
  });

  it("opens a modal listing the products with availability when a delete is refused", async () => {
    const el = await mount(inUseApi());
    const dialog = await openInUseModal(el);
    expect(dialog.open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    const productTable = dialog.querySelector("wt-data-table")!;
    expect((productTable.rows as ProductUsingUnit[]).map((product) => product.id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(productTable.shadowRoot!.textContent).toContain("Café");
    // The availability column reuses the product active/inactive labels (es-ES is the test locale).
    expect(productTable.shadowRoot!.textContent).toContain("Inactivo");
  });

  it("filters the product list in the modal", async () => {
    const el = await mount(inUseApi());
    const dialog = await openInUseModal(el);
    dialog
      .querySelector("[data-test=in-use-search]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "té" }, bubbles: true, composed: true }),
      );
    await el.updateComplete;
    const productTable = dialog.querySelector("wt-data-table")!;
    expect((productTable.rows as ProductUsingUnit[]).map((product) => product.id)).toEqual(["p2"]);
  });

  it("emits an edit-product event carrying the unit to return to", async () => {
    const el = await mount(inUseApi());
    const dialog = await openInUseModal(el);
    const edited = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("wt-edit-product", (event) => resolve(event as CustomEvent), {
        once: true,
      }),
    );
    dialog
      .querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=edit-product-p1]")!
      .click();
    const event = await edited;
    expect(event.detail).toEqual({ productId: "p1", returnToUnitId: "u1" });
  });

  it("deletes the unit from the modal once nothing uses it", async () => {
    const deleteUnit = vi
      .fn()
      .mockRejectedValueOnce({ code: "unit.in_use", params: { products: inUseProducts } })
      .mockResolvedValueOnce(undefined);
    const el = await mount(stubApi({ deleteUnit }));
    const dialog = await openInUseModal(el);
    dialog.querySelector<HTMLElement>("[data-test=delete-unit]")!.click();
    await flush(el);
    expect(deleteUnit).toHaveBeenCalledTimes(2);
    expect(dialog.open).toBe(false);
    const rows = el.shadowRoot!.querySelector("wt-data-table")!.rows as readonly Unit[];
    expect(rows.some((unit) => unit.id === "u1")).toBe(false);
  });

  it("refreshes the modal list when a retried delete is still refused", async () => {
    const deleteUnit = vi
      .fn()
      .mockRejectedValueOnce({ code: "unit.in_use", params: { products: inUseProducts } })
      .mockRejectedValueOnce({ code: "unit.in_use", params: { products: [inUseProducts[1]] } });
    const el = await mount(stubApi({ deleteUnit }));
    const dialog = await openInUseModal(el);
    dialog.querySelector<HTMLElement>("[data-test=delete-unit]")!.click();
    await flush(el);
    expect(dialog.open).toBe(true);
    const productTable = dialog.querySelector("wt-data-table")!;
    expect((productTable.rows as ProductUsingUnit[]).map((product) => product.id)).toEqual(["p2"]);
  });

  it("reopens the modal for a unit on request, fetching its current products", async () => {
    const productsUsingUnit = vi.fn().mockResolvedValue([inUseProducts[0]]);
    const el = await mount(stubApi({ productsUsingUnit }));
    const consumed = new Promise<void>((resolve) =>
      el.addEventListener("wt-reopen-consumed", () => resolve(), { once: true }),
    );
    el.reopenUnitId = "u1";
    await consumed;
    await flush(el);
    expect(productsUsingUnit).toHaveBeenCalledWith("u1");
    const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      "[data-test=in-use-dialog]",
    )!;
    expect(dialog.open).toBe(true);
    expect(
      (dialog.querySelector("wt-data-table")!.rows as ProductUsingUnit[]).map((p) => p.id),
    ).toEqual(["p1"]);
  });

  it("shows an empty state and deletes once no product is left, from the modal", async () => {
    const deleteUnit = vi.fn().mockResolvedValue(undefined);
    const productsUsingUnit = vi.fn().mockResolvedValue([]);
    const el = await mount(stubApi({ deleteUnit, productsUsingUnit }));
    const consumed = new Promise<void>((resolve) =>
      el.addEventListener("wt-reopen-consumed", () => resolve(), { once: true }),
    );
    el.reopenUnitId = "u1";
    await consumed;
    await flush(el);
    const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      "[data-test=in-use-dialog]",
    )!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("wt-data-table")).toBeNull();
    dialog.querySelector<HTMLElement>("[data-test=delete-unit]")!.click();
    await flush(el);
    expect(deleteUnit).toHaveBeenCalledWith("u1");
    expect(dialog.open).toBe(false);
  });

  it("closes the in-use modal without deleting when Close is clicked", async () => {
    const el = await mount(inUseApi());
    const dialog = await openInUseModal(el);
    expect(dialog.open).toBe(true);
    dialog.querySelector<HTMLElement>("[data-test=close-in-use]")!.click();
    await el.updateComplete;
    expect(dialog.open).toBe(false);
  });

  it("restores focus when deletion is cancelled", async () => {
    const el = await mount();
    const menu = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("wt-row-actions")!;
    const trigger = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    const remove = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=delete-u1]")!;
    trigger.focus();
    remove.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-delete]")!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(menu.shadowRoot!.activeElement).toBe(trigger);
  });
});
