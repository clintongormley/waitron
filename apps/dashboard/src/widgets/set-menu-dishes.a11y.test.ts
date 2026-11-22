import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fill, setLocale } from "../i18n/t.js";
import { useLocale } from "../testing/locale-setup.js";
import { details, mountDishes, wineDetails } from "./set-menu-dishes.test-fixture.js";
import { cleanupWidgets, expectNoA11yViolations } from "./test-helpers.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

it.each(["light", "dark"] as const)(
  "makes course tables and the %s dialog states accessible",
  async (theme) => {
    const { el, host, api } = await mountDishes(
      { ...details, ...wineDetails, dishes: [...details.dishes, ...wineDetails.dishes] },
      theme,
    );
    await expect.element(page.getByRole("region", { name: "No course" })).toBeVisible();
    await expectNoA11yViolations(host);

    api.updateMenuItem.mockRejectedValueOnce({
      code: "set_menu.invalid",
      params: { field: "surcharge" },
    });
    const surcharge = page.getByRole("textbox", { name: "Surcharge for Bravas" });
    await surcharge.fill("2.00");
    await userEvent.keyboard("{Enter}");
    await expect.element(surcharge).toHaveAttribute("aria-invalid", "true");
    await expectNoA11yViolations(host);

    await page.getByRole("button", { name: "Add products", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add products" });
    await expect.element(page.getByRole("checkbox", { name: "Coffee" })).toBeVisible();
    await expectNoA11yViolations(host);
    const cancelChoices = () =>
      page
        .elementLocator(
          el
            .shadowRoot!.querySelector("dashboard-set-menu-dishes")!
            .shadowRoot!.querySelector("dashboard-set-menu-dish-choices")!,
        )
        .getByRole("button", { name: "Cancel" })
        .click();
    await cancelChoices();
    await expect.element(add).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Edit variants for Wine" }).click();
    const variants = page.getByRole("dialog", { name: "Variants for Wine" });
    await expect.element(page.getByRole("switch", { name: "Include Glass" })).toBeVisible();
    await expectNoA11yViolations(host);
    await cancelChoices();
    await expect.element(variants).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Copy dishes from another set menu" }).click();
    await expect
      .element(page.getByRole("dialog", { name: "Copy dishes from another set menu" }))
      .toBeVisible();
    await expect.element(page.getByRole("combobox", { name: /^Set menu/ })).toBeVisible();
    await expectNoA11yViolations(host);
  },
);

it.each(["light", "dark"] as const)("makes the empty %s dishes view accessible", async (theme) => {
  const { host } = await mountDishes({ ...details, dishes: [] }, theme);
  await expect.element(page.getByRole("heading", { name: "Dishes" })).toBeVisible();
  await expectNoA11yViolations(host);
});

it("shows a Spanish decimal mark for the inherited variant surcharge", async () => {
  setLocale("es-ES");
  await mountDishes(wineDetails);
  await page
    .getByRole("button", { name: fill("menus.set_menu_edit_variants", { name: "Wine" }) })
    .click();
  await expect
    .element(
      page.getByRole("textbox", { name: fill("menus.set_menu_surcharge_for", { name: "Glass" }) }),
    )
    .toHaveAttribute("placeholder", "2,00");
});
