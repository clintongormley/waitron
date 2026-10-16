import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { NUTRITION_ICONS, registerIcons, type WtIcon } from "./index.js";
import { cleanup, host } from "./test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "./a11y-helpers.js";

registerIcons(NUTRITION_ICONS);
afterEach(cleanup);

const labels = [
  ["allergen-gluten", "Gluten", "Gluten"],
  ["allergen-crustaceans", "Crustaceans", "Crustáceos"],
  ["allergen-eggs", "Eggs", "Huevos"],
  ["allergen-fish", "Fish", "Pescado"],
  ["allergen-peanuts", "Peanuts", "Cacahuetes"],
  ["allergen-soybeans", "Soybeans", "Soja"],
  ["allergen-milk", "Milk", "Leche"],
  ["allergen-nuts", "Nuts", "Frutos de cáscara"],
  ["allergen-celery", "Celery", "Apio"],
  ["allergen-mustard", "Mustard", "Mostaza"],
  ["allergen-sesame", "Sesame", "Sésamo"],
  ["allergen-sulphites", "Sulphites", "Sulfitos"],
  ["allergen-lupin", "Lupin", "Altramuces"],
  ["allergen-molluscs", "Molluscs", "Moluscos"],
  ["diet-vegan", "Vegan", "Vegano"],
  ["diet-vegetarian", "Vegetarian", "Vegetariano"],
  ["diet-halal", "Halal", "Halal"],
  ["diet-kosher", "Kosher", "Kosher"],
  ["diet-no_meat", "No meat", "Sin carne"],
  ["diet-no_fish", "No fish", "Sin pescado"],
  ["allergies", "Nutritional info", "Información nutricional"],
];

describe.each(["light", "dark"] as const)("nutrition icon accessibility (%s)", (theme) => {
  test.each(["en", "es"] as const)(
    "labelled glyphs at phone and desktop widths (%s)",
    async (locale) => {
      const original = [window.innerWidth, window.innerHeight];
      try {
        for (const width of [390, 1280]) {
          await page.viewport(width, 900);
          await mountThemed(
            `<ul lang="${locale}">${labels
              .map(
                ([name, en, es]) =>
                  `<li><wt-icon name="${name}"></wt-icon> ${locale === "en" ? en : es}</li>`,
              )
              .join("")}</ul>`,
            theme,
          );
          host.style.cssText =
            "background:var(--wt-color-bg);color:var(--wt-color-text);font-family:var(--wt-font-family);padding:var(--wt-space-4)";
          for (const icon of host.querySelectorAll<WtIcon>("wt-icon")) {
            await icon.updateComplete;
            expect(icon.shadowRoot!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
          }
          await expectNoA11yViolations(host);
          if (import.meta.env["VITE_NUTRITION_LOOK"] === "1") {
            await page.screenshot({
              path: `__screenshots__/nutrition-icons-look/${theme}-${locale}-${width}.png`,
            });
          }
          cleanup();
        }
      } finally {
        await page.viewport(original[0]!, original[1]!);
      }
    },
  );
});
