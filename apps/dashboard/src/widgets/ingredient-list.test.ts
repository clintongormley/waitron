import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { allergenStateName } from "../i18n/domain.js";
import type { Ingredient } from "../api/client.js";
import { IngredientList } from "./ingredient-list.js";

afterEach(cleanupWidgets);

/**
 * A representative ingredient carrying every field the list reads; individual tests override the one
 * field they exercise (allergens, name) via a spread so the fixture stays the single source for the
 * rest. Unlike a product, an ingredient has a single `name` string (no descriptions map) and a single
 * `allergens` declaration (no manual/published split).
 */
function ingredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: "ing-1",
    name: "Harina de trigo",
    allergens: null,
    active: true,
    ...overrides,
  };
}

describe("ingredient-list", () => {
  it("renders one wt-card row per ingredient", async () => {
    const ingredients = [
      ingredient({ id: "a", allergens: null }),
      ingredient({ id: "b", allergens: { eggs: { presence: "contains" } } }),
    ];
    const { el } = await mountWidget<IngredientList>("dashboard-ingredient-list", { ingredients });
    const rows = el.shadowRoot!.querySelectorAll("wt-card[data-test=row]");
    expect(rows.length).toBe(2);
  });

  it("shows the ingredient name", async () => {
    const { el } = await mountWidget<IngredientList>("dashboard-ingredient-list", {
      ingredients: [ingredient({ name: "Harina de trigo" })],
    });
    expect(el.shadowRoot!.querySelector("[data-test=row]")!.textContent).toContain(
      "Harina de trigo",
    );
  });

  // The three-state allergen invariant (design §7): null=PENDING, {}=none, {…}=declared. PENDING and
  // none MUST be distinguishable — a blank declaration must never silently claim "allergen-free".
  it("renders a PENDING allergen pill when allergens is null", async () => {
    const { el } = await mountWidget<IngredientList>("dashboard-ingredient-list", {
      ingredients: [ingredient({ allergens: null })],
    });
    const pill = el.shadowRoot!.querySelector<HTMLElement>("[data-test=allergen-state]")!;
    expect(pill.getAttribute("data-state")).toBe("pending");
    expect(pill.textContent!.trim().length).toBeGreaterThan(0);
  });

  it("renders a 'none' allergen pill when allergens is an empty map", async () => {
    const { el } = await mountWidget<IngredientList>("dashboard-ingredient-list", {
      ingredients: [ingredient({ allergens: {} })],
    });
    const pill = el.shadowRoot!.querySelector<HTMLElement>("[data-test=allergen-state]")!;
    expect(pill.getAttribute("data-state")).toBe("none");
  });

  it("renders a 'declared' allergen pill when allergens has entries", async () => {
    const { el } = await mountWidget<IngredientList>("dashboard-ingredient-list", {
      ingredients: [ingredient({ allergens: { eggs: { presence: "contains" } } })],
    });
    const pill = el.shadowRoot!.querySelector<HTMLElement>("[data-test=allergen-state]")!;
    expect(pill.getAttribute("data-state")).toBe("declared");
  });

  // The three states render through the i18n layer as three DISTINCT localised names (Pendiente /
  // Ninguno / Declarado), preserving the a11y "three different words, not colour alone" requirement.
  // `data-state` stays the raw token; only the pill's visible text is localised.
  it("renders each allergen-state pill with its localised name", async () => {
    const { el } = await mountWidget<IngredientList>("dashboard-ingredient-list", {
      ingredients: [
        ingredient({ id: "p", allergens: null }),
        ingredient({ id: "n", allergens: {} }),
        ingredient({ id: "d", allergens: { milk: { presence: "contains" } } }),
      ],
    });
    const pills = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=allergen-state]");
    expect(pills[0]!.textContent!.trim()).toBe(allergenStateName("pending", "es-ES"));
    expect(pills[1]!.textContent!.trim()).toBe(allergenStateName("none", "es-ES"));
    expect(pills[2]!.textContent!.trim()).toBe(allergenStateName("declared", "es-ES"));
    // PENDING and none are not the same rendered text (the whole point of the invariant).
    expect(pills[0]!.textContent).not.toBe(pills[1]!.textContent);
  });

  it("emits edit-ingredient with the ingredient id when a row's Edit control is clicked", async () => {
    const { el } = await mountWidget<IngredientList>("dashboard-ingredient-list", {
      ingredients: [ingredient({ id: "ing-42" })],
    });
    const detail = new Promise<{ id: string }>((resolve) =>
      el.addEventListener("edit-ingredient", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-ing-42]")!.click();
    expect((await detail).id).toBe("ing-42");
  });

  // edit-ingredient must escape this widget's shadow boundary to reach the recipe screen, so it is
  // dispatched bubbles+composed — pinned so a future edit does not quietly drop either flag.
  it("emits edit-ingredient as a bubbling, composed event", async () => {
    const { el } = await mountWidget<IngredientList>("dashboard-ingredient-list", {
      ingredients: [ingredient({ id: "ing-9" })],
    });
    const seen = new Promise<Event>((resolve) => el.addEventListener("edit-ingredient", resolve));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-ing-9]")!.click();
    const event = await seen;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("renders no rows for an empty ingredients list", async () => {
    const { el } = await mountWidget<IngredientList>("dashboard-ingredient-list", {
      ingredients: [],
    });
    expect(el.shadowRoot!.querySelectorAll("[data-test=row]").length).toBe(0);
  });
});
