import { afterEach, expect, it, onTestFinished, vi } from "vitest";
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

it("names a hidden surcharge error and remembers the hidden column on reopen", async () => {
  const key = "waitron.menus.set-menu.dishes.starters:columns";
  localStorage.removeItem(key);
  onTestFinished(() => localStorage.removeItem(key));
  const { el } = await mountDishes();
  await expect.element(page.getByRole("region", { name: "Starters" })).toBeVisible();
  const table = page.elementLocator(
    el
      .shadowRoot!.querySelector("dashboard-set-menu-dishes")!
      .shadowRoot!.querySelector('wt-data-table[aria-label="Starters"]')!,
  );
  const surcharge = page.getByRole("textbox", { name: "Surcharge for Soup" });
  await surcharge.fill("20000");
  await userEvent.keyboard("{Enter}");
  await expect.element(surcharge).toHaveAttribute("aria-invalid", "true");
  const chooser = table.getByRole("button", { name: "Customise columns" });
  await vi.waitFor(() => expect(chooser.element()).toBeVisible());
  await chooser.click();
  const hideSurcharge = page.getByRole("checkbox", { name: /Hide.*Surcharge/ });
  await expect.element(hideSurcharge).toBeChecked();
  await page.elementLocator(hideSurcharge.element().closest("label")!).click();
  await page.getByRole("button", { name: "Done" }).click();
  const actions = page.elementLocator(
    el
      .shadowRoot!.querySelector("dashboard-set-menu-dishes")!
      .shadowRoot!.querySelector("wt-form-actions")!,
  );
  const save = actions.getByRole("button", { name: "Save", exact: true });
  await expect
    .element(actions.getByRole("alert"))
    .toHaveTextContent("Your change to Soup was not saved.");
  await expect.element(save).toBeDisabled();

  cleanupWidgets();
  await mountDishes();
  await expect.element(page.getByRole("region", { name: "Starters" })).toBeVisible();
  expect(
    page
      .getByRole("region", { name: "Starters" })
      .getByRole("columnheader", { name: "Surcharge" })
      .elements(),
  ).toHaveLength(0);
  await expect
    .element(
      page
        .getByRole("region", { name: "Sharing plates" })
        .getByRole("columnheader", { name: "Surcharge" }),
    )
    .toBeVisible();
});

it("moves Bravas to Starters and explains both line changes, then restores its product course", async () => {
  const { api } = await mountDishes();
  const moved = { ...bravas, courseId: starters.id, courseOverrideId: starters.id };
  let finishMove!: () => void;
  api.saveSetMenuDishCourse
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishMove = () =>
            resolve({
              details: { ...details, dishes: [hake, moved, soup], lines: [starterLine] },
              addedLines: [starterLine],
              removedLines: [sharingLine],
            });
        }),
    )
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
  await page.getByRole("textbox", { name: "Surcharge for Bravas" }).fill("3.50");
  await choose("Starters");
  await expect.element(page.getByRole("combobox", { name: /^Course for Bravas/ })).toBeDisabled();
  finishMove();
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
  await expect
    .element(page.getByRole("textbox", { name: "Surcharge for Bravas" }))
    .toHaveValue("3.50");
  expect(api.updateMenuItem).not.toHaveBeenCalled();
});

it("leaves the next field focused if the manager moved on while a course change was saving", async () => {
  const { api } = await mountDishes();
  const moved = { ...bravas, courseId: starters.id, courseOverrideId: starters.id };
  let finishMove!: () => void;
  api.saveSetMenuDishCourse.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishMove = () => resolve({ details: { ...details, dishes: [hake, moved, soup] } });
      }),
  );
  const course = page.getByRole("combobox", { name: /^Course for Bravas/ });
  await course.click();
  await page.getByRole("option", { name: "Starters", exact: true }).click();
  await expect.element(course).toBeDisabled();
  const next = page.getByRole("textbox", { name: "Price per set menu" });
  await next.click();
  finishMove();

  await expect
    .element(
      page
        .getByRole("region", { name: "Starters" })
        .getByRole("cell", { name: "Bravas", exact: true }),
    )
    .toBeVisible();
  const field = next.element();
  expect((field.getRootNode() as ShadowRoot).activeElement === field).toBe(true);
});

it("shows Included while blank and stages clearing the surcharge until Save", async () => {
  const { el, api } = await mountDishes();
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
  expect(api.updateMenuItem).toHaveBeenCalledTimes(1);
  const dishes = page.elementLocator(el.shadowRoot!.querySelector("dashboard-set-menu-dishes")!);
  await dishes.getByRole("button", { name: "Save", exact: true }).click();
  await vi.waitFor(() =>
    expect(api.updateMenuItem).toHaveBeenNthCalledWith(2, "daily", "bravas-item", {
      grossPrice: null,
    }),
  );
});

it("saves two staged surcharges together and freezes editing until the refresh finishes", async () => {
  const { el, api } = await mountDishes();
  const dishes = page.elementLocator(el.shadowRoot!.querySelector("dashboard-set-menu-dishes")!);
  const save = dishes.getByRole("button", { name: "Save", exact: true });
  const cancel = dishes.getByRole("button", { name: "Cancel", exact: true });
  const starter = page.getByRole("textbox", { name: "Surcharge for Soup" });
  const sharing = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  await expect.element(save).toBeDisabled();
  const reads = api.readSetMenu.mock.calls.length;
  let release!: (value: typeof details) => void;
  api.readSetMenu.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await starter.fill("2.00");
  await sharing.fill("5.25");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(release).toBeDefined());
  expect(api.updateMenuItem).toHaveBeenCalledWith("daily", "soup-item", { grossPrice: "2.00" });
  expect(api.updateMenuItem).toHaveBeenCalledWith("daily", "bravas-item", { grossPrice: "5.25" });
  await expect.element(save).toBeDisabled();
  await expect.element(cancel).toBeDisabled();
  const field = sharing.element();
  const fieldRoot = field.getRootNode() as ShadowRoot;
  expect(fieldRoot.activeElement).toBe(field);
  await expect.element(sharing).toHaveAttribute("readonly");
  release({
    ...details,
    dishes: [hake, { ...bravas, surcharge: "5.25" }, { ...soup, surcharge: "2.00" }],
  });
  await expect.element(sharing).not.toHaveAttribute("readonly");
  expect(fieldRoot.activeElement).toBe(field);
  await expect.element(cancel).toBeDisabled();
  expect(api.readSetMenu).toHaveBeenCalledTimes(reads + 1);

  await starter.fill("4");
  await sharing.fill("");
  await cancel.click();
  await expect.element(starter).toHaveValue("2.00");
  await expect.element(sharing).toHaveValue("5.25");
  await expect.element(save).toBeDisabled();
  expect(api.updateMenuItem).toHaveBeenCalledTimes(2);
});

it("keeps only refused edits for a retry when the refresh also fails", async () => {
  const { el, api } = await mountDishes();
  const dishes = page.elementLocator(el.shadowRoot!.querySelector("dashboard-set-menu-dishes")!);
  const save = dishes.getByRole("button", { name: "Save", exact: true });
  const starter = page.getByRole("textbox", { name: "Surcharge for Soup" });
  const sharing = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  api.updateMenuItem
    .mockImplementationOnce(() => Promise.resolve())
    .mockRejectedValueOnce({
      code: "set_menu.invalid",
      params: { field: "surcharge" },
    });
  api.readSetMenu.mockRejectedValueOnce(new Error("offline"));
  await starter.fill("2");
  await sharing.fill("5.25");
  await save.click();
  await expect.element(starter).toHaveAttribute("aria-invalid", "true");
  await expect.element(sharing).toHaveValue("5.25");
  await expect.element(dishes.getByRole("button", { name: "Try again" })).toBeVisible();
  api.readSetMenu.mockResolvedValue({
    ...details,
    dishes: [hake, { ...bravas, surcharge: "5.25" }, { ...soup, surcharge: "2.00" }],
  });
  await save.click();
  await expect.element(save).toBeDisabled();
  await expect.element(starter).not.toHaveAttribute("aria-invalid", "true");
  expect(api.updateMenuItem.mock.calls).toEqual([
    ["daily", "bravas-item", { grossPrice: "5.25" }],
    ["daily", "soup-item", { grossPrice: "2" }],
    ["daily", "soup-item", { grossPrice: "2" }],
  ]);
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

  const count = lineForm.getByRole("spinbutton", { name: "Number of dishes" }).first();
  await count.fill("1");
  await expect.element(lineForm.getByRole("button", { name: "Save" })).toBeDisabled();
  await count.fill("2");
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

it("refuses a surcharge above the limit beside its row and sends nothing", async () => {
  const { api } = await mountDishes();
  const field = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  await field.fill("20000");
  await expect.element(field).not.toHaveAttribute("aria-invalid", "true");
  await userEvent.keyboard("{Enter}");
  await expect.element(field).toHaveAttribute("aria-invalid", "true");
  await expect.element(page.getByText("Enter a surcharge from 0.00 to 10,000.00.")).toBeVisible();
  expect(api.updateMenuItem).not.toHaveBeenCalled();
});

it("sends nothing for a surcharge that matches the saved one, then saves a real change", async () => {
  const { api } = await mountDishes({ ...wineDetails, dishes: [wine, bravas] });
  const wineField = page.getByRole("textbox", { name: "Surcharge for Wine" });
  await wineField.fill("2");
  await userEvent.keyboard("{Enter}");
  const bravasField = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  await bravasField.fill("3");
  await bravasField.fill("");
  await userEvent.keyboard("{Enter}");
  await wineField.fill("2.50");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(api.updateMenuItem).toHaveBeenCalled());
  expect(api.updateMenuItem).toHaveBeenCalledExactlyOnceWith("daily", "wine-item", {
    grossPrice: "2.50",
  });
});

it("shows a surcharge refusal that names no surcharge field as an alert, not on the row", async () => {
  const { api } = await mountDishes();
  api.updateMenuItem.mockRejectedValueOnce({ code: "set_menu.not_found" });
  const field = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  await field.fill("4.00");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("That set menu could not be found.");
  await expect.element(field).not.toHaveAttribute("aria-invalid", "true");
});

it("sends nothing when a dish's current course is picked again", async () => {
  const { api } = await mountDishes();
  const moved = { ...bravas, courseId: starters.id, courseOverrideId: starters.id };
  api.saveSetMenuDishCourse.mockResolvedValue({
    details: { ...details, dishes: [hake, moved, soup] },
  });
  const course = page.getByRole("combobox", { name: /^Course for Bravas/ });
  await course.click();
  await page
    .getByRole("option", { name: "Sharing plates (from the product)", exact: true })
    .click();
  await course.click();
  await page.getByRole("option", { name: "Starters", exact: true }).click();
  await vi.waitFor(() => expect(api.saveSetMenuDishCourse).toHaveBeenCalled());
  expect(api.saveSetMenuDishCourse).toHaveBeenCalledExactlyOnceWith(
    "daily",
    "bravas-item",
    "starters",
  );
});

it("puts a refused course under its row, and any other course refusal in an alert", async () => {
  const { api } = await mountDishes();
  api.saveSetMenuDishCourse
    .mockRejectedValueOnce({ code: "set_menu.invalid", params: { field: "courseId" } })
    .mockRejectedValueOnce({ code: "set_menu.not_found" });
  const course = page.getByRole("combobox", { name: /^Course for Bravas/ });
  await course.click();
  await page.getByRole("option", { name: "Starters", exact: true }).click();
  await expect.element(course).toHaveAttribute("aria-invalid", "true");
  await expect.element(page.getByText("Choose a course that is still available.")).toBeVisible();
  expect(page.getByRole("alert").elements()).toHaveLength(0);

  await course.click();
  await page.getByRole("option", { name: "Starters", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("That set menu could not be found.");
  await expect.element(course).not.toHaveAttribute("aria-invalid", "true");
});

it("keeps a dish whose removal is refused and says why", async () => {
  const { api } = await mountDishes();
  api.removeSectionMember.mockRejectedValueOnce({ code: "set_menu.not_found" });
  const reads = api.readSetMenu.mock.calls.length;
  await page.getByRole("button", { name: "Actions for Hake" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("That set menu could not be found.");
  await expect.element(page.getByRole("region", { name: "No course" })).toBeVisible();
  expect(api.readSetMenu).toHaveBeenCalledTimes(reads);
});

it("omits a removed dish from a queued Save even when the removal refresh fails", async () => {
  const { el, api } = await mountDishes();
  const dishes = page.elementLocator(el.shadowRoot!.querySelector("dashboard-set-menu-dishes")!);
  const save = dishes.getByRole("button", { name: "Save", exact: true });
  let finishRemove!: () => void;
  api.removeSectionMember.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRemove = () => resolve(undefined);
      }),
  );
  api.readSetMenu
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ...details, dishes: [bravas, { ...soup, surcharge: "2.00" }] });

  await page.getByRole("textbox", { name: "Surcharge for Hake" }).fill("4.00");
  await page.getByRole("textbox", { name: "Surcharge for Soup" }).fill("2.00");
  await page.getByRole("button", { name: "Actions for Hake" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await vi.waitFor(() => expect(finishRemove).toBeDefined());
  await save.click();
  finishRemove();
  await expect.element(page.getByRole("region", { name: "No course" })).not.toBeInTheDocument();
  expect(api.updateMenuItem).toHaveBeenCalledExactlyOnceWith("daily", "soup-item", {
    grossPrice: "2.00",
  });
});

it("offers Try again when the set menu cannot be read after a removal", async () => {
  const { api } = await mountDishes();
  api.readSetMenu.mockRejectedValueOnce(new Error("offline"));
  const reads = api.readSetMenu.mock.calls.length;
  await page.getByRole("button", { name: "Actions for Hake" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("The set menu could not be loaded.");
  await expect.element(page.getByRole("region", { name: "No course" })).toBeVisible();

  api.readSetMenu.mockResolvedValueOnce({ ...details, dishes: [bravas, soup] });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.element(page.getByRole("region", { name: "No course" })).not.toBeInTheDocument();
  expect(page.getByRole("alert").elements()).toHaveLength(0);
  expect(api.readSetMenu).toHaveBeenCalledTimes(reads + 2);
});
