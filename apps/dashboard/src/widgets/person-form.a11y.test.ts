import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./person-form.js";
import type { PersonForm } from "./person-form.js";

// Open the modal before running axe so its controls enter the accessibility tree.
// The themed host gives the contrast checks the same background as the dashboard.
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("person-form a11y (%s theme)", (theme) => {
  it("renders accessibly when open", async () => {
    const { el, host } = await mountWidget<PersonForm>(
      "dashboard-person-form",
      { open: true },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-modal")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    // The email field carries an accessible name from its wt-input label (the <label for>/<input id>
    // pair in wt-input's shadow), so axe's label rule passes and a screen-reader user hears "Email".
    const emailInput = el
      .shadowRoot!.querySelector("[data-test=email]")!
      .shadowRoot!.querySelector<HTMLInputElement>("input")!;
    expect(emailInput.labels?.length).toBeGreaterThan(0);
    await expectNoA11yViolations(host);
  });
});
