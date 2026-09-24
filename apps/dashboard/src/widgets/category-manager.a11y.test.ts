import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./category-manager.js";
import type { CategoryManager } from "./category-manager.js";
import type { CategorySummary } from "../api/client.js";

const categories: CategorySummary[] = [
  { id: "c1", name: { es: "Entrantes" }, image: null, color: null, parentId: null },
  { id: "c2", name: { es: "Postres" }, image: null, color: null, parentId: null },
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
