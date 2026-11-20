import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useLocale } from "../testing/locale-setup.js";
import { cleanupWidgets } from "./test-helpers.js";
import {
  details,
  mountDishes as mountEditor,
  wine,
  wineDetails,
} from "./set-menu-dishes.test-fixture.js";

useLocale("en-GB");
afterEach(cleanupWidgets);

type Editor = HTMLElementTagNameMap["dashboard-set-menu-editor"];
let editor: Editor;
const choices = () =>
  page.elementLocator(
    editor
      .shadowRoot!.querySelector("dashboard-set-menu-dishes")!
      .shadowRoot!.querySelector("dashboard-set-menu-dish-choices")!,
  );
const choicesModal = () => choices().element().shadowRoot!.querySelector("wt-modal")!;
const addDialog = () => page.getByRole("dialog", { name: "Add products" });
const variantsDialog = () => page.getByRole("dialog", { name: "Variants for Wine" });

async function mountDishes(initial = details) {
  const mounted = await mountEditor(initial);
  editor = mounted.el;
  return mounted;
}

async function openAdd() {
  await vi.waitFor(() =>
    expect(page.getByRole("button", { name: "Add products", exact: true }).element()).toBeVisible(),
  );
  await page.getByRole("button", { name: "Add products", exact: true }).click();
  await expect.element(addDialog()).toBeVisible();
}

async function openVariants() {
  await vi.waitFor(() =>
    expect(page.getByRole("button", { name: "Edit variants for Wine" }).element()).toBeVisible(),
  );
  await page.getByRole("button", { name: "Edit variants for Wine" }).click();
  await expect.element(variantsDialog()).toBeVisible();
}

it("offers Try again when the products to add cannot be loaded", async () => {
  const { api } = await mountDishes();
  api.listLibraryProducts.mockRejectedValueOnce(new Error("offline"));
  await openAdd();
  await expect
    .element(choices().getByRole("alert"))
    .toHaveTextContent("The products could not be loaded. Try again.");
  expect(page.getByRole("checkbox", { name: "Wine" }).elements()).toHaveLength(0);

  await choices().getByRole("button", { name: "Try again" }).click();
  await expect.element(page.getByRole("checkbox", { name: "Wine" })).toBeVisible();
  expect(choices().getByRole("alert").elements()).toHaveLength(0);
  expect(api.listLibraryProducts).toHaveBeenCalledTimes(2);
});

it("asks about variants only for products that have them, and a re-ticked variant stays in", async () => {
  const { api } = await mountDishes();
  api.addSetMenuDishes.mockResolvedValue({ details: wineDetails, addedLines: [] });
  await openAdd();
  await page.getByRole("checkbox", { name: "Wine" }).click();
  await page.getByRole("checkbox", { name: "Coffee" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  const groups = choices().getByRole("group");
  await expect.element(groups.getByText("Wine", { exact: true })).toBeVisible();
  expect(groups.getByText("Coffee", { exact: true }).elements()).toHaveLength(0);

  const bottle = page.getByRole("checkbox", { name: "Bottle" });
  await bottle.click();
  await expect.element(bottle).not.toBeChecked();
  await bottle.click();
  await expect.element(bottle).toBeChecked();
  await page.getByRole("button", { name: "Add products", exact: true }).last().click();
  expect(api.addSetMenuDishes).toHaveBeenCalledExactlyOnceWith("daily", [
    { productId: "wine", excludedVariantIds: [] },
    { productId: "coffee", excludedVariantIds: [] },
  ]);
});

it("goes Back from the variant step to the product list without adding anything", async () => {
  const { api } = await mountDishes();
  await openAdd();
  await page.getByRole("checkbox", { name: "Wine" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  await expect.element(page.getByRole("checkbox", { name: "Glass" })).toBeVisible();

  await choices().getByRole("button", { name: "Back" }).click();
  await expect.element(page.getByRole("checkbox", { name: "Glass" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Add selected" })).toBeVisible();
  expect(api.addSetMenuDishes).not.toHaveBeenCalled();
});

it("closes the add dialog on Cancel without adding anything", async () => {
  const { api } = await mountDishes();
  await openAdd();
  await expect.element(page.getByRole("checkbox", { name: "Wine" })).toBeVisible();
  await choices().getByRole("button", { name: "Cancel" }).click();
  await expect.element(addDialog()).not.toBeInTheDocument();
  expect(api.addSetMenuDishes).not.toHaveBeenCalled();
});

it("stays open on Escape while the chosen dishes are being added", async () => {
  const { api } = await mountDishes();
  let finish!: () => void;
  api.addSetMenuDishes.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ details: { ...details, dishes: [...details.dishes] } });
      }),
  );
  await openAdd();
  await page.getByRole("checkbox", { name: "Turbot" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  await vi.waitFor(() => expect(api.addSetMenuDishes).toHaveBeenCalled());

  const requestClose = vi.spyOn(choicesModal(), "requestClose");
  await userEvent.keyboard("{Escape}");
  expect(requestClose).toHaveBeenCalledExactlyOnceWith("escape");
  await expect(requestClose.mock.results[0]!.value).resolves.toBe(false);
  await expect.element(addDialog()).toBeVisible();
  finish();
  await expect.element(addDialog()).not.toBeInTheDocument();
});

it("adds the dishes once when Add products is pressed twice before it redraws", async () => {
  const { api } = await mountDishes();
  api.addSetMenuDishes.mockResolvedValue({ details: wineDetails, addedLines: [] });
  await openAdd();
  await page.getByRole("checkbox", { name: "Wine" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  const add = page.getByRole("button", { name: "Add products", exact: true }).last();
  await expect.element(add).toBeEnabled();
  const button = add.element() as HTMLElement;
  button.click();
  button.click();
  await expect.element(addDialog()).not.toBeInTheDocument();
  expect(api.addSetMenuDishes).toHaveBeenCalledExactlyOnceWith("daily", [
    { productId: "wine", excludedVariantIds: [] },
  ]);
});

it("marks an over-limit variant surcharge and holds Save until it is fixed", async () => {
  const { api } = await mountDishes({ ...wineDetails, dishes: [{ ...wine, surcharge: null }] });
  await openVariants();
  const glass = choices().getByRole("textbox", { name: "Surcharge for Glass" });
  await expect.element(glass).toHaveAttribute("placeholder", "Included");
  await glass.fill("20000");
  await expect.element(glass).toHaveAttribute("aria-invalid", "true");
  await expect
    .element(choices().getByText("Check the marked surcharges before saving."))
    .toBeVisible();
  const save = choices().getByRole("button", { name: "Save", exact: true });
  await expect.element(save).toBeDisabled();
  await glass.fill("1.00");
  await expect.element(save).toBeEnabled();
  expect(api.saveSetMenuVariantChoices).not.toHaveBeenCalled();
});

it("keeps the variants dialog open with the server's refusal and sends a blank surcharge as none", async () => {
  const { api } = await mountDishes(wineDetails);
  api.saveSetMenuVariantChoices.mockRejectedValueOnce({ code: "set_menu.not_found" });
  await openVariants();
  const bottle = choices().getByRole("switch", { name: "Include Bottle" });
  (bottle.element() as HTMLInputElement).focus();
  await userEvent.keyboard(" ");
  await expect.element(bottle).not.toBeChecked();
  await choices().getByRole("button", { name: "Save", exact: true }).click();
  expect(api.saveSetMenuVariantChoices).toHaveBeenCalledExactlyOnceWith("daily", "wine-item", [
    { variantId: "glass", included: true, surcharge: null },
    { variantId: "bottle", included: false, surcharge: null },
  ]);
  await expect
    .element(choices().getByText("That set menu could not be found.", { exact: false }))
    .toBeVisible();
  await expect.element(bottle).not.toBeChecked();
});

it("saves the variant choices once when Save is pressed twice before it redraws", async () => {
  const { api } = await mountDishes(wineDetails);
  api.saveSetMenuVariantChoices.mockResolvedValue(wineDetails);
  await openVariants();
  const bottle = choices().getByRole("switch", { name: "Include Bottle" });
  (bottle.element() as HTMLInputElement).focus();
  await userEvent.keyboard(" ");
  const save = choices().getByRole("button", { name: "Save", exact: true });
  await expect.element(save).toBeEnabled();
  const button = save.element() as HTMLElement;
  button.click();
  button.click();
  await expect.element(variantsDialog()).not.toBeInTheDocument();
  expect(api.saveSetMenuVariantChoices).toHaveBeenCalledExactlyOnceWith("daily", "wine-item", [
    { variantId: "glass", included: true, surcharge: null },
    { variantId: "bottle", included: false, surcharge: null },
  ]);
});

it("closes the variants dialog on Cancel without saving", async () => {
  const { api } = await mountDishes(wineDetails);
  await openVariants();
  await choices().getByRole("button", { name: "Cancel" }).click();
  await expect.element(variantsDialog()).not.toBeInTheDocument();
  expect(api.saveSetMenuVariantChoices).not.toHaveBeenCalled();
});
