import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { useLocale } from "../testing/locale-setup.js";
import { details, mountDishes, wineDetails } from "./set-menu-dishes.test-fixture.js";
import { cleanupWidgets, expectNoA11yViolations } from "./test-helpers.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

it.each(["light", "dark"] as const)(
  "makes course tables and the %s dialog states accessible",
  async (theme) => {
    const { host } = await mountDishes(
      { ...details, ...wineDetails, dishes: [...details.dishes, ...wineDetails.dishes] },
      theme,
    );
    await expect.element(page.getByRole("region", { name: "No course" })).toBeVisible();
    await expectNoA11yViolations(host);

    await page.getByRole("button", { name: "Add products", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add products" });
    await expect.element(page.getByRole("checkbox", { name: "Coffee" })).toBeVisible();
    await expectNoA11yViolations(host);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(add).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Edit variants for Wine" }).click();
    const variants = page.getByRole("dialog", { name: "Variants for Wine" });
    await expect.element(page.getByRole("switch", { name: "Include Glass" })).toBeVisible();
    await expectNoA11yViolations(host);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(variants).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Copy dishes from another set menu" }).click();
    await expect
      .element(page.getByRole("dialog", { name: "Copy dishes from another set menu" }))
      .toBeVisible();
    await expect.element(page.getByRole("combobox", { name: /^Set menu/ })).toBeVisible();
    await expectNoA11yViolations(host);
  },
);
