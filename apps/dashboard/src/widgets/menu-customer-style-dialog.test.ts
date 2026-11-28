import { registerIcons } from "@waitron/ui";
import type { CustomerMenuAppearance, CustomerMenuStyle } from "@waitron/shared";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DASHBOARD_ICONS } from "../icons.js";
import { codeMessage } from "../i18n/codes.js";
import { useLocale } from "../testing/locale-setup.js";
import type { MenuCustomerStyleDialog } from "./menu-customer-style-dialog.js";
import { cleanupWidgets, dialogMessageOf, mountWidget } from "./test-helpers.js";
import "./menu-customer-style-dialog.js";

registerIcons(DASHBOARD_ICONS);
useLocale("en");
afterEach(cleanupWidgets);

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ready, fail) => {
    resolve = ready;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const stored = (
  appearance: CustomerMenuAppearance = { pageColor: "#fbf7ef", textColor: "#222222" },
  affectedMenus = [{ id: "dinner", name: "Dinner" }],
): CustomerMenuStyle => ({ name: "Default", appearance, affectedMenus });

async function mount(
  options: {
    getCustomerStyle?: (id: string) => Promise<CustomerMenuStyle>;
    saveCustomerStyle?: (id: string, value: CustomerMenuAppearance) => Promise<CustomerMenuStyle>;
  } = {},
) {
  const getCustomerStyle = vi.fn(options.getCustomerStyle ?? (async () => stored()));
  const saveCustomerStyle = vi.fn(
    options.saveCustomerStyle ??
      (async (_id: string, appearance: CustomerMenuAppearance) => stored(appearance)),
  );
  const { el } = await mountWidget<MenuCustomerStyleDialog>(
    "dashboard-menu-customer-style-dialog",
    {
      api: { saveCustomerStyle },
      readApi: {
        getCustomerStyle,
        getCustomerPreview: async () => ({ state: "unpublished" }),
      },
      menuId: "menu",
    },
  );
  const saved = vi.fn();
  el.addEventListener("customer-style-saved", saved);
  return { el, getCustomerStyle, saveCustomerStyle, saved };
}

const changeButton = () => page.getByRole("button", { name: "Change…", exact: true });
const dialog = () => page.getByRole("dialog", { name: "Customer menu style" });
const saveButton = () => page.getByRole("button", { name: "Save style", exact: true });
const colourField = (name: string) => page.getByRole("textbox", { name, exact: true });
const modalOf = (el: MenuCustomerStyleDialog) => el.shadowRoot!.querySelector("wt-modal")!;
const formErrorOf = (el: MenuCustomerStyleDialog) =>
  el.shadowRoot!.querySelector<HTMLElement & { error?: string }>("wt-form-actions")?.error;

async function openEditor() {
  await expect.element(changeButton()).toBeEnabled();
  await changeButton().click();
  await expect.element(dialog()).toBeVisible();
}

it("offers Try again when the style cannot be read, and shows the style once it loads", async () => {
  const retry = gate<CustomerMenuStyle>();
  const reads = [Promise.reject<CustomerMenuStyle>(new Error("connection.failed")), retry.promise];
  const { el, getCustomerStyle } = await mount({ getCustomerStyle: () => reads.shift()! });
  await openEditor();
  await expect
    .element(page.getByRole("alert").getByText("Could not load the customer menu style."))
    .toBeVisible();
  expect(colourField("Page colour").query()).toBeNull();
  await expect.element(saveButton()).toBeDisabled();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.element(page.getByRole("status").getByText("Loading menus…")).toBeVisible();
  expect(page.getByText("Could not load the customer menu style.").query()).toBeNull();
  retry.resolve(stored({ pageColor: "#abcdef" }));
  await expect.element(colourField("Page colour")).toHaveValue("#abcdef");
  expect(getCustomerStyle).toHaveBeenLastCalledWith("menu");
  expect(el.shadowRoot!.querySelector(".style-name")?.textContent).toContain("Default");
});

it("does not apply a style read that finishes after the dialog was removed", async () => {
  const read = gate<CustomerMenuStyle>();
  const { el } = await mount({ getCustomerStyle: () => read.promise });
  el.remove();
  read.resolve(stored());
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".style-name")).toBeNull();
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("wt-button")!.disabled,
  ).toBe(true);
});

it("does not record a failed style read that finishes after the dialog was removed", async () => {
  const read = gate<CustomerMenuStyle>();
  const { el } = await mount({ getCustomerStyle: () => read.promise });
  el.remove();
  read.reject({ code: "connection.failed" });
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("wt-button")!.disabled,
  ).toBe(true);
});

it("refuses a colour code that is not #rrggbb beside its field, and saves once it is corrected", async () => {
  const { el, saveCustomerStyle, saved } = await mount();
  await openEditor();
  const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[name="pageColor-picker"]')!;
  const defaultPage = await (async () => {
    await colourField("Page colour").fill("");
    await expect.element(saveButton()).toBeEnabled();
    return picker.value;
  })();
  await colourField("Page colour").fill("#12");
  await expect.element(colourField("Page colour")).not.toHaveAttribute("aria-invalid", "true");
  expect(picker.value).toBe(defaultPage);
  await saveButton().click();
  await expect.element(colourField("Page colour")).toHaveAttribute("aria-invalid", "true");
  await expect.element(page.getByText("Enter a colour code like #a12b3c.")).toBeVisible();
  expect(await dialogMessageOf(modalOf(el))).toBe("Correct the highlighted fields to continue.");
  const field = colourField("Page colour").element();
  expect((field.getRootNode() as ShadowRoot).activeElement).toBe(field);
  await expect.element(saveButton()).toBeDisabled();
  expect(saveCustomerStyle).not.toHaveBeenCalled();
  await colourField("Page colour").fill("#FFFFFF");
  await expect.element(colourField("Page colour")).not.toHaveAttribute("aria-invalid", "true");
  await expect.element(saveButton()).toBeEnabled();
  await saveButton().click();
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(saveCustomerStyle).toHaveBeenCalledExactlyOnceWith("menu", {
    pageColor: "#ffffff",
    textColor: "#222222",
  });
  expect(saved).toHaveBeenCalledOnce();
});

it("saves a cleared colour as no colour, so the default applies", async () => {
  const { saveCustomerStyle } = await mount();
  await openEditor();
  await colourField("Text colour").fill("");
  await expect.element(colourField("Text colour")).not.toHaveAttribute("aria-invalid", "true");
  await saveButton().click();
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(saveCustomerStyle).toHaveBeenCalledOnce();
  const sent = saveCustomerStyle.mock.calls[0]![1];
  expect(sent).toEqual({ pageColor: "#fbf7ef" });
  expect(sent.textColor).toBeUndefined();
});

it("shows a colour refusal beside its field and clears it once the colour is edited", async () => {
  const refusal = { code: "management.request_invalid", params: { field: "headingColor" } };
  const { el, saved } = await mount({
    saveCustomerStyle: async () => {
      throw refusal;
    },
  });
  await openEditor();
  await colourField("Heading colour").fill("#123456");
  await saveButton().click();
  await expect.element(colourField("Heading colour")).toHaveAttribute("aria-invalid", "true");
  await expect.element(page.getByText(codeMessage(refusal.code))).toBeVisible();
  await expect.element(colourField("Page colour")).not.toHaveAttribute("aria-invalid", "true");
  expect(await dialogMessageOf(modalOf(el))).toBe("Correct the highlighted fields to continue.");
  await expect.element(dialog()).toBeVisible();
  expect(saved).not.toHaveBeenCalled();
  await colourField("Heading colour").fill("#123457");
  await expect.element(colourField("Heading colour")).not.toHaveAttribute("aria-invalid", "true");
  expect(await dialogMessageOf(modalOf(el))).toBe("");
});

it("shows a refusal that names no colour at the bottom and clears it once the draft is edited", async () => {
  const { el, saveCustomerStyle } = await mount({
    saveCustomerStyle: async () => {
      throw { code: "connection.failed" };
    },
  });
  await openEditor();
  await colourField("Page colour").fill("#ffffff");
  await saveButton().click();
  await vi.waitFor(async () =>
    expect(await dialogMessageOf(modalOf(el))).toBe(codeMessage("connection.failed")),
  );
  for (const name of ["Page colour", "Text colour", "Heading colour"])
    await expect.element(colourField(name)).not.toHaveAttribute("aria-invalid", "true");
  await expect.element(colourField("Page colour")).toHaveValue("#ffffff");
  await expect.element(saveButton()).toBeEnabled();
  expect(saveCustomerStyle).toHaveBeenCalledOnce();
  await colourField("Page colour").fill("#fffffe");
  await vi.waitFor(async () => expect(await dialogMessageOf(modalOf(el))).toBe(""));
});

it("saves a chosen heading font and keeps the editor open while choosing it", async () => {
  const { saveCustomerStyle } = await mount();
  await openEditor();
  await page.getByRole("combobox", { name: "Heading font" }).click();
  await page.getByRole("option", { name: "Serif", exact: true }).click();
  await expect.element(dialog()).toBeVisible();
  await expect.element(saveButton()).toBeEnabled();
  await saveButton().click();
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(saveCustomerStyle).toHaveBeenCalledExactlyOnceWith("menu", {
    pageColor: "#fbf7ef",
    textColor: "#222222",
    headingFont: "serif",
  });
});

it("ignores a wt-close that bubbles up from inside the editor", async () => {
  const { el } = await mount();
  await openEditor();
  const inner = el.shadowRoot!.querySelector("wt-combobox")!;
  inner.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  await expect.element(dialog()).toBeVisible();
  expect(modalOf(el)).not.toBeNull();
});

it("warns when the heading colour is hard to read on the page colour", async () => {
  await mount();
  await openEditor();
  const warning = page.getByText("Headings may be hard to read on this page colour.");
  await colourField("Page colour").fill("#ffffff");
  await colourField("Heading colour").fill("#111111");
  await expect.element(warning).not.toBeInTheDocument();
  await colourField("Heading colour").fill("#eeeeee");
  await expect.element(warning).toBeVisible();
});

it("names no other menu when the style is used by this menu alone", async () => {
  await mount({ getCustomerStyle: async () => stored(undefined, []) });
  await openEditor();
  await expect.element(colourField("Page colour")).toHaveValue("#fbf7ef");
  expect(page.getByText(/Saving also changes/).query()).toBeNull();
});

it("saves on Enter in a colour field", async () => {
  const { saveCustomerStyle, saved } = await mount();
  await openEditor();
  await colourField("Page colour").fill("#ffffff");
  await userEvent.keyboard("{Enter}");
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(saveCustomerStyle).toHaveBeenCalledExactlyOnceWith("menu", {
    pageColor: "#ffffff",
    textColor: "#222222",
  });
  expect(saved).toHaveBeenCalledOnce();
});

it("ignores a scripted second Save click and a scripted font change on the disabled controls while a save is in flight", async () => {
  const written = gate<CustomerMenuStyle>();
  const { el, saveCustomerStyle } = await mount({ saveCustomerStyle: () => written.promise });
  await openEditor();
  await colourField("Page colour").fill("#ffffff");
  await saveButton().click();
  expect(saveCustomerStyle).toHaveBeenCalledOnce();
  el.shadowRoot!.querySelector<HTMLElement>("[data-save-style]")!.click();
  const font = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
    'wt-combobox[name="headingFont"]',
  )!;
  font.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "serif" }, bubbles: true, composed: true }),
  );
  written.reject({ code: "connection.failed" });
  await vi.waitFor(async () =>
    expect(await dialogMessageOf(modalOf(el))).toBe(codeMessage("connection.failed")),
  );
  expect(saveCustomerStyle).toHaveBeenCalledOnce();
  await el.updateComplete;
  expect(font.value).toBe("system");
});

it("does not announce a save that finishes after the dialog was removed", async () => {
  const written = gate<CustomerMenuStyle>();
  const { el, saved } = await mount({ saveCustomerStyle: () => written.promise });
  await openEditor();
  await colourField("Page colour").fill("#ffffff");
  await saveButton().click();
  el.remove();
  written.resolve(stored({ pageColor: "#ffffff" }));
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(saved).not.toHaveBeenCalled();
  expect(modalOf(el).open).toBe(true);
});

it("does not show a refusal for a save that ends after the dialog was removed", async () => {
  const written = gate<CustomerMenuStyle>();
  const { el } = await mount({ saveCustomerStyle: () => written.promise });
  await openEditor();
  await colourField("Page colour").fill("#ffffff");
  await saveButton().click();
  el.remove();
  written.reject({ code: "connection.failed" });
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  expect(formErrorOf(el)).toBeFalsy();
});

it("fills the colour code from the colour picker and saves the picked colour", async () => {
  const { el, saveCustomerStyle } = await mount();
  await openEditor();
  const picker = el.shadowRoot!.querySelector<HTMLInputElement>('input[name="textColor-picker"]')!;
  picker.value = "#00aa55";
  picker.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await expect.element(colourField("Text colour")).toHaveValue("#00aa55");
  await saveButton().click();
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(saveCustomerStyle).toHaveBeenCalledExactlyOnceWith("menu", {
    pageColor: "#fbf7ef",
    textColor: "#00aa55",
  });
});
