import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./category-manager.js";
import type { CategoryManager } from "./category-manager.js";
import type { CategorySummary } from "../api/client.js";

/**
 * The category manager owns a labelled create field (`wt-input`) + a button, lists categories in the shared data table and has no in-flight fetch to settle. It is mounted in both themes so axe checks the same colour tokens as the app.
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
