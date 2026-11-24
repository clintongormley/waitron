import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import type { DashboardApi, DashboardMenuSummary } from "../api/client.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetMenusScreen } from "./set-menus-screen.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

const daily: DashboardMenuSummary = {
  id: "daily",
  name: "Daily menu",
  kind: "set_menu",
  active: true,
  setPrice: "14.00",
  setVatClass: "reduced",
  heldBy: [],
};
const budget: DashboardMenuSummary = {
  ...daily,
  id: "weekend",
  name: "Weekend menu",
  setPrice: "9.00",
};

async function mount(offers: DashboardMenuSummary[]) {
  const live = new LiveData();
  const listMenus = vi.fn().mockResolvedValue(offers);
  history.replaceState(null, "", "/set-menus");
  const { el } = await mountWidget<SetMenusScreen>("dashboard-set-menus-screen", {
    api: {
      liveData: live,
      listMenus,
      getMenuSettings: async () => ({ defaultProductVatClass: "general" }),
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    } as unknown as DashboardApi,
  });
  await expect.element(page.getByRole("button", { name: "Daily menu", exact: true })).toBeVisible();
  return { live, listMenus, table: el.shadowRoot!.querySelector("wt-data-table")! };
}

it("sorts prices numerically and searches its own menu names", async () => {
  const frame = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1280, 900);
  onTestFinished(() => page.viewport(frame.width, frame.height));
  const { table } = await mount([daily, budget]);
  const rows = () =>
    [...table.shadowRoot!.querySelectorAll("tbody [part=name-text]")].map((el) => el.textContent);
  expect(rows()).toEqual(["Daily menu", "Weekend menu"]);
  await page.elementLocator(table.shadowRoot!.querySelector('[data-sort="price"]')!).click();
  await vi.waitFor(() => expect(rows()).toEqual(["Weekend menu", "Daily menu"]));
  await page.getByRole("searchbox", { name: "Search set menus" }).fill("daily");
  await vi.waitFor(() => expect(rows()).toEqual(["Daily menu"]));
});

it("remembers a hidden price column for the Set menus list", async () => {
  const frame = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1280, 900);
  const choice = "waitron.set-menus.list.table:columns";
  onTestFinished(async () => {
    localStorage.removeItem(choice);
    await page.viewport(frame.width, frame.height);
  });
  const { table } = await mount([daily, budget]);
  const chooser = table.shadowRoot!.querySelector<HTMLButtonElement>(".columns-trigger");
  expect(chooser).not.toBeNull();
  chooser!.click();
  await table.updateComplete;
  const hidePrice = table.shadowRoot!.querySelector<HTMLInputElement>('[data-column="price"]');
  expect(hidePrice).not.toBeNull();
  hidePrice!.click();
  await expect.poll(() => table.shadowRoot!.querySelector('[data-sort="price"]')).toBeNull();
  cleanupWidgets();
  const reopened = await mount([daily, budget]);
  expect(reopened.table.shadowRoot!.querySelector('[data-sort="price"]')).toBeNull();
});

it("refreshes offering links when a placement is added and removed", async () => {
  const { live, listMenus } = await mount([daily]);
  const unused = page.getByText("Not on any menu", { exact: true });
  const lunch = page.getByRole("link", { name: "Lunch menus" });
  await expect.element(unused).toBeVisible();
  listMenus.mockResolvedValue([{ ...daily, heldBy: [{ id: "lunch", name: "Lunch menus" }] }]);
  live.invalidate([{ type: "section_members" }]);
  await expect.element(lunch).toBeVisible();
  listMenus.mockResolvedValue([daily]);
  live.invalidate([{ type: "section_members" }]);
  await expect.element(unused).toBeVisible();
  expect(lunch.elements()).toHaveLength(0);
});
