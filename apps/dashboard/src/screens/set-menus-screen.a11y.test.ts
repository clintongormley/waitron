import { afterEach, expect, it, onTestFinished } from "vitest";
import { page } from "vitest/browser";
import type { DashboardApi, DashboardMenuSummary } from "../api/client.js";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
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
  heldBy: [{ id: "lunch", name: "Lunch menus" }],
};

it.each([
  ["light", 390],
  ["dark", 390],
  ["light", 1280],
  ["dark", 1280],
] as const)("makes offering links readable in %s at %ipx", async (theme, width) => {
  const frame = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 900);
  expect(window.innerWidth).toBe(width);
  onTestFinished(() => page.viewport(frame.width, frame.height));
  history.replaceState(null, "", "/set-menus");
  const { el, host } = await mountWidget<SetMenusScreen>(
    "dashboard-set-menus-screen",
    {
      api: {
        listMenus: async () => [daily, { ...daily, id: "unused", name: "Unused", heldBy: [] }],
        getMenuSettings: async () => ({ defaultProductVatClass: "general" }),
        getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      } as unknown as DashboardApi,
    },
    theme,
  );
  const table = page.elementLocator(el).getByRole("table");
  await expect.element(table.getByRole("link", { name: "Lunch menus" })).toBeVisible();
  const layout = width === 390 ? "narrow" : "wide";
  await expect.poll(() => el.shadowRoot!.querySelector("wt-data-table")?.className).toBe(layout);
  if (width === 390) await expect.element(table.getByText("Offered on")).toBeVisible();
  else await expect.element(table.getByRole("columnheader", { name: "Offered on" })).toBeVisible();
  const unused = table.getByText("Not on any menu", { exact: true });
  await expect.element(unused).toBeVisible();
  const token = document.createElement("span");
  token.style.color = "var(--wt-color-text-muted)";
  host.append(token);
  expect(getComputedStyle(unused.element()).color).toBe(getComputedStyle(token).color);
  token.remove();
  await expectNoA11yViolations(host);
});
