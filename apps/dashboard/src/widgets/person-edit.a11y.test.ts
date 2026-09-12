import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./person-edit.js";
import type { PersonEdit } from "./person-edit.js";
import type { PersonSummary } from "../api/client.js";

// Open the modal before running axe so its controls enter the accessibility tree.
// The themed host gives the contrast checks the same background as the dashboard.
const person: PersonSummary = {
  personId: "p1",
  displayName: "Ada",
  role: "manager",
  status: "active",
  hasPassword: true,
  hasTotp: false,
  email: null,
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("person-edit a11y (%s theme)", (theme) => {
  it("renders accessibly when open", async () => {
    const { el, host } = await mountWidget<PersonEdit>(
      "dashboard-person-edit",
      { person, open: true },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-modal")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    // The email field carries an accessible name from its wt-input label, so axe's label rule passes
    // and a screen-reader user hears "Email".
    const emailInput = el
      .shadowRoot!.querySelector("[data-test=edit-email]")!
      .shadowRoot!.querySelector<HTMLInputElement>("input")!;
    expect(emailInput.labels?.length).toBeGreaterThan(0);
    await expectNoA11yViolations(host);
  });
});
