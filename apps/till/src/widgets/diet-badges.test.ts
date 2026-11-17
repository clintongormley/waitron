import { afterEach, describe, expect, it } from "vitest";
import { nothing, render } from "lit";
import { applyTokens } from "@waitron/ui";
import { currentLocale, t } from "../i18n/t.js";
import { allergenLabel, allergenName } from "../i18n/allergen-names.js";
import { dietBadgeStyles, dietBadges, extraNutrition } from "./diet-badges.js";
import { namedIcons, tokenColour } from "./test-helpers.js";

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

describe.each(["light", "dark"] as const)("diet colours (%s theme)", (theme) => {
  /** Draws inside a shadow root carrying the shared styles, as each host does, and returns the root. */
  function drawStyled(template: ReturnType<typeof dietBadges>): ShadowRoot {
    const host = document.createElement("div");
    host.setAttribute("data-theme", theme);
    document.body.append(host);
    hosts.push(host);
    applyTokens(host);
    const root = host.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [dietBadgeStyles.styleSheet!];
    render(template, root);
    return root;
  }

  it("paints a diet badge in the success colour and the pending note in the warning colour", () => {
    const root = drawStyled(
      dietBadges({ vegan: "yes", vegetarian: "unknown", contains: [] }, "line-diet"),
    );
    const success = tokenColour(root, "--wt-color-success");
    const warning = tokenColour(root, "--wt-color-warning");
    const text = tokenColour(root, "--wt-color-text");
    expect(success).not.toBe(text);
    expect(warning).not.toBe(text);
    expect(getComputedStyle(root.querySelector('[data-diet="vegan"]')!).color).toBe(success);
    expect(getComputedStyle(root.querySelector("[data-diet-pending]")!).color).toBe(warning);
  });
});
