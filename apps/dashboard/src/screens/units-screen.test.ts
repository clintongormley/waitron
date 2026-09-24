import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, ProductUsingUnit, Unit } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { UnitsScreen } from "./units-screen.js";
import "./units-screen.js";

afterEach(cleanupWidgets);
// The table remembers its sort and precision filter in sessionStorage under waitron.units.table; a
// value left by an earlier test would make the first-visit assertions order-dependent.
beforeEach(() => sessionStorage.clear());
// Some tests pin the reader locale so the precision marker or a translated string can be asserted;
// restore the file's default (es-ES) afterwards so later tests are unaffected.
afterEach(() => setLocale("es-ES"));

const units: Unit[] = [
  {
    id: "u1",
    name: { es: "unidad", en: "each" },
    abbreviation: { es: "ud", en: "ea" },
    precision: 0,
  },
  {
    id: "u2",
    name: { es: "kilogramo", en: "kilogram" },
    abbreviation: { es: "kg", en: "kg" },
    precision: 3,
  },
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
    createUnit: vi.fn().mockResolvedValue({
      id: "u3",
      name: { es: "caja" },
      abbreviation: { es: "cj" },
      precision: 0,
    }),
    updateUnit: vi.fn().mockResolvedValue(units[0]),
    deleteUnit: vi.fn().mockResolvedValue(undefined),
    reassignProductsUnit: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as DashboardApi;
}

const inUseProducts: ProductUsingUnit[] = [
  { id: "p1", name: "Café", available: true },
  { id: "p2", name: "Té", available: false },
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

async function mountWith(list: Unit[]): Promise<UnitsScreen> {
  return mount(stubApi({ listUnits: vi.fn().mockResolvedValue(list) }));
}

/** The search box is in wt-data-table's shadow root. */
async function typeTableSearch(el: UnitsScreen, value: string): Promise<void> {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const search = table.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  search.value = value;
  search.dispatchEvent(new Event("input"));
  await el.updateComplete;
  await table.updateComplete;
}

function listedKeys(el: UnitsScreen): string[] {
  return [
    ...el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelectorAll("tr[data-row-key]"),
  ].map((row) => row.getAttribute("data-row-key")!);
}

/** The rendered text of a unit's precision cell (column order: name, abbreviation, precision). */
function precisionCellText(el: UnitsScreen, id: string): string {
  const row = el
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector(`tr[data-row-key="${id}"]`)!;
  return row.querySelectorAll("td")[2]!.textContent!.trim();
}

describe("units-screen", () => {
  it("lists localized units and searches them by name and abbreviation", async () => {
    setLocale("es-ES");
    const el = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(table.shadowRoot!.querySelector('[data-row-key="u1"]')).toBeTruthy();
    expect(table.shadowRoot!.textContent).toContain("kilogramo");
    await typeTableSearch(el, "kilo");
    expect(listedKeys(el)).toEqual(["u2"]);
    // The abbreviation is searchable too: "ud" is only unidad's abbreviation.
    await typeTableSearch(el, "ud");
    expect(listedKeys(el)).toEqual(["u1"]);
  });

  it("puts the create button in the header, not a toolbar", async () => {
    const el = await mount();
    const create = el.shadowRoot!.querySelector("[data-test=create]")!;
    expect(create.closest(".header-actions")).not.toBeNull();
    expect(create.closest(".heading")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".toolbar")).toBeNull();
  });

  it("makes the units table searchable", async () => {
    const el = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(table.searchable).toBe(true);
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector(".table-search")).not.toBeNull();
  });

  it("shows a unit's abbreviation in its own column", async () => {
    setLocale("es-ES");
    const el = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(table.shadowRoot!.textContent).toContain(t("units.abbreviation"));
    expect(table.shadowRoot!.textContent).toContain("kg");
  });

  it("renders precision as the locale decimal marker plus zeroes", async () => {
    const litre: Unit = { id: "u", name: { es: "Litro" }, abbreviation: { es: "l" }, precision: 3 };
    setLocale("es-ES");
    expect(precisionCellText(await mountWith([litre]), "u")).toBe(",000");
    cleanupWidgets();
    setLocale("en-GB");
    expect(precisionCellText(await mountWith([{ ...litre }]), "u")).toBe(".000");
    cleanupWidgets();
    expect(precisionCellText(await mountWith([{ ...litre, precision: 0 }]), "u")).toBe("0");
  });

  it("narrows the list with the precision filter, labelled with the marker", async () => {
    setLocale("es-ES");
    const el = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const filter = table.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[data-filter="precision"]',
    )!;
    const optionLabels = [...filter.querySelectorAll("option")].map((o) => o.textContent!.trim());
    expect(optionLabels).toEqual([t("units.filter_precision_all"), "0", ",000"]);
    filter.value = "3";
    filter.dispatchEvent(new Event("change"));
    await el.updateComplete;
    await table.updateComplete;
    expect(listedKeys(el)).toEqual(["u2"]);
  });

  it("sorts by name ascending on first visit", async () => {
    setLocale("es-ES");
    const el = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(table.sortKey).toBe("name");
    expect(table.sortDirection).toBe("ascending");
    // es content: "kilogramo" sorts before "unidad".
    expect(listedKeys(el)).toEqual(["u2", "u1"]);
  });

  it("restores a stored sort and precision filter from sessionStorage", async () => {
    setLocale("es-ES");
    sessionStorage.setItem(
      "waitron.units.table",
      JSON.stringify({ sortKey: "name", sortDirection: "descending", filters: { precision: "3" } }),
    );
    const el = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    expect(table.sortDirection).toBe("descending");
    // The stored precision filter keeps only the precision-3 unit.
    expect(listedKeys(el)).toEqual(["u2"]);
  });

  it("left-aligns the row-action buttons", async () => {
    const el = await mount();
    const menu = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("wt-row-actions")!;
    const buttons = [...menu.querySelectorAll("wt-button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button.getAttribute("align")).toBe("start");
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
    resolveCreate({ id: "u3", name: { es: "caja" }, abbreviation: { es: "cj" }, precision: 0 });
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
    // Each row's checkbox is the only place a screen reader hears which product it is ticking.
    expect(
      productTable.shadowRoot!.querySelector('[data-test="select-p1"]')!.getAttribute("aria-label"),
    ).toBe(`${t("units.select_product")}: Café`);
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
    // Found by row key: the table sorts by name, so u1 is not necessarily the first row.
    const menu = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="u1"] wt-row-actions')!;
    const trigger = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    trigger.focus();
    const dialog = await openInUseModal(el);
    dialog.querySelector<HTMLElement>("[data-test=cancel-in-use]")!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(menu.shadowRoot!.activeElement).toBe(trigger);
  });

  it("opens the delete-unit screen when a unit row is clicked", async () => {
    setLocale("es-ES");
    const listUnitProducts = vi
      .fn()
      .mockResolvedValue([{ id: "p1", name: "Sopa", available: true }]);
    const el = await mount(stubApi({ listUnitProducts }));
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    // The whole-row activator lives in the first cell of the units table's shadow root.
    const rowAction = table.shadowRoot!.querySelector<HTMLButtonElement>(".row-activate")!;
    expect(rowAction.getAttribute("aria-label")).toBe(`${t("units.delete_unit")}: kilogramo`);
    rowAction.click();
    await flush(el);
    expect(listUnitProducts).toHaveBeenCalledTimes(1);
    const dialog = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      "[data-test=in-use-dialog]",
    )!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("heading")).toBe(t("units.delete_unit"));
    expect(dialog.querySelector("wt-data-table")!.shadowRoot!.textContent).toContain("Sopa");
  });

  it("paints the in-use explanation with the danger colour", async () => {
    const el = await mount(inUseApi());
    el.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
    const dialog = await openInUseModal(el);
    const warning = dialog.querySelector<HTMLElement>("[data-test=in-use-warning]")!;
    expect(warning.textContent).toContain(t("units.in_use_body"));
    expect(getComputedStyle(warning).color).toBe("rgb(13, 14, 15)");
  });

  it("orders reassign targets with Each first and named units alphabetically", async () => {
    setLocale("en-GB");
    const list: Unit[] = [
      units[0]!,
      units[1]!,
      { id: "u3", name: { en: "Litre" }, abbreviation: { en: "l" }, precision: 2 },
      { id: "u4", name: { en: "Gram" }, abbreviation: { en: "g" }, precision: 1 },
    ];
    const el = await mount(
      stubApi({
        listUnits: vi.fn().mockResolvedValue(list),
        listUnitProducts: vi.fn().mockResolvedValue(inUseProducts),
      }),
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table
      .shadowRoot!.querySelector<HTMLButtonElement>('tr[data-row-key="u1"] .row-activate')!
      .click();
    await flush(el);

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=reassign-unit]")!;
    expect([...select.options].map((option) => option.textContent!.trim())).toEqual([
      t("units.change_unit_placeholder"),
      t("units.change_unit_each"),
      "Gram",
      "kilogram",
      "Litre",
    ]);
  });

  it("offers Each (no unit) as a reassign target and reassigns to it", async () => {
    setLocale("es-ES");
    const listUnitProducts = vi
      .fn()
      .mockResolvedValue([{ id: "p1", name: "Sopa", available: true }]);
    const reassignProductsUnit = vi.fn().mockResolvedValue([]);
    const el = await mount(stubApi({ listUnitProducts, reassignProductsUnit }));
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLButtonElement>(".row-activate")!.click();
    await flush(el);
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-test=in-use-dialog]")!;
    dialog
      .querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-p1]")!
      .click();
    await el.updateComplete;
    const select = dialog.querySelector<HTMLSelectElement>("[data-test=reassign-unit]")!;
    // Pick the Each option by its localized label, then reassign — its value is a sentinel, not a uuid.
    const eachOption = [...select.options].find(
      (option) => option.textContent!.trim() === t("units.change_unit_each"),
    )!;
    expect(eachOption).toBeTruthy();
    select.value = eachOption.value;
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;
    dialog.querySelector<HTMLElement>("[data-test=change-unit]")!.click();
    await flush(el);
    const clickedUnitId = listUnitProducts.mock.calls[0]![0] as string;
    // Each maps to a null target — assert the null, not the sentinel string.
    expect(reassignProductsUnit).toHaveBeenCalledWith(clickedUnitId, ["p1"], null);
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  function unitsTable(el: UnitsScreen): HTMLElementTagNameMap["wt-data-table"] {
    return el.shadowRoot!.querySelector("wt-data-table")!;
  }

  function inUseDialog(el: UnitsScreen): HTMLElement & { open: boolean } {
    return el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      "[data-test=in-use-dialog]",
    )!;
  }

  async function sortBy(table: HTMLElementTagNameMap["wt-data-table"], key: string) {
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>(`[data-sort="${key}"]`)!.click();
    await table.updateComplete;
  }

  function keysOf(table: Element): string[] {
    return [...table.shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
      row.getAttribute("data-row-key")!,
    );
  }

  it("says the units could not be loaded when the first load fails without a code", async () => {
    const el = await mount(stubApi({ listUnits: vi.fn().mockRejectedValue(new Error("offline")) }));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
        t("units.load_error"),
      ),
    );
  });

  it("shows a failed live refresh's own message and keeps the listed units", async () => {
    const api = stubApi();
    const el = await mount(api);
    vi.mocked(api.background.listUnits).mockRejectedValue({ code: "server.internal" });
    api.liveData.invalidate([{ type: "units", id: "u1" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
        codeMessage("server.internal"),
      ),
    );
    expect(listedKeys(el).sort()).toEqual(["u1", "u2"]);
  });

  it("edits a unit from its row action and replaces only that row with the saved unit", async () => {
    setLocale("es-ES");
    const saved: Unit = { ...units[0]!, name: { es: "pieza", en: "piece" } };
    const refresh = deferred<Unit[]>();
    const api = stubApi({ updateUnit: vi.fn().mockResolvedValue(saved) });
    vi.mocked(api.background.listUnits).mockReturnValue(refresh.promise);
    const el = await mount(api);
    const table = unitsTable(el);
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-u1]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    expect(form.open).toBe(true);
    expect(form.value).toEqual(units[0]);
    const value = {
      name: { es: "pieza", en: "piece" },
      abbreviation: units[0]!.abbreviation,
      precision: 0,
    };
    form.dispatchEvent(
      new CustomEvent("wt-submit", { detail: { value }, bubbles: true, composed: true }),
    );
    await vi.waitFor(() => expect(form.open).toBe(false));
    expect(api.updateUnit).toHaveBeenCalledWith("u1", value);
    expect(api.createUnit).not.toHaveBeenCalled();
    expect(table.rows).toEqual([saved, units[1]]);
    refresh.resolve(units);
  });

  it("opens the in-use dialog with its empty state when a refusal lists no products", async () => {
    const el = await mount(
      stubApi({ deleteUnit: vi.fn().mockRejectedValue({ code: "unit.in_use" }) }),
    );
    const dialog = await openInUseModal(el);
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain(t("units.in_use_empty"));
    expect(dialog.querySelector("wt-data-table")).toBeNull();
  });

  it("closes the in-use dialog and shows the refusal when a retried delete fails otherwise", async () => {
    const deleteUnit = vi
      .fn()
      .mockRejectedValueOnce({ code: "unit.in_use", params: { products: inUseProducts } })
      .mockRejectedValueOnce({ code: "unit.not_found" });
    const el = await mount(stubApi({ deleteUnit }));
    const dialog = await openInUseModal(el);
    dialog.querySelector<HTMLElement>("[data-test=delete-unit]")!.click();
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent!.trim()).toBe(
      codeMessage("unit.not_found"),
    );
    expect(listedKeys(el).sort()).toEqual(["u1", "u2"]);
  });

  it("sends one delete when Delete is pressed again before the first settles", async () => {
    const removal = deferred<void>();
    const deleteUnit = vi.fn().mockReturnValue(removal.promise);
    const el = await mount(stubApi({ deleteUnit }));
    const table = unitsTable(el);
    await table.updateComplete;
    const remove = table.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-u1]")!;
    remove.click();
    remove.click();
    removal.resolve();
    await vi.waitFor(() => expect(listedKeys(el)).toEqual(["u2"]));
    expect(deleteUnit).toHaveBeenCalledOnce();
  });

  it("deletes nothing from the in-use dialog's Delete while no unit is open in it", async () => {
    const deleteUnit = vi.fn().mockResolvedValue(undefined);
    const el = await mount(stubApi({ deleteUnit }));
    expect(inUseDialog(el).open).toBe(false);
    inUseDialog(el).querySelector<HTMLElement>("[data-test=delete-unit]")!.click();
    await el.updateComplete;
    expect(deleteUnit).not.toHaveBeenCalled();
  });

  it("fetches a clicked unit's products once when its row is clicked twice", async () => {
    const products = deferred<ProductUsingUnit[]>();
    const listUnitProducts = vi.fn().mockReturnValue(products.promise);
    const el = await mount(stubApi({ listUnitProducts }));
    const table = unitsTable(el);
    await table.updateComplete;
    const row = table.shadowRoot!.querySelector<HTMLButtonElement>(".row-activate")!;
    row.click();
    row.click();
    products.resolve(inUseProducts);
    await vi.waitFor(() => expect(inUseDialog(el).open).toBe(true));
    expect(listUnitProducts).toHaveBeenCalledOnce();
  });

  it("shows why a clicked unit's products could not be listed, without opening the dialog", async () => {
    const listUnitProducts = vi.fn().mockRejectedValue({ code: "unit.not_found" });
    const el = await mount(stubApi({ listUnitProducts }));
    const table = unitsTable(el);
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLButtonElement>(".row-activate")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent?.trim()).toBe(
        codeMessage("unit.not_found"),
      ),
    );
    expect(inUseDialog(el).open).toBe(false);
  });

  it("moves products once when Change unit is pressed again before the first settles", async () => {
    const moved = deferred<ProductUsingUnit[]>();
    const reassignProductsUnit = vi.fn().mockReturnValue(moved.promise);
    const el = await mount(
      stubApi({
        deleteUnit: vi
          .fn()
          .mockRejectedValue({ code: "unit.in_use", params: { products: inUseProducts } }),
        reassignProductsUnit,
      }),
    );
    const dialog = await openInUseModal(el);
    const change = dialog.querySelector<HTMLElement>("[data-test=change-unit]")!;
    change.click();
    await el.updateComplete;
    expect(reassignProductsUnit).not.toHaveBeenCalled();
    dialog
      .querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-p1]")!
      .click();
    await el.updateComplete;
    const select = dialog.querySelector<HTMLSelectElement>("[data-test=reassign-unit]")!;
    select.value = "u2";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;
    change.click();
    change.click();
    moved.resolve([inUseProducts[1]!]);
    await vi.waitFor(() =>
      expect(
        (dialog.querySelector("wt-data-table")!.rows as ProductUsingUnit[]).map((p) => p.id),
      ).toEqual(["p2"]),
    );
    expect(reassignProductsUnit).toHaveBeenCalledOnce();
  });

  it("sorts the in-use products by name and by availability", async () => {
    const el = await mount(
      inUseApi([
        { id: "p1", name: "Té", available: true },
        { id: "p2", name: "Café", available: false },
      ]),
    );
    const dialog = await openInUseModal(el);
    const products = dialog.querySelector<HTMLElementTagNameMap["wt-data-table"]>("wt-data-table")!;
    await products.updateComplete;
    expect(keysOf(products)).toEqual(["p1", "p2"]);
    await sortBy(products, "name");
    expect(keysOf(products)).toEqual(["p2", "p1"]);
    await sortBy(products, "availability");
    expect(keysOf(products)).toEqual(["p2", "p1"]);
    await sortBy(products, "availability");
    expect(keysOf(products)).toEqual(["p1", "p2"]);
  });

  it("sorts the units by abbreviation", async () => {
    setLocale("es-ES");
    const el = await mountWith([
      { id: "a", name: { es: "alfa" }, abbreviation: { es: "zz" }, precision: 0 },
      { id: "b", name: { es: "beta" }, abbreviation: { es: "aa" }, precision: 0 },
    ]);
    const table = unitsTable(el);
    await table.updateComplete;
    expect(keysOf(table)).toEqual(["a", "b"]);
    await sortBy(table, "abbreviation");
    expect(keysOf(table)).toEqual(["b", "a"]);
  });

  it("writes precision with a full stop when the locale reports no decimal separator", async () => {
    const parts = vi
      .spyOn(Intl.NumberFormat.prototype, "formatToParts")
      .mockReturnValue([{ type: "integer", value: "1" }]);
    try {
      setLocale("de-CH");
      const el = await mount();
      await unitsTable(el).updateComplete;
      expect(precisionCellText(el, "u2")).toBe(".000");
    } finally {
      parts.mockRestore();
    }
  });
});
