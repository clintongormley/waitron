import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { AllergenPicker } from "./allergen-picker.js";
import { AllergenDietaryPicker } from "./allergen-dietary-picker.js";

// Losing a kind during seeding or rebuilding a declaration must change these exact saved values.
afterEach(cleanupWidgets);

it("retains every cereal and nut kind when a declaration is reopened", async () => {
  const declaration: NonNullable<AllergenPicker["declaration"]> = {
    gluten: { kinds: ["wheat", "barley"] },
    nuts: { kinds: ["walnuts"] },
    milk: {},
  };
  const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
    declaration: structuredClone(declaration),
  });
  expect(el.value).toEqual({
    gluten: { kinds: ["wheat", "barley"] },
    nuts: { kinds: ["walnuts"] },
    milk: {},
  });
  expect(el.shadowRoot!.querySelector("[data-test^=presence-]")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("Trigo");
  expect(el.shadowRoot!.textContent).toContain("Cebada");
});

it("offers specific kinds without preselecting a cereal or nut", async () => {
  const { el } = await mountWidget<AllergenPicker>("dashboard-allergen-picker", {
    declaration: {},
  });
  const changes: unknown[] = [];
  el.addEventListener("wt-allergens-change", (e) => changes.push((e as CustomEvent).detail.value));
  const add = async (choice: string) => {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
    await el.updateComplete;
    const button = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="choose-${choice}"]`);
    expect(button, `choice ${choice}`).not.toBeNull();
    button!.click();
    await el.updateComplete;
  };
  await add("gluten:wheat");
  await add("gluten:barley");
  await add("nuts:walnuts");
  expect(changes).toEqual([
    { gluten: { kinds: ["wheat"] } },
    { gluten: { kinds: ["wheat", "barley"] } },
    { gluten: { kinds: ["wheat", "barley"] }, nuts: { kinds: ["walnuts"] } },
  ]);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-gluten:wheat"]')!.click();
  await el.updateComplete;
  expect(el.value).toEqual({ gluten: { kinds: ["barley"] }, nuts: { kinds: ["walnuts"] } });
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-gluten:barley"]')!.click();
  await el.updateComplete;
  expect(el.value).toEqual({ nuts: { kinds: ["walnuts"] } });
});

it("lets a product choose each cereal and nut separately", async () => {
  const { el } = await mountWidget<AllergenDietaryPicker>("dashboard-allergen-dietary-picker", {
    value: { allergens: ["gluten:wheat", "gluten:barley"], dietary: [] },
  });
  expect(el.shadowRoot!.querySelector('[data-test="allergens-summary"]')!.textContent).toContain(
    "Trigo",
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="allergens-line"]')!.click();
  await el.updateComplete;
  const box =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[data-test="allergens"]')!;
  expect(box.options).toContainEqual({
    value: "nuts:walnuts",
    label: "Frutos de cáscara (Nueces)",
  });
  expect(box.options.some((o) => o.value === "gluten" || o.value === "nuts")).toBe(false);
});

it("rebuilds kinds without duplicates or sharing mutable arrays", async () => {
  const { allergenChoices, allergensFromChoices } = await import("./allergen-choices.js");
  const input: NonNullable<AllergenPicker["declaration"]> = {
    gluten: { kinds: ["wheat", "barley"] },
    milk: {},
  };
  const choices = allergenChoices(input);
  expect(choices).toEqual(["gluten:wheat", "gluten:barley", "milk"]);
  const result = allergensFromChoices([
    ...choices,
    "gluten:wheat",
    "nuts:walnuts",
    "gluten",
    "milk:wheat",
    "unknown",
  ]);
  expect(result).toEqual({
    gluten: { kinds: ["wheat", "barley"] },
    milk: {},
    nuts: { kinds: ["walnuts"] },
  });
  result.gluten!.kinds!.push("oats");
  expect(input).toEqual({ gluten: { kinds: ["wheat", "barley"] }, milk: {} });
  expect(allergenChoices(null)).toEqual([]);
});
