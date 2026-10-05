import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import type { DashboardApi, Product } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./menus-screen.js";

registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const product: Product = {
  id: "coffee",
  catalogueId: "menu",
  categoryId: null,
  primaryCategoryId: null,
  name: "Coffee",
  customerName: { en: "Coffee for guests" },
  kitchenName: "COFFEE KITCHEN",
  modifiers: [],
  unitId: "each",
  unit: { id: "each", name: { en: "Each" }, abbreviation: { en: "ea" }, precision: 0 },
  description: null,
  dietaryDeclarations: [],
  pricingUnit: "each",
  unitPrice: "2.00",
  vatClass: "general",
  active: true,
  available: true,
  ordering: "public",
  allergens: null,
  dietOverride: null,
  manualAllergens: null,
  image: null,
  color: null,
  variants: [],
};
class MenuColourApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-menus-screen .api=${this.api}></dashboard-menus-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
for (const succeeds of [true, false]) {
  it(`a late colour ${succeeds ? "write" : "refusal"} does not close or commit a newly opened product`, async () => {
    history.replaceState(null, "", "/manage/menus/menu/menu/view/structure");
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const pending = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const client = {
      listCatalogues: async () => [{ id: "menu", name: "Menu", active: true, version: 1 }],
      listLibraryProducts: async () => [
        product,
        { ...product, id: "tea", name: "Tea", color: "#b12525" },
      ],
      listCategories: async () => [],
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
      getMenuStatus: async () => ({ state: "unpublished", clashes: 0 }),
      getMenuStructure: async () => ({
        rootSectionId: "root",
        root: {
          id: "root",
          internalName: "Menu",
          names: {},
          image: null,
          color: null,
          members: [],
        },
        includable: [],
        includedBy: [],
        nodes: [],
      }),
      setProductColor: vi.fn(() => pending),
    } as unknown as DashboardApi;
    Object.defineProperty(client, "background", { get: () => client });
    const { el: app } = await mountWidget<MenuColourApp>("menu-colour-leave-test-app", {
      api: client,
    });
    const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!;
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("dashboard-menu-structure-table")).not.toBeNull(),
    );
    const tree = screen.shadowRoot!.querySelector("dashboard-menu-structure-table")!;
    const open = (id: string) =>
      tree.dispatchEvent(
        new CustomEvent("wt-product-color", {
          detail: { productId: id },
          bubbles: true,
          composed: true,
        }),
      );
    open("coffee");
    await screen.updateComplete;
    const form = screen.shadowRoot!.querySelector("dashboard-product-color-form")!;
    await form.updateComplete;
    form.shadowRoot!.querySelector<HTMLElement>('[data-color="#256bb1"]')!.click();
    await form.updateComplete;
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await vi.waitFor(() => expect(client.setProductColor).toHaveBeenCalledOnce());
    open("tea");
    await screen.updateComplete;
    await form.updateComplete;
    expect(form.productId).toBe("tea");
    if (succeeds) resolve();
    else reject({ code: "product.invalid", params: { field: "color" } });
    await expect.poll(() => form.busy).toBe(false);
    expect(form.open).toBe(true);
    expect(form.errors).toEqual({});
    expect(
      form.shadowRoot!.querySelector('[data-color="#b12525"]')!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(app.leave.coordinator.isDirty([form])).toBe(false);
    form.shadowRoot!.querySelector<HTMLElement>('[data-color="#256bb1"]')!.click();
    await form.updateComplete;
    expect(app.leave.coordinator.isDirty([form])).toBe(true);
  });
}
customElements.define("menu-colour-leave-test-app", MenuColourApp);
for (const succeeds of [true, false]) {
  it(`Menus Product colour ${succeeds ? "commits the written override before closing" : "refusal retains the draft and warns before Cancel"}`, async () => {
    history.replaceState(null, "", "/manage/menus/menu/menu/view/structure");
    const client = {
      listCatalogues: async () => [{ id: "menu", name: "Menu", active: true, version: 1 }],
      listLibraryProducts: async () => [product],
      listCategories: async () => [],
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      getMenuStatuses: async () => ({ menu: { state: "unpublished", clashes: 0 } }),
      getMenuStatus: async () => ({ state: "unpublished", clashes: 0 }),
      getMenuStructure: async () => ({
        rootSectionId: "root",
        root: {
          id: "root",
          internalName: "Menu",
          names: {},
          image: null,
          color: null,
          members: [],
        },
        includable: [],
        includedBy: [],
        nodes: [{ memberId: "m-coffee", ref: { kind: "product", productId: "coffee" } }],
      }),
      setProductColor: vi.fn(async () => {
        if (!succeeds) throw { code: "product.invalid", params: { field: "color" } };
      }),
    } as unknown as DashboardApi;
    Object.defineProperty(client, "background", { get: () => client });
    const { el: app } = await mountWidget<MenuColourApp>("menu-colour-leave-test-app", {
      api: client,
    });
    const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!;
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("dashboard-menu-structure-table")).not.toBeNull(),
    );
    const tree = screen.shadowRoot!.querySelector("dashboard-menu-structure-table")!;
    tree.dispatchEvent(
      new CustomEvent("wt-product-color", {
        detail: { productId: "coffee" },
        bubbles: true,
        composed: true,
      }),
    );
    await screen.updateComplete;
    const form = screen.shadowRoot!.querySelector("dashboard-product-color-form")!;
    await form.updateComplete;
    expect(form.open).toBe(true);
    form.shadowRoot!.querySelector<HTMLElement>('[data-color="#256bb1"]')!.click();
    await form.updateComplete;
    expect(app.leave.coordinator.isDirty([form])).toBe(true);
    let committed: string | null | undefined;
    let dirtyAfterCommit: boolean | undefined;
    const commit = form.commitSaved.bind(form);
    vi.spyOn(form, "commitSaved").mockImplementation((value) => {
      commit(value);
      committed = value;
      dirtyAfterCommit = app.leave.coordinator.isDirty([form]);
    });
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await vi.waitFor(() =>
      expect(client.setProductColor).toHaveBeenCalledExactlyOnceWith("coffee", "#256bb1"),
    );
    if (succeeds) {
      await expect.poll(() => committed).toBe("#256bb1");
      expect(dirtyAfterCommit).toBe(false);
      await expect.poll(() => form.open).toBe(false);
      expect(app.leave.coordinator.isDirty()).toBe(false);
    } else {
      await expect.poll(() => form.busy).toBe(false);
      expect(committed).toBeUndefined();
      form.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
      await app.updateComplete;
      const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
      await q.updateComplete;
      expect(q.open).toBe(true);
      expect(form.open).toBe(true);
    }
  });
}
