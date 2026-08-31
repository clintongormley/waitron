import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./product-form.js";
import type { CategorySummary, ProductForm } from "./product-form.js";
import type { OptionGroup, Product, Station } from "../api/client.js";

/**
 * The product dialog only exposes anything to the accessibility tree once it is OPEN — a closed
 * <dialog> renders nothing to test — so it is mounted with `open = true` and its wt-dialog's first
 * render (which calls showModal) is settled before axe runs, in both themes. axe is run against the
 * themed host so a color-contrast check means what it means in the app.
 *
 * The surface axe sees: the dialog's accessible name (its `heading`), the labelled description /
 * price `wt-input`s, the labelled VAT / pricing-unit / category `<select>`s, the labelled `active`
 * `wt-switch`, and the composed allergen-picker + image-upload children (each with its own labelled
 * controls), plus the primary confirm control in the footer. The EDIT-mode scan additionally exercises
 * the labelled station-override `<select>` (KDS-1), which renders only when a product is passed.
 */
afterEach(cleanupWidgets);

const CATEGORIES: CategorySummary[] = [{ id: "cat-1", name: "Bebidas" }];

const STATIONS: Station[] = [
  { id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
];

const OPTION_GROUPS: OptionGroup[] = [
  {
    id: "og1",
    name: { es: "Tamaño" },
    minSelect: 1,
    maxSelect: 1,
    required: true,
    sort: 0,
    active: true,
  },
  {
    id: "og2",
    name: { es: "Extras" },
    minSelect: 0,
    maxSelect: 3,
    required: false,
    sort: 1,
    active: true,
  },
];

const EDIT_PRODUCT: Product = {
  id: "prod-1",
  catalogueId: "cat-1",
  categoryId: "cat-1",
  descriptions: { es: "Té verde" },
  pricingUnit: "each",
  unitPrice: "1.20",
  vatClass: "reduced",
  active: true,
  allergens: null,
  manualAllergens: null,
  image: null,
};

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

  it("renders accessibly in edit mode with the station-override select", async () => {
    const { el, host } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      {
        open: true,
        catalogueId: "cat-1",
        categories: CATEGORIES,
        stations: STATIONS,
        product: EDIT_PRODUCT,
      },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });

  // Exercises the option-group attach section's picker + one attached row's ↑/↓/Remove controls
  // (Task 12) — a partially-full attach list (one of two groups picked) so the picker also renders.
  it("renders accessibly with an option group attached", async () => {
    const { el, host } = await mountWidget<ProductForm>(
      "dashboard-product-form",
      {
        open: true,
        catalogueId: "cat-1",
        categories: CATEGORIES,
        optionGroups: OPTION_GROUPS,
        attachedGroupIds: ["og1"],
      },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });
});
