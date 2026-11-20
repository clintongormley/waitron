import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useLocale } from "../testing/locale-setup.js";
import type { DashboardApi } from "../api/client.js";
import { details } from "./set-menu-dishes.test-fixture.js";
import { cleanupWidgets, expectMessageAboveButtons, mountWidget } from "./test-helpers.js";
import "./set-menu-copy-dishes.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const daily = {
  id: "daily",
  name: "Daily menu",
  kind: "set_menu",
  active: true,
  setPrice: "14.00",
  setVatClass: "reduced",
};
const special = { ...daily, id: "special", name: "Special menu", setPrice: "20.00" };
const lunch = { ...daily, id: "lunch", name: "Lunch", kind: "menu", setPrice: null };

function fakeApi() {
  return {
    listMenus: vi.fn().mockResolvedValue([lunch, daily, special]),
    listLibraryProducts: vi
      .fn()
      .mockResolvedValue([{ id: "turbot", name: "Turbot", active: true, variants: [] }]),
    copySetMenuDishes: vi.fn(),
  };
}

async function mountCopy(api = fakeApi()) {
  const events: string[] = [];
  const saved: unknown[] = [];
  const { el } = await mountWidget<HTMLElementTagNameMap["dashboard-set-menu-copy-dishes"]>(
    "dashboard-set-menu-copy-dishes",
    { api: api as unknown as DashboardApi, menuId: "daily" },
  );
  el.addEventListener("set-menu-dish-dialog-closed", () => events.push("closed"));
  el.addEventListener("set-menu-dishes-saved", (event) => {
    events.push("saved");
    saved.push((event as CustomEvent).detail);
  });
  const closed = () =>
    new Promise((resolve) =>
      el.addEventListener("set-menu-dish-dialog-closed", resolve, { once: true }),
    );
  return { el, api, events, saved, closed };
}

const dialog = () => page.getByRole("dialog", { name: "Copy dishes from another set menu" });
const copyButton = () => page.getByRole("button", { name: "Copy dishes", exact: true });

async function chooseSpecial() {
  await page.getByRole("combobox", { name: /^Set menu/ }).click();
  await page.getByRole("option", { name: "Special menu" }).click();
}

it("offers Try again when the set menus fail to load, and then lists the other set menus", async () => {
  const api = fakeApi();
  api.listMenus.mockRejectedValueOnce(new Error("offline"));
  await mountCopy(api);
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("The set menus could not be loaded. Try again.");
  expect(copyButton().elements()).toHaveLength(0);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect.element(page.getByRole("combobox", { name: /^Set menu/ })).toBeVisible();
  expect(api.listMenus).toHaveBeenCalledTimes(2);
  expect(page.getByRole("alert").elements()).toHaveLength(0);
  await page.getByRole("combobox", { name: /^Set menu/ }).click();
  expect(
    page
      .getByRole("option")
      .elements()
      .map((option) => option.textContent?.trim())
      .filter(Boolean),
  ).toEqual(["Special menu"]);
});

it("says there is nothing to copy from when this is the only set menu", async () => {
  const api = fakeApi();
  api.listMenus.mockResolvedValue([lunch, daily]);
  await mountCopy(api);
  await expect
    .element(page.getByText("There are no other set menus to copy dishes from."))
    .toBeVisible();
  expect(page.getByRole("combobox", { name: /^Set menu/ }).elements()).toHaveLength(0);
  expect(copyButton().elements()).toHaveLength(0);
});

it("copies from the chosen set menu, closes and hands back the saved dishes", async () => {
  const { api, events, saved, closed } = await mountCopy();
  const result = { details, addedLines: [] };
  api.copySetMenuDishes.mockResolvedValue(result);
  await expect.element(copyButton()).toBeDisabled();
  await chooseSpecial();
  const close = closed();
  await copyButton().click();
  await close;
  expect(events).toEqual(["saved", "closed"]);
  expect(api.copySetMenuDishes).toHaveBeenCalledExactlyOnceWith("daily", "special");
  expect(saved).toEqual([result]);
  await expect.element(dialog()).not.toBeInTheDocument();
});

it("copies once when Copy dishes is pressed twice before it redraws", async () => {
  const { api, closed } = await mountCopy();
  api.copySetMenuDishes.mockResolvedValue({ details, addedLines: [] });
  await chooseSpecial();
  await expect.element(copyButton()).toBeEnabled();
  const close = closed();
  const button = copyButton().element() as HTMLElement;
  button.click();
  button.click();
  await close;
  expect(api.copySetMenuDishes).toHaveBeenCalledExactlyOnceWith("daily", "special");
});

it("shows a refusal above the buttons without reading the product library", async () => {
  const { el, api, events } = await mountCopy();
  api.copySetMenuDishes.mockRejectedValue({ code: "set_menu.not_found" });
  await chooseSpecial();
  await copyButton().click();
  const text = "That set menu could not be found. Reload the menu list and choose a set menu.";
  await expect.element(dialog().getByText(text)).toBeVisible();
  await expectMessageAboveButtons(
    el.shadowRoot!.querySelector("wt-modal")!,
    copyButton().element(),
    text,
  );
  expect(api.listLibraryProducts).not.toHaveBeenCalled();
  expect(events).toEqual([]);
  await expect.element(copyButton()).toBeEnabled();
});

it("still explains a measured dish when the product library cannot be read to name it", async () => {
  const { api } = await mountCopy();
  api.copySetMenuDishes.mockRejectedValue({
    code: "set_menu.dish_sold_by_measure",
    params: { productId: "turbot" },
  });
  api.listLibraryProducts.mockRejectedValue(new Error("offline"));
  await chooseSpecial();
  await copyButton().click();
  await vi.waitFor(() => expect(api.listLibraryProducts).toHaveBeenCalledOnce());
  await expect
    .element(dialog().getByText("sold by weight or measure", { exact: false }))
    .toBeVisible();
  expect(dialog().getByText("Turbot", { exact: false }).elements()).toHaveLength(0);
});

it("refuses to close while the copy is being saved", async () => {
  const { el, api, events, closed } = await mountCopy();
  let finish!: (value: unknown) => void;
  api.copySetMenuDishes.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await chooseSpecial();
  await copyButton().click();
  await vi.waitFor(() => expect(finish).toBeDefined());
  const requestClose = vi.spyOn(el.shadowRoot!.querySelector("wt-modal")!, "requestClose");
  await userEvent.keyboard("{Escape}");
  expect(requestClose).toHaveBeenCalledExactlyOnceWith("escape");
  await expect(requestClose.mock.results[0]!.value).resolves.toBe(false);
  await expect.element(dialog()).toBeVisible();
  expect(events).toEqual([]);
  const close = closed();
  finish({ details, addedLines: [] });
  await close;
  expect(events).toEqual(["saved", "closed"]);
  await expect.element(dialog()).not.toBeInTheDocument();
});

it("closes on Cancel straight away when nothing was chosen and no leave check is present", async () => {
  const { events, closed } = await mountCopy();
  await expect.element(page.getByRole("combobox", { name: /^Set menu/ })).toBeVisible();
  const close = closed();
  await page.getByRole("button", { name: "Cancel" }).click();
  await close;
  expect(events).toEqual(["closed"]);
  await expect.element(dialog()).not.toBeInTheDocument();
});
