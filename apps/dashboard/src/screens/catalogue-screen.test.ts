import { LeaveController, NavigationGuard } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import { LitElement, html } from "lit";
import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type {
  CatalogueSummary,
  CategorySummary,
  Course,
  DashboardApi,
  ExtraList,
  ExtraListInput,
  SectionDetails,
  MenuStructure,
  OptionList,
  OptionListInput,
  Product,
  ProductEditorInput,
  ProductEditorValue,
  Unit,
} from "../api/client.js";
import type { ProductChildKind } from "../state/product-child-create.js";
import type { AddToMenus } from "../widgets/add-to-menus.js";
import type { CourseList } from "../widgets/course-list.js";
import type { ProductEditor } from "../widgets/product-editor.js";
import type { CatalogueBrowser } from "../widgets/catalogue-browser.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { CatalogueScreen } from "./catalogue-screen.js";
import { ROOT_KEY } from "../widgets/product-list.js";

class PlacementLeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("placement-leave-test-host", PlacementLeaveHost);

const catalogues: CatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1 },
  { id: "cat-b", name: "Bebidas", active: true, version: 1 },
];
const categories: CategorySummary[] = [
  { id: "c1", name: "Entrantes", parentId: null, color: null },
];
const units: Unit[] = [
  { id: "u1", name: { es: "unidad" }, abbreviation: { es: "u" }, precision: 0 },
];
// The two kinds of modifier list the product editor attaches. Staff, customer-facing and kitchen
// names differ in each, so an assertion on the editor's rows can tell which one a surface read.
const extraLists: ExtraList[] = [
  {
    id: "ex-1",
    name: "Salsas",
    customerName: { es: "Elige una salsa" },
    kitchenName: "SALSA",
    minPicks: 0,
    maxPicks: null,
    active: true,
    items: [],
  },
];
const optionLists: OptionList[] = [
  {
    id: "opt-list-1",
    name: "Punto",
    customerName: { es: "Punto de la carne" },
    kitchenName: "PUNTO",
    defaultLabelId: null,
    active: true,
    labels: [],
  },
];
const extraInput: ExtraListInput = {
  name: "Panes",
  customerName: null,
  kitchenName: null,
  minPicks: 0,
  maxPicks: null,
  active: true,
  items: [],
};
const optionInput: OptionListInput = {
  name: "Corte",
  customerName: null,
  kitchenName: null,
  defaultLabelId: null,
  active: true,
  labels: [],
};
const products: Product[] = [
  {
    id: "p1",
    modifiers: [],
    catalogueId: "cat-a",
    categoryId: "c1",
    primaryCategoryId: "c1",
    name: "Croquetas",
    customerName: { es: "Croquetas caseras de jamón" },
    unitId: "u1",
    unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "8.50",
    vatClass: "reduced",
    active: true,
    available: true,
    ordering: "public",
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    color: null,
    variants: [],
  },
];
const value: ProductEditorValue = {
  id: "p1",
  parentId: null,
  inherited: null,
  name: "Croquetas",
  customerName: { es: "Croquetas caseras de jamón" },
  description: { es: "Cremosas" },
  kitchenName: "CROQUETAS",
  image: null,
  unitId: "u1",
  unitPrice: "8.50",
  active: true,
  available: true,
  ordering: "public",
  vatClass: "reduced",
  variants: [],
  primaryCategoryId: "c1",
  color: null,
  // One attachment the editor's Modifiers section shows, so the tests below can tell an unrelated
  // save carrying it back untouched from one that wipes it.
  modifiers: [{ kind: "options", id: "opt-list-1" }],
  allergens: {},
  dietaryDeclarations: ["vegetarian"],
  courseId: null,
};

// Drinks is on both menus. A section's customer-facing name differs from its internal one, so the
// Add to menus step reading the wrong one shows text the assertions refuse.
const drinksNode = {
  memberId: "m-drinks",
  ref: { kind: "section" as const, sectionId: "s-drinks" },
  internalName: "Drinks list",
  names: {},
  image: null,
  color: null,
  ownerMenuId: "menu-lunch",
  children: [
    {
      memberId: "m-beer",
      ref: { kind: "section" as const, sectionId: "s-beer" },
      internalName: "Beer list",
      names: {},
      image: null,
      color: null,
      ownerMenuId: "menu-lunch",
      children: [],
    },
  ],
};
const structures: Record<string, MenuStructure> = {
  "cat-a": {
    rootSectionId: "root-a",
    root: {
      id: "root-a",
      internalName: "Lunch Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: [drinksNode],
  },
  "cat-b": {
    rootSectionId: "root-b",
    root: {
      id: "root-b",
      internalName: "Lunch Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: [drinksNode],
  },
};
const sections: SectionDetails[] = [
  {
    id: "s-drinks",
    internalName: "Drinks list",
    names: { es: "Bebidas frías" },
    image: null,
    color: null,
    members: [],
  },
  {
    id: "s-beer",
    internalName: "Beer list",
    names: { es: "Cervezas de barril" },
    image: null,
    color: null,
    members: [],
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const api = {
    getCatalogueSettings: vi
      .fn()
      .mockResolvedValue({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    listCategories: vi.fn().mockResolvedValue(categories),
    listUnits: vi.fn().mockResolvedValue(units),
    listExtraLists: vi.fn().mockResolvedValue(extraLists),
    listOptionLists: vi.fn().mockResolvedValue(optionLists),
    createExtraList: vi.fn().mockResolvedValue({ ...extraLists[0], id: "ex-new", name: "Panes" }),
    createOptionList: vi
      .fn()
      .mockResolvedValue({ ...optionLists[0], id: "opt-new", name: "Corte" }),
    updateExtraList: vi.fn().mockResolvedValue(extraLists[0]),
    updateOptionList: vi.fn().mockResolvedValue(optionLists[0]),
    listStations: vi.fn().mockResolvedValue([]),
    listCourses: vi.fn().mockResolvedValue([]),
    listProducts: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve(id === "cat-a" ? products : [])),
    listMadeAt: vi.fn().mockResolvedValue({
      [products[0]!.id]: {
        stationId: "bar",
        stationName: "Bar",
        noPreparation: false,
        noReplacement: false,
        variesByZone: false,
      },
    }),
    getFolderRouting: vi.fn().mockResolvedValue({
      stationTimes: [],
      todayEnds: null,
      clockReadable: true,
      zones: [],
      categories: [],
      products: [],
      cells: [],
      defaultStationId: null,
      stations: [],
      canMakeDefault: false,
    }),
    getProductEditor: vi.fn().mockResolvedValue(value),
    countProductMenus: vi.fn().mockResolvedValue(0),
    createProductEditor: vi.fn().mockResolvedValue({ ...value, id: "new" }),
    updateProductEditor: vi.fn().mockResolvedValue(value),
    getMenuStructure: vi.fn().mockImplementation((id: string) => Promise.resolve(structures[id])),
    listSections: vi.fn().mockResolvedValue(sections),
    addSectionProducts: vi.fn().mockResolvedValue({ added: 1 }),
    createUnit: vi.fn().mockResolvedValue({
      id: "u2",
      name: { es: "ración" },
      abbreviation: { es: "ra" },
      precision: 2,
    }),
    createCategory: vi.fn().mockResolvedValue({
      id: "c2",
      name: { es: "Postres" },
      image: null,
      parentId: null,
    }),
    ...overrides,
  } as unknown as DashboardApi;
  Object.defineProperty(api, "background", { get: () => api });
  return api;
}

async function flush(el: CatalogueScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}
/**
 * Resolves on a dialog's `wt-close`, which everything the screen does on close follows. Chromium
 * sends the native close only with a later rendered frame, which a busy runner can hold back past
 * `vi.waitFor`'s one second.
 */
function closeOf(dialog: Element): Promise<unknown> {
  return new Promise((resolve) => dialog.addEventListener("wt-close", resolve, { once: true }));
}
const editor = (el: CatalogueScreen): ProductEditor =>
  el.shadowRoot!.querySelector("dashboard-product-editor")!;
const step = (el: CatalogueScreen): AddToMenus =>
  el.shadowRoot!.querySelector("dashboard-add-to-menus")!;
const list = (el: CatalogueScreen): CatalogueBrowser =>
  el.shadowRoot!.querySelector("dashboard-catalogue-browser")!;
async function productTable(el: CatalogueScreen) {
  await list(el).updateComplete;
  const products = list(el).shadowRoot!.querySelector("dashboard-product-list")!;
  await products.updateComplete;
  const table = products.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return table;
}
function emit(source: Element, type: string, detail: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
/** One change in the open editor, so its Save has something to send. */
async function editKitchenName(el: CatalogueScreen): Promise<void> {
  emit(editor(el).shadowRoot!.querySelector('[name="kitchen-name"]')!, "wt-change", {
    value: "CROQUETAS FRITAS",
  });
  await editor(el).updateComplete;
}

afterEach(cleanupWidgets);
afterEach(() => localStorage.clear());

describe("catalogue-screen", () => {
  it("loads all product editor libraries and de-duplicates products from every menu", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(api.listUnits).toHaveBeenCalledOnce();
    expect(api.listCategories).toHaveBeenCalledOnce();
    expect(api.listProducts).toHaveBeenCalledWith("cat-a");
    expect(api.listProducts).toHaveBeenCalledWith("cat-b");
    expect(api.listMadeAt).toHaveBeenCalledOnce();
    expect(api.getFolderRouting).toHaveBeenCalledOnce();
    expect(list(el).routing).toMatchObject({ cells: [], defaultStationId: null });
    expect(list(el).madeAt[products[0]!.id]?.stationName).toBe("Bar");
    expect(list(el).products).toEqual(products);
    expect(el.shadowRoot!.querySelector('select[name="product-catalogue"]')).toBeNull();
  });

  it("keeps products available when the optional folder routing read is refused", async () => {
    const api = stubApi({
      getFolderRouting: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(list(el).products).toEqual(products);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(list(el).routing).toBeNull();
  });

  it("tells the browser the routing read failed, and clears that once a later read succeeds", async () => {
    const api = Object.assign(
      stubApi({ getFolderRouting: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(list(el).routing).toBeNull();
    expect(list(el).routingFailed).toBe(true);
    const routing = await stubApi().getFolderRouting();
    vi.mocked(api.getFolderRouting).mockResolvedValue(routing);
    api.liveData.refresh();
    await vi.waitFor(() => expect(list(el).routingFailed).toBe(false));
    expect(list(el).routing).toEqual(routing);
  });

  it("counts a refused routing read as failed too", async () => {
    const api = stubApi({
      getFolderRouting: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(list(el).routingFailed).toBe(true);
  });

  it("marks routing failed when a refresh after a good read fails, and not before", async () => {
    const api = Object.assign(stubApi(), { liveData: new LiveData() });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(list(el).routingFailed).toBe(false);
    expect(list(el).routing).not.toBeNull();
    vi.mocked(api.getFolderRouting).mockRejectedValue({ code: "connection.failed" });
    api.liveData.refresh();
    await vi.waitFor(() => expect(list(el).routingFailed).toBe(true));
    expect(list(el).routing).toBeNull();
  });

  it("clears a failed refresh's message once the server answers again", async () => {
    const api = Object.assign(stubApi(), { liveData: new LiveData() });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    const alert = () => el.shadowRoot!.querySelector("[role=alert]");
    vi.mocked(api.listUnits).mockRejectedValue({ code: "connection.failed" });
    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(alert()?.textContent?.trim()).toBe(codeMessage("connection.failed")),
    );
    const more: Unit = { ...units[0]!, id: "u2" };
    vi.mocked(api.listUnits).mockResolvedValue([...units, more]);
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert()).toBeNull());
    expect(editor(el).units.map(({ id }) => id)).toEqual(["u1", "u2"]);
  });

  it("keeps a save's connection failure through a failed re-read and the reads' recovery", async () => {
    const api = Object.assign(
      stubApi({ updateProductEditor: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    const alert = () => el.shadowRoot!.querySelector("[role=alert]");
    emit(list(el), "edit-product", { productId: "p1" });
    await vi.waitFor(() => expect(editor(el).open).toBe(true));
    vi.mocked(api.listUnits).mockRejectedValue({ code: "connection.failed" });
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert()).not.toBeNull());

    emit(editor(el), "wt-submit", { value });
    await vi.waitFor(() => expect(api.updateProductEditor).toHaveBeenCalledTimes(1));
    await flush(el);
    const reads = vi.mocked(api.listUnits).mock.calls.length;
    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listUnits).toHaveBeenCalledTimes(reads + 1));
    await flush(el);

    const more: Unit = { ...units[0]!, id: "u2" };
    vi.mocked(api.listUnits).mockResolvedValue([...units, more]);
    api.liveData.refresh();
    await vi.waitFor(() => expect(editor(el).units.map(({ id }) => id)).toEqual(["u1", "u2"]));
    await flush(el);
    expect(alert()?.textContent?.trim()).toBe(codeMessage("connection.failed"));
  });

  async function editDuringOutage(api: DashboardApi & { liveData: LiveData }) {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    const alert = () => el.shadowRoot!.querySelector("[role=alert]");
    vi.mocked(api.listUnits).mockRejectedValue({ code: "connection.failed" });
    api.liveData.refresh();
    await vi.waitFor(() => expect(alert()).not.toBeNull());

    emit(list(el), "edit-product", { productId: "p1" });
    await vi.waitFor(() => expect(api.getProductEditor).toHaveBeenCalledTimes(1));
    await flush(el);
    if (!editor(el).open)
      expect(alert()?.textContent?.trim()).toBe(codeMessage("connection.failed"));

    if (editor(el).open) {
      emit(editor(el), "wt-submit", { value });
      await flush(el);
    }
    const reads = vi.mocked(api.listUnits).mock.calls.length;
    vi.mocked(api.listUnits).mockResolvedValue(units);
    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listUnits).toHaveBeenCalledTimes(reads + 1));
    await flush(el);
    return alert;
  }

  it("drops an editor's failed read when the reads that failed beside it recover", async () => {
    const api = Object.assign(
      stubApi({ getProductEditor: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const alert = await editDuringOutage(api);
    expect(api.updateProductEditor).not.toHaveBeenCalled();
    expect(alert()).toBeNull();
  });

  it("keeps an editor's failed write when the reads that failed beside it recover", async () => {
    const api = Object.assign(
      stubApi({ updateProductEditor: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const alert = await editDuringOutage(api);
    expect(api.updateProductEditor).toHaveBeenCalledTimes(1);
    expect(alert()?.textContent?.trim()).toBe(codeMessage("connection.failed"));
  });

  it("loads the products once the server answers again after a failed first load", async () => {
    const api = Object.assign(
      stubApi({ listCatalogues: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    const alert = () => el.shadowRoot!.querySelector("[role=alert]");
    await vi.waitFor(() =>
      expect(alert()?.textContent?.trim()).toBe(codeMessage("connection.failed")),
    );
    expect(api.listProducts).not.toHaveBeenCalled();
    vi.mocked(api.listCatalogues).mockResolvedValue(catalogues);
    api.liveData.refresh();
    await vi.waitFor(() => expect(list(el).products).toEqual(products));
    expect(list(el).madeAt[products[0]!.id]?.stationName).toBe("Bar");
    expect(alert()).toBeNull();
  });

  it("leaves the content languages to their own Settings page while still handing them to the editor", async () => {
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=add-language]")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-add-content-language")).toBeNull();
    expect(editor(el).locales).toEqual(["es", "en"]);
  });

  it("confirms Archive and switches the product off without changing its availability", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "delete-product", { productId: "p1" });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-dialog]")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    expect(api.getProductEditor).toHaveBeenCalledWith("p1");
    expect(api.updateProductEditor).toHaveBeenCalledWith("p1", {
      ...value,
      active: false,
      available: true,
    });
  });

  it.each([
    [
      "en-GB",
      "Archive Croquetas",
      "This can't be undone. The till stops selling the product, it comes off the extras lists that offer it, and it cannot be brought back. Its past sales are kept, and a new product can take its name.",
      "Archive",
    ],
    [
      "es",
      "Archivar Croquetas",
      "No se puede deshacer. La caja deja de vender el producto, sale de las listas de extras que lo ofrecen y no se puede recuperar. Sus ventas pasadas se conservan y un producto nuevo puede usar su nombre.",
      "Archivar",
    ],
  ])("in %s, asks to archive a product permanently", async (locale, heading, body, action) => {
    const before = currentLocale();
    setLocale(locale);
    try {
      const api = stubApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "delete-product", { productId: "p1" });
      await flush(el);
      const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-dialog]")!;
      expect(dialog.getAttribute("heading")).toBe(heading);
      expect(dialog.querySelector("p")!.textContent!.trim()).toBe(body);
      const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!;
      expect(confirm.textContent!.trim()).toBe(action);
    } finally {
      setLocale(before);
    }
  });

  it("names affected extras lists in the product Archive warning", async () => {
    const offered = (id: string, name: string, productId: string): ExtraList => ({
      ...extraLists[0]!,
      id,
      name,
      items: [{ id: `${id}-item`, productId, maxQuantity: null, preselected: false, price: null }],
    });
    const api = stubApi({
      listExtraLists: vi
        .fn()
        .mockResolvedValue([
          offered("affected", "Archive affected sauces", "p1"),
          offered("unrelated", "Archive unrelated drinks", "other"),
        ]),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "delete-product", { productId: "p1" });
    await flush(el);
    const warning = el.shadowRoot!.querySelector("[data-test=delete-dialog]")!;
    expect(warning.textContent).toContain("Archive affected sauces");
    expect(warning.textContent).not.toContain("Archive unrelated drinks");
  });

  it("keeps the Archive confirmation open and reports a refused save inside it", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "delete-product", { productId: "p1" });
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-dialog]")!;
    expect(dialog.getAttribute("open")).not.toBeNull();
    const actions = dialog.querySelector("wt-form-actions")!;
    const message = await formMessageOf(actions);
    expect(message?.textContent).toBe(codeMessage("server.internal"));
    expect(dialog.shadowRoot!.querySelector(".body")!.contains(message)).toBe(true);
    expect(actions.shadowRoot!.querySelector("[data-error]")).toBeNull();
    expect(dialog.textContent).not.toContain(codeMessage("server.internal"));
  });

  it.each(["archive", "save"])("names the live menus that refuse an %s", async (path) => {
    const before = currentLocale();
    setLocale("en");
    onTestFinished(() => setLocale(before));
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "product.on_live_menu",
        params: {
          products: [{ id: "v1", name: "Half" }],
          menus: [
            { id: "d", name: "Dinner" },
            { id: "l", name: "Lunch Menu" },
          ],
        },
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    let message: Element | null;
    if (path === "archive") {
      emit(list(el), "delete-product", { productId: "p1" });
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
      await flush(el);
      message = await formMessageOf(
        el.shadowRoot!.querySelector("[data-test=delete-dialog] wt-form-actions")!,
      );
      expect(el.shadowRoot!.querySelector("[data-test=delete-dialog]")!.hasAttribute("open")).toBe(
        true,
      );
    } else {
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el), "wt-submit", {
        value: { ...value, variants: [{ name: "Half", active: false }] },
      });
      await flush(el);
      message = el.shadowRoot!.querySelector("[role=alert]");
      expect(editor(el).open).toBe(true);
    }
    expect(message?.textContent?.trim()).toBe(
      "It is on a live or scheduled menu. Take it off the menu and publish, then archive it. Menus: Dinner, Lunch Menu.",
    );
  });

  describe("the Archive confirmation names the menus the product comes off", () => {
    const warning =
      "This can't be undone. The till stops selling the product, it comes off the extras lists that offer it, and it cannot be brought back. Its past sales are kept, and a new product can take its name.";
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
    const dialogOf = (el: CatalogueScreen) =>
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-dialog]")!;
    const bodyOf = (el: CatalogueScreen) =>
      dialogOf(el).querySelector("p")!.textContent!.replace(/\s+/g, " ").trim();
    async function openArchive(api: DashboardApi, productId = "p1", locale = "en-GB") {
      const before = currentLocale();
      setLocale(locale);
      onTestFinished(() => setLocale(before));
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "delete-product", { productId });
      await flush(el);
      return el;
    }

    it("says how many menus it comes off when the product is on two", async () => {
      const api = stubApi({ countProductMenus: vi.fn().mockResolvedValue(2) });
      const el = await openArchive(api);
      expect(api.countProductMenus).toHaveBeenCalledWith(["p1"]);
      expect(bodyOf(el)).toBe(`${warning} It comes off the 2 menus it is on.`);
    });

    it("says the one menu it comes off in the singular", async () => {
      const el = await openArchive(stubApi({ countProductMenus: vi.fn().mockResolvedValue(1) }));
      expect(bodyOf(el)).toBe(`${warning} It comes off the one menu it is on.`);
    });

    it("adds nothing when the product is on no menu", async () => {
      const el = await openArchive(stubApi({ countProductMenus: vi.fn().mockResolvedValue(0) }));
      expect(bodyOf(el)).toBe(warning);
    });

    it("in Spanish, names the menus as cartas", async () => {
      const el = await openArchive(
        stubApi({ countProductMenus: vi.fn().mockResolvedValue(3) }),
        "p1",
        "es",
      );
      expect(bodyOf(el)).toBe(
        "No se puede deshacer. La caja deja de vender el producto, sale de las listas de extras que lo ofrecen y no se puede recuperar. Sus ventas pasadas se conservan y un producto nuevo puede usar su nombre. Sale de las 3 cartas en las que está.",
      );
    });

    it("says every menu while the count is still loading, and Archive works meanwhile", async () => {
      const api = stubApi({ countProductMenus: vi.fn().mockReturnValue(new Promise(() => {})) });
      const el = await openArchive(api);
      expect(bodyOf(el)).toBe(`${warning} It comes off every menu it is on.`);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledWith("p1", { ...value, active: false });
    });

    it("says every menu when the count cannot be read, and Archive still works", async () => {
      const api = stubApi({
        countProductMenus: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      const el = await openArchive(api);
      expect(bodyOf(el)).toBe(`${warning} It comes off every menu it is on.`);
      expect(dialogOf(el).textContent).not.toContain(codeMessage("server.internal"));
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledWith("p1", { ...value, active: false });
      expect(dialogOf(el).getAttribute("open")).toBeNull();
    });

    it("never shows an earlier dialog's late count in the next one", async () => {
      const first = deferred<number>();
      const second = deferred<number>();
      const counts = [first, second];
      const api = stubApi({
        countProductMenus: vi.fn().mockImplementation(() => counts.shift()!.promise),
      });
      const el = await openArchive(api);
      dialogOf(el).querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
      await flush(el);
      emit(list(el), "delete-product", { productId: "p1" });
      await flush(el);
      second.resolve(0);
      await flush(el);
      first.resolve(4);
      await flush(el);
      expect(bodyOf(el)).toBe(warning);
    });

    it("forgets the last dialog's count while the next product's is still being read", async () => {
      const both = [...products, { ...products[0]!, id: "p2", name: "Patatas" }];
      const api = stubApi({
        listProducts: vi
          .fn()
          .mockImplementation((id: string) => Promise.resolve(id === "cat-a" ? both : [])),
        countProductMenus: vi
          .fn()
          .mockResolvedValueOnce(4)
          .mockReturnValueOnce(new Promise(() => {})),
      });
      const el = await openArchive(api);
      expect(bodyOf(el)).toContain("the 4 menus");
      dialogOf(el).querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
      await flush(el);
      emit(list(el), "delete-product", { productId: "p2" });
      await flush(el);
      expect(api.countProductMenus).toHaveBeenLastCalledWith(["p2"]);
      expect(bodyOf(el)).toBe(`${warning} It comes off every menu it is on.`);
    });
  });

  async function archivedRowOffersView(api: DashboardApi, productId = "p1") {
    const archived = { ...(await api.getProductEditor(productId)), active: false };
    vi.mocked(api.getProductEditor).mockReset().mockResolvedValue(archived);
    const original = vi.mocked(api.listProducts).getMockImplementation()!;
    vi.mocked(api.listProducts).mockImplementation(async (id: string) =>
      (await original(id)).map((product) => ({
        ...product,
        active: product.id === productId ? false : product.active,
        variants: product.variants.map((variant) => ({
          ...variant,
          active: variant.id === productId ? false : variant.active,
        })),
      })),
    );
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    const table = await productTable(el);
    await chooseOption(
      table.shadowRoot!.querySelector<HTMLElement>('wt-combobox[data-filter="active"]')!,
      "",
    );
    table.setExpanded("folder:c1", true);
    table.setExpanded("p1", true);
    await table.updateComplete;
    const actions = table.shadowRoot!.querySelector<HTMLElement>(
      `[data-test="actions-${productId}"]`,
    )!;
    expect(
      [...actions.querySelectorAll("wt-button")].map((button) => button.textContent!.trim()),
    ).toEqual([t("product.view")]);
    const seen: unknown[] = [];
    list(el).addEventListener("view-product", (event) => seen.push((event as CustomEvent).detail));
    actions.querySelector<HTMLElement>(`[data-test="view-${productId}"]`)!.click();
    expect(seen).toEqual([{ productId }]);
    expect(api.getProductEditor).toHaveBeenCalledExactlyOnceWith(productId);
    await flush(el);
    const details = el.shadowRoot!.querySelector("dashboard-product-details")!;
    expect(details.open).toBe(true);
    expect(details.value).toEqual(archived);
    expect(api.updateProductEditor).not.toHaveBeenCalled();
    expect(editor(el).open).toBe(false);
    return el;
  }
  it("an archived product row offers View only", async () => {
    await archivedRowOffersView(stubApi());
  });

  it("creates the complete aggregate once, closes, then refreshes the list", async () => {
    let release!: () => void;
    const pending = new Promise<ProductEditorValue>((resolve) => {
      release = () => resolve({ ...value, id: "new" });
    });
    const api = stubApi({ createProductEditor: vi.fn().mockReturnValue(pending) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "add-product", { categoryId: null });
    await el.updateComplete;
    emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
    emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
    expect(api.createProductEditor).toHaveBeenCalledOnce();
    release();
    await flush(el);
    expect(editor(el).open).toBe(false);
    expect(api.listProducts).toHaveBeenCalledTimes(4);
  });

  it("draws the title alone in the header", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    const header = el.shadowRoot!.querySelector(".header")!;
    expect([...header.children].map((child) => child.localName)).toEqual(["h1"]);
    expect(el.shadowRoot!.querySelector("[data-test=add-product]")).toBeNull();
  });

  /** Lets a closing native dialog hand focus back, which it does a task after it closes. */
  async function afterDialogCloses(el: CatalogueScreen): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await el.updateComplete;
  }

  it("opens the product editor, with no category, from the All products menu", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    (await productTable(el))
      .shadowRoot!.querySelector<HTMLElement>('[data-test="add-product-root"]')!
      .click();
    await el.updateComplete;
    expect(editor(el).open).toBe(true);
    expect(editor(el).value).toBeNull();
    expect(editor(el).newCategoryId).toBeNull();
  });

  it("files a new product in the category whose menu added it, and in none for a category that is gone", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    emit(list(el), "add-product", { categoryId: "c1" });
    await el.updateComplete;
    expect(editor(el).newCategoryId).toBe("c1");
    emit(editor(el), "wt-cancel", {});
    await el.updateComplete;
    emit(list(el), "add-product", { categoryId: "gone" });
    await el.updateComplete;
    expect(editor(el).newCategoryId).toBeNull();
  });

  it("keeps every menu's Add product disabled until the units have loaded", async () => {
    const api = stubApi({ listUnits: vi.fn().mockResolvedValue([]) });
    Object.assign(api, { liveData: new LiveData() });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    const item = async () =>
      (await productTable(el)).shadowRoot!.querySelector<HTMLElement>(
        '[data-test="add-product-root"]',
      )!;
    expect((await item()).hasAttribute("disabled")).toBe(true);
    vi.mocked(api.listUnits).mockResolvedValue(units);
    api.liveData.invalidate([{ type: "units", id: units[0]!.id }]);
    await vi.waitFor(async () => expect((await item()).hasAttribute("disabled")).toBe(false));
  });

  it("returns focus to the ⋮ of the row whose Add product made a product, once the Add to menus step closes", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    const table = await productTable(el);
    table.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product-root"]')!.click();
    await el.updateComplete;
    emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
    await vi.waitFor(() => expect(step(el).open).toBe(true));
    const closed = closeOf(step(el));
    step(el).shadowRoot!.querySelector<HTMLElement>('[data-test="skip"]')!.click();
    await closed;
    await vi.waitFor(() => expect(step(el).open).toBe(false));
    await afterDialogCloses(el);
    expect(table.shadowRoot!.activeElement).toBe(
      table.shadowRoot!.querySelector(`tr[data-row-key="${ROOT_KEY}"] wt-row-actions`),
    );
  });

  it("returns focus to that row's ⋮ after the product editor is cancelled", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    const table = await productTable(el);
    table.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product-c1"]')!.click();
    await el.updateComplete;
    const closed = closeOf(editor(el));
    emit(editor(el), "wt-cancel", {});
    await closed;
    await vi.waitFor(() => expect(editor(el).open).toBe(false));
    await afterDialogCloses(el);
    expect(table.shadowRoot!.activeElement).toBe(
      table.shadowRoot!.querySelector('tr[data-row-key="folder:c1"] wt-row-actions'),
    );
  });

  it("opens the category a new product was saved into, so the product shows", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    const reveal = vi.spyOn(list(el), "revealProduct");
    emit(list(el), "add-product", { categoryId: "c1" });
    await el.updateComplete;
    emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledExactlyOnceWith("new"));
  });

  it("loads the aggregate on edit and keeps the editor open after a failed save", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({ code: "product.invalid" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(api.getProductEditor).toHaveBeenCalledWith("p1");
    expect(editor(el).value).toEqual(value);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
  });

  it("offers the venue's courses and saves the course inside the product write", async () => {
    const api = stubApi({
      listCourses: vi
        .fn()
        .mockResolvedValue([
          { id: "k1", name: "Starters", displayOrder: 0, active: true, inUse: false },
        ]),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(editor(el).courses.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "k1", name: "Starters" },
    ]);
    const routed: ProductEditorInput = { ...value, courseId: "k1" };
    emit(editor(el), "wt-submit", { value: routed });
    await flush(el);
    // The course travels in the same product write.
    expect(api.updateProductEditor).toHaveBeenCalledExactlyOnceWith("p1", routed);
    expect(api.createProductEditor).not.toHaveBeenCalled();
  });

  it("loads both kinds of modifier list and hands them to the product editor", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(api.listExtraLists).toHaveBeenCalled();
    expect(api.listOptionLists).toHaveBeenCalled();
    expect(editor(el).extraLists).toEqual(extraLists);
    expect(editor(el).optionLists).toEqual(optionLists);
  });

  // The products list names each attached list too, and it is this screen that holds the loaded sets;
  // without them its Modifiers column can only print the missing-choice placeholder.
  it("hands both kinds of modifier list to the products list as well", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(list(el).extraLists).toEqual(extraLists);
    expect(list(el).optionLists).toEqual(optionLists);
  });

  it("creates an extras list from inside the product editor and attaches it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "extras" });
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    expect(form.open).toBe(true);
    // The extras form offers this screen's products; it neither loads nor filters them itself.
    expect(form.products).toEqual(products);
    emit(form, "wt-submit", { value: extraInput });
    await flush(el);
    expect(api.createExtraList).toHaveBeenCalledWith(extraInput);
    expect(form.open).toBe(false);
    expect(editor(el).currentValue.modifiers).toEqual([
      { kind: "options", id: "opt-list-1" },
      { kind: "extras", id: "ex-new" },
    ]);
    // The list the editor offers has to gain the new one, or it is invisible to the next product.
    expect(api.listExtraLists).toHaveBeenCalledTimes(2);
  });

  it("creates an options list from inside the product editor and attaches it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "options" });
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-option-list-form")!;
    expect(form.open).toBe(true);
    emit(form, "wt-submit", { value: optionInput });
    await flush(el);
    expect(api.createOptionList).toHaveBeenCalledWith(optionInput);
    expect(form.open).toBe(false);
    expect(editor(el).currentValue.modifiers).toEqual([
      { kind: "options", id: "opt-list-1" },
      { kind: "options", id: "opt-new" },
    ]);
    expect(api.listOptionLists).toHaveBeenCalledTimes(2);
  });

  it("keeps a typed name and price, and the attached list, when its attached list's row opens the list editor", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    const product = editor(el);
    await userEvent.fill(
      product.shadowRoot!.querySelector('[name="name"]')!.shadowRoot!.querySelector("input")!,
      "Croquetas fritas",
    );
    await userEvent.fill(
      product.shadowRoot!.querySelector('[name="unit-price"]')!.shadowRoot!.querySelector("input")!,
      "9.75",
    );
    await product.updateComplete;
    const unsaved = () => {
      const { name, unitPrice, modifiers } = product.currentValue;
      return { name, unitPrice, modifiers };
    };
    const expected = {
      name: "Croquetas fritas",
      unitPrice: "9.75",
      modifiers: [{ kind: "options", id: "opt-list-1" }],
    };
    expect(unsaved()).toEqual(expected);
    const form = el.shadowRoot!.querySelector("dashboard-option-list-form")!;
    const openFromRow = async () => {
      await userEvent.click(
        product.shadowRoot!.querySelector<HTMLElement>(
          '[data-test="open-modifier-options:opt-list-1"]',
        )!,
      );
      await el.updateComplete;
      expect(form.open).toBe(true);
      expect(form.value).toEqual(optionLists[0]);
    };

    await openFromRow();
    emit(form, "wt-cancel", {});
    await flush(el);
    expect(form.open).toBe(false);
    expect(product.open).toBe(true);
    expect(unsaved()).toEqual(expected);

    await openFromRow();
    emit(form, "wt-submit", { value: optionInput });
    await flush(el);
    expect(api.updateOptionList).toHaveBeenCalledWith("opt-list-1", optionInput);
    expect(form.open).toBe(false);
    expect(product.open).toBe(true);
    expect(unsaved()).toEqual(expected);
  });

  describe("focus after the list editor opened from an attached row closes", () => {
    // p1 carries only the options list, so the extras cases serve it an extras list instead.
    const kinds = {
      options: {
        key: "options:opt-list-1",
        form: "dashboard-option-list-form",
        input: optionInput,
        update: "updateOptionList",
        id: "opt-list-1",
      },
      extras: {
        key: "extras:ex-1",
        form: "dashboard-extra-list-form",
        input: extraInput,
        update: "updateExtraList",
        id: "ex-1",
      },
    } as const;
    type Kind = keyof typeof kinds;
    const apiFor = (kind: Kind): DashboardApi =>
      kind === "options"
        ? stubApi()
        : stubApi({
            getProductEditor: vi
              .fn()
              .mockResolvedValue({ ...value, modifiers: [{ kind: "extras", id: "ex-1" }] }),
          });
    async function openProduct(api: DashboardApi, kind: Kind) {
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      const form = el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(kinds[kind].form)!;
      const row = editor(el).shadowRoot!.querySelector<HTMLElement>(
        `[data-test=attached-modifier][data-modifier="${kinds[kind].key}"]`,
      )!;
      return { el, form, row };
    }
    const activator = (row: HTMLElement) =>
      row.querySelector<HTMLElement>(`[data-test="open-modifier-${row.dataset.modifier}"]`)!;
    const closes = (kind: Kind) => [
      (form: HTMLElement) => emit(form, "wt-cancel", {}),
      (form: HTMLElement) => emit(form, "wt-submit", { value: kinds[kind].input }),
    ];

    // The click case focuses the name field and calls `click()`, which leaves focus there, so only
    // the screen's own hand-back can put focus on the row.
    describe.each(["options", "extras"] as const)("an attached %s list", (kind) => {
      it.each([
        [
          "Enter on the row",
          async (row: HTMLElement) => {
            activator(row).focus();
            await userEvent.keyboard("{Enter}");
          },
        ],
        [
          "a click that leaves focus where it was",
          async (row: HTMLElement, el: CatalogueScreen) => {
            editor(el).shadowRoot!.querySelector<HTMLElement>('[name="name"]')!.focus();
            activator(row).click();
          },
        ],
      ])(
        "goes back to the row after Cancel and after a save, when %s opened it",
        async (_, open) => {
          const api = apiFor(kind);
          const { el, form, row } = await openProduct(api, kind);
          for (const close of closes(kind)) {
            await open(row, el);
            await el.updateComplete;
            expect(form.open).toBe(true);
            close(form);
            await flush(el);
            await afterDialogCloses(el);
            expect(form.open).toBe(false);
            expect(editor(el).shadowRoot!.activeElement).toBe(activator(row));
          }
          expect(api[kinds[kind].update]).toHaveBeenCalledWith(kinds[kind].id, kinds[kind].input);
        },
      );
    });

    it("goes back to the row's menu after Cancel and after a save, when the menu's Edit opened it", async () => {
      const api = apiFor("options");
      const { el, form, row } = await openProduct(api, "options");
      const menu = row.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
        "wt-row-actions",
      )!;
      for (const close of closes("options")) {
        await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>("button")!);
        await menu.updateComplete;
        await userEvent.click(
          row.querySelector<HTMLElement>('[data-test="edit-modifier-options:opt-list-1"]')!,
        );
        await el.updateComplete;
        expect(form.open).toBe(true);
        close(form);
        await flush(el);
        await afterDialogCloses(el);
        expect(form.open).toBe(false);
        expect(editor(el).shadowRoot!.activeElement).toBe(menu);
      }
      expect(api.updateOptionList).toHaveBeenCalledWith("opt-list-1", optionInput);
    });

    it("goes to the Modifiers control after a new list's form is cancelled, though a row opened one before", async () => {
      const { el, form, row } = await openProduct(stubApi(), "options");
      activator(row).focus();
      await userEvent.keyboard("{Enter}");
      await el.updateComplete;
      emit(form, "wt-cancel", {});
      await flush(el);
      await afterDialogCloses(el);
      const combobox = editor(el).shadowRoot!.querySelector<HTMLElement>(
        "[data-test=add-modifier]",
      )!;
      combobox.focus();
      emit(combobox, "wt-change", { value: "create-options" });
      await el.updateComplete;
      expect(form.open).toBe(true);
      emit(form, "wt-cancel", {});
      await flush(el);
      await afterDialogCloses(el);
      expect(editor(el).shadowRoot!.activeElement).toBe(combobox);
    });

    it.each([
      [
        "its Cancel",
        (form: HTMLElement) =>
          form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click(),
      ],
      [
        "Escape",
        async (form: HTMLElement) => {
          const closed = closeOf(form.shadowRoot!.querySelector("wt-modal")!);
          await userEvent.keyboard("{Escape}");
          await closed;
        },
      ],
    ])(
      "goes back to the row after %s closes the list's form, even when the editor draws the row enabled again only after the form has shut",
      async (_, close) => {
        const { el, form, row } = await openProduct(apiFor("options"), "options");
        activator(row).focus();
        await userEvent.keyboard("{Enter}");
        await el.updateComplete;
        expect(form.open).toBe(true);
        const product = editor(el) as ProductEditor & { scheduleUpdate(): Promise<unknown> | void };
        await product.updateComplete;
        const scheduleUpdate = product.scheduleUpdate;
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        product.scheduleUpdate = async function (this: typeof product) {
          await held;
          return scheduleUpdate.call(this);
        };
        try {
          await close(form);
          await vi.waitFor(() => expect(form.open).toBe(false));
          await flush(el);
          await afterDialogCloses(el);
          const button = row.querySelector<HTMLButtonElement>(".row-activate")!;
          expect(button.disabled).toBe(true);
          release();
          await vi.waitFor(() => expect(product.shadowRoot!.activeElement).toBe(button));
        } finally {
          release();
          product.scheduleUpdate = scheduleUpdate;
        }
      },
    );
  });

  it("edits an attached list of either kind through its own nested form", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-edit-related", { kind: "options", id: "opt-list-1" });
    await el.updateComplete;
    const options = el.shadowRoot!.querySelector("dashboard-option-list-form")!;
    expect(options.open).toBe(true);
    expect(options.value).toEqual(optionLists[0]);
    emit(options, "wt-submit", { value: optionInput });
    await flush(el);
    expect(api.updateOptionList).toHaveBeenCalledWith("opt-list-1", optionInput);
    expect(api.createOptionList).not.toHaveBeenCalled();
    emit(editor(el), "wt-edit-related", { kind: "extras", id: "ex-1" });
    await el.updateComplete;
    const extras = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    expect(extras.open).toBe(true);
    expect(extras.value).toEqual(extraLists[0]);
    emit(extras, "wt-submit", { value: extraInput });
    await flush(el);
    expect(api.updateExtraList).toHaveBeenCalledWith("ex-1", extraInput);
    expect(api.createExtraList).not.toHaveBeenCalled();
    // Editing a list attached to the product changes the list, never what the product carries.
    expect(editor(el).currentValue.modifiers).toEqual([{ kind: "options", id: "opt-list-1" }]);
  });

  // Both nested forms show a refused save themselves, keyed by the field path the server named —
  // the same wiring the Modifiers screen gives them. Without it the form stays open saying nothing.
  it("gives a refused nested list write back to the form that sent it", async () => {
    const refusal = {
      code: "extras.translation_required",
      params: { field: "customerName", language: "es" },
      status: 400,
    };
    const api = stubApi({
      createExtraList: vi.fn().mockRejectedValue(refusal),
      createOptionList: vi.fn().mockRejectedValue({ ...refusal, code: "options.invalid" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "extras" });
    await el.updateComplete;
    const extras = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    emit(extras, "wt-submit", { value: extraInput });
    await flush(el);
    expect(extras.open).toBe(true);
    expect(extras.fieldErrors).toEqual({
      customerName: codeMessage("extras.translation_required"),
    });
    // Nothing was attached and nothing was said behind the modal.
    expect(editor(el).currentValue.modifiers).toEqual([{ kind: "options", id: "opt-list-1" }]);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();

    emit(extras, "wt-cancel", {});
    await flush(el);
    // A refusal belongs to the form that earned it: reopening a form must not inherit the last one.
    expect([extras.open, extras.fieldErrors, editor(el).childOpen]).toEqual([false, {}, false]);
    emit(editor(el), "wt-create-related", { kind: "options" });
    await el.updateComplete;
    const options = el.shadowRoot!.querySelector("dashboard-option-list-form")!;
    expect([options.open, options.fieldErrors, editor(el).childOpen]).toEqual([true, {}, true]);
    emit(options, "wt-submit", { value: optionInput });
    await flush(el);
    expect([options.open, options.fieldErrors]).toEqual([
      true,
      { customerName: codeMessage("options.invalid") },
    ]);
  });

  it("gives a refusal to offer a product with Active variants back to the nested extras form, by item", async () => {
    const api = stubApi({
      createExtraList: vi.fn().mockRejectedValue({
        code: "extras.product_has_variants",
        params: { field: "items.0.productId", productId: "p1" },
        status: 409,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "extras" });
    await el.updateComplete;
    const extras = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    emit(extras, "wt-submit", { value: { ...extraInput, items: [{ productId: "p1" }] } });
    await flush(el);
    expect(extras.open).toBe(true);
    expect(extras.fieldErrors).toEqual({
      "items.0.productId": codeMessage("extras.product_has_variants"),
    });
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("ignores a closed form's second cancel, which by then belongs to another form", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "extras" });
    await el.updateComplete;
    const extras = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    emit(extras, "wt-cancel", {});
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "options" });
    await el.updateComplete;
    const options = el.shadowRoot!.querySelector("dashboard-option-list-form")!;
    expect(options.open).toBe(true);
    emit(extras, "wt-cancel", {});
    await flush(el);
    expect([options.open, extras.open, editor(el).childOpen]).toEqual([true, false, true]);
  });

  async function openNested(api: DashboardApi, kind: ProductChildKind): Promise<CatalogueScreen> {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind });
    await el.updateComplete;
    return el;
  }
  async function submitNested(
    el: CatalogueScreen,
    form: LitElement,
    value: unknown,
  ): Promise<void> {
    emit(form, "wt-submit", { value });
    await flush(el);
    await form.updateComplete;
  }
  /** A form's one message about a failed submission, or "" when it shows none. */
  async function bottomOf(form: Element): Promise<string> {
    const actions = form.shadowRoot!.querySelector("wt-form-actions")!;
    return (await formMessageOf(actions))?.textContent?.trim() ?? "";
  }
  const errorBeside = (form: Element, selector: string): string =>
    form.shadowRoot!.querySelector<HTMLElement & { error: string }>(selector)!.error;

  // The unit form keys its errors by its OWN field names, not by the path a refusal carries.
  it("gives a refused nested unit create back to the unit form, beside the field it concerns", async () => {
    const api = stubApi({
      createUnit: vi
        .fn()
        .mockRejectedValueOnce({ code: "unit.precision_invalid", params: {}, status: 400 })
        .mockRejectedValueOnce({
          code: "unit.translation_required",
          params: { field: "abbreviation", language: "es" },
          status: 400,
        }),
    });
    const el = await openNested(api, "unit");
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    await submitNested(el, form, {
      name: { es: "ración" },
      abbreviation: { es: "ra" },
      precision: 2,
    });
    expect(form.open).toBe(true);
    expect(errorBeside(form, "wt-combobox[name=precision]")).toBe(
      codeMessage("unit.precision_invalid"),
    );
    expect(await bottomOf(form)).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();

    await submitNested(el, form, { name: { es: "ración" }, abbreviation: {}, precision: 2 });
    expect(errorBeside(form, "[data-test=abbreviation-es]")).toBe(
      codeMessage("unit.translation_required"),
    );
    expect(errorBeside(form, "[data-test=name-es]")).toBe("");
    expect(errorBeside(form, "wt-combobox[name=precision]")).toBe("");
    expect(await bottomOf(form)).toBe(t("form.fix_fields"));
  });

  it("leaves a nested form's Save working on a refusal beside a field, which stays gone once that field changes", async () => {
    const api = stubApi({
      createUnit: vi
        .fn()
        .mockRejectedValueOnce({ code: "unit.precision_invalid", params: {}, status: 400 }),
    });
    const el = await openNested(api, "unit");
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    await form.updateComplete;
    emit(form.shadowRoot!.querySelector("[data-test=name-es]")!, "wt-change", { value: "ración" });
    emit(form.shadowRoot!.querySelector("[data-test=abbreviation-es]")!, "wt-change", {
      value: "ra",
    });
    await chooseOption(form.shadowRoot!.querySelector("wt-combobox[name=precision]")!, "2");
    await form.updateComplete;
    const save =
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=submit]")!;
    save.click();
    await flush(el);
    await form.updateComplete;
    expect(api.createUnit).toHaveBeenCalledWith({
      name: { es: "ración" },
      abbreviation: { es: "ra" },
      precision: 2,
    });
    expect(errorBeside(form, "wt-combobox[name=precision]")).not.toBe("");
    expect(save.disabled).toBe(false);

    await chooseOption(form.shadowRoot!.querySelector("wt-combobox[name=precision]")!, "1");
    await form.updateComplete;
    expect(errorBeside(form, "wt-combobox[name=precision]")).toBe("");
    // The screen redrawing for its own reasons does not bring the dismissed refusal back.
    el.requestUpdate();
    await el.updateComplete;
    await form.updateComplete;
    expect(errorBeside(form, "wt-combobox[name=precision]")).toBe("");
  });

  it("still says a nested unit refusal that names no field of the form, in its bottom message", async () => {
    const api = stubApi({
      createUnit: vi.fn().mockRejectedValue({ code: "server.internal", status: 500 }),
    });
    const el = await openNested(api, "unit");
    const unitForm = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    await submitNested(el, unitForm, {
      name: { es: "ración" },
      abbreviation: { es: "ra" },
      precision: 2,
    });
    expect(unitForm.open).toBe(true);
    expect(await bottomOf(unitForm)).toBe(codeMessage("server.internal"));
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("ignores a closed unit form's second cancel once the extras form is open", async () => {
    const el = await openNested(stubApi(), "unit");
    const unitForm = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    emit(unitForm, "wt-cancel", {});
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "extras" });
    await el.updateComplete;
    const extrasForm = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    expect(extrasForm.open).toBe(true);
    emit(unitForm, "wt-cancel", {});
    await flush(el);
    expect([extrasForm.open, unitForm.open, editor(el).childOpen]).toEqual([true, false, true]);
  });

  it("ignores a closed extras form's second cancel once the unit form is open", async () => {
    const el = await openNested(stubApi(), "extras");
    const extrasForm = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    emit(extrasForm, "wt-cancel", {});
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "unit" });
    await el.updateComplete;
    const unitForm = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    expect(unitForm.open).toBe(true);
    emit(extrasForm, "wt-cancel", {});
    await flush(el);
    expect([unitForm.open, extrasForm.open, editor(el).childOpen]).toEqual([true, false, true]);
  });

  // Opened by a real click: opened by a synthetic click with this case run first, one Escape also
  // closed the editor behind it (HeadlessChrome 153; C74).
  it("closes only the unit form when Escape is pressed in it, leaving the product editor open", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el).shadowRoot!.querySelector("wt-price-input")!, "wt-unit-click", {});
    await editor(el).updateComplete;
    await userEvent.click(
      editor(el).shadowRoot!.querySelector<HTMLElement>("[data-test=add-unit]")!,
    );
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    expect(form.open).toBe(true);
    let cancels = 0;
    form.addEventListener("wt-cancel", () => cancels++);

    const closed = closeOf(form.shadowRoot!.querySelector("wt-modal")!);
    await userEvent.keyboard("{Escape}");
    await closed;
    await vi.waitFor(() => expect(cancels).toBe(1));
    await flush(el);
    await closeReportsDelivered();

    expect(form.open).toBe(false);
    expect(editor(el).open).toBe(true);
    expect(cancels).toBe(1);
  });

  describe("focus after the unit form opened from the unit chooser closes", () => {
    // The name field has focus when the chooser opens, and the chooser's unit dropdown when Add unit
    // is clicked in script, so the dialogs' own return of focus lands on neither target and only
    // the hand-back can. The real click on the chooser's heading comes first because without it one
    // Escape closed the chooser as well as the form.
    async function openUnitForm(el: CatalogueScreen) {
      const product = editor(el);
      product.shadowRoot!.querySelector<HTMLElement>('[name="name"]')!.focus();
      emit(product.shadowRoot!.querySelector("wt-price-input")!, "wt-unit-click", {});
      await product.updateComplete;
      const chooser = product.shadowRoot!.querySelector<LitElement>(
        "wt-dialog[data-test=unit-chooser]",
      )!;
      await chooser.updateComplete;
      await userEvent.click(chooser.shadowRoot!.querySelector("h2")!);
      product.shadowRoot!.querySelector<HTMLElement>("wt-combobox[name=unit]")!.focus();
      product.shadowRoot!.querySelector<HTMLElement>("[data-test=add-unit]")!.click();
      await el.updateComplete;
      const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
      expect(form.open).toBe(true);
      return form;
    }
    async function mountWithProduct(api: DashboardApi) {
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      return el;
    }

    it.each([
      [
        "its Cancel",
        (form: HTMLElement) =>
          form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click(),
      ],
      [
        "Escape",
        async (form: HTMLElement) => {
          const closed = closeOf(form.shadowRoot!.querySelector("wt-modal")!);
          await userEvent.keyboard("{Escape}");
          await closed;
        },
      ],
    ])("goes back to Add unit after %s closes it", async (_, close) => {
      const el = await mountWithProduct(stubApi());
      const form = await openUnitForm(el);
      await close(form);
      await vi.waitFor(() => expect(form.open).toBe(false));
      await flush(el);
      await afterDialogCloses(el);
      const product = editor(el);
      expect(
        product.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
          "wt-dialog[data-test=unit-chooser]",
        )!.open,
      ).toBe(true);
      const addUnit = product.shadowRoot!.querySelector("[data-test=add-unit]");
      expect(addUnit).not.toBeNull();
      expect(product.shadowRoot!.activeElement).toBe(addUnit);
    });

    it.each([
      [
        "its Cancel",
        (form: HTMLElement) =>
          form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click(),
      ],
      [
        "Escape",
        async (form: HTMLElement) => {
          const closed = closeOf(form.shadowRoot!.querySelector("wt-modal")!);
          await userEvent.keyboard("{Escape}");
          await closed;
        },
      ],
    ])(
      "goes back to Add unit after %s closes it, even when the editor draws it enabled again only after the form has shut",
      async (_, close) => {
        const el = await mountWithProduct(stubApi());
        const form = await openUnitForm(el);
        const product = editor(el) as ProductEditor & { scheduleUpdate(): Promise<unknown> | void };
        const scheduleUpdate = product.scheduleUpdate;
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        product.scheduleUpdate = async function (this: typeof product) {
          await held;
          return scheduleUpdate.call(this);
        };
        try {
          await close(form);
          await vi.waitFor(() => expect(form.open).toBe(false));
          await flush(el);
          await afterDialogCloses(el);
          const addUnit = product.shadowRoot!.querySelector<HTMLElement>("[data-test=add-unit]")!;
          expect(addUnit.hasAttribute("disabled")).toBe(true);
          release();
          await vi.waitFor(() => expect(product.shadowRoot!.activeElement).toBe(addUnit));
        } finally {
          release();
          product.scheduleUpdate = scheduleUpdate;
        }
      },
    );

    it("goes back to the price's unit button, the chooser's opener, after a save closes it and the chooser", async () => {
      const api = stubApi();
      const el = await mountWithProduct(api);
      const form = await openUnitForm(el);
      emit(form, "wt-submit", {
        value: { name: { es: "ración" }, abbreviation: { es: "ra" }, precision: 2 },
      });
      await flush(el);
      await afterDialogCloses(el);
      expect(api.createUnit).toHaveBeenCalledOnce();
      expect(form.open).toBe(false);
      const price = editor(el).shadowRoot!.querySelector("wt-price-input")!;
      expect(editor(el).shadowRoot!.activeElement).toBe(price);
      expect(price.shadowRoot!.activeElement).toBe(price.shadowRoot!.querySelector("button.unit"));
    });
  });

  it("reports a refused attachment inside the editor, not behind it", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "product.invalid",
        params: { field: "modifiers.0.id" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(editor(el).fieldErrors).toEqual({ modifier: t("editor.field_rejected") });
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("reports a refused save beside the field the server named, and clears it on the next product", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "product.invalid",
        params: { field: "kitchenName" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(editor(el).fieldErrors).toEqual({ "kitchen-name": t("editor.field_rejected") });
    // The refusal is said ONCE, beside the field — the screen's own banner is for a refusal with
    // nothing to point at.
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    await editor(el).updateComplete;
    // …and the section holding that field is no longer folded over it.
    const kitchen = editor(el).shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      '[data-section="kitchen"]',
    )!;
    expect(kitchen.open).toBe(true);
    emit(editor(el), "wt-cancel", {});
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(editor(el).fieldErrors).toEqual({});
  });

  // Each of these codes names the missing thing by id; the editor holds the one field that chose it.
  it.each([
    ["category.not_found", { categoryId: "c1" }, "primary"],
    ["unit.not_found", { unitId: "u1" }, "unit"],
    ["course.not_found", { courseId: "k1" }, "product-course"],
    ["product.variant_not_found", { variantId: "v2" }, "variant-1-name"],
  ])(
    "puts %s beside the editor field that chose it, leaving Save working",
    async (code, params, field) => {
      const variant = {
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: null,
        available: true,
        active: true,
      };
      const sent = {
        ...value,
        courseId: "k1",
        variants: [
          { ...variant, id: "v1", name: "Media" },
          { ...variant, id: "v2", name: "Entera" },
        ],
      };
      const api = stubApi({
        getProductEditor: vi.fn().mockResolvedValue(sent),
        updateProductEditor: vi.fn().mockRejectedValue({ code, params, status: 404 }),
      });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      await editKitchenName(el);
      emit(editor(el), "wt-submit", { value: sent });
      await flush(el);
      expect(editor(el).fieldErrors).toEqual({ [field]: codeMessage(code) });
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
      await editor(el).updateComplete;
      expect(
        editor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=save]",
        )!.disabled,
      ).toBe(false);
    },
  );

  it("keeps a missing id the save did not send for the screen's banner", async () => {
    const api = stubApi({
      updateProductEditor: vi
        .fn()
        .mockRejectedValue({ code: "category.not_found", params: { categoryId: "c9" } }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).fieldErrors).toEqual({});
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
  });

  it("falls back to the screen's banner when a refusal names a field with no error display", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "product.invalid",
        params: { field: "available" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).fieldErrors).toEqual({});
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
  });

  it("reports a refused translation beside the input for the language the server named", async () => {
    // The default content language is English and the product carries only a Spanish customer name,
    // which is what the real save refuses: it names the missing LANGUAGE, never a field.
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "content.translation_required",
        params: { language: "en" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    await editKitchenName(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(editor(el).fieldErrors).toEqual({
      "customer-name-en": codeMessage("content.translation_required"),
    });
    // Said once, beside the field — the screen's banner renders behind the open editor.
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    await editor(el).updateComplete;
    const descriptors = editor(el).shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      '[data-section="descriptors"]',
    )!;
    await expect.poll(() => descriptors.open).toBe(true);
    await expect
      .poll(() => editor(el).shadowRoot!.activeElement?.getAttribute("name"))
      .toBe("customer-name-en");
    const input = editor(el).shadowRoot!.querySelector("[name=customer-name-en]") as unknown as {
      error: string;
      invalid: boolean;
    };
    expect(input).toMatchObject({
      error: codeMessage("content.translation_required"),
      invalid: true,
    });
    expect(await bottomOf(editor(el))).toBe(t("form.fix_fields"));
    expect(
      editor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
        .disabled,
    ).toBe(false);
  });

  describe("a staff name another Active product already has", () => {
    let locale: string;
    beforeEach(() => {
      locale = currentLocale();
      setLocale("en-GB");
    });
    afterEach(() => setLocale(locale));
    const MESSAGE = "Another active product or variant already has this name.";
    const variantRow = {
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
      active: true,
    };
    const sent = {
      ...value,
      name: "Croquetas",
      variants: [
        { ...variantRow, id: "v1", name: "Media" },
        { ...variantRow, id: "v2", name: "Entera" },
      ],
    };
    async function refuse(field: string) {
      const api = stubApi({
        getProductEditor: vi.fn().mockResolvedValue(sent),
        updateProductEditor: vi.fn().mockRejectedValue({
          code: "product.name_taken",
          params: { field, name: "Entera" },
          status: 409,
        }),
      });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el), "wt-submit", { value: sent });
      await flush(el);
      await editor(el).updateComplete;
      return el;
    }

    it("puts the refusal beside the product's Name with its own message, keeping the draft", async () => {
      const el = await refuse("name");
      expect(editor(el).open).toBe(true);
      expect(editor(el).fieldErrors).toEqual({ name: MESSAGE });
      const name = editor(el).shadowRoot!.querySelector("[name=name]") as unknown as {
        error: string;
        value: string;
      };
      expect(name).toMatchObject({ error: MESSAGE, value: "Croquetas" });
      expect(await bottomOf(editor(el))).toBe(t("form.fix_fields"));
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    });

    it("puts the refusal beside the variant row's Name", async () => {
      const el = await refuse("variants.1.name");
      expect(editor(el).fieldErrors).toEqual({ "variant-1-name": MESSAGE });
      const table = editor(el).shadowRoot!.querySelector("dashboard-variant-table")!;
      await table.updateComplete;
      expect(table.shadowRoot!.querySelector("[data-test=error-1]")?.textContent).toContain(
        MESSAGE,
      );
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    });

    it("says it in Spanish", async () => {
      setLocale("es");
      const el = await refuse("name");
      expect(editor(el).fieldErrors).toEqual({
        name: "Ya hay otro producto o variante activo con este nombre.",
      });
    });

    it("an archived row offers View only even when a write would refuse its name", async () => {
      await archivedRowOffersView(
        stubApi({
          updateProductEditor: vi.fn().mockRejectedValue({
            code: "product.name_taken",
            params: { field: "name", name: "Croquetas" },
            status: 409,
          }),
        }),
      );
    });
  });

  it("marks the variant whose translation the save refused, and reaches its window", async () => {
    const variants = [
      {
        name: "Media",
        customerName: { en: "Half", es: "Media" },
        kitchenName: null,
        image: null,
        unitPrice: "4.50",
        available: true,
        active: true,
      },
      {
        name: "Entera",
        customerName: { es: "Ración entera" },
        kitchenName: null,
        image: null,
        unitPrice: "8.50",
        available: true,
        active: true,
      },
    ];
    // The product's own customer name is complete, so the only value missing English is the second
    // variant's — the editor must not point at a field that is fine.
    const product = { ...value, customerName: { en: "Croquettes", es: "Croquetas" }, variants };
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
      getProductEditor: vi.fn().mockResolvedValue(product),
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "content.translation_required",
        params: { language: "en" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value: product });
    await flush(el);
    expect(editor(el).fieldErrors).toEqual({
      "variant-1-name": codeMessage("content.translation_required"),
    });
    await editor(el).updateComplete;
    const table = editor(el).shadowRoot!.querySelector("dashboard-variant-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector("[data-test=error-1]")?.textContent).toContain(
      codeMessage("content.translation_required"),
    );
    // A variant's names are only editable in its own window, so focus lands on the row's actions —
    // the way into it. Every other control on the row belongs to a different variant or a different
    // value.
    await expect
      .poll(() => table.shadowRoot!.activeElement?.getAttribute("data-test"))
      .toBe("actions-1");
  });

  it("puts a refusal to give an offered product an Active variant beside that variant, naming the lists", async () => {
    const variant = {
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
    };
    const product = {
      ...value,
      variants: [
        { ...variant, id: "v1", name: "Media", active: false },
        { ...variant, name: "Entera", active: true },
      ],
    };
    const api = stubApi({
      getProductEditor: vi.fn().mockResolvedValue(product),
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "product.offered_as_extra",
        params: {
          field: "variants.1.active",
          extraLists: [
            { id: "ex-1", name: "Salsas" },
            { id: "ex-2", name: "Toppings" },
          ],
        },
        status: 409,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value: product });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    await editor(el).updateComplete;
    const table = editor(el).shadowRoot!.querySelector("dashboard-variant-table")!;
    await table.updateComplete;
    const error = table.shadowRoot!.querySelector("[data-test=error-1]")?.textContent ?? "";
    expect(error).toContain(codeMessage("product.offered_as_extra"));
    expect(error).toContain("Salsas");
    expect(error).toContain("Toppings");
    expect(table.shadowRoot!.querySelector("[data-test=error-0]")).toBeNull();
  });

  it("closes after a successful write even when the product refresh fails", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    vi.mocked(api.listProducts).mockRejectedValueOnce({ code: "server.internal" });
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
  });

  it("creates a related unit without replacing the dirty parent draft", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "add-product", { categoryId: null });
    await el.updateComplete;
    const before = { ...editor(el).currentValue, name: "Borrador" };
    (editor(el) as unknown as { draft: ProductEditorInput }).draft = before;
    emit(editor(el), "wt-create-related", { kind: "unit" });
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    expect(form.open).toBe(true);
    emit(form, "wt-submit", { value: { name: { es: "ración" }, precision: 2 } });
    await flush(el);
    expect(editor(el).currentValue.name).toBe("Borrador");
    expect(editor(el).currentValue.unitId).toBe("u2");
  });

  describe("the courses window", () => {
    const venueCourses: Course[] = [
      { id: "k1", name: "Entrantes", displayOrder: 0, active: true, inUse: false },
      { id: "k2", name: "Principales", displayOrder: 1, active: true, inUse: false },
    ];
    const slowly = <T>(value: T): Promise<T> =>
      new Promise((resolve) => setTimeout(() => resolve(value), 100));
    /** The server's courses, which the window's writes change. A slow create is answered after a
     * delay, as over a real network. */
    function courseApi(
      overrides: Partial<DashboardApi> = {},
      slowCreate = false,
      initial: Course[] = venueCourses,
    ) {
      let rows = initial.map((course) => ({ ...course }));
      const read = (all: boolean) =>
        Promise.resolve(
          rows.filter((course) => all || course.active).map((course) => ({ ...course })),
        );
      return stubApi({
        listCourses: vi.fn(() => read(false)),
        listCoursesWithDisabled: vi.fn(() => read(true)),
        createCourse: vi.fn(
          async ({ name, displayOrder }: { name: string; displayOrder: number }) => {
            if (slowCreate) await slowly(null);
            rows = [...rows, { id: "k-new", name, displayOrder, active: true, inUse: false }];
            return { id: "k-new" };
          },
        ),
        updateCourse: vi.fn().mockResolvedValue(undefined),
        removeCourse: vi.fn((id: string) => {
          rows = rows.filter((course) => course.id !== id);
          return Promise.resolve();
        }),
        moveCourse: vi.fn(() => read(false)),
        ...overrides,
      });
    }
    const coursesWindow = (el: CatalogueScreen) =>
      el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-test=courses-dialog]")!;
    const courseList = (el: CatalogueScreen) =>
      el.shadowRoot!.querySelector<LitElement>("dashboard-course-list");
    const inList = (el: CatalogueScreen, selector: string) =>
      courseList(el)!.shadowRoot!.querySelector<HTMLElement>(selector)!;
    const courseBox = (el: CatalogueScreen) =>
      editor(el).shadowRoot!.querySelector<HTMLElement & { value: string }>(
        'wt-combobox[name="product-course"]',
      )!;
    async function shownCourse(el: CatalogueScreen): Promise<string | undefined> {
      const box = courseBox(el) as unknown as LitElement;
      await box.updateComplete;
      return box.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
    }

    /** Opens the product, types an unsaved name, then chooses Edit courses… with real clicks. */
    async function openCourses(api: DashboardApi, courseId: string | null = null) {
      (api.getProductEditor as ReturnType<typeof vi.fn>).mockResolvedValue({ ...value, courseId });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el).shadowRoot!.querySelector('[name="name"]')!, "wt-change", {
        value: "Croquetas sin guardar",
      });
      await editor(el).updateComplete;
      const kitchen = editor(el).shadowRoot!.querySelector<LitElement>('[data-section="kitchen"]')!;
      await kitchen.updateComplete;
      await userEvent.click(kitchen.shadowRoot!.querySelector<HTMLElement>("button.header")!);
      const box = courseBox(el) as unknown as LitElement;
      await box.updateComplete;
      await userEvent.click(box.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
      await box.updateComplete;
      const row = [...box.shadowRoot!.querySelectorAll<HTMLElement>("li[role=option]")].find(
        (option) => option.textContent!.trim() === t("editor.edit_courses"),
      )!;
      await userEvent.click(row);
      await el.updateComplete;
      await vi.waitFor(() =>
        expect(courseList(el)?.shadowRoot!.querySelectorAll("tbody tr").length).toBeGreaterThan(0),
      );
      return el;
    }
    /** Deletes a course nothing refers to from the window: its Delete, then the confirmation. */
    async function deleteInWindow(el: CatalogueScreen, id: string): Promise<void> {
      inList(el, `[data-test="remove-${id}"]`).click();
      await vi.waitFor(() =>
        expect(
          courseList(el)!.shadowRoot!.querySelector('[data-test="confirm-delete-course"]'),
        ).not.toBeNull(),
      );
      inList(el, '[data-test="confirm-delete-course"]').click();
    }
    /** Opens the list's new row and types a name into it, leaving focus in the field. */
    async function typeNewCourse(el: CatalogueScreen, name: string): Promise<void> {
      await userEvent.click(inList(el, '[data-test="add-course"]'));
      await courseList(el)!.updateComplete;
      const field = inList(el, 'wt-input[name="course-name"]') as unknown as LitElement;
      await field.updateComplete;
      const input = field.shadowRoot!.querySelector("input")!;
      input.value = name;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.focus();
    }
    async function addCourse(el: CatalogueScreen, name: string): Promise<void> {
      await typeNewCourse(el, name);
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() => expect(inList(el, '[data-test="name-k-new"]')).not.toBeNull());
    }
    async function done(el: CatalogueScreen): Promise<void> {
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!);
      await flush(el);
      await flush(el);
    }

    it("opens from Edit courses… holding the course list, headed Courses, with one Done button", async () => {
      const api = courseApi();
      const el = await openCourses(api);
      const dialog = coursesWindow(el) as HTMLElement & { open: boolean; heading: string };
      expect(dialog.open).toBe(true);
      expect(dialog.heading).toBe(t("kitchen.courses_title"));
      expect(courseList(el)!.closest("[data-test=courses-dialog]")).toBe(dialog);
      expect(
        [...dialog.querySelectorAll("wt-button")].map((button) => button.textContent!.trim()),
      ).toEqual([t("action.done")]);
      expect(dialog.querySelector("[data-test=courses-done]")!.getAttribute("slot")).toBe("cancel");
      expect(editor(el).childOpen).toBe(true);
    });

    it("selects a course added in the window once Done closes it, keeping the product's unsaved edits", async () => {
      const api = courseApi();
      const el = await openCourses(api, "k1");
      await addCourse(el, "Postres");
      await done(el);
      expect(coursesWindow(el).open).toBe(false);
      expect(editor(el).open).toBe(true);
      expect(editor(el).currentValue.courseId).toBe("k-new");
      expect(editor(el).currentValue.name).toBe("Croquetas sin guardar");
      expect(editor(el).courses.map(({ id }) => id)).toEqual(["k1", "k2", "k-new"]);
      expect(await shownCourse(el)).toBe("Postres");
      expect(editor(el).shadowRoot!.activeElement).toBe(courseBox(el));
    });

    it("waits for a course typed and left by pressing Done, then selects it", async () => {
      const api = courseApi({}, true);
      const create = vi.mocked(api.createCourse);
      const el = await openCourses(api, "k1");
      await typeNewCourse(el, "Postres");
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!);
      await vi.waitFor(() => expect(coursesWindow(el).open).toBe(false));
      await vi.waitFor(() => expect(editor(el).currentValue.courseId).toBe("k-new"));
      expect(create).toHaveBeenCalledExactlyOnceWith({ name: "Postres", displayOrder: 2 });
      expect(editor(el).courses.map(({ id }) => id)).toEqual(["k1", "k2", "k-new"]);
      expect(await shownCourse(el)).toBe("Postres");
      expect(editor(el).shadowRoot!.activeElement).toBe(courseBox(el));
    });

    it("closes once when Done is pressed again while it waits", async () => {
      let answer!: () => void;
      let added = false;
      const postres: Course = {
        id: "k-new",
        name: "Postres",
        displayOrder: 2,
        active: true,
        inUse: false,
      };
      const courses = () =>
        Promise.resolve([...venueCourses, ...(added ? [postres] : [])].map((c) => ({ ...c })));
      const api = courseApi({
        createCourse: vi.fn(
          () =>
            new Promise<{ id: string }>((resolve) => {
              answer = () => {
                added = true;
                resolve({ id: "k-new" });
              };
            }),
        ),
        listCourses: vi.fn(courses),
        listCoursesWithDisabled: vi.fn(courses),
      });
      const el = await openCourses(api, "k1");
      await typeNewCourse(el, "Postres");
      const reads = vi.mocked(api.listCourses).mock.calls.length;
      const listReads = vi.mocked(api.listCoursesWithDisabled).mock.calls.length;
      const doneButton = el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!;
      await userEvent.click(doneButton);
      await userEvent.click(doneButton);
      await vi.waitFor(() => expect(api.createCourse).toHaveBeenCalledOnce());
      answer();
      await vi.waitFor(() => expect(coursesWindow(el).open).toBe(false));
      await vi.waitFor(() => expect(editor(el).currentValue.courseId).toBe("k-new"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await flush(el);
      // The list's own read after the add, then the window's one on closing.
      expect(api.listCoursesWithDisabled).toHaveBeenCalledTimes(listReads + 1);
      expect(api.listCourses).toHaveBeenCalledTimes(reads + 1);
      expect(editor(el).courses.map(({ id }) => id)).toEqual(["k1", "k2", "k-new"]);
      expect(await shownCourse(el)).toBe("Postres");
      expect(editor(el).shadowRoot!.activeElement).toBe(courseBox(el));
    });

    it("waits as well for a change made in the window while Done was waiting", async () => {
      let answerRemoval!: () => void;
      const api = courseApi(
        {
          removeCourse: vi.fn(() => new Promise<void>((resolve) => (answerRemoval = resolve))),
        },
        true,
      );
      const el = await openCourses(api, "k1");
      await typeNewCourse(el, "Postres");
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!);
      await deleteInWindow(el, "k2");
      await vi.waitFor(() => expect(api.createCourse).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 300));
      await flush(el);
      expect(vi.mocked(api.removeCourse).mock.calls).toEqual([["k2", { disable: false }]]);
      expect([coursesWindow(el).open, editor(el).currentValue.courseId]).toEqual([true, "k1"]);
      answerRemoval();
      await vi.waitFor(() => expect(coursesWindow(el).open).toBe(false));
      await vi.waitFor(() => expect(editor(el).currentValue.courseId).toBe("k-new"));
    });

    it("keeps a Delete confirmation opened while Done waits, closing only once it is answered", async () => {
      let answerCreate!: () => void;
      let created = false;
      const api = courseApi();
      const create = vi.mocked(api.createCourse).getMockImplementation()!;
      vi.mocked(api.createCourse).mockImplementation(async (input) => {
        await new Promise<void>((resolve) => (answerCreate = resolve));
        created = true;
        return create(input);
      });
      const el = await openCourses(api, "k1");
      await typeNewCourse(el, "Postres");
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!);
      await vi.waitFor(() => expect(api.createCourse).toHaveBeenCalledOnce());
      inList(el, '[data-test="remove-k2"]').click();
      const confirmation = () =>
        courseList(el)!.shadowRoot!.querySelector('[data-test="confirm-delete-course"]');
      await vi.waitFor(() => expect(confirmation()).not.toBeNull());
      answerCreate();
      await vi.waitFor(() => expect(created).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await flush(el);
      expect([coursesWindow(el).open, confirmation() !== null]).toEqual([true, true]);
      expect(api.removeCourse).not.toHaveBeenCalled();
      inList(el, '[data-test="confirm-delete-course"]').click();
      await vi.waitFor(() => expect(coursesWindow(el).open).toBe(false));
      expect(vi.mocked(api.removeCourse).mock.calls).toEqual([["k2", { disable: false }]]);
      await vi.waitFor(() => expect(editor(el).currentValue.courseId).toBe("k-new"));
    });

    it("keeps the window open when a Delete confirmation in it is dismissed", async () => {
      const api = courseApi();
      const el = await openCourses(api, "k1");
      inList(el, '[data-test="remove-k2"]').click();
      const confirmation = () =>
        courseList(el)!.shadowRoot!.querySelector('[data-test="delete-course-modal"]');
      await vi.waitFor(() => expect(confirmation()).not.toBeNull());
      const closed = closeOf(confirmation()!);
      await userEvent.keyboard("{Escape}");
      await closed;
      await vi.waitFor(() => expect(confirmation()).toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 300));
      await flush(el);
      expect(coursesWindow(el).open).toBe(true);
      expect(api.removeCourse).not.toHaveBeenCalled();
    });

    it("stays open when a course left by pressing Done is refused, showing why beside its name", async () => {
      const api = courseApi({
        createCourse: vi.fn(() =>
          slowly(null).then(() => Promise.reject({ code: "course.name_taken" })),
        ),
      });
      const el = await openCourses(api, "k1");
      await typeNewCourse(el, "Entrantes");
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!);
      const field = () =>
        inList(el, 'wt-input[name="course-name"]') as unknown as { error: string } | null;
      await vi.waitFor(() => expect(field()?.error).toBe(codeMessage("course.name_taken")));
      await flush(el);
      expect(coursesWindow(el).open).toBe(true);
      expect(editor(el).currentValue.courseId).toBe("k1");
      // Escape still closes it, dropping the refused name.
      const closed = closeOf(coursesWindow(el));
      await userEvent.keyboard("{Escape}");
      await closed;
      await vi.waitFor(() => expect(editor(el).childOpen).toBe(false));
      await flush(el);
      expect(coursesWindow(el).open).toBe(false);
      expect(editor(el).currentValue.courseId).toBe("k1");
      expect(editor(el).shadowRoot!.activeElement).toBe(courseBox(el));
    });

    it("leaves a window opened for the next product alone when the last one's save lands", async () => {
      const api = courseApi({}, true);
      const create = vi.mocked(api.createCourse);
      const el = await openCourses(api, "k1");
      await typeNewCourse(el, "Postres");
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el), "wt-create-related", { kind: "courses" });
      await el.updateComplete;
      await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 300));
      await flush(el);
      expect(coursesWindow(el).open).toBe(true);
      expect(editor(el).childOpen).toBe(true);
      expect(editor(el).currentValue.courseId).toBe("k1");
    });

    it("closes the next product's window on its Done while the last one's save is still out", async () => {
      let answer!: (value: { id: string }) => void;
      const api = courseApi({
        createCourse: vi.fn(() => new Promise<{ id: string }>((resolve) => (answer = resolve))),
      });
      const el = await openCourses(api, "k1");
      await typeNewCourse(el, "Postres");
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!);
      await vi.waitFor(() => expect(api.createCourse).toHaveBeenCalledOnce());
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el), "wt-create-related", { kind: "courses" });
      await el.updateComplete;
      await vi.waitFor(() =>
        expect(courseList(el)?.shadowRoot!.querySelectorAll("tbody tr").length).toBeGreaterThan(0),
      );
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!);
      await vi.waitFor(() => expect(coursesWindow(el).open).toBe(false));
      expect(editor(el).childOpen).toBe(false);
      answer({ id: "k-new" });
      await flush(el);
      expect(editor(el).currentValue.courseId).toBe("k1");
    });

    it("offers only active courses in the product's course box, though the window lists a disabled one", async () => {
      const brunch: Course = {
        id: "k3",
        name: "Brunch",
        displayOrder: 2,
        active: false,
        inUse: true,
      };
      const api = courseApi({}, false, [...venueCourses, brunch]);
      const el = await openCourses(api, "k1");
      expect(inList(el, '[data-test="status-k3"]')).not.toBeNull();
      await done(el);
      expect(editor(el).courses.map(({ id }) => id)).toEqual(["k1", "k2"]);
      const box = courseBox(el) as unknown as LitElement;
      await userEvent.click(box.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
      await box.updateComplete;
      const options = [...box.shadowRoot!.querySelectorAll("li[role=option]")].map((option) =>
        option.textContent!.trim(),
      );
      expect(options).toContain("Principales");
      expect(options).not.toContain("Brunch");
    });

    it("clears the product's course when the window removed it", async () => {
      const api = courseApi();
      const el = await openCourses(api, "k2");
      await deleteInWindow(el, "k2");
      await vi.waitFor(() => expect(inList(el, '[data-test="name-k2"]')).toBeNull());
      await done(el);
      expect(editor(el).currentValue.courseId).toBeNull();
      expect(editor(el).currentValue.name).toBe("Croquetas sin guardar");
      expect(await shownCourse(el)).toBe(t("product.no_course"));
    });

    it("keeps the product's course when the window neither added a course nor removed it", async () => {
      const api = courseApi();
      const el = await openCourses(api, "k2");
      await deleteInWindow(el, "k1");
      await vi.waitFor(() => expect(inList(el, '[data-test="name-k1"]')).toBeNull());
      await done(el);
      expect(editor(el).currentValue.courseId).toBe("k2");
      expect(editor(el).courses.map(({ id }) => id)).toEqual(["k2"]);
      expect(await shownCourse(el)).toBe("Principales");
      expect(editor(el).shadowRoot!.activeElement).toBe(courseBox(el));
    });

    it("does not select a course added in the window and then removed there", async () => {
      const api = courseApi();
      const el = await openCourses(api, "k1");
      await addCourse(el, "Postres");
      await deleteInWindow(el, "k-new");
      await vi.waitFor(() => expect(inList(el, '[data-test="name-k-new"]')).toBeNull());
      await done(el);
      expect(editor(el).currentValue.courseId).toBe("k1");
    });

    it("closes on Escape the same way, leaving the product editor open", async () => {
      const api = courseApi();
      const el = await openCourses(api, "k1");
      await addCourse(el, "Postres");
      let closes = 0;
      coursesWindow(el).addEventListener("wt-close", () => closes++);
      const closed = closeOf(coursesWindow(el));
      await userEvent.keyboard("{Escape}");
      await closed;
      await vi.waitFor(() => expect(closes).toBe(1));
      await flush(el);
      await flush(el);
      expect(coursesWindow(el).open).toBe(false);
      expect(editor(el).open).toBe(true);
      expect(editor(el).currentValue.courseId).toBe("k-new");
      expect(editor(el).currentValue.name).toBe("Croquetas sin guardar");
      expect(editor(el).shadowRoot!.activeElement).toBe(courseBox(el));
    });

    // Choosing Edit courses… focuses the course box before the window opens, so the window's own
    // return of focus lands there whatever the screen does. Here the name field has focus and the
    // box's action event is sent from script, so only the hand-back can put focus on the box.
    it.each([
      [
        "Done",
        (el: CatalogueScreen) =>
          el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!.click(),
      ],
      [
        "Escape",
        async (el: CatalogueScreen) => {
          const closed = closeOf(coursesWindow(el));
          await userEvent.keyboard("{Escape}");
          await closed;
        },
      ],
    ])("goes back to the course box after %s closes it", async (_, close) => {
      const el = await openCourses(courseApi(), "k1");
      await done(el);
      editor(el).shadowRoot!.querySelector<HTMLElement>('[name="name"]')!.focus();
      emit(courseBox(el), "wt-combobox-action", { value: "edit-courses" });
      await el.updateComplete;
      await vi.waitFor(() =>
        expect(courseList(el)?.shadowRoot!.querySelectorAll("tbody tr").length).toBeGreaterThan(0),
      );
      expect(coursesWindow(el).open).toBe(true);
      await close(el);
      await vi.waitFor(() => expect(editor(el).childOpen).toBe(false));
      await flush(el);
      await flush(el);
      expect(coursesWindow(el).open).toBe(false);
      expect(editor(el).shadowRoot!.activeElement).toBe(courseBox(el));
    });

    it("ignores the closed window's late close once another nested form is open", async () => {
      const api = courseApi();
      const el = await openCourses(api, "k1");
      const unhandled: unknown[] = [];
      const onRejection = (event: PromiseRejectionEvent) => {
        unhandled.push(event.reason);
        event.preventDefault();
      };
      window.addEventListener("unhandledrejection", onRejection);
      try {
        // Clicked in script, not through the browser: the native close is reported a task later,
        // and the unit form has to be open by then.
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!.click();
        // Done waited on this first, so it has let the window go by the time this settles; the render
        // follows.
        await el.shadowRoot!.querySelector<CourseList>("dashboard-course-list")!.settled();
        await el.updateComplete;
        await (coursesWindow(el) as unknown as LitElement).updateComplete;
        emit(editor(el), "wt-create-related", { kind: "unit" });
        await el.updateComplete;
        const unitForm = el.shadowRoot!.querySelector("dashboard-unit-form")!;
        expect(unitForm.open).toBe(true);
        await closeReportsDelivered();
        await flush(el);
        expect([unitForm.open, coursesWindow(el).open, editor(el).childOpen]).toEqual([
          true,
          false,
          true,
        ]);
        // Rejections are reported in the order they went unhandled, so once this marker arrives a
        // failure of the late close's handling has been reported too.
        const marker = new Error("marker");
        void Promise.reject(marker);
        await vi.waitFor(() => expect(unhandled).toContain(marker));
        expect(unhandled).toEqual([marker]);
      } finally {
        window.removeEventListener("unhandledrejection", onRejection);
      }
    });

    it("leaves alone a product opened while the closing window's refresh was in flight", async () => {
      const api = courseApi();
      const el = await openCourses(api, "k1");
      await addCourse(el, "Postres");
      let answer!: (rows: Course[]) => void;
      vi.mocked(api.listCourses).mockImplementationOnce(
        () => new Promise<Course[]>((resolve) => (answer = resolve)),
      );
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=courses-done]")!);
      vi.mocked(api.getProductEditor).mockResolvedValue({ ...value, courseId: "k2" });
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      expect(editor(el).currentValue.courseId).toBe("k2");
      answer([
        ...venueCourses,
        { id: "k-new", name: "Postres", displayOrder: 2, active: true, inUse: false },
      ]);
      await flush(el);
      expect(editor(el).courses.map(({ id }) => id)).toEqual(["k1", "k2", "k-new"]);
      expect(editor(el).currentValue.courseId).toBe("k2");
    });

    it("reports a failed refresh of the courses as a load failure, and keeps the product's course", async () => {
      const api = courseApi();
      const el = await openCourses(api, "k1");
      (api.listCourses as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
        code: "connection.failed",
      });
      await done(el);
      expect(coursesWindow(el).open).toBe(false);
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
        codeMessage("connection.failed"),
      );
      expect(editor(el).currentValue.courseId).toBe("k1");
    });
  });

  it("ignores a late product response after the editor is cancelled", async () => {
    let resolve!: (value: ProductEditorValue) => void;
    const api = stubApi({
      getProductEditor: vi.fn().mockReturnValue(new Promise((done) => (resolve = done))),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    emit(editor(el), "wt-cancel", {});
    resolve(value);
    await flush(el);
    expect(editor(el).open).toBe(false);
  });

  it("opens the product named in the address", async () => {
    history.replaceState(null, "", "/manage/catalogue/product/p1");
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect((el as unknown as { editorOpen: boolean }).editorOpen).toBe(true);
  });

  it("ignores an unknown product id", async () => {
    history.replaceState(
      null,
      "",
      "/manage/catalogue/product/00000000-0000-4000-8000-000000000000",
    );
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect((el as unknown as { editorOpen: boolean }).editorOpen).toBe(false);
  });
  describe("a variant's own page", () => {
    // Listed under its parent only: the list read nests variants, and nothing lists one at the top.
    const withVariant: Product[] = [
      {
        ...products[0]!,
        kitchenName: "CROQ KITCHEN",
        variants: [
          {
            id: "v1",
            name: "Media ración",
            customerName: { es: "Media ración de croquetas" },
            kitchenName: "1/2 CROQ",
            image: null,
            unitPrice: null,
            available: true,
            active: true,
            effective: {
              unitPrice: "8.50",
              vatClass: "reduced",
              primaryCategoryId: "c1",
            },
          },
        ],
      },
    ];
    const variantValue: ProductEditorValue = {
      ...value,
      id: "v1",
      parentId: "p1",
      name: "Media ración",
      customerName: { es: "Media ración de croquetas" },
      kitchenName: "1/2 CROQ",
      description: null,
      unitId: null,
      unitPrice: null,
      vatClass: null,
      primaryCategoryId: null,
      modifiers: [],
      allergens: null,
      dietaryDeclarations: null,
      inherited: {
        name: "Croquetas",
        description: { es: "Cremosas" },
        image: null,
        unitPrice: "8.50",
        vatClass: "reduced",
        unitId: "u1",
        primaryCategoryId: "c1",
        courseId: null,
        allergens: {},
        dietaryDeclarations: ["vegetarian"],
      },
    };
    const variantApi = () =>
      stubApi({
        listProducts: vi
          .fn()
          .mockImplementation((id: string) => Promise.resolve(id === "cat-a" ? withVariant : [])),
        getProductEditor: vi
          .fn()
          .mockImplementation((id: string) => Promise.resolve(id === "v1" ? variantValue : value)),
      });

    it.each([
      ["en", "Edit variant of: Croquetas", "Edit variant of: Croquetas renamed"],
      ["es", "Editar variante de: Croquetas", "Editar variante de: Croquetas renamed"],
    ] as const)(
      "names the variant's parent in %s and re-reads its name on reload",
      async (locale, heading, renamedHeading) => {
        const previous = currentLocale();
        onTestFinished(() => setLocale(previous));
        setLocale(locale);
        history.replaceState(null, "", "/manage/catalogue/product/v1");
        const api = variantApi();
        const first = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
        await flush(first.el);
        expect(
          editor(first.el).shadowRoot!.querySelector("wt-modal")!.getAttribute("heading"),
        ).toBe(heading);
        first.host.remove();
        vi.mocked(api.getProductEditor).mockResolvedValue({
          ...variantValue,
          inherited: { ...variantValue.inherited!, name: "Croquetas renamed" },
        });
        const second = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
        await flush(second.el);
        expect(
          editor(second.el).shadowRoot!.querySelector("wt-modal")!.getAttribute("heading"),
        ).toBe(renamedHeading);
      },
    );

    it("opens the variant named in the address", async () => {
      history.replaceState(null, "", "/manage/catalogue/product/v1");
      const api = variantApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      expect(api.getProductEditor).toHaveBeenCalledWith("v1");
      expect(editor(el).open).toBe(true);
      expect(editor(el).value).toEqual(variantValue);
    });

    it("opens a variant's page from its parent's variants section, and saves to the variant", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el), "wt-open-product", { productId: "v1" });
      await flush(el);
      expect(editor(el).value).toEqual(variantValue);
      expect(location.pathname).toBe("/manage/catalogue/product/v1");
      emit(editor(el), "wt-submit", { value: variantValue });
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledWith("v1", variantValue);
    });

    // Opening the variant shuts the parent's window first, and the browser reports that shut a task
    // later. Neither a report that lands while the variant is still loading, nor one that lands
    // after the variant's window is already showing, is the person cancelling.
    it("keeps a variant opened from its parent when its load outlasts the parent's window closing", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      let release!: () => void;
      const loaded = new Promise<ProductEditorValue>((resolve) => {
        release = () => resolve(variantValue);
      });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      vi.mocked(api.getProductEditor).mockReturnValue(loaded);
      emit(editor(el), "wt-open-product", { productId: "v1" });
      await flush(el);
      await closeReportsDelivered();
      release();
      await flush(el);
      expect(editor(el).open).toBe(true);
      expect(editor(el).value).toEqual(variantValue);
      expect(location.pathname).toBe("/manage/catalogue/product/v1");
    });

    it("keeps a variant opened from its parent when it loads before the closed window reports", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      // Long enough for the parent's window to have shut, short enough to finish inside the task.
      vi.mocked(api.getProductEditor).mockImplementation(async () => {
        for (let turn = 0; turn < 30; turn++) await Promise.resolve();
        return variantValue;
      });
      emit(editor(el), "wt-open-product", { productId: "v1" });
      await flush(el);
      await closeReportsDelivered();
      await el.updateComplete;
      expect(editor(el).open).toBe(true);
      expect(editor(el).value).toEqual(variantValue);
      expect(location.pathname).toBe("/manage/catalogue/product/v1");
    });

    it("names extras removed for active variants with their parent and updates names after a live replacement and reopen", async () => {
      const api = Object.assign(variantApi(), { liveData: new LiveData() });
      const offered = (id: string, name: string, productId: string) => ({
        ...extraLists[0]!,
        id,
        name,
        usage: { products: 1 },
        items: [
          { id: `${id}-item`, productId, maxQuantity: null, preselected: false, price: null },
        ],
      });
      vi.mocked(api.listExtraLists).mockResolvedValue([
        offered("first", "Affected variant list", "v1"),
        offered("second", "Affected variant list", "p1"),
        offered("archived", "Archived baseline list", "old"),
      ]);
      vi.mocked(api.listProducts).mockResolvedValue([
        {
          ...withVariant[0]!,
          variants: [
            ...withVariant[0]!.variants,
            { ...withVariant[0]!.variants[0]!, id: "old", active: false },
          ],
        },
      ]);
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "delete-product", { productId: "p1" });
      await flush(el);
      const warning = () =>
        el.shadowRoot!.querySelector("[data-test=delete-dialog] [data-test=archive-extra-lists]");
      expect(warning()!.querySelectorAll("li")).toHaveLength(1);
      expect(warning()!.textContent).toContain("Affected variant list");
      expect(warning()!.textContent).not.toContain("Archived baseline list");
      vi.mocked(api.listExtraLists).mockResolvedValue([
        offered("latest", "Latest affected list", "v1"),
      ]);
      api.liveData.refresh();
      await vi.waitFor(() => expect(warning()!.textContent).toContain("Latest affected list"));
      expect(warning()!.textContent).not.toContain("Affected variant list");
      emit(el.shadowRoot!.querySelector("[data-test=delete-dialog]")!, "wt-close", {});
      await flush(el);
      emit(list(el), "delete-product", { productId: "v1" });
      await flush(el);
      expect(warning()!.textContent).toContain("Latest affected list");
      expect(warning()!.textContent).not.toContain("Affected variant list");
    });

    it("names only the variant's affected extras lists in its Archive warning", async () => {
      const api = variantApi();
      vi.mocked(api.listExtraLists).mockResolvedValue([
        ...[
          ["variant-list", "Archive variant sauces", "v1"],
          ["parent-list", "Archive parent sauces", "p1"],
        ].map(([id, name, productId]) => ({
          ...extraLists[0]!,
          id: id!,
          name: name!,
          usage: { products: 1 },
          items: [
            {
              id: `${id}-item`,
              productId: productId!,
              maxQuantity: null,
              preselected: false,
              price: null,
            },
          ],
        })),
      ]);
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "delete-product", { productId: "v1" });
      await flush(el);
      const warning = el.shadowRoot!.querySelector("[data-test=delete-dialog]")!;
      expect(warning.textContent).toContain("Archive variant sauces");
      expect(warning.textContent).not.toContain("Archive parent sauces");
    });

    it("confirms a variant's Archive and switches the variant off through its own write", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      // Sold out as well, so a write that resets availability while removing is caught.
      vi.mocked(api.getProductEditor).mockImplementation((id: string) =>
        Promise.resolve(id === "v1" ? { ...variantValue, available: false } : value),
      );
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "delete-product", { productId: "v1" });
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-dialog]")!;
      const before = currentLocale();
      setLocale("en-GB");
      el.requestUpdate();
      await el.updateComplete;
      try {
        expect(dialog.getAttribute("heading")).toBe("Archive Media ración");
        expect(dialog.textContent).toContain(
          "This can't be undone. The till stops offering the variant, and it cannot be brought back. Its past sales are kept.",
        );
        expect(
          el
            .shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!
            .textContent!.trim(),
        ).toBe("Archive");
        setLocale("es");
        el.requestUpdate();
        await el.updateComplete;
        expect(dialog.getAttribute("heading")).toBe("Archivar Media ración");
        expect(dialog.textContent).toContain(
          "No se puede deshacer. La caja deja de ofrecer la variante y no se puede recuperar. Sus ventas pasadas se conservan.",
        );
      } finally {
        setLocale(before);
        el.requestUpdate();
        await el.updateComplete;
      }
      const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!;
      expect(confirm.textContent!.trim()).toBe(t("product.archive"));
      confirm.click();
      await flush(el);
      expect(api.getProductEditor).toHaveBeenCalledWith("v1");
      expect(api.updateProductEditor).toHaveBeenCalledOnce();
      expect(api.updateProductEditor).toHaveBeenCalledWith("v1", {
        ...variantValue,
        active: false,
        available: false,
      });
      expect(dialog.getAttribute("open")).toBeNull();
    });

    it("says how many menus a variant comes off, asking about the variant itself", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const before = currentLocale();
      setLocale("en-GB");
      onTestFinished(() => setLocale(before));
      const api = variantApi();
      (api as unknown as Record<string, unknown>).countProductMenus = vi.fn().mockResolvedValue(2);
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "delete-product", { productId: "v1" });
      await flush(el);
      expect(api.countProductMenus).toHaveBeenCalledWith(["v1"]);
      const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-dialog]")!;
      expect(dialog.querySelector("p")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
        "This can't be undone. The till stops offering the variant, and it cannot be brought back. Its past sales are kept. It comes off the 2 menus it is on.",
      );
    });

    it("an archived variant row offers View only", async () => {
      await archivedRowOffersView(variantApi(), "v1");
    });

    it("reports a failed reload after a written archive as a load failure", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      vi.mocked(api.listProducts).mockRejectedValue({ code: "catalogue.not_found" });
      emit(list(el), "delete-product", { productId: "v1" });
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledOnce();
      expect(api.updateProductEditor).toHaveBeenCalledWith("v1", {
        ...variantValue,
        active: false,
      });
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
        codeMessage("catalogue.not_found"),
      );
      expect(el.shadowRoot!.querySelector("[data-test=delete-dialog]")!.hasAttribute("open")).toBe(
        false,
      );
      expect((el as unknown as { busy: boolean }).busy).toBe(false);
    });

    it("an archived variant offers View only even when a write would be refused by extras", async () => {
      const api = variantApi();
      vi.mocked(api.updateProductEditor).mockRejectedValue({
        code: "product.offered_as_extra",
        params: { field: "active", extraLists: [{ id: "ex-1", name: "Salsas" }] },
        status: 409,
      });
      await archivedRowOffersView(api, "v1");
    });

    it("names the extras lists that refuse a save inside the variant's own editor", async () => {
      history.replaceState(null, "", "/manage/catalogue/product/v1");
      const api = variantApi();
      vi.mocked(api.getProductEditor).mockResolvedValue(variantValue);
      vi.mocked(api.updateProductEditor).mockRejectedValue({
        code: "product.offered_as_extra",
        params: {
          field: "active",
          extraLists: [
            { id: "ex-1", name: "Salsas" },
            { id: "ex-2", name: "Toppings" },
          ],
        },
        status: 409,
      });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(editor(el), "wt-submit", { value: { ...variantValue, active: false } });
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledWith(
        "v1",
        expect.objectContaining({ active: false }),
      );
      expect(editor(el).open).toBe(true);
      await editor(el).updateComplete;
      expect(await bottomOf(editor(el))).toBe(
        `${codeMessage("product.offered_as_extra")} Salsas, Toppings`,
      );
      expect((el as unknown as { busy: boolean }).busy).toBe(false);
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    });

    it("an archived variant offers View only even when a write would fail", async () => {
      const api = variantApi();
      vi.mocked(api.updateProductEditor).mockRejectedValue({ code: "server.internal" });
      await archivedRowOffersView(api, "v1");
    });
  });

  describe("the Add to menus step after a create", () => {
    async function create(api: DashboardApi): Promise<CatalogueScreen> {
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "add-product", { categoryId: null });
      await el.updateComplete;
      emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
      await flush(el);
      await flush(el);
      return el;
    }
    const place = (el: CatalogueScreen, menuId: string, sectionId: string) =>
      step(el).shadowRoot!.querySelector<HTMLInputElement>(
        `fieldset[data-menu="${menuId}"] input[value="${sectionId}"]`,
      )!;
    async function choose(el: CatalogueScreen, ...places: [string, string][]): Promise<void> {
      for (const [menuId, sectionId] of places) {
        place(el, menuId, sectionId).click();
        await step(el).updateComplete;
      }
    }
    const control = (el: CatalogueScreen, test: string) =>
      step(el).shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!;

    for (const partial of [false, true]) {
      it(`W69 placement ${partial ? "partial" : "complete"} success commits accepted destinations before closing`, async () => {
        const { el: leaveHost } = await mountWidget<PlacementLeaveHost>(
          "placement-leave-test-host",
          {},
        );
        const leave = leaveHost.leave.coordinator;
        const register = (event: Event) => {
          (event as CustomEvent<{ accept: (value: typeof leave) => void }>).detail.accept(leave);
        };
        document.addEventListener("wt-leave-coordinator", register);
        onTestFinished(() => {
          document.removeEventListener("wt-leave-coordinator", register);
          leaveHost.leave.forceReset();
        });
        const api = stubApi({
          addSectionProducts: vi
            .fn()
            .mockImplementation((id: string) =>
              partial && id === "s-drinks"
                ? Promise.reject({ code: "server.internal" })
                : Promise.resolve({ added: 1 }),
            ),
        });
        const el = await create(api);
        await choose(el, ["cat-a", "root-a"], ["cat-a", "s-drinks"]);
        expect(leave.isDirty()).toBe(true);
        const picker = step(el);
        let committed: { ids: string[]; open: boolean; dirty: boolean } | undefined;
        const original = (picker as AddToMenus & { commitAdded?: (ids: string[]) => void })
          .commitAdded;
        if (original)
          vi.spyOn(
            picker as AddToMenus & { commitAdded: (ids: string[]) => void },
            "commitAdded",
          ).mockImplementation((ids) => {
            original.call(picker, ids);
            committed = { ids, open: picker.open, dirty: leave.isDirty([picker]) };
          });
        control(el, "add-to-menus").click();
        await flush(el);
        await flush(el);
        expect(committed).toEqual({
          ids: partial ? ["root-a"] : ["root-a", "s-drinks"],
          open: true,
          dirty: partial,
        });
        expect(picker.open).toBe(partial);
        if (partial) {
          expect(place(el, "cat-a", "root-a").checked).toBe(false);
          expect(place(el, "cat-a", "s-drinks").checked).toBe(true);
          control(el, "skip").click();
          await leaveHost.updateComplete;
          const q = leaveHost.shadowRoot!.querySelector("wt-unsaved-changes")!;
          await q.updateComplete;
          expect(q.open).toBe(true);
          q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
          await closeReportsDelivered();
          expect(picker.open).toBe(true);
        } else expect(leave.isDirty()).toBe(false);
      });
    }

    it("follows a saved create with the step, naming the product and each section by staff and internal names", async () => {
      const api = stubApi();
      const el = await create(api);
      expect(editor(el).open).toBe(false);
      expect(step(el).open).toBe(true);
      expect(api.getMenuStructure).toHaveBeenCalledWith("cat-a");
      expect(api.getMenuStructure).toHaveBeenCalledWith("cat-b");
      const text = step(el).shadowRoot!.textContent!;
      expect(step(el).productName).toBe("Croquetas");
      expect(step(el).shadowRoot!.querySelector("wt-modal")!.getAttribute("heading")).not.toMatch(
        /caseras|CROQUETAS/,
      );
      expect(text).toContain("Comida");
      expect(text).toContain("Bebidas");
      expect(text).toContain("Drinks list");
      expect(text).toContain("Beer list");
      expect(text).not.toContain("Bebidas frías");
      expect(text).not.toContain("Cervezas de barril");
      expect(place(el, "cat-a", "root-a")).not.toBeNull();
    });

    it("adds the product once to each chosen section, only after the product is saved", async () => {
      const calls: string[] = [];
      const api = stubApi({
        createProductEditor: vi.fn().mockImplementation(() => {
          calls.push("create");
          return Promise.resolve({ ...value, id: "new" });
        }),
        addSectionProducts: vi.fn().mockImplementation((id: string) => {
          calls.push(`add:${id}`);
          return Promise.resolve({ added: 1 });
        }),
      });
      const el = await create(api);
      expect(api.addSectionProducts).not.toHaveBeenCalled();
      // Drinks is chosen on BOTH menus: it is one list, so it is asked for once.
      await choose(el, ["cat-b", "s-drinks"], ["cat-b", "root-b"], ["cat-a", "s-beer"]);
      control(el, "add-to-menus").click();
      await flush(el);
      await flush(el);
      expect(calls).toEqual(["create", "add:s-drinks", "add:s-beer", "add:root-b"]);
      expect(api.addSectionProducts).toHaveBeenCalledWith("s-drinks", ["new"]);
      expect(api.addSectionProducts).toHaveBeenCalledWith("s-beer", ["new"]);
      expect(api.addSectionProducts).toHaveBeenCalledWith("root-b", ["new"]);
      expect(step(el).open).toBe(false);
    });

    it("keeps the saved product when one section refuses it, says so apart from a save failure, and still tries the rest", async () => {
      const api = stubApi({
        addSectionProducts: vi
          .fn()
          .mockImplementation((id: string) =>
            id === "s-drinks"
              ? Promise.reject({ code: "server.internal" })
              : Promise.resolve({ added: 1 }),
          ),
      });
      const el = await create(api);
      await choose(el, ["cat-a", "root-a"], ["cat-a", "s-drinks"], ["cat-a", "s-beer"]);
      control(el, "add-to-menus").click();
      await flush(el);
      await flush(el);
      expect(vi.mocked(api.addSectionProducts).mock.calls.map(([id]) => id)).toEqual([
        "root-a",
        "s-drinks",
        "s-beer",
      ]);
      expect(api.createProductEditor).toHaveBeenCalledOnce();
      expect(api.updateProductEditor).not.toHaveBeenCalled();
      expect(step(el).open).toBe(true);
      const alert = control(el, "placement-error");
      expect(alert.textContent).toContain(t("add_to_menus.failed").replace("{name}", "Croquetas"));
      expect(alert.textContent).toContain("Drinks list");
      expect(alert.textContent).not.toContain("Beer list");
      expect(alert.textContent).toContain(codeMessage("server.internal"));
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
      expect(editor(el).open).toBe(false);
      expect(editor(el).fieldErrors).toEqual({});
    });

    it("sends every chosen section's addition at once, and lists refusals in the order the places are shown", async () => {
      let refuseFirst!: (error: unknown) => void;
      const api = stubApi({
        addSectionProducts: vi.fn().mockImplementation((id: string) => {
          if (id === "root-a") return new Promise((_, reject) => (refuseFirst = reject));
          if (id === "s-drinks") return Promise.reject({ code: "server.internal" });
          return Promise.resolve({ added: 1 });
        }),
      });
      const el = await create(api);
      await choose(el, ["cat-a", "root-a"], ["cat-a", "s-drinks"], ["cat-a", "s-beer"]);
      control(el, "add-to-menus").click();
      await flush(el);
      expect(vi.mocked(api.addSectionProducts).mock.calls.map(([id]) => id)).toEqual([
        "root-a",
        "s-drinks",
        "s-beer",
      ]);
      expect(step(el).busy).toBe(true);
      refuseFirst({ code: "menu_section.membership_invalid" });
      await flush(el);
      expect(step(el).busy).toBe(false);
      expect(step(el).failures).toEqual([
        { sectionId: "root-a", reason: codeMessage("menu_section.membership_invalid") },
        { sectionId: "s-drinks", reason: codeMessage("server.internal") },
      ]);
    });

    it("asks for every menu's structure at once", async () => {
      const api = stubApi({
        getMenuStructure: vi
          .fn()
          .mockImplementation((id: string) =>
            id === "cat-a" ? new Promise(() => {}) : Promise.resolve(structures[id]),
          ),
      });
      await create(api);
      expect(vi.mocked(api.getMenuStructure).mock.calls.map(([id]) => id)).toEqual([
        "cat-a",
        "cat-b",
      ]);
    });

    it("sends nothing and changes nothing when the step is skipped", async () => {
      const api = stubApi();
      const el = await create(api);
      await choose(el, ["cat-a", "s-drinks"]);
      control(el, "skip").click();
      await flush(el);
      expect(step(el).open).toBe(false);
      expect(api.addSectionProducts).not.toHaveBeenCalled();
      expect(api.createProductEditor).toHaveBeenCalledOnce();
      expect(api.updateProductEditor).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    });

    it("reports menus that fail to load as a load failure, with the product still saved", async () => {
      const api = stubApi({
        getMenuStructure: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      const el = await create(api);
      expect(editor(el).open).toBe(false);
      expect(step(el).open).toBe(true);
      expect(control(el, "load-error").textContent).toContain(codeMessage("server.internal"));
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    });

    it("offers the menus once the server answers again after they failed to load", async () => {
      const api = Object.assign(
        stubApi({ getMenuStructure: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
        { liveData: new LiveData() },
      );
      const el = await create(api);
      await vi.waitFor(() =>
        expect(control(el, "load-error").textContent).toContain(codeMessage("connection.failed")),
      );
      vi.mocked(api.getMenuStructure).mockImplementation((id: string) =>
        Promise.resolve(structures[id]!),
      );
      api.liveData.refresh();
      await vi.waitFor(() => expect(control(el, "load-error")).toBeNull());
      await step(el).updateComplete;
      expect(place(el, "cat-a", "root-a")).not.toBeNull();
    });

    it("does not follow a save of an existing product with the step", async () => {
      const api = stubApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el), "wt-submit", { value });
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledOnce();
      expect(editor(el).open).toBe(false);
      expect(step(el)?.open ?? false).toBe(false);
      expect(api.getMenuStructure).not.toHaveBeenCalled();
    });
  });

  it("hands the product list the content language unit names are read in", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(list(el).unitLanguage).toBe("es");
    await list(el).updateComplete;
    const products = list(el).shadowRoot!.querySelector("dashboard-product-list")!;
    expect(products.unitLanguage).toBe("es");
  });

  it("reads unit names in the venue's default language when no content language is listed", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi({
        getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: [] }),
      }),
    });
    await flush(el);
    expect(list(el).unitLanguage).toBe("es");
  });

  it("reads unit names in the first listed content language, not the venue's default", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi({
        getContentLanguages: vi
          .fn()
          .mockResolvedValue({ defaultLanguage: "en", languages: ["es", "en"] }),
      }),
    });
    await flush(el);
    expect(list(el).unitLanguage).toBe("es");
  });

  it("tells the product list the catalogue has loaded only once its products have", async () => {
    const pending: ((value: Product[]) => void)[] = [];
    const api = stubApi({
      listProducts: vi.fn(() => new Promise<Product[]>((resolve) => pending.push(resolve))),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(list(el).loaded).toBe(false);
    for (const resolve of pending) resolve([]);
    await vi.waitFor(() => expect(list(el).loaded).toBe(true));
  });
});

it("reads and writes the opened category in the address", async () => {
  history.replaceState(null, "", "/manage/catalogue/category/c1");
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
    api: stubApi(),
  });
  await flush(el);
  const browser = el.shadowRoot!.querySelector("dashboard-catalogue-browser")!;
  expect(browser.categoryId).toBe("c1");
  emit(browser, "open-category", { categoryId: "b" });
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/catalogue/category/b");
  emit(browser, "open-category", { categoryId: null });
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/catalogue");
});

describe("catalogue-screen sticky headings", () => {
  async function mountBounded(props: Partial<CatalogueScreen>, api = stubApi()) {
    const { el, host } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api,
      ...props,
    });
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.height = "600px";
    await flush(el);
    return { el, host };
  }

  it.each([false, true])(
    "hands stickyHeader (%s) down to the Products table, which fills the screen only when it is set",
    async (sticky) => {
      const { el, host } = await mountBounded({ stickyHeader: sticky });
      expect(el.hasAttribute("sticky-header")).toBe(sticky);
      expect(list(el).stickyHeader).toBe(sticky);
      const table = await productTable(el);
      expect(table.stickyHeader).toBe(sticky);
      const scroll = table.shadowRoot!.querySelector(".scroll")!.getBoundingClientRect();
      const bottom = host.getBoundingClientRect().bottom;
      if (sticky) expect(scroll.bottom).toBeCloseTo(bottom, 0);
      else expect(scroll.bottom).toBeLessThan(bottom - 100);
      const heading = el.shadowRoot!.querySelector("h1")!.getBoundingClientRect();
      expect(heading.top).toBeCloseTo(host.getBoundingClientRect().top, 0);
    },
  );

  it("keeps the no-catalogue prompt its own height", async () => {
    const { el } = await mountBounded(
      { stickyHeader: true },
      stubApi({ listCatalogues: vi.fn().mockResolvedValue([]) }),
    );
    const prompt = el.shadowRoot!.querySelector<HTMLElement>("[data-test=no-catalogue]")!;
    expect(prompt.getBoundingClientRect().height).toBeLessThan(100);
  });
});

describe("media editor entry", () => {
  it("opens the existing product editor with focus on its photo control", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1", field: "image" });
    await expect.poll(() => editor(el).open).toBe(true);
    await expect
      .poll(() => {
        const upload = editor(el).shadowRoot!.querySelector("dashboard-image-upload");
        return upload?.shadowRoot?.activeElement?.getAttribute("data-test");
      })
      .toBe("choose-image");
    expect(editor(el).shadowRoot!.querySelectorAll("dashboard-image-upload")).toHaveLength(1);
  });
  it("honours a photo deep link from the Structure menu", async () => {
    const old = location.href;
    try {
      history.replaceState(null, "", "/manage/catalogue/product/p1?field=image");
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
        api: stubApi(),
      });
      await expect.poll(() => editor(el).open).toBe(true);
      await expect
        .poll(() =>
          editor(el)
            .shadowRoot!.querySelector("dashboard-image-upload")
            ?.shadowRoot?.activeElement?.getAttribute("data-test"),
        )
        .toBe("choose-image");
    } finally {
      history.replaceState(null, "", old);
    }
  });
});

it("clears the photo entry target when the product editor closes", async () => {
  history.replaceState(null, "", "/manage/catalogue/product/p1?field=image");
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
    api: stubApi(),
  });
  await flush(el);
  await expect.poll(() => editor(el).open).toBe(true);
  expect(new URL(location.href).searchParams.get("field")).toBe("image");
  emit(editor(el), "wt-cancel", {});
  await expect.poll(() => editor(el).open).toBe(false);
  expect(new URL(location.href).searchParams.get("field")).toBeNull();
});

it("closing a guarded linked product retires its field query before opening another editor", async () => {
  history.replaceState(null, "", "/manage/catalogue");
  const guard = new NavigationGuard(window, {
    isDirty: () => false,
    request: async (proceed) => {
      await proceed();
      return "proceeded";
    },
  });
  onTestFinished(() => guard.dispose());
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
    api: stubApi(),
  });
  await flush(el);
  await guard.write("/manage/catalogue/product/p1?field=name");
  await expect.poll(() => editor(el).value?.id).toBe("p1");
  emit(editor(el), "wt-cancel", {});
  await expect.poll(() => location.pathname).toBe("/manage/catalogue");
  expect(location.search).toBe("");
  emit(list(el), "edit-product", { productId: "p1" });
  await expect.poll(() => editor(el).open).toBe(true);
  expect(editor(el).initialField).toBe("");
});

it("waits for the venue's VAT default before enabling Add product", async () => {
  let resolve!: (value: { defaultProductVatClass: "reduced"; defaultColor: null }) => void;
  const pending = new Promise<{ defaultProductVatClass: "reduced"; defaultColor: null }>((yes) => {
    resolve = yes;
  });
  const api = stubApi({ getCatalogueSettings: vi.fn(() => pending) });
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
  await expect.poll(() => editor(el)?.units.length).toBeGreaterThan(0);
  await expect.poll(() => editor(el)?.locales.length).toBeGreaterThan(0);
  await flush(el);
  const add = async () =>
    (await productTable(el)).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      '[data-test="add-product-root"]',
    )!;
  expect((await add()).disabled).toBe(true);
  (await add()).click();
  await el.updateComplete;
  expect(editor(el).open).toBe(false);
  resolve({ defaultProductVatClass: "reduced", defaultColor: null });
  await pending;
  await flush(el);
  expect((await add()).disabled).toBe(false);
  (await add()).click();
  await flush(el);
  expect(editor(el).open).toBe(true);
  expect(
    editor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="tax"]')!
      .value,
  ).toBe("reduced");
});

it("paints All products' square, an uncategorised product and a new product's inherited colour with the venue default, and repaints them on a live answer", async () => {
  const liveData = new LiveData();
  const loose: Product = {
    ...products[0]!,
    id: "p2",
    name: "Agua",
    categoryId: null,
    primaryCategoryId: null,
  };
  const api = Object.assign(
    stubApi({
      getCatalogueSettings: vi
        .fn()
        .mockResolvedValue({ defaultProductVatClass: "general", defaultColor: "#b12525" }),
      listProducts: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === "cat-a" ? [...products, loose] : []),
        ),
    }),
    { liveData },
  );
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
  await flush(el);
  const fills = async () => {
    const root = (await productTable(el)).shadowRoot!;
    const fill = (selector: string) =>
      getComputedStyle(root.querySelector<HTMLElement>(selector)!).backgroundColor;
    return [
      fill('[data-test="color-root"] [part~="color-swatch"]'),
      fill('[data-test="color-p2"] [data-test="thumb-placeholder"]'),
    ];
  };
  await expect.poll(fills).toEqual(["rgb(177, 37, 37)", "rgb(177, 37, 37)"]);
  emit(list(el), "add-product", { categoryId: null });
  await el.updateComplete;
  await editor(el).updateComplete;
  const inherited = () =>
    getComputedStyle(
      editor(el).shadowRoot!.querySelector<HTMLElement>('fieldset.color [data-color=""] .chip')!,
    ).backgroundColor;
  expect(inherited()).toBe("rgb(177, 37, 37)");

  vi.mocked(api.getCatalogueSettings).mockResolvedValue({
    defaultProductVatClass: "general",
    defaultColor: "#256bb1",
  });
  liveData.refresh();
  await expect.poll(fills).toEqual(["rgb(37, 107, 177)", "rgb(37, 107, 177)"]);
  await editor(el).updateComplete;
  expect(inherited()).toBe("rgb(37, 107, 177)");
});

it("reads the venue's default into a new editor without replacing an open draft", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({
      getCatalogueSettings: vi
        .fn()
        .mockResolvedValue({ defaultProductVatClass: "super_reduced", defaultColor: null }),
    }),
    { liveData },
  );
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
  await flush(el);
  emit(list(el), "add-product", { categoryId: null });
  await el.updateComplete;
  await editor(el).updateComplete;
  const tax = () =>
    editor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="tax"]')!;
  expect(tax().value).toBe("super_reduced");
  tax().dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "zero" },
      bubbles: true,
      composed: true,
    }),
  );
  await editor(el).updateComplete;
  vi.mocked(api.getCatalogueSettings).mockResolvedValue({
    defaultProductVatClass: "reduced",
    defaultColor: null,
  });
  liveData.refresh();
  await expect.poll(() => vi.mocked(api.getCatalogueSettings).mock.calls.length).toBe(2);
  await flush(el);
  await editor(el).updateComplete;
  expect(tax().value).toBe("zero");
  emit(editor(el), "wt-cancel", {});
  await flush(el);
  emit(list(el), "add-product", { categoryId: null });
  await el.updateComplete;
  await editor(el).updateComplete;
  expect(tax().value).toBe("reduced");
});

describe("archived product entry", () => {
  it("reads archived details passively from the existing background client", async () => {
    history.replaceState(null, "", "/manage/catalogue");
    const background = stubApi({
      getProductEditor: vi.fn().mockResolvedValue({ ...value, active: false }),
    });
    const api = { ...stubApi(), background } as DashboardApi;
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "view-product", { productId: "p1" });
    await flush(el);
    expect(background.getProductEditor).toHaveBeenCalledExactlyOnceWith("p1");
    expect(api.getProductEditor).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("dashboard-product-details")!.open).toBe(true);
    expect(api.updateProductEditor).not.toHaveBeenCalled();
  });

  it.each(["row", "variant", "link"])(
    "opens details through %s without opening the editor",
    async (entry) => {
      history.replaceState(null, "", "/manage/catalogue");
      const archived = { ...value, active: false, id: entry === "variant" ? "v1" : "p1" };
      const api = stubApi({
        getProductEditor: vi.fn().mockResolvedValue(archived),
        listProducts: vi.fn().mockResolvedValue([
          {
            ...products[0]!,
            active: false,
            variants: [
              {
                id: "v1",
                name: "Small",
                customerName: null,
                kitchenName: null,
                image: null,
                unitPrice: null,
                available: true,
                active: false,
                effective: { unitPrice: "8.50", vatClass: "reduced", primaryCategoryId: "c1" },
              },
            ],
          },
        ]),
      });
      if (entry === "link") history.replaceState(null, "", "/manage/catalogue/product/p1");
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      if (entry !== "link") emit(list(el), "view-product", { productId: archived.id });
      await flush(el);
      const details = el.shadowRoot!.querySelector<
        HTMLElement & { open: boolean; value: ProductEditorValue }
      >("dashboard-product-details");
      expect(details?.open).toBe(true);
      expect(details?.value.id).toBe(archived.id);
      expect(editor(el).open).toBe(false);
      emit(details!, "wt-close", {});
      await flush(el);
      expect(details?.open).toBe(false);
      expect(location.pathname).toBe("/manage/catalogue");
    },
  );

  it("keeps active products in the editor", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("dashboard-product-details")
        ?.open ?? false,
    ).toBe(false);
  });
});
