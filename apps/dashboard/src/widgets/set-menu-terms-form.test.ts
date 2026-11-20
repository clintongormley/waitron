import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "../screens/menus-screen.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const value = {
  id: "daily",
  name: "Daily menu",
  names: { en: "Today's menu", es: "Daily lunch for guests" },
  price: "14.00",
  vatClass: "reduced",
  takeawayVatClass: null,
} as const;
const languages = { defaultLanguage: "en", languages: ["en", "es"] };

async function mount(
  options: { create?: boolean; theme?: "light" | "dark"; failed?: boolean } = {},
) {
  const updateMenuDetails = options.failed
    ? vi.fn().mockRejectedValue({ code: "set_menu.invalid", params: { field: "setPrice" } })
    : vi.fn().mockResolvedValue(undefined);
  expect(customElements.get("dashboard-set-menu-terms-form")).toBeDefined();
  const { el, host } = await mountWidget(
    "dashboard-set-menu-terms-form",
    {
      api: { updateMenuDetails } as unknown as DashboardApi,
      value: options.create ? null : value,
      languages,
      defaultVatClass: "super_reduced",
    } as Partial<HTMLElement>,
    options.theme,
  );
  return { root: el.shadowRoot!, host, updateMenuDetails };
}

function change(root: ShadowRoot, name: string, value: string) {
  const control = root.querySelector(`[name="${name}"]`)!;
  control.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
function save(root: ShadowRoot) {
  return root.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
}

it("starts a new draft on the venue VAT rate and marks the required fields", async () => {
  const { root } = await mount({ create: true });
  expect(root.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')?.required).toBe(
    true,
  );
  expect(
    root.querySelector<HTMLElementTagNameMap["wt-price-input"]>('[name="setPrice"]')?.required,
  ).toBe(true);
  const eatIn = root.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="setVatClass"]');
  expect(eatIn?.required).toBe(true);
  expect(eatIn?.value).toBe("super_reduced");
  expect(save(root).disabled).toBe(true);
});

it("keeps Save quiet until an edit and saves or clears the separate takeaway rate", async () => {
  const { root, updateMenuDetails } = await mount();
  expect(save(root).disabled).toBe(true);
  change(root, "setPrice", "14.0");
  await (root.host as HTMLElementTagNameMap["dashboard-set-menu-terms-form"]).updateComplete;
  expect(save(root).disabled).toBe(true);
  save(root).click();
  expect(updateMenuDetails).not.toHaveBeenCalled();
  change(root, "setTakeawayVatClass", "general");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  await vi.waitFor(() =>
    expect(updateMenuDetails).toHaveBeenLastCalledWith(
      "daily",
      expect.objectContaining({ setTakeawayVatClass: "general" }),
    ),
  );
  await vi.waitFor(() => expect(save(root).disabled).toBe(true));
  change(root, "setTakeawayVatClass", "");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  await vi.waitFor(() =>
    expect(updateMenuDetails).toHaveBeenLastCalledWith(
      "daily",
      expect.objectContaining({ setTakeawayVatClass: null }),
    ),
  );
});

it("puts an invalid price beside the price and blocks another submission until corrected", async () => {
  const { root, updateMenuDetails } = await mount();
  const price = root.querySelector<HTMLElementTagNameMap["wt-price-input"]>('[name="setPrice"]')!;
  await userEvent.fill(page.elementLocator(price.shadowRoot!.querySelector("input")!), "10000.01");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  await vi.waitFor(() => expect(save(root).disabled).toBe(true));
  expect(price.error).toBeTruthy();
  expect(updateMenuDetails).not.toHaveBeenCalled();
});

it.each(["light", "dark"] as const)(
  "keeps empty, filled and refused forms accessible in %s",
  async (theme) => {
    const empty = await mount({ create: true, theme });
    await expectNoA11yViolations(empty.host);
    cleanupWidgets();
    const { root, host } = await mount({ failed: true, theme });
    await expectNoA11yViolations(host);
    change(root, "setPrice", "15.00");
    await vi.waitFor(() => expect(save(root).disabled).toBe(false));
    save(root).click();
    const price = root.querySelector<HTMLElementTagNameMap["wt-price-input"]>('[name="setPrice"]')!;
    await vi.waitFor(() => expect(price.error).toBeTruthy());
    expect(save(root).disabled).toBe(false);
    await expectNoA11yViolations(host);
  },
);

it("sends only the changed term when renaming an existing set menu", async () => {
  const { root, updateMenuDetails } = await mount();
  change(root, "name", "Daily lunch");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  await vi.waitFor(() =>
    expect(updateMenuDetails).toHaveBeenCalledExactlyOnceWith("daily", {
      internalName: "Daily lunch",
    }),
  );
});

it("refuses a blank name beside the name and sends nothing", async () => {
  const { root, updateMenuDetails } = await mount();
  change(root, "name", "   ");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  const name = root.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!;
  await vi.waitFor(() => expect(name.error).toBe("Enter a name for the menu."));
  expect(updateMenuDetails).not.toHaveBeenCalled();
});

it("ignores a cleared eat-in VAT rate and saves a newly chosen one", async () => {
  const { root, updateMenuDetails } = await mount();
  const eatIn = root.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="setVatClass"]')!;
  change(root, "setVatClass", "");
  await (root.host as HTMLElementTagNameMap["dashboard-set-menu-terms-form"]).updateComplete;
  expect(eatIn.value).toBe("reduced");
  expect(save(root).disabled).toBe(true);
  change(root, "setVatClass", "general");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  await vi.waitFor(() =>
    expect(updateMenuDetails).toHaveBeenCalledExactlyOnceWith("daily", { setVatClass: "general" }),
  );
});

it("saves a customer-facing name typed for one language", async () => {
  const { root, updateMenuDetails } = await mount();
  await page.getByRole("textbox", { name: /^Customer-facing name \(es\)/ }).fill("Menú del día");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  await vi.waitFor(() =>
    expect(updateMenuDetails).toHaveBeenCalledExactlyOnceWith("daily", {
      names: { en: "Today's menu", es: "Menú del día" },
    }),
  );
});

it("closes the new set menu dialog on Cancel and creates nothing", async () => {
  const createMenu = vi.fn();
  const { el } = await mountWidget("dashboard-set-menu-terms-form", {
    api: { createMenu } as unknown as DashboardApi,
    creating: true,
    languages,
  } as Partial<HTMLElement>);
  const cancelled = vi.fn();
  el.addEventListener("set-menu-terms-cancelled", cancelled);
  await expect.element(page.getByRole("dialog", { name: "Add set menu" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.element(page.getByRole("dialog", { name: "Add set menu" })).not.toBeInTheDocument();
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
  expect(createMenu).not.toHaveBeenCalled();
});
