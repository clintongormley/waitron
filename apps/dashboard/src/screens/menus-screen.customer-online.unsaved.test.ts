import { LeaveController, registerIcons } from "@waitron/ui";
import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { CustomerMenuOnlineSettings } from "@waitron/shared";
import type { DashboardApi } from "../api/client.js";
import type { MenuReadPart } from "../api/menu-api.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale, t } from "../i18n/t.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, menuReadFixture, mountWidget } from "../widgets/test-helpers.js";
import "./menus-screen.js";

registerIcons(DASHBOARD_ICONS);
useLocale("en");
beforeEach(() => page.viewport(1280, 800));
afterEach(cleanupWidgets);

class OnlineSettingsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;

  override render() {
    return html`<dashboard-menus-screen .api=${this.api}></dashboard-menus-screen>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("online-settings-leave-app", OnlineSettingsLeaveApp);

const initial: CustomerMenuOnlineSettings = { enabled: false, address: "lunch", photos: "large" };
const status = {
  state: "current",
  version: 1,
  hash: "a".repeat(64),
  clashes: 0,
  publishedAt: "2026-11-26T17:00:00.000Z",
};

async function open(save = vi.fn(async (_id: string, value: CustomerMenuOnlineSettings) => value)) {
  const api = {
    listMenus: async () => [{ id: "menu", name: "Lunch", active: true }],
    listLibraryProducts: async () => [],
    listCategories: async () => [],
    getMenuSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    getMenuStatuses: async () => ({ menu: status }),
    getMenuStatus: async () => status,
    getMenuStructure: async () => ({
      rootSectionId: "root",
      root: { id: "root", internalName: "Lunch", names: {}, image: null, color: null, members: [] },
      nodes: [],
      includable: [],
      includedBy: [],
    }),
    getMenuRead(id: string, parts: readonly MenuReadPart[]) {
      return menuReadFixture(this as unknown as DashboardApi, id, parts);
    },
    getCustomerOnlineSettings: async () => initial,
    saveCustomerOnlineSettings: save,
    getCustomerPreview: async () => ({
      state: "published",
      menu: { name: "Lunch for guests", language: "en", languages: ["en"], members: [] },
    }),
  } as unknown as DashboardApi;
  history.replaceState(null, "", "/menus/menu/menu/view/customer-menu");
  const { el: app } = await mountWidget<OnlineSettingsLeaveApp>("online-settings-leave-app", {
    api,
  });
  return { app, save };
}

const online = () => page.getByRole("switch", { name: "Online", exact: true });
const address = () => page.getByRole("textbox", { name: "Address" });
const saveButton = () => page.getByRole("button", { name: "Save", exact: true });
const warning = () => page.getByText("Customers cannot open this page yet.");

it("saves the staged switch and keeps the public access notice visible after saving On", async () => {
  const { app, save } = await open();
  await expect.element(warning()).toBeVisible();
  await expect.element(saveButton()).toBeDisabled();
  await online().click();
  expect(save).not.toHaveBeenCalled();
  await saveButton().click();
  await expect.element(saveButton()).toBeDisabled();
  await expect.element(online()).toBeChecked();
  await expect.element(warning()).toBeVisible();
  expect(save).toHaveBeenCalledExactlyOnceWith("menu", { ...initial, enabled: true });
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("puts an address refusal beside the field and restores the saved address on Discard", async () => {
  const { app } = await open(
    vi.fn(async () => {
      throw { code: "customer_menu.address_taken", params: { field: "address" } };
    }),
  );
  await address().fill("dinner");
  await saveButton().click();
  await expect.element(address()).toHaveAttribute("aria-invalid", "true");
  await expect.element(address()).toHaveValue("dinner");
  await expect.element(saveButton()).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(question.open).toBe(true));
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.element(address()).toHaveValue("lunch");
  await expect.element(saveButton()).toBeDisabled();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("focuses the invalid address after Save and lets the manager correct it", async () => {
  const { save } = await open();
  await address().fill("Lunch!");
  await expect.element(address()).not.toHaveAttribute("aria-invalid", "true");
  await saveButton().click();
  await expect.element(address()).toHaveAttribute("aria-invalid", "true");
  const field = address().element();
  expect((field.getRootNode() as ShadowRoot).activeElement).toBe(field);
  await expect.element(saveButton()).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
  await address().fill("lunch-today");
  await expect.element(address()).not.toHaveAttribute("aria-invalid", "true");
  await expect.element(saveButton()).toBeEnabled();
});

it("keeps the draft while switching between Settings and Preview on a phone", async () => {
  await page.viewport(390, 800);
  try {
    const { app, save } = await open();
    const settingsView = page.getByRole("radio", { name: "Settings", exact: true });
    const previewView = page.getByRole("radio", { name: "Preview", exact: true });
    await settingsView.click();
    await address().fill("lunch-today");
    await previewView.click();
    await expect.element(page.getByRole("heading", { name: "Lunch for guests" })).toBeVisible();
    await vi.waitFor(() => expect(address().query()).toBeNull());
    expect(saveButton().query()).toBeNull();
    await settingsView.click();
    await expect.element(address()).toHaveValue("lunch-today");
    expect(app.leave.coordinator.isDirty()).toBe(true);
    expect(save).not.toHaveBeenCalled();
  } finally {
    await page.viewport(1280, 720);
  }
});

it("keeps Spanish photo choices on one line beside the preview", async () => {
  await page.viewport(900, 800);
  setLocale("es");
  await open();
  for (const name of ["Ninguna", "Pequeñas", "Grandes"]) {
    const choice = page.getByRole("radio", { name, exact: true });
    await expect.element(choice).toBeVisible();
    const text = document.createRange();
    text.selectNodeContents(choice.element());
    expect(Array.from(text.getClientRects()).filter((rect) => rect.width > 0)).toHaveLength(1);
  }
});
