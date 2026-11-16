import { afterEach, expect, it } from "vitest";
import { nothing, render } from "lit";
import { currentLocale, t } from "../i18n/t.js";
import { allergenLabel, allergenName } from "../i18n/allergen-names.js";
import { dietBadges, extraNutrition } from "./diet-badges.js";
import { namedIcons } from "./test-helpers.js";

const hosts: HTMLElement[] = [];
afterEach(() => hosts.splice(0).forEach((host) => host.remove()));

function draw(template: ReturnType<typeof dietBadges>): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(template, host);
  return host;
}

it("shows an extra's suitability badges alone when it declares no allergens", () => {
  const host = draw(extraNutrition({ suitableFor: ["vegan", "kosher"] }, "allergens-x", "diet-x"));
  expect(host.querySelector('[data-test="allergens-x"]')).toBeNull();
  const diet = host.querySelector('[data-test="diet-x"]')!;
  expect([...diet.querySelectorAll("[data-diet]")].map((b) => b.getAttribute("data-diet"))).toEqual(
    ["vegan", "kosher"],
  );
  expect(diet.textContent).toContain(t("diet.kosher"));
});

it("shows an extra's allergens alone when it declares no suitability", () => {
  const host = draw(extraNutrition({ addAllergens: { milk: {} } }, "allergens-x", "diet-x"));
  expect(host.querySelector('[data-test="diet-x"]')).toBeNull();
  expect(host.querySelector('[data-test="allergens-x"]')!.textContent).toContain(
    allergenName("milk", currentLocale()),
  );
  expect(host.querySelector(".allergen-chip")).not.toBeNull();
  expect(host.querySelector("wt-icon")).toBeNull();
});

it("draws an extra's allergens as large named icons when a kitchen screen asks", async () => {
  const host = draw(
    extraNutrition(
      { addAllergens: { gluten: { kinds: ["wheat"] }, milk: {} }, suitableFor: ["halal"] },
      "allergens-x",
      "diet-x",
      { icons: true },
    ),
  );
  const allergens = host.querySelector('[data-test="allergens-x"]')!;
  expect(await namedIcons(allergens)).toEqual([
    ["allergen-gluten", "img", allergenLabel("gluten", { kinds: ["wheat"] }, currentLocale())],
    ["allergen-milk", "img", allergenName("milk", currentLocale())],
  ]);
  for (const icon of allergens.querySelectorAll("wt-icon"))
    expect(icon.getAttribute("size")).toBe("lg");
  expect(host.querySelector(".allergen-chip")).toBeNull();
  expect(host.querySelector('[data-test="diet-x"] [data-diet="halal"]')).not.toBeNull();
});

it("adds no chrome for an extra declaring neither, ignoring a label outside the four", () => {
  expect(extraNutrition({ suitableFor: ["no_meat"], addAllergens: null }, "a", "d")).toBe(nothing);
});

it("adds no chrome for an extra declaring an empty set of allergens", () => {
  expect(extraNutrition({ addAllergens: {} }, "a", "d")).toBe(nothing);
});

it("shows a kosher badge the dish's profile asserts", () => {
  const host = draw(
    dietBadges({ vegan: "no", vegetarian: "no", kosher: "yes", contains: [] }, "line-diet"),
  );
  const row = host.querySelector('[data-test="line-diet"]')!;
  expect([...row.querySelectorAll("[data-diet]")].map((b) => b.getAttribute("data-diet"))).toEqual([
    "kosher",
  ]);
});

it("renders no row for a reviewed dish with no claim and nothing tagged", () => {
  expect(dietBadges({ vegan: "no", vegetarian: "no", contains: [] }, "line-diet")).toBe(nothing);
});
