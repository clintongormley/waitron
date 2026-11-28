import { LiveData } from "@waitron/dashboard-kit";
import { LeaveController, registerIcons } from "@waitron/ui";
import { printEquipmentLabel } from "@waitron/ui/src/print-label.js";
import { LitElement, html } from "lit";
import { toDataURL } from "qrcode";
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

vi.mock("@waitron/ui/src/print-label.js", { spy: true });

registerIcons(DASHBOARD_ICONS);
useLocale("en");
beforeEach(() => page.viewport(1280, 800));
afterEach(cleanupWidgets);

class OnlineSettingsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  canOpenCloudServices = true;

  override render() {
    return html`<dashboard-menus-screen
        .api=${this.api}
        .canOpenCloudServices=${this.canOpenCloudServices}
      ></dashboard-menus-screen>
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
  saved: CustomerMenuOnlineSettings | (() => Promise<CustomerMenuOnlineSettings>) = initial,
  cloud = vi.fn(async (): Promise<{ status: string; origin?: string }> => ({
    status: "unavailable",
  })),
  liveData?: LiveData,
  canOpenCloudServices = true,
  tag = "online-settings-leave-app",
) {
  let stored = typeof saved === "function" ? initial : saved;
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
    listMenus: async () => [{ id: "menu", name: "Lunch menu", active: true }],
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
    getCustomerOnlineSettings: typeof saved === "function" ? saved : async () => stored,
    getCustomerMenuCloudStatus: cloud,
    liveData,
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
  const { el: app, host } = await mountWidget<OnlineSettingsLeaveApp>(tag, {
    api,
    canOpenCloudServices,
  });
  return { app, host, save, styles };
}

function openScreen(
  save?: Parameters<typeof open>[0],
  getSettings?: () => Promise<CustomerMenuOnlineSettings>,
) {
  return open(save, getSettings, undefined, undefined, true, "dashboard-menus-screen");
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

it("saves without a live-link warning on an unavailable box and keeps an address refusal in the draft", async () => {
  const { app, save } = await open(
    vi.fn(async () => {
      throw { code: "customer_menu.address_taken", params: { field: "address" } };
    }),
    { ...initial, enabled: true },
  );
  await address().fill("dinner");
  await saveButton().click();
  expect(save).toHaveBeenCalledOnce();
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

it("fits the public host beside the address text", async () => {
  await open(
    undefined,
    { ...initial, enabled: true },
    vi.fn(async () => ({ status: "ready", origin: "https://casa-delgado.menu.example" })),
  );
  const host = page.getByText("casa-delgado.menu.example/", { exact: true });
  await expect.element(host).toBeVisible();
  const input = address().element();
  const bounds = input.getBoundingClientRect();
  const style = getComputedStyle(input);
  const top = Number.parseFloat(style.paddingTop);
  const bottom = Number.parseFloat(style.paddingBottom);
  const contentMiddle = bounds.top + (bounds.height + top - bottom) / 2;
  const range = document.createRange();
  range.selectNodeContents(host.element());
  const lines = Array.from(range.getClientRects()).filter(({ width }) => width > 0);
  expect(new Set(lines.map(({ top }) => top)).size).toBe(1);
  const line = lines[0]!;
  expect(Math.abs(line.top + line.height / 2 - contentMiddle)).toBeLessThan(3);
});

it("explains why links are withheld and how to turn remote access back on", async () => {
  await open(
    undefined,
    { ...initial, enabled: true },
    vi.fn(async () => ({ status: "remote_off" })),
  );
  const reason = page.getByText("Remote access is off. Turn it on in Cloud services.");
  await expect.element(reason).toBeVisible();
  const link = page.getByRole("link", { name: "Cloud services", exact: true });
  await expect.element(link).toHaveAttribute("href", "/cloud");
  const toggle = (online().element().getRootNode() as ShadowRoot).host;
  expect(toggle.closest(".online-card")).toContainElement(link.element());
  await expect.element(page.getByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
  await expect.element(address()).toBeEnabled();
});

it("keeps the reason without sending menu-only staff to Cloud services", async () => {
  await open(
    undefined,
    { ...initial, enabled: true },
    vi.fn(async () => ({ status: "remote_off" })),
    undefined,
    false,
  );
  await expect
    .element(page.getByText("Remote access is off. Turn it on in Cloud services."))
    .toBeVisible();
  expect(page.getByRole("link", { name: "Cloud services", exact: true }).query()).toBeNull();
});

it("retries a failed sharing status read without losing the address draft", async () => {
  const cloud = vi.fn(async () => ({ status: "ready", origin: "https://cafe.example.test" }));
  cloud.mockRejectedValueOnce(new Error("unavailable"));
  await open(undefined, { ...initial, enabled: true }, cloud);
  await expect
    .element(page.getByText("Could not check whether customers can open this menu."))
    .toBeVisible();
  await address().fill("dinner");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect.element(address()).toHaveValue("dinner");
});

it.each([
  ["rename", "ready"],
  ["turn off", "ready"],
  ["rename", "loading"],
] as const)(
  "asks before %s with sharing %s and keeps the saved address after Stop or a refusal",
  async (action, status) => {
    const save = vi.fn(async () => {
      throw { code: "customer_menu.address_taken", params: { field: "address" } };
    });
    const ready = { status: "ready", origin: "https://cafe.example.test" };
    let settleStatus!: (value: typeof ready) => void;
    const answer = new Promise<typeof ready>((resolve) => {
      settleStatus = resolve;
    });
    if (status === "ready") settleStatus(ready);
    await open(
      save,
      { ...initial, enabled: true },
      vi.fn(() => answer),
    );
    if (action === "rename") await address().fill("dinner");
    else await online().click();
    await saveButton().click();
    const confirm = page.getByRole("dialog", {
      name: action === "rename" ? "Change the live menu link?" : "Take this menu offline?",
    });
    await expect
      .element(confirm.getByText("Existing links and printed QR codes will stop working."))
      .toBeVisible();
    expect(save).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.element(confirm).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await saveButton().click();
    const confirmSave = page.getByRole("button", { name: "Save", exact: true }).last();
    await expect.element(confirmSave).toBeVisible();
    expect((confirmSave.element().getRootNode() as ShadowRoot).host).toHaveAttribute(
      "variant",
      "danger",
    );
    await confirmSave.click();
    await expect.element(confirm).not.toBeInTheDocument();
    expect(save).toHaveBeenCalledExactlyOnceWith("menu", {
      ...initial,
      ...(action === "rename" ? { enabled: true, address: "dinner" } : { enabled: false }),
    });
    settleStatus(ready);
    await expect
      .element(page.getByRole("link", { name: "https://cafe.example.test/lunch" }))
      .toHaveAttribute("href", "https://cafe.example.test/lunch");
  },
);

it("copies the saved address and withholds sharing when availability changes", async () => {
  const origin = "https://cafe.example.test";
  const url = "https://cafe.example.test/lunch";
  const live = new LiveData();
  const cloud = vi.fn(async () => ({ status: "ready", origin }));
  await open(undefined, { ...initial, enabled: true }, cloud, live);
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  try {
    const qr = page.getByRole("img", { name: `QR code for ${url}` });
    await expect.element(qr).toBeVisible();
    const originalQr = qr.element().getAttribute("src");
    expect(originalQr).toMatch(/^data:image\/png;base64,/);
    await address().fill("draft-address");
    await expect
      .element(page.getByText("The link and QR code change when you save."))
      .toBeVisible();
    expect(qr.element()).toHaveAttribute("src", originalQr);
    const download = page.getByRole("button", { name: "Download QR code" });
    const png = await toDataURL(url, { width: 512 });
    expect(originalQr).toBe(png);
    const downloadImage = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      await download.click();
      expect(downloadImage).toHaveBeenCalledOnce();
      const downloaded = downloadImage.mock.contexts[0] as HTMLAnchorElement;
      expect(downloaded.download).toBe("lunch-qr.png");
      expect(downloaded.href).toBe(png);
    } finally {
      downloadImage.mockRestore();
    }
    const print = vi.mocked(printEquipmentLabel).mockImplementation(() => {});
    try {
      await page.getByRole("button", { name: "Print QR code" }).click();
      expect(print).toHaveBeenCalledExactlyOnceWith({ qr: png, code: url, name: "Lunch menu" });
    } finally {
      print.mockRestore();
    }
    await page.getByRole("button", { name: "Copy link" }).click();
    expect(copy).toHaveBeenLastCalledWith(url);
    await expect.element(page.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Copy link" }), { timeout: 3500 })
      .toBeVisible();

    cloud.mockRejectedValue(new Error("unavailable"));
    live.refresh();
    await expect.element(page.getByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
    await expect.element(qr).not.toBeInTheDocument();
  } finally {
    copy.mockRestore();
  }
});

it("copies the saved address in the inline embed code", async () => {
  await open(
    undefined,
    { ...initial, enabled: true },
    vi.fn(async () => ({ status: "ready", origin: "https://cafe.example.test" })),
  );
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  try {
    const copyCode = page.getByRole("button", { name: "Copy code" });
    await expect
      .element(page.getByRole("link", { name: /https:\/\/cafe\.example\.test/ }))
      .toBeVisible();
    expect(copyCode.query()).toBeNull();
    await page.getByRole("button", { name: /Embed code/ }).click();
    await expect.element(copyCode).toBeVisible();
    await address().fill("draft-address");
    copy.mockRejectedValueOnce(new Error("Clipboard denied"));
    await copyCode.click();
    const failure = page.getByText("Could not copy. Select and copy the text.", { exact: true });
    await expect.element(failure).toBeVisible();
    expect(failure.element().closest("wt-disclosure")).not.toBeNull();
    await copyCode.click();
    await expect.element(failure).not.toBeInTheDocument();
    expect(copy).toHaveBeenLastCalledWith(
      '<iframe src="https://cafe.example.test/lunch" title="Customer menu" loading="lazy"></iframe>',
    );
    await expect.element(page.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  } finally {
    copy.mockRestore();
  }
});

it("replaces sharing with the offline notice after switching off and saving", async () => {
  await open(
    undefined,
    { ...initial, enabled: true },
    vi.fn(async () => ({ status: "ready", origin: "https://cafe.example.test" })),
  );
  await expect.element(page.getByRole("img", { name: /QR code for/ })).toBeVisible();
  await online().click();
  await expect.element(page.getByRole("button", { name: "Print QR code" })).toBeVisible();
  await saveButton().click();
  await expect.element(page.getByRole("dialog", { name: "Take this menu offline?" })).toBeVisible();
  await saveButton().last().click();
  await expect
    .element(page.getByText("Customers cannot open this menu while it is offline."))
    .toBeVisible();
  await expect.element(page.getByRole("img", { name: /QR code for/ })).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: /Embed code/ })).not.toBeInTheDocument();
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
  await openScreen(undefined, readsFrom(reads));
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
  await openScreen(undefined, readsFrom(reads));
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
  await openScreen(save, readsFrom(reads));
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
  await openScreen(
    vi.fn(() => written.promise),
    readsFrom(reads),
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
  const { save } = await openScreen();
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

async function discardTabChanges(app: OnlineSettingsLeaveApp): Promise<void> {
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(question.open).toBe(true));
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
}

async function chooseStyle(name: string): Promise<void> {
  await styleButton().click();
  await page.getByRole("combobox", { name: "Style Use venue default", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

it("previews a draft choice, restores it on Cancel, and reads the saved style on reload", async () => {
  const { app, save, styles } = await open();
  const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!.shadowRoot!;
  const editor = screen.querySelector("dashboard-menu-customer-style-dialog")!.shadowRoot!;
  await chooseStyle("Terrace");
  await expect.poll(() => canvasColor(editor)).toBe("rgb(31, 41, 40)");
  await expect.poll(() => canvasColor(screen)).toBe("rgb(251, 247, 239)");
  await page.getByRole("button", { name: "Use style", exact: true }).click();
  await expect.element(styleDialog()).not.toBeInTheDocument();
  await expect.poll(() => canvasColor(screen)).toBe("rgb(31, 41, 40)");
  await discardTabChanges(app);
  await expect.poll(() => canvasColor(screen)).toBe("rgb(251, 247, 239)");
  await expect.element(saveButton()).toBeDisabled();
  expect(save).not.toHaveBeenCalled();

  await chooseStyle("Terrace");
  await page.getByRole("button", { name: "Use style", exact: true }).click();
  await expect.element(styleDialog()).not.toBeInTheDocument();
  await saveButton().click();
  await expect.element(saveButton()).toBeDisabled();
  expect(save).toHaveBeenCalledExactlyOnceWith("menu", { ...initial, styleId: "terrace" });
  await expect.poll(() => canvasColor(screen)).toBe("rgb(31, 41, 40)");
  const terrace = styles.find(({ id }) => id === "terrace")!;
  terrace.appearance = { pageColor: "#ffffff" };
  await screen.querySelector("dashboard-menu-online-preview")!.reload();
  await expect.poll(() => canvasColor(screen)).toBe("rgb(255, 255, 255)");
});

it.each([
  { name: "Terrace", styleId: "terrace" },
  { name: "Default", styleId: "default" },
])(
  "stages the explicitly picked $name style when its colours are saved",
  async ({ name, styleId }) => {
    const { app, save } = await open();
    const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!.shadowRoot!;
    await chooseStyle(name);
    await pageColor().fill("#ffffff");
    await page.getByRole("button", { name: "Save style", exact: true }).click();
    await expect.element(styleDialog()).not.toBeInTheDocument();
    await expect.poll(() => canvasColor(screen)).toBe("rgb(255, 255, 255)");
    expect(save).not.toHaveBeenCalled();
    await saveButton().click();
    expect(save).toHaveBeenCalledExactlyOnceWith("menu", { ...initial, styleId });
  },
);

it("uses a newly named style immediately and keeps an unsaved address", async () => {
  const { app, save } = await open();
  const screen = app.shadowRoot!.querySelector("dashboard-menus-screen")!.shadowRoot!;
  await address().fill("lunch-today");
  await styleButton().click();
  await pageColor().fill("#ffffff");
  await page.getByRole("button", { name: "Save as new style…", exact: true }).click();
  await page.getByRole("textbox", { name: "Style name" }).fill("White terrace");
  await page.getByRole("button", { name: "Save as new style", exact: true }).click();
  await expect.element(styleDialog()).not.toBeInTheDocument();
  await expect.element(page.getByText("White terrace", { exact: true })).toBeVisible();
  await expect.poll(() => canvasColor(screen)).toBe("rgb(255, 255, 255)");
  await expect.element(address()).toHaveValue("lunch-today");
  await discardTabChanges(app);
  await expect.element(address()).toHaveValue("lunch");
  await expect.element(page.getByText("White terrace", { exact: true })).toBeVisible();
  await expect.element(saveButton()).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
  await address().fill("lunch-today");
  await saveButton().click();
  expect(save).toHaveBeenCalledExactlyOnceWith("menu", {
    ...initial,
    address: "lunch-today",
    styleId: "white-terrace",
  });
});
