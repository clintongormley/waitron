import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, NavigationGuard } from "@waitron/ui";
import type { DashboardApi, MenuPriceRow } from "../api/client.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, combinedFixture, mountWidget } from "../widgets/test-helpers.js";
import "./menus-screen.js";

const structure = "/menus/menu/lunch/view/structure";
const priceOverrides = "/menus/menu/lunch/view/prices";
const burger: MenuPriceRow = {
  menuItemId: "burger",
  combined: combinedFixture("product", "12.00", [], null, "12.00", {}),
  productId: "product",
  name: "Burger",
  categoryId: null,
  placements: [[]],
  override: null,
  effectivePrice: "12.00",
  available: true,
  variants: [],
};

class MenuPricesLeaveApp extends LitElement {
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

customElements.define("menu-prices-leave-test-app", MenuPricesLeaveApp);
afterEach(cleanupWidgets);

it.each([
  ["tab", structure],
  ["breadcrumb", "/menus"],
  ["browser Back", structure],
  ["tab while saving", structure],
])("handles leaving Price overrides by %s", async (via, destination) => {
  history.replaceState(null, "", structure);
  let finishSave!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  const write = vi.fn(() => pending);
  const api = {
    listMenus: async () => [{ id: "lunch", name: "Lunch", kind: "menu", active: true }],
    listSections: async () => [],
    listLibraryProducts: async () => [],
    listCategories: async () => [],
    getMenuSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    getMenuPrices: async () => [burger],
    getMenuRead: async () => ({}),
    updateMenuItem: write,
  };
  const { el: app } = await mountWidget<MenuPricesLeaveApp>("menu-prices-leave-test-app", {
    api: { ...api, background: api } as unknown as DashboardApi,
  });
  const guard = new NavigationGuard(window, {
    isDirty: () => app.leave.coordinator.isDirty(),
    request: (proceed, signal) =>
      app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
  });
  try {
    await guard.write(priceOverrides);
    const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!;
    const prices = () => screen.shadowRoot!.querySelector("dashboard-menu-prices-table");
    const tab = () => screen.shadowRoot!.querySelector("wt-tabs")!;
    const dialog = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    const field = () =>
      prices()
        ?.shadowRoot!.querySelector("wt-data-table")
        ?.shadowRoot!.querySelector("wt-price-input")
        ?.shadowRoot!.querySelector("input");
    await vi.waitFor(() => expect(field()).toBeInstanceOf(HTMLInputElement));
    await userEvent.fill(field()!, "11");
    const structureTab = tab().shadowRoot!.querySelector('[data-key="structure"]')!;
    if (via === "tab while saving") {
      await userEvent.click(prices()!.shadowRoot!.querySelector('[data-test="prices-save"]')!);
      expect(write).toHaveBeenCalledExactlyOnceWith("lunch", "burger", { grossPrice: "11" });
      await userEvent.click(structureTab);
      await vi.waitFor(() => expect(location.pathname).toBe(destination));
      expect(dialog.open).toBe(false);
      return;
    }

    const leave = async () => {
      if (via === "browser Back") history.back();
      else {
        const control =
          via === "tab" ? structureTab : screen.shadowRoot!.querySelector('[data-test="back"]');
        await userEvent.click(control!);
      }
      await vi.waitFor(() => expect(dialog.open).toBe(true));
      await dialog.updateComplete;
    };

    await leave();
    expect(location.pathname).toBe(priceOverrides);
    expect(tab().value).toBe("prices");
    expect(field()?.value).toBe("11");
    await userEvent.click(dialog.shadowRoot!.querySelector('[data-choice="keep"]')!);
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(field()?.value).toBe("11");

    await leave();
    await userEvent.click(dialog.shadowRoot!.querySelector('[data-choice="discard"]')!);
    await vi.waitFor(() => expect(location.pathname).toBe(destination));
    expect(prices()).toBeNull();
    expect(write).not.toHaveBeenCalled();
    await guard.write(priceOverrides);
    await vi.waitFor(() => expect(field()?.value).toBe(""));
  } finally {
    finishSave();
    guard.dispose();
  }
});
