import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./ingredient-form.js";
import type { IngredientForm } from "./ingredient-form.js";
import type { Ingredient } from "../api/client.js";

/**
 * The ingredient dialog only exposes anything to the accessibility tree once it is OPEN — a closed
 * <dialog> renders nothing to test — so it is mounted with `open = true` and its wt-dialog's first
 * render (which calls showModal) is settled before axe runs, in both themes. axe is run against the
 * themed host so a color-contrast check means what it means in the app.
 *
 * It is mounted into the RICHEST state: an edit of an ingredient whose allergens are DECLARED, so the
 * allergen picker's "Revisado" switch is ON and its 14 per-code controls are ENABLED — the surface a
 * PENDING (reviewed-off, disabled) picker would hide from axe. The surface axe sees: the dialog's
 * accessible name (its `heading`), the labelled `name` `wt-input`, the labelled `active` `wt-switch`,
 * the composed allergen-picker (its reviewed switch + enabled per-code selects and source inputs), and
 * the primary confirm control in the footer.
 */
const INGREDIENT: Ingredient = {
  id: "ing-1",
  name: "Leche entera",
  allergens: { milk: { presence: "contains", source: "vaca" } },
  active: false,
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("ingredient-form a11y (%s theme)", (theme) => {
  it("renders accessibly when open", async () => {
    const { el, host } = await mountWidget<IngredientForm>(
      "dashboard-ingredient-form",
      { open: true, ingredient: INGREDIENT },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const picker = el.shadowRoot!.querySelector("dashboard-allergen-picker")!;
    await (picker as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });
});
