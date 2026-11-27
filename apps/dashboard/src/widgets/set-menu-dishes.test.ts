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

it("shows Dish and Surcharge without a Course column or chooser", async () => {
  await mountDishes();
  const startersGroup = page.getByRole("region", { name: "Starters" });
  await expect.element(startersGroup.getByRole("columnheader", { name: "Dish" })).toBeVisible();
  await expect
    .element(startersGroup.getByRole("columnheader", { name: "Surcharge" }))
    .toBeVisible();
  expect(
    startersGroup.getByRole("columnheader", { name: "Course", exact: true }).elements(),
  ).toEqual([]);
  expect(page.getByRole("button", { name: "Customise columns" }).elements()).toEqual([]);
});

it("lets a manager edit Surcharge with a saved choice to hide it", async () => {
  const key = "waitron.menus.set-menu.dishes.starters:columns";
  localStorage.setItem(key, JSON.stringify({ surcharge: false }));
  onTestFinished(() => localStorage.removeItem(key));
  const { api } = await mountDishes();
  const surcharge = page.getByRole("textbox", { name: "Surcharge for Soup" });
  await expect.element(surcharge).toBeVisible();
  await surcharge.fill("2.50");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(api.updateMenuItem).toHaveBeenCalledExactlyOnceWith("daily", "soup-item", {
      grossPrice: "2.50",
    }),
  );
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

it("ignores Escape while a surcharge is being sent", async () => {
  const { api } = await mountDishes();
  const sharing = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  let answer!: () => void;
  api.updateMenuItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        answer = resolve;
      }),
  );
  await sharing.fill("5.25");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(answer).toBeDefined());
  await expect.element(sharing).toHaveAttribute("readonly");
  await userEvent.keyboard("{Escape}");
  await expect.element(sharing).toHaveValue("5.25");
  expect(api.updateMenuItem).toHaveBeenCalledTimes(1);
  api.readSetMenu.mockResolvedValue({
    ...details,
    dishes: [hake, { ...bravas, surcharge: "5.25" }, soup],
  });
  answer();
  await expect.element(sharing).not.toHaveAttribute("readonly");
  expect(api.updateMenuItem).toHaveBeenCalledTimes(1);
});

it("keeps a refused surcharge marked when another dish is removed", async () => {
  const { api } = await mountDishes();
  api.updateMenuItem.mockRejectedValueOnce({
    code: "set_menu.invalid",
    params: { field: "surcharge" },
  });
  const field = page.getByRole("textbox", { name: "Surcharge for Bravas" });
  await field.fill("4.00");
  await userEvent.keyboard("{Enter}");
  await expect.element(field).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Actions for Hake" }).click();
  api.readSetMenu.mockResolvedValue({ ...details, dishes: [bravas, soup] });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.element(page.getByRole("region", { name: "No course" })).not.toBeInTheDocument();
  await expect.element(field).toHaveAttribute("aria-invalid", "true");
  await expect.element(field).toHaveValue("4.00");
});
