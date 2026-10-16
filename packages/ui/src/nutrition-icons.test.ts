import { afterEach, describe, expect, test } from "vitest";
import * as ui from "./index.js";
import { cleanup, host, mount } from "./test-helpers.js";

const names = [
  "allergen-gluten",
  "allergen-crustaceans",
  "allergen-eggs",
  "allergen-fish",
  "allergen-peanuts",
  "allergen-soybeans",
  "allergen-milk",
  "allergen-nuts",
  "allergen-celery",
  "allergen-mustard",
  "allergen-sesame",
  "allergen-sulphites",
  "allergen-lupin",
  "allergen-molluscs",
  "diet-vegan",
  "diet-vegetarian",
  "diet-halal",
  "diet-kosher",
  "diet-no_meat",
  "diet-no_fish",
  "allergies",
];

afterEach(cleanup);

describe.each(["light", "dark"])("nutrition icons (%s)", (theme) => {
  test("every nutrition code draws a distinct, contained glyph using the theme text token", async () => {
    ui.registerIcons(ui.NUTRITION_ICONS);
    const paths = new Set<string>();
    for (const name of names) {
      const icon = await mount(`<wt-icon name="${name}"></wt-icon>`);
      host.dataset.theme = theme;
      host.style.color = "var(--wt-color-text)";
      const path = icon.shadowRoot!.querySelector("path");
      expect(path, name).not.toBeNull();
      const glyph = path as SVGPathElement;
      paths.add(glyph.getAttribute("d")!);
      const box = glyph.getBBox();
      expect(box.width, name).toBeGreaterThan(3);
      expect(box.height, name).toBeGreaterThan(3);
      expect(box.x, name).toBeGreaterThanOrEqual(-0.01);
      expect(box.y, name).toBeGreaterThanOrEqual(-0.01);
      expect(box.x + box.width, name).toBeLessThanOrEqual(16.01);
      expect(box.y + box.height, name).toBeLessThanOrEqual(16.01);
      expect(getComputedStyle(glyph).fill, name).toBe(getComputedStyle(host).color);
    }
    expect(paths.size).toBe(names.length);
  });
});
