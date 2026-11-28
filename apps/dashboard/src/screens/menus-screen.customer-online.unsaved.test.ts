import { LeaveController, registerIcons } from "@waitron/ui";
import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type {
  CustomerMenuAppearance,
  CustomerMenuOnlineSettings,
  CustomerMenuStyle,
} from "@waitron/shared";
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

const initial: CustomerMenuOnlineSettings = {
  enabled: false,
  address: "lunch",
  photos: "large",
  styleId: null,
};
const status = {
  state: "current",
  version: 1,
  hash: "a".repeat(64),
  clashes: 0,
  publishedAt: "2026-11-26T17:00:00.000Z",
};

async function open(
  save = vi.fn(async (_id: string, value: CustomerMenuOnlineSettings) => value),
  getSettings?: () => Promise<CustomerMenuOnlineSettings>,
  tag = "online-settings-leave-app",
) {
  let stored = initial;
  const styles: CustomerMenuStyle[] = [
    {
      id: "default",
      isDefault: true,
      name: "Default",
      appearance: { pageColor: "#fbf7ef" },
      affectedMenus: [{ id: "dinner", name: "Dinner" }],
    },
    {
      id: "terrace",
      isDefault: false,
      name: "Terrace",
      appearance: { pageColor: "#1f2928" },
      affectedMenus: [],
    },
  ];
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
    getCustomerOnlineSettings: () => getSettings?.() ?? Promise.resolve(stored),
    saveCustomerOnlineSettings: async (id: string, value: CustomerMenuOnlineSettings) => {
      stored = await save(id, value);
      return stored;
    },
    getCustomerStyles: async () => [...styles],
    saveCustomerStyle: async (
      _id: string,
      styleId: string,
      appearance: CustomerMenuAppearance,
      name?: string,
    ) => {
      if (name !== undefined) {
        const copy = { id: "white-terrace", isDefault: false, name, appearance, affectedMenus: [] };
        styles.push(copy);
        stored = { ...stored, styleId: copy.id };
        return copy;
      }
      const index = styles.findIndex(({ id }) => id === styleId);
      const style = { ...styles[index]!, appearance };
      styles[index] = style;
      return style;
    },
    getCustomerPreview: async () => ({
      state: "published",
      appearance: styles.find(({ id }) => id === (stored.styleId ?? "default"))?.appearance,
      menu: { name: "Lunch for guests", language: "en", languages: ["en"], members: [] },
    }),
  } as unknown as DashboardApi;
  history.replaceState(null, "", "/menus/menu/menu/view/customer-menu");
  const { el: app, host } = await mountWidget<OnlineSettingsLeaveApp>(tag, { api });
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
    .element(page.getByText(t("form.fix_fields")), { timeout: 1500 })
    .not.toBeInTheDocument();
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

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ready, fail) => {
    resolve = ready;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Reads after the listed ones never settle: the screen reads again as the test page is torn down. */
const readsFrom = (reads: Promise<CustomerMenuOnlineSettings>[]) => () =>
  reads.shift() ?? new Promise<CustomerMenuOnlineSettings>(() => {});
const loadingSettings = () => page.getByText("Loading Online settings…");
const tab = (name: string) => page.getByRole("tab", { name, exact: true });

async function leaveAndReturn() {
  await tab("Preview").click();
  await vi.waitFor(() => expect(location.pathname).toBe("/menus/menu/menu/view/preview"));
  await tab("Customer menu").click();
  await vi.waitFor(() => expect(location.pathname).toBe("/menus/menu/menu/view/customer-menu"));
}

it("ignores Online settings that arrive after the manager left and came back", async () => {
  const first = gate<CustomerMenuOnlineSettings>();
  const second = gate<CustomerMenuOnlineSettings>();
  const reads = [first.promise, second.promise];
  await open(undefined, readsFrom(reads), "dashboard-menus-screen");
  await expect.element(loadingSettings()).toBeVisible();
  await leaveAndReturn();
  first.resolve({ ...initial, address: "stale" });
  await new Promise(requestAnimationFrame);
  await expect.element(loadingSettings()).toBeVisible();
  second.resolve(initial);
  await expect.element(address()).toHaveValue("lunch");
});

it("ignores a failed settings read that ends after the manager left and came back", async () => {
  const first = gate<CustomerMenuOnlineSettings>();
  const second = gate<CustomerMenuOnlineSettings>();
  const reads = [first.promise, second.promise];
  await open(undefined, readsFrom(reads), "dashboard-menus-screen");
  await leaveAndReturn();
  first.reject({ code: "connection.failed" });
  await new Promise(requestAnimationFrame);
  await expect
    .element(page.getByText("Could not load the Online settings."))
    .not.toBeInTheDocument();
  await expect.element(loadingSettings()).toBeVisible();
  second.resolve(initial);
  await expect.element(address()).toHaveValue("lunch");
});

it("does not apply a save that finishes after the manager left and came back", async () => {
  const written = gate<CustomerMenuOnlineSettings>();
  const reread = gate<CustomerMenuOnlineSettings>();
  const reads = [Promise.resolve(initial), reread.promise];
  const save = vi.fn(() => written.promise);
  await open(save, readsFrom(reads), "dashboard-menus-screen");
  await address().fill("dinner");
  await saveButton().click();
  expect(save).toHaveBeenCalledOnce();
  await leaveAndReturn();
  written.resolve({ ...initial, address: "dinner" });
  await new Promise(requestAnimationFrame);
  await expect.element(loadingSettings()).toBeVisible();
  reread.resolve(initial);
  await expect.element(address()).toHaveValue("lunch");
  await expect.element(saveButton()).toBeDisabled();
});

it("does not show a refusal for a save that ends after the manager left and came back", async () => {
  const written = gate<CustomerMenuOnlineSettings>();
  const reread = gate<CustomerMenuOnlineSettings>();
  const reads = [Promise.resolve(initial), reread.promise];
  await open(
    vi.fn(() => written.promise),
    readsFrom(reads),
    "dashboard-menus-screen",
  );
  await address().fill("dinner");
  await saveButton().click();
  await leaveAndReturn();
  written.reject({ code: "connection.failed" });
  await new Promise(requestAnimationFrame);
  await expect.element(loadingSettings()).toBeVisible();
  await expect
    .element(page.getByText("This browser could not connect to Waitron.", { exact: false }))
    .not.toBeInTheDocument();
});

it("shows a refusal that names no field at the bottom and keeps the draft", async () => {
  await open(
    vi.fn(async () => {
      throw { code: "connection.failed" };
    }),
  );
  await address().fill("dinner");
  await saveButton().click();
  await expect
    .element(page.getByText("This browser could not connect to Waitron.", { exact: false }))
    .toBeVisible();
  await expect.element(address()).toHaveValue("dinner");
  await expect.element(address()).not.toHaveAttribute("aria-invalid", "true");
  await expect.element(saveButton()).toBeEnabled();
});

it("brings a phone back to Settings with a link to Preview when the menu is not published", async () => {
  await page.viewport(390, 800);
  try {
    const written = gate<CustomerMenuOnlineSettings>();
    await open(vi.fn(() => written.promise));
    const link = page.getByRole("link", { name: "Go to Preview" });
    await page.getByRole("radio", { name: "Settings", exact: true }).click();
    await expect.element(link).not.toBeInTheDocument();
    await online().click();
    await saveButton().click();
    await page.getByRole("radio", { name: "Preview", exact: true }).click();
    await vi.waitFor(() => expect(address().query()).toBeNull());
    written.reject({ code: "customer_menu.not_published" });
    await expect
      .element(page.getByText("Publish the menu from Preview before switching it on."))
      .toBeVisible();
    await expect.element(link).toBeVisible();
  } finally {
    await page.viewport(1280, 800);
  }
});

it("asks for an address when the menu is switched on with the address cleared", async () => {
  const { save } = await open();
  await online().click();
  await address().fill("");
  await saveButton().click();
  await expect.element(page.getByText("Enter an address to switch the menu on.")).toBeVisible();
  await expect.element(address()).toHaveAttribute("aria-invalid", "true");
  expect(save).not.toHaveBeenCalled();
});

it("puts the saved settings back on Cancel when no page asks about unsaved changes", async () => {
  const { save } = await open(undefined, undefined, "dashboard-menus-screen");
  await address().fill("dinner");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.element(address()).toHaveValue("lunch");
  await expect.element(saveButton()).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});

it("sends one save when Save is pressed twice before the screen redraws", async () => {
  const written = gate<CustomerMenuOnlineSettings>();
  const save = vi.fn(() => written.promise);
  await open(save);
  await address().fill("dinner");
  const button = saveButton().element() as HTMLElement;
  button.click();
  button.click();
  expect(save).toHaveBeenCalledOnce();
  written.resolve({ ...initial, address: "dinner" });
  await expect.element(saveButton()).toBeDisabled();
});

it("takes no change into the draft while a save is being sent", async () => {
  const written = gate<CustomerMenuOnlineSettings>();
  const { app } = await open(vi.fn(() => written.promise));
  await address().fill("dinner");
  await saveButton().click();
  const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!;
  const toggle = screen.shadowRoot!.querySelector<HTMLElement & { checked: boolean }>(
    "wt-switch[name=customer-menu-enabled]",
  )!;
  toggle.dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
  await screen.updateComplete;
  expect(toggle.checked).toBe(false);
  written.resolve({ ...initial, address: "dinner" });
  await expect.element(saveButton()).toBeDisabled();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});


it("previews a named choice and holds it until the Customer menu tab is saved", async () => {
  const { app, save } = await open();
  const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!.shadowRoot!;
  const editor = screen.querySelector("dashboard-menu-customer-style-dialog")!.shadowRoot!;
  await styleButton().click();
  await page.getByRole("combobox", { name: "Style Use venue default", exact: true }).click();
  await page.getByRole("option", { name: "Terrace", exact: true }).click();
  await expect.poll(() => canvasColor(editor)).toBe("rgb(31, 41, 40)");
  await expect.poll(() => canvasColor(screen)).toBe("rgb(251, 247, 239)");
  await page.getByRole("button", { name: "Use style", exact: true }).click();
  await expect.element(styleDialog()).not.toBeInTheDocument();
  await expect.poll(() => canvasColor(screen)).toBe("rgb(31, 41, 40)");
  expect(save).not.toHaveBeenCalled();
  await saveButton().click();
  expect(save).toHaveBeenCalledExactlyOnceWith("menu", { ...initial, styleId: "terrace" });
});

it("uses a newly named style immediately and keeps an unsaved address", async () => {
  const { save } = await open();
  await address().fill("lunch-today");
  await styleButton().click();
  await pageColor().fill("#ffffff");
  await page.getByRole("button", { name: "Save as new style…", exact: true }).click();
  await page.getByRole("textbox", { name: "Style name" }).fill("White terrace");
  await page.getByRole("button", { name: "Save as new style", exact: true }).click();
  await expect.element(styleDialog()).not.toBeInTheDocument();
  await expect.element(page.getByText("White terrace", { exact: true })).toBeVisible();
  await expect.element(address()).toHaveValue("lunch-today");
  expect(save).not.toHaveBeenCalled();
  await saveButton().click();
  expect(save).toHaveBeenCalledExactlyOnceWith("menu", {
    ...initial,
    address: "lunch-today",
    styleId: "white-terrace",
  });
});
