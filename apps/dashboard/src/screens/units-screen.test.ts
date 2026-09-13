import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, ProductUsingUnit, Unit } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
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
    reassignProductsUnit: vi.fn().mockResolvedValue([]),
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
  // No confirmation step: clicking Delete attempts the delete, which the stub refuses as in-use.
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>("[data-test=delete-u1]")!
    .click();
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

  it("emits an edit-product event to open the product's editor", async () => {
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
    expect(event.detail).toEqual({ productId: "p1" });
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

  it("shows an empty state after the last product is reassigned, then deletes from the modal", async () => {
    const deleteUnit = vi
      .fn()
      .mockRejectedValueOnce({ code: "unit.in_use", params: { products: [inUseProducts[0]] } })
      .mockResolvedValueOnce(undefined);
    const reassignProductsUnit = vi.fn().mockResolvedValue([]);
    const el = await mount(stubApi({ deleteUnit, reassignProductsUnit }));
    const dialog = await openInUseModal(el);
    dialog
      .querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-p1]")!
      .click();
    await el.updateComplete;
    const select = dialog.querySelector<HTMLSelectElement>("[data-test=reassign-unit]")!;
    select.value = "u2";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;
    dialog.querySelector<HTMLElement>("[data-test=change-unit]")!.click();
    await flush(el);
    expect(reassignProductsUnit).toHaveBeenCalledWith("u1", ["p1"], "u2");
    expect(dialog.querySelector("wt-data-table")).toBeNull();

    dialog.querySelector<HTMLElement>("[data-test=delete-unit]")!.click();
    await flush(el);
    expect(deleteUnit).toHaveBeenLastCalledWith("u1");
    expect(dialog.open).toBe(false);
  });

  it("deletes a unit immediately, with no confirmation step, when nothing uses it", async () => {
    const deleteUnit = vi.fn().mockResolvedValue(undefined);
    const el = await mount(stubApi({ deleteUnit }));
    el.shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=delete-u1]")!
      .click();
    await flush(el);
    expect(deleteUnit).toHaveBeenCalledWith("u1");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-test=in-use-dialog]")!
        .open,
    ).toBe(false);
    const rows = el.shadowRoot!.querySelector("wt-data-table")!.rows as readonly Unit[];
    expect(rows.some((unit) => unit.id === "u1")).toBe(false);
  });

  it("reassigns the checked products to another unit and refreshes the list", async () => {
    const reassignProductsUnit = vi.fn().mockResolvedValue([inUseProducts[1]]);
    const el = await mount(
      stubApi({
        deleteUnit: vi
          .fn()
          .mockRejectedValue({ code: "unit.in_use", params: { products: inUseProducts } }),
        reassignProductsUnit,
      }),
    );
    const dialog = await openInUseModal(el);
    const productTable = dialog.querySelector("wt-data-table")!;
    productTable.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-p1]")!.click();
    await el.updateComplete;
    const select = dialog.querySelector<HTMLSelectElement>("[data-test=reassign-unit]")!;
    select.value = "u2";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;
    dialog.querySelector<HTMLElement>("[data-test=change-unit]")!.click();
    await flush(el);
    expect(reassignProductsUnit).toHaveBeenCalledWith("u1", ["p1"], "u2");
    expect((productTable.rows as ProductUsingUnit[]).map((product) => product.id)).toEqual(["p2"]);
  });

  // Nothing failed to LOAD here, so the banner has to carry the refusal's own sentence — the
  // generic load message would be a lie about what went wrong.
  it("shows the refusal's own message when a bulk reassignment fails", async () => {
    const el = await mount(
      stubApi({
        deleteUnit: vi
          .fn()
          .mockRejectedValue({ code: "unit.in_use", params: { products: inUseProducts } }),
        reassignProductsUnit: vi.fn().mockRejectedValue({ code: "unit.not_found" }),
      }),
    );
    const dialog = await openInUseModal(el);
    dialog
      .querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-p1]")!
      .click();
    await el.updateComplete;
    const select = dialog.querySelector<HTMLSelectElement>("[data-test=reassign-unit]")!;
    select.value = "u2";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;
    dialog.querySelector<HTMLElement>("[data-test=change-unit]")!.click();
    await flush(el);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("unit.not_found"));
    expect(alert.textContent).not.toContain(t("units.load_error"));
  });

  it("closes the in-use modal without deleting when Cancel is clicked", async () => {
    const el = await mount(inUseApi());
    const dialog = await openInUseModal(el);
    expect(dialog.open).toBe(true);
    dialog.querySelector<HTMLElement>("[data-test=cancel-in-use]")!.click();
    await el.updateComplete;
    expect(dialog.open).toBe(false);
  });

  it("restores focus to the row menu when the in-use modal is cancelled", async () => {
    const el = await mount(inUseApi());
    const menu = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("wt-row-actions")!;
    const trigger = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    trigger.focus();
    const dialog = await openInUseModal(el);
    dialog.querySelector<HTMLElement>("[data-test=cancel-in-use]")!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(menu.shadowRoot!.activeElement).toBe(trigger);
  });
});
