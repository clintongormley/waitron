import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./category-manager.js";
import type { CategoryManager } from "./category-manager.js";
import type { CategorySummary } from "../api/client.js";

/**
 * The category manager owns a labelled create field (`wt-input`) + a button and lists categories. It
 * holds no `api`, so there is no in-flight fetch to settle. Mounted with `categories` assigned, in
 * both themes; axe runs against the themed host so a color-contrast check means what it means in the
 * app. The fixture is non-empty so the list surface (and its color-contrast) is exercised.
 */
const categories: CategorySummary[] = [
  { id: "c1", name: "Entrantes" },
  { id: "c2", name: "Postres" },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("category-manager a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<CategoryManager>(
      "dashboard-category-manager",
      { categories },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
