import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardApi } from "../api/client.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./set-menu-terms-form.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const value = {
  id: "daily",
  name: "Daily menu",
  names: { en: "Today's menu", es: "Daily lunch for guests" },
  price: "14.00",
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

it("asks for a name, customer names and a price, and no VAT", async () => {
  const created = { id: "lunch", name: "Lunch", kind: "set_menu", active: true, setPrice: "14.00" };
  const createMenu = vi.fn().mockResolvedValue(created);
  const { el } = await mountWidget("dashboard-set-menu-terms-form", {
    api: { createMenu } as unknown as DashboardApi,
    creating: true,
    languages,
  } as Partial<HTMLElement>);
  const root = el.shadowRoot!;
  expect(root.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')?.required).toBe(
    true,
  );
  const price = root.querySelector<HTMLElementTagNameMap["wt-price-input"]>('[name="setPrice"]');
  expect(price?.required).toBe(true);
  expect([...root.querySelectorAll("[name]")].map((field) => field.getAttribute("name"))).toEqual([
    "name",
    "names-en",
    "names-es",
    "setPrice",
  ]);
  expect(root.querySelector("wt-combobox")).toBeNull();
  expect(page.getByText(/VAT/).query()).toBeNull();
  expect(save(root).disabled).toBe(true);
  change(root, "name", "Lunch");
  change(root, "setPrice", "14");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  await vi.waitFor(() =>
    expect(createMenu).toHaveBeenCalledExactlyOnceWith("Lunch", {
      kind: "set_menu",
      names: {},
      setPrice: "14.00",
    }),
  );
});

it("keeps Save quiet until an edit and saves a changed price", async () => {
  const { root, updateMenuDetails } = await mount();
  expect(save(root).disabled).toBe(true);
  change(root, "setPrice", "14.0");
  await (root.host as HTMLElementTagNameMap["dashboard-set-menu-terms-form"]).updateComplete;
  expect(save(root).disabled).toBe(true);
  save(root).click();
  expect(updateMenuDetails).not.toHaveBeenCalled();
  change(root, "setPrice", "15.50");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  await vi.waitFor(() =>
    expect(updateMenuDetails).toHaveBeenCalledExactlyOnceWith("daily", { setPrice: "15.50" }),
  );
  await vi.waitFor(() => expect(save(root).disabled).toBe(true));
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
  await vi.waitFor(() => expect(name.error).toBe("Enter a name for the set menu."));
  expect(updateMenuDetails).not.toHaveBeenCalled();
});

it("saves a customer-facing name typed for one language", async () => {
  const { root, updateMenuDetails } = await mount();
  await page.getByRole("textbox", { name: /^Customer-facing name \(es\)/ }).fill("Set lunch");
  await vi.waitFor(() => expect(save(root).disabled).toBe(false));
  save(root).click();
  await vi.waitFor(() =>
    expect(updateMenuDetails).toHaveBeenCalledExactlyOnceWith("daily", {
      names: { en: "Today's menu", es: "Set lunch" },
    }),
  );
});

it.each(["Cancel", "Escape"])(
  "closes the new set menu dialog on %s, reports it cancelled and creates nothing",
  async (how) => {
    const createMenu = vi.fn();
    const { el } = await mountWidget("dashboard-set-menu-terms-form", {
      api: { createMenu } as unknown as DashboardApi,
      creating: true,
      languages,
    } as Partial<HTMLElement>);
    const cancelled = vi.fn();
    el.addEventListener("set-menu-terms-cancelled", cancelled);
    await expect.element(page.getByRole("dialog", { name: "Add set menu" })).toBeVisible();
    const reported = new Promise((resolve) =>
      el.addEventListener("set-menu-terms-cancelled", resolve, { once: true }),
    );
    if (how === "Cancel") await page.getByRole("button", { name: "Cancel" }).click();
    else await userEvent.keyboard("{Escape}");
    await reported;
    expect(cancelled).toHaveBeenCalledOnce();
    await expect
      .element(page.getByRole("dialog", { name: "Add set menu" }))
      .not.toBeInTheDocument();
    expect(createMenu).not.toHaveBeenCalled();
  },
);
