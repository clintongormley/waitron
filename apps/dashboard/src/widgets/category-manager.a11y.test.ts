import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./category-manager.js";
import type { CategoryManager } from "./category-manager.js";
import type { CategorySummary, Station } from "../api/client.js";

/**
 * The category manager owns a labelled create field (`wt-input`) + a button, lists categories and, per
 * row, a labelled station-routing `<select>` (KDS-1). It holds no `api`, so there is no in-flight fetch
 * to settle. Mounted with `categories` + `stations` assigned, in both themes; axe runs against the
 * themed host so a color-contrast check means what it means in the app. The fixtures are non-empty so
 * the list + the token-styled routing select (and their color-contrast) are exercised.
 */
const categories: CategorySummary[] = [
  { id: "c1", name: "Entrantes" },
  { id: "c2", name: "Postres" },
];

const stations: Station[] = [
  { id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("category-manager a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<CategoryManager>(
      "dashboard-category-manager",
      { categories, stations },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
