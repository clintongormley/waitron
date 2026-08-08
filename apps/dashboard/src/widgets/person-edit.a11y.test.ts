import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./person-edit.js";
import type { PersonEdit } from "./person-edit.js";
import type { PersonSummary } from "../api/client.js";

/**
 * The edit dialog only exposes anything to the accessibility tree once it is OPEN — a closed <dialog>
 * renders nothing — so it is mounted with a person and `open = true`, its wt-dialog's first render
 * (which calls showModal) settled before axe runs, in both themes. axe runs against the themed host so
 * a color-contrast check means what it means in the app.
 *
 * The rendered surface axe sees: the dialog's accessible name (from its `heading`), the labelled role
 * `<select>` and its save button, the status toggle, and the two labelled `wt-input` fields (PIN,
 * password) each with their save button.
 */
const person: PersonSummary = {
  personId: "p1",
  displayName: "Ada",
  role: "manager",
  status: "active",
  hasPassword: true,
  hasTotp: false,
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("person-edit a11y (%s theme)", (theme) => {
  it("renders accessibly when open", async () => {
    const { el, host } = await mountWidget<PersonEdit>(
      "dashboard-person-edit",
      { person, open: true },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });
});
