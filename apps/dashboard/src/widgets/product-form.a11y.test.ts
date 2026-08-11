import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./product-form.js";
import type { CategorySummary, ProductForm } from "./product-form.js";

/**
 * The product dialog only exposes anything to the accessibility tree once it is OPEN — a closed
 * <dialog> renders nothing to test — so it is mounted with `open = true` and its wt-dialog's first
 * render (which calls showModal) is settled before axe runs, in both themes. axe is run against the
 * themed host so a color-contrast check means what it means in the app.
 *
 * The surface axe sees: the dialog's accessible name (its `heading`), the labelled description /
 * price `wt-input`s, the labelled VAT / pricing-unit / category `<select>`s, the labelled `active`
 * `wt-switch`, and the composed allergen-picker + image-upload children (each with its own labelled
 * controls), plus the primary confirm control in the footer.
 */
afterEach(cleanupWidgets);

const CATEGORIES: CategorySummary[] = [{ id: "cat-1", name: "Bebidas" }];

describe.each(["light", "dark"] as const)("product-form a11y (%s theme)", (theme) => {
  it("renders accessibly when open", async () => {
    const { el, host } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      { open: true, catalogueId: "cat-1", categories: CATEGORIES },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });
});
