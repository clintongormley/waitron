import { LeaveController, registerIcons } from "@waitron/ui";
import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CustomerMenuAppearance, CustomerMenuOnlineSettings } from "@waitron/shared";
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
  let appearance: CustomerMenuAppearance = { pageColor: "#fbf7ef" };
  const style = () => ({
    name: "Default",
    appearance,
    affectedMenus: [{ id: "dinner", name: "Dinner" }],
  });
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
    getCustomerStyle: async () => style(),
    saveCustomerStyle: async (_id: string, value: CustomerMenuAppearance) => {
      appearance = value;
      return style();
    },
    getCustomerPreview: async () => ({
      state: "published",
      appearance,
      menu: { name: "Lunch for guests", language: "en", languages: ["en"], members: [] },
    }),
  } as unknown as DashboardApi;
  history.replaceState(null, "", "/menus/menu/menu/view/customer-menu");
  const { el: app, host } = await mountWidget<OnlineSettingsLeaveApp>("online-settings-leave-app", {
    api,
  });
  return { app, host, save };
}

const online = () => page.getByRole("switch", { name: "Online", exact: true });
const address = () => page.getByRole("textbox", { name: "Address" });
const saveButton = () => page.getByRole("button", { name: "Save", exact: true });
const warning = () => page.getByText("Customers cannot open this page yet.");
const styleButton = () => page.getByRole("button", { name: "Change…", exact: true });
const styleDialog = () => page.getByRole("dialog", { name: "Customer menu style" });
const pageColor = () => page.getByRole("textbox", { name: "Page colour", exact: true });
function canvasColor(root: ShadowRoot) {
  const canvas = root
    .querySelector("dashboard-menu-online-preview")
    ?.shadowRoot?.querySelector("customer-menu-page")
    ?.shadowRoot?.querySelector("article");
  return canvas && getComputedStyle(canvas).backgroundColor;
}

it("previews the default style draft and updates the tab after Save style", async () => {
  const { app } = await open();
  await expect.element(page.getByText("Default", { exact: true }), { timeout: 2000 }).toBeVisible();
  await styleButton().click();
  const dialog = styleDialog();
  const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!.shadowRoot!;
  const editor = screen.querySelector("dashboard-menu-customer-style-dialog")!.shadowRoot!;
  const save = page.getByRole("button", { name: "Save style", exact: true });
  await expect.element(dialog).toBeVisible();
  await expect
    .poll(() => {
      const menu = editor
        .querySelector("dashboard-menu-online-preview")
        ?.shadowRoot?.querySelector("customer-menu-page");
      return (
        menu &&
        menu.getBoundingClientRect().right - menu.parentElement!.getBoundingClientRect().right
      );
    })
    .toBeLessThanOrEqual(1);
  await expect
    .element(page.getByText("Saving also changes Dinner.", { exact: true }))
    .toBeVisible();
  await expect.element(save).toBeDisabled();
  await pageColor().fill("#ffffff");
  await expect.poll(() => canvasColor(editor)).toBe("rgb(255, 255, 255)");
  const warningStatus = editor
    .querySelector('wt-input[name="textColor"]')!
    .closest("div")!
    .querySelector('[role="status"]');
  expect(warningStatus).not.toBeNull();
  await page.getByRole("textbox", { name: "Text colour", exact: true }).fill("#eeeeee");
  const contrast = page.getByText("Text and page colours may be hard to read together.");
  await expect.element(contrast).toBeVisible();
  expect(warningStatus?.contains(contrast.element())).toBe(true);
  expect(contrast.element().closest("p")?.querySelector("wt-icon")?.getAttribute("name")).toBe(
    "warning",
  );
  await expect.element(save).toBeEnabled();
  await save.click();
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.poll(() => canvasColor(screen)).toBe("rgb(255, 255, 255)");
  await styleButton().click();
  await expect.element(pageColor()).toHaveValue("#ffffff");
});

it("scopes Escape and Discard to the style draft and keeps the staged Online settings", async () => {
  const { app } = await open();
  await address().fill("lunch-today");
  await styleButton().click();
  await pageColor().fill("#ffffff");
  await userEvent.keyboard("{Escape}");
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(question.open).toBe(true));
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.element(styleDialog()).not.toBeInTheDocument();
  await expect.element(address()).toHaveValue("lunch-today");
  await address().fill("lunch");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await styleButton().click();
  await expect.element(pageColor()).toHaveValue("#fbf7ef");
  const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!.shadowRoot!;
  const editor = screen.querySelector("dashboard-menu-customer-style-dialog")!.shadowRoot!;
  await page.elementLocator(editor.querySelector("wt-button[slot=cancel]")!).click();
  await expect.element(styleDialog()).not.toBeInTheDocument();
});

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
  const { host } = await open();
  host.style.setProperty("--wt-font-size-sm", "20px");
  host.style.setProperty("--wt-font-family", "monospace");
  for (const size of ["none", "small", "large"] as const) {
    const name = t(`customer_menu.photos_${size}`);
    const choice = page.getByRole("radio", {
      name,
      exact: true,
    });
    await expect.element(choice).toBeVisible();
    await vi.waitFor(() => {
      const button = choice.element();
      const text = document.createRange();
      text.selectNodeContents(button);
      const tops = Array.from(text.getClientRects())
        .filter((rect) => rect.width > 0)
        .map((rect) => rect.top);
      expect(new Set(tops).size, name).toBe(1);
      const group = (button.getRootNode() as ShadowRoot).host;
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(
        group.parentElement!.getBoundingClientRect().right + 1,
      );
    });
  }
});
