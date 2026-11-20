import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { useLocale } from "../testing/locale-setup.js";
import type { DashboardApi } from "../api/client.js";
import { details } from "./set-menu-dishes.test-fixture.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
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
  return { el, api, events, saved };
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
  const { api, events, saved } = await mountCopy();
  const result = { details, addedLines: [] };
  api.copySetMenuDishes.mockResolvedValue(result);
  await expect.element(copyButton()).toBeDisabled();
  await chooseSpecial();
  await copyButton().click();
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(api.copySetMenuDishes).toHaveBeenCalledExactlyOnceWith("daily", "special");
  await vi.waitFor(() => expect(events).toEqual(["saved", "closed"]));
  expect(saved).toEqual([result]);
});

it("shows a refusal under the actions without reading the product library", async () => {
  const { api, events } = await mountCopy();
  api.copySetMenuDishes.mockRejectedValue({ code: "set_menu.not_found" });
  await chooseSpecial();
  await copyButton().click();
  await expect
    .element(dialog().getByText("That set menu could not be found.", { exact: false }))
    .toBeVisible();
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
  const { api, events } = await mountCopy();
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
  await userEvent.keyboard("{Escape}");
  await new Promise((resolve) => setTimeout(resolve, 50));
  await expect.element(dialog()).toBeVisible();
  expect(events).toEqual([]);
  finish({ details, addedLines: [] });
  await expect.element(dialog()).not.toBeInTheDocument();
  await vi.waitFor(() => expect(events).toEqual(["saved", "closed"]));
});

it("closes on Cancel straight away when nothing was chosen and no leave check is present", async () => {
  const { events } = await mountCopy();
  await expect.element(page.getByRole("combobox", { name: /^Set menu/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await vi.waitFor(() => expect(events).toEqual(["closed"]));
  await expect.element(dialog()).not.toBeInTheDocument();
});

class CopyLeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = fakeApi();
  closed = 0;

  override render() {
    return html`<dashboard-set-menu-copy-dishes
        .api=${this.api as unknown as DashboardApi}
        menuId="daily"
        @set-menu-dish-dialog-closed=${() => this.closed++}
      ></dashboard-set-menu-copy-dishes>
      ${this.leave.render({
        heading: "Unsaved changes",
        message: "Leave without saving?",
        keepLabel: "Keep editing",
        discardLabel: "Discard",
      })}`;
  }
}
customElements.define("set-menu-copy-leave-test", CopyLeaveHost);

it("asks before Escape drops a chosen set menu, and Cancel puts the choice back and closes", async () => {
  const { el } = await mountWidget<CopyLeaveHost>("set-menu-copy-leave-test", {});
  const confirmation = page.getByRole("dialog", { name: "Unsaved changes" });
  await chooseSpecial();
  await userEvent.keyboard("{Escape}");
  await expect.element(confirmation).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect.element(confirmation).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("combobox", { name: /^Set menu.*Special menu/ }))
    .toBeVisible();
  expect(el.closed).toBe(0);

  await page.getByRole("button", { name: "Cancel" }).click();
  await vi.waitFor(() => expect(el.closed).toBe(1));
  expect(confirmation.elements()).toHaveLength(0);
  const copy = el.shadowRoot!.querySelector("dashboard-set-menu-copy-dishes")!;
  expect(copy.shadowRoot!.querySelector("wt-combobox")!.value).toBe("");
  expect(el.api.copySetMenuDishes).not.toHaveBeenCalled();
});
