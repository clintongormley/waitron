import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  applyNutritionChange,
  dietaryPresentation,
  nutritionAllergensForComparison,
  nutritionErrors,
} from "./product-nutrition.js";

const locale = currentLocale();
afterEach(() => setLocale(locale));

it("keeps null, explicit none and incomplete allergen codes distinct in draft comparisons", () => {
  expect(nutritionAllergensForComparison(null)).toBeNull();
  expect(nutritionAllergensForComparison({})).toEqual({});
  expect(nutritionAllergensForComparison({ gluten: {} })).toEqual({ gluten: {} });
  expect(nutritionAllergensForComparison({ gluten: { kinds: [] } })).toEqual({
    gluten: { kinds: [] },
  });
  expect(nutritionAllergensForComparison({ gluten: { kinds: ["wheat", "barley"] } })).toEqual({
    gluten: { kinds: ["barley", "wheat"] },
  });
});

it("changes only its named nutrition field and copies the supplied kind arrays", () => {
  const draft = { allergens: null, dietaryDeclarations: ["vegan" as const] };
  const allergens = { nuts: { kinds: ["walnuts" as const] } };
  const changed = applyNutritionChange(draft, { field: "allergens", value: allergens });
  expect(changed).toEqual({
    allergens: { nuts: { kinds: ["walnuts"] } },
    dietaryDeclarations: ["vegan"],
  });
  allergens.nuts.kinds.length = 0;
  expect(changed.allergens).toEqual({ nuts: { kinds: ["walnuts"] } });
  expect(draft).toEqual({ allergens: null, dietaryDeclarations: ["vegan"] });
  expect(
    applyNutritionChange(
      { allergens: {}, dietaryDeclarations: null },
      { field: "dietaryDeclarations", value: ["halal"] },
    ),
  ).toEqual({ allergens: {}, dietaryDeclarations: ["halal"] });
});

it("marks both missing kind groups and accepts null, none and valid declarations", () => {
  setLocale("en");
  expect(nutritionErrors({ gluten: {}, nuts: { kinds: [] } })).toEqual({
    "allergens-gluten": "Choose which cereals",
    "allergens-nuts": "Choose which nuts",
  });
  expect(nutritionErrors(null)).toEqual({});
  expect(nutritionErrors({})).toEqual({});
  expect(
    nutritionErrors({ gluten: { kinds: ["oats"] }, nuts: { kinds: ["almonds"] }, milk: {} }),
  ).toEqual({});
});

it("marks invalid kinds through the catalogue validator", () => {
  setLocale("en");
  expect(nutritionErrors({ milk: { kinds: ["wheat"] } })).toEqual({
    allergens: "Choose a valid cereal or nut",
  });
  expect(nutritionErrors({ nuts: { kinds: ["wheat"] } })).toEqual({
    allergens: "Choose a valid cereal or nut",
  });
});

it("shows vegan implications without adding them to declarations", () => {
  const own = ["vegan" as const];
  expect(dietaryPresentation(own, [])).toEqual({
    chosen: ["vegan"],
    inherited: false,
    implied: [
      { label: "vegetarian", from: "vegan" },
      { label: "no_meat", from: "vegan" },
      { label: "no_fish", from: "vegan" },
    ],
  });
  expect(own).toEqual(["vegan"]);
  expect(dietaryPresentation(["vegan", "vegetarian"], []).implied).toEqual([
    { label: "no_meat", from: "vegan" },
    { label: "no_fish", from: "vegan" },
  ]);
  expect(dietaryPresentation(["vegetarian"], []).implied).toEqual([
    { label: "no_meat", from: "vegetarian" },
    { label: "no_fish", from: "vegetarian" },
  ]);
});

it("keeps explicit empty diets distinct from inherited diets", () => {
  expect(dietaryPresentation([], ["halal"])).toEqual({ chosen: [], implied: [], inherited: false });
  expect(dietaryPresentation(null, ["halal"])).toEqual({
    chosen: ["halal"],
    implied: [],
    inherited: true,
  });
});
