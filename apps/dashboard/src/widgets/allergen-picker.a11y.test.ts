import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./allergen-picker.js";
import type { AllergenPicker } from "./allergen-picker.js";

/**
 * The picker is mounted and then its "Revisado" switch flipped ON before axe runs, so the RICHER
 * enabled surface — the 14 named per-code `<select>`s and their free-text `source` `wt-input`s — is
 * what axe sees (a superset of the disabled/PENDING state). Each control carries an accessible name
 * (the `<select>` an `aria-label`, the source input a `wt-input` label), and the whole thing is run
 * against the themed host in BOTH themes so a color-contrast check means what it means in the app.
 */
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("allergen-picker a11y (%s theme)", (theme) => {
  it("renders accessibly with the controls enabled", async () => {
    const { el, host } = await mountWidget<AllergenPicker>(
      "dashboard-allergen-picker",
      {},
      theme,
    );
    const sw = el.shadowRoot!.querySelector<HTMLElement>("[data-test=reviewed]")!;
    sw.dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
