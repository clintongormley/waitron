import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { AllergenPicker } from "./allergen-picker.js";
import { allergenName } from "../i18n/domain.js";

afterEach(cleanupWidgets);

it("shows only selected allergens without source authoring", async () => {
  const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
    declaration: { milk: { presence: "may_contain", source: "old recorded text" } },
  });
  expect(el.shadowRoot!.querySelectorAll("[data-test^=presence-]")).toHaveLength(1);
  expect(el.shadowRoot!.querySelector("[data-test^=source-]")).toBeNull();
  expect(el.value).toEqual({ milk: { presence: "may_contain" } });
});

it("searches unselected allergens, adds once, and removes back to reviewed none", async () => {
  const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
    declaration: {},
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
  await el.updateComplete;
  const search = el.shadowRoot!.querySelector<HTMLElement>("[data-test=allergen-search]")!;
  search.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: allergenName("milk") },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("[data-test^=choose-]")).toHaveLength(1);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-milk]")!.click();
  await el.updateComplete;
  expect(el.value).toEqual({ milk: { presence: "contains" } });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=choose-milk]")).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-allergen]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-milk]")!.click();
  await el.updateComplete;
  expect(el.value).toEqual({});
  expect(el.shadowRoot!.querySelectorAll("[data-test^=presence-]")).toHaveLength(0);
});

it("keeps a reopened picker open when the previous native dialog delivers its close event", async () => {
  const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
    declaration: {},
  });
  const add = el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!;
  add.click();
  await el.updateComplete;
  const previous = el.shadowRoot!.querySelector("wt-dialog")!;
  await previous.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-allergen]")!.click();
  await el.updateComplete;
  await previous.updateComplete;
  add.click();
  await el.updateComplete;
  previous.shadowRoot!.querySelector("dialog")!.dispatchEvent(new Event("close"));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=allergen-search]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
});
