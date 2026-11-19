import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets } from "./test-helpers.js";
import {
  bravas,
  details,
  drinkLine,
  hake,
  mountDishes,
  sharingLine,
  soup,
  starterLine,
  starters,
  wine,
  wineDetails,
} from "./set-menu-dishes.test-fixture.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

it("groups dishes in course order and links from No course to the product", async () => {
  await mountDishes();
  await expect.element(page.getByRole("region", { name: "No course" })).toBeVisible();
  expect(
    page
      .getByRole("region")
      .elements()
      .filter((region) => region.querySelector("table")),
  ).toEqual([
    page.getByRole("region", { name: "Starters" }).element(),
    page.getByRole("region", { name: "Sharing plates" }).element(),
    page.getByRole("region", { name: "No course" }).element(),
  ]);
  await expect
    .element(
      page
        .getByRole("region", { name: "Starters" })
        .getByRole("cell", { name: "Soup", exact: true }),
    )
    .toBeVisible();
  const link = page
    .getByRole("region", { name: "No course" })
    .getByRole("link", { name: "Edit Hake" });
  await expect.element(link).toHaveAttribute("href", "/products/product/hake");
});

it("moves Bravas to Starters and explains both line changes, then restores its product course", async () => {
  const { api } = await mountDishes();
  const moved = { ...bravas, courseId: starters.id, courseOverrideId: starters.id };
  api.saveSetMenuDishCourse
    .mockResolvedValueOnce({
      details: { ...details, dishes: [hake, moved, soup], lines: [starterLine] },
      addedLines: [starterLine],
      removedLines: [sharingLine],
    })
    .mockResolvedValueOnce({ details, addedLines: [sharingLine], removedLines: [starterLine] });
  await expect.element(page.getByRole("combobox", { name: /^Course for Bravas/ })).toBeVisible();
  await expect
    .element(
      page.getByRole("combobox", { name: "Course for Bravas Sharing plates (from the product)" }),
    )
    .toBeVisible();
  const choose = async (name: string) => {
    await page.getByRole("combobox", { name: /^Course for Bravas/ }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await choose("Starters");
  await expect
    .element(
      page
        .getByRole("region", { name: "Starters" })
        .getByRole("cell", { name: "Bravas", exact: true }),
    )
    .toBeVisible();
  expect(api.saveSetMenuDishCourse).toHaveBeenNthCalledWith(1, "daily", "bravas-item", "starters");
  await expect.element(page.getByText("Added a line: 1 × Starters")).toBeVisible();
  await expect.element(page.getByText("Removed a line: 1 × Sharing plates")).toBeVisible();
  await vi.waitFor(() => {
    const course = page.getByRole("combobox", { name: /^Course for Bravas/ }).element();
    expect((course.getRootNode() as ShadowRoot).activeElement === course).toBe(true);
  });
  await choose("Sharing plates (from the product)");
  await expect
    .element(
      page
        .getByRole("region", { name: "Sharing plates" })
        .getByRole("cell", { name: "Bravas", exact: true }),
    )
    .toBeVisible();
  expect(api.saveSetMenuDishCourse).toHaveBeenNthCalledWith(2, "daily", "bravas-item", null);
});

it("shows Included while blank, saves on Enter, and clears the surcharge on blur", async () => {
  const { api } = await mountDishes();
  const field = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  await expect.element(field).toHaveAttribute("placeholder", "Included");
  await field.fill("5.25");
  expect(api.updateMenuItem).not.toHaveBeenCalled();
  api.readSetMenu.mockResolvedValue({
    ...details,
    dishes: [hake, { ...bravas, surcharge: "5.25" }, soup],
  });
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(api.updateMenuItem).toHaveBeenCalledExactlyOnceWith("daily", "bravas-item", {
      grossPrice: "5.25",
    }),
  );
  await field.fill("");
  api.readSetMenu.mockResolvedValue(details);
  await page.getByRole("textbox", { name: "Surcharge for Soup" }).click();
  await vi.waitFor(() =>
    expect(api.updateMenuItem).toHaveBeenNthCalledWith(2, "daily", "bravas-item", {
      grossPrice: null,
    }),
  );
});

it("queues a return to Included while the preceding surcharge read is still pending", async () => {
  const { api } = await mountDishes();
  const field = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  await expect.element(field).toHaveAttribute("placeholder", "Included");
  let release!: (value: typeof details) => void;
  api.readSetMenu.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await field.fill("5.25");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(release).toBeDefined());
  await field.fill("");
  await userEvent.keyboard("{Enter}");
  release({ ...details, dishes: [hake, { ...bravas, surcharge: "5.25" }, soup] });
  await vi.waitFor(() =>
    expect(api.updateMenuItem).toHaveBeenNthCalledWith(2, "daily", "bravas-item", {
      grossPrice: null,
    }),
  );
});

it("marks a refused surcharge on its row and lets Escape put back the saved price", async () => {
  const { api } = await mountDishes();
  api.updateMenuItem.mockRejectedValueOnce({
    code: "set_menu.invalid",
    params: { field: "surcharge" },
  });
  const field = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  await field.fill("4.00");
  await userEvent.keyboard("{Enter}");
  await expect.element(field).toHaveAttribute("aria-invalid", "true");
  await expect
    .element(page.getByRole("textbox", { name: "Surcharge for Soup" }))
    .not.toHaveAttribute("aria-invalid", "true");
  await userEvent.keyboard("{Escape}");
  await expect.element(field).toHaveValue("");
});

it("removes the selected dish from the draft's root", async () => {
  const { api } = await mountDishes();
  await page.getByRole("button", { name: "Actions for Hake" }).click();
  api.readSetMenu.mockResolvedValue({ ...details, dishes: [bravas, soup] });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await vi.waitFor(() =>
    expect(api.removeSectionMember).toHaveBeenCalledExactlyOnceWith("daily-root", "hake-member"),
  );
  await expect.element(page.getByRole("region", { name: "No course" })).not.toBeInTheDocument();
});

async function openAdd() {
  await vi.waitFor(() =>
    expect(page.getByRole("button", { name: "Add products", exact: true }).element()).toBeVisible(),
  );
  await page.getByRole("button", { name: "Add products", exact: true }).click();
  await expect.element(page.getByRole("dialog", { name: "Add products" })).toBeVisible();
}

it("lets Bottle be unticked before adding Wine in one save", async () => {
  const { api } = await mountDishes();
  api.addSetMenuDishes.mockResolvedValue({ details: wineDetails, addedLines: [] });
  await openAdd();
  await page.getByRole("checkbox", { name: "Wine" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  await expect.element(page.getByRole("checkbox", { name: "Glass" })).toBeChecked();
  const bottle = page.getByRole("checkbox", { name: "Bottle" });
  await expect.element(bottle).toBeChecked();
  await bottle.click();
  expect(page.getByRole("checkbox", { name: "Magnum" }).elements()).toHaveLength(0);
  expect(api.addSetMenuDishes).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Add products", exact: true }).last().click();
  expect(api.addSetMenuDishes).toHaveBeenCalledExactlyOnceWith("daily", [
    { productId: "wine", excludedVariantIds: ["bottle"] },
  ]);
});

it("announces a line added by a dish", async () => {
  const { api } = await mountDishes(wineDetails);
  api.addSetMenuDishes.mockResolvedValue({
    details: { ...wineDetails, lines: [...wineDetails.lines, drinkLine] },
    addedLines: [drinkLine],
  });
  await openAdd();
  await page.getByRole("checkbox", { name: "Coffee" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  await expect.element(page.getByText("Added a line: 1 × Drinks")).toBeVisible();
});

it("keeps the line added by a dish when saving an already edited inclusion count", async () => {
  const { el, api } = await mountDishes(wineDetails);
  const withDrinks = { ...wineDetails, lines: [sharingLine, drinkLine] };
  api.addSetMenuDishes.mockResolvedValue({ details: withDrinks, addedLines: [drinkLine] });
  api.saveSetMenuLines.mockResolvedValue({ lines: withDrinks.lines });
  const lineForm = page.elementLocator(
    el.shadowRoot!.querySelector("dashboard-set-menu-lines-form")!,
  );
  await lineForm.getByRole("spinbutton", { name: "Number of dishes" }).fill("2");

  await openAdd();
  await page.getByRole("checkbox", { name: "Coffee" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  await expect.element(page.getByText("Added a line: 1 × Drinks")).toBeVisible();

  await lineForm.getByRole("button", { name: "Save" }).click();
  await vi.waitFor(() =>
    expect(api.saveSetMenuLines).toHaveBeenCalledExactlyOnceWith("daily", [
      { count: 2, courseIds: ["sharing"] },
      { count: 1, courseIds: ["drinks"] },
    ]),
  );
});

it("does not put an automatically removed line back when saving another count", async () => {
  const { el, api } = await mountDishes({ ...details, lines: [sharingLine, starterLine] });
  const moved = { ...bravas, courseId: starters.id, courseOverrideId: starters.id };
  api.saveSetMenuDishCourse.mockResolvedValue({
    details: { ...details, dishes: [hake, moved, soup], lines: [starterLine] },
    addedLines: [],
    removedLines: [sharingLine],
  });
  api.saveSetMenuLines.mockResolvedValue({ lines: [starterLine] });
  const lineForm = page.elementLocator(
    el.shadowRoot!.querySelector("dashboard-set-menu-lines-form")!,
  );
  await lineForm.getByRole("spinbutton", { name: "Number of dishes" }).nth(1).fill("2");

  await page.getByRole("combobox", { name: /^Course for Bravas/ }).click();
  await page.getByRole("option", { name: "Starters", exact: true }).click();
  await expect.element(page.getByText("Removed a line: 1 × Sharing plates")).toBeVisible();

  await lineForm.getByRole("button", { name: "Save" }).click();
  await vi.waitFor(() =>
    expect(api.saveSetMenuLines).toHaveBeenCalledExactlyOnceWith("daily", [
      { count: 2, courseIds: ["starters"] },
    ]),
  );
});

it("keeps the add dialog open and names a dish the server refuses for its unit", async () => {
  const { api } = await mountDishes();
  api.addSetMenuDishes.mockRejectedValue({
    code: "set_menu.dish_sold_by_measure",
    params: { productId: "turbot" },
  });
  await openAdd();
  await page.getByRole("checkbox", { name: "Turbot" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  await expect
    .element(page.getByText("Turbot is sold by weight or measure", { exact: false }))
    .toBeVisible();
  await expect
    .element(page.getByText("or sell it by the portion on the product.", { exact: false }))
    .toBeVisible();
  await expect.element(page.getByRole("checkbox", { name: "Turbot" })).toBeChecked();
});

it("opens the variants for a dish from its row actions", async () => {
  await mountDishes(wineDetails);
  await page.getByRole("button", { name: "Actions for Wine" }).click();
  await vi.waitFor(() =>
    expect(page.getByRole("button", { name: "Variants…" }).element()).toBeVisible(),
  );
  await page.getByRole("button", { name: "Variants…" }).click();
  await expect.element(page.getByRole("dialog", { name: "Variants for Wine" })).toBeVisible();
});

it("opens variants from a publication problem and saves exclusions with variant surcharges", async () => {
  const { el, api } = await mountDishes(wineDetails);
  api.saveSetMenuVariantChoices.mockResolvedValue({ ...wineDetails, problems: [] });
  await vi.waitFor(() =>
    expect(page.getByRole("button", { name: "Edit variants for Wine" }).element()).toBeVisible(),
  );
  await page.getByRole("button", { name: "Edit variants for Wine" }).click();
  await expect.element(page.getByRole("dialog", { name: "Variants for Wine" })).toBeVisible();
  const choices = page.elementLocator(
    el
      .shadowRoot!.querySelector("dashboard-set-menu-dishes")!
      .shadowRoot!.querySelector("dashboard-set-menu-dish-choices")!,
  );
  await expect.element(choices.getByText("Bottle · Drinks", { exact: true })).toBeVisible();
  const glass = choices.getByRole("textbox", { name: "Surcharge for Glass" });
  await expect.element(glass).toHaveAttribute("placeholder", "2.00");
  const save = choices.getByRole("button", { name: "Save", exact: true });
  await expect.element(save).toBeDisabled();
  const bottle = choices.getByRole("switch", { name: "Include Bottle" });
  (bottle.element() as HTMLInputElement).focus();
  await userEvent.keyboard(" ");
  await expect.element(bottle).not.toBeChecked();
  await glass.fill("3.50");
  await save.click();
  expect(api.saveSetMenuVariantChoices).toHaveBeenCalledExactlyOnceWith("daily", "wine-item", [
    { variantId: "glass", included: true, surcharge: "3.50" },
    { variantId: "bottle", included: false, surcharge: null },
  ]);
  await expect
    .element(page.getByRole("button", { name: "Edit variants for Wine" }))
    .not.toBeInTheDocument();
});

it("copies from another set menu and shows the returned dishes and kept surcharges", async () => {
  const { api } = await mountDishes(wineDetails);
  api.copySetMenuDishes.mockResolvedValue({
    details: { ...wineDetails, dishes: [wine, soup] },
    addedLines: [],
  });
  await vi.waitFor(() =>
    expect(
      page.getByRole("button", { name: "Copy dishes from another set menu" }).element(),
    ).toBeVisible(),
  );
  await page.getByRole("button", { name: "Copy dishes from another set menu" }).click();
  await expect
    .element(page.getByRole("dialog", { name: "Copy dishes from another set menu" }))
    .toBeVisible();
  await page.getByRole("combobox", { name: /^Set menu/ }).click();
  expect(page.getByRole("option", { name: /Daily menu|^Lunch$/ }).elements()).toHaveLength(0);
  await page.getByRole("option", { name: "Special menu" }).click();
  await page.getByRole("button", { name: "Copy dishes", exact: true }).click();
  expect(api.copySetMenuDishes).toHaveBeenCalledExactlyOnceWith("daily", "special");
  await expect
    .element(page.getByRole("textbox", { name: "Surcharge for Wine" }))
    .toHaveValue("2.00");
  await expect
    .element(
      page
        .getByRole("region", { name: "Starters" })
        .getByRole("cell", { name: "Soup", exact: true }),
    )
    .toBeVisible();
});

it("names the measured dish when a copy is refused and leaves the source selected", async () => {
  const { api } = await mountDishes(wineDetails);
  api.copySetMenuDishes.mockRejectedValue({
    code: "set_menu.dish_sold_by_measure",
    params: { productId: "turbot" },
  });
  await page.getByRole("button", { name: "Copy dishes from another set menu" }).click();
  await page.getByRole("combobox", { name: /^Set menu/ }).click();
  await page.getByRole("option", { name: "Special menu" }).click();
  const copy = page.getByRole("button", { name: "Copy dishes", exact: true });
  await copy.click();
  await expect
    .element(page.getByText("Turbot is sold by weight or measure", { exact: false }))
    .toBeVisible();
  await expect
    .element(page.getByRole("combobox", { name: /^Set menu.*Special menu/ }))
    .toBeVisible();
  await expect.element(copy).toBeEnabled();
});
