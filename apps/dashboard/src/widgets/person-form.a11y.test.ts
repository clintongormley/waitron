import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./person-form.js";
import type { PersonForm } from "./person-form.js";

/**
 * The create dialog only exposes anything to the accessibility tree once it is OPEN — a closed
 * <dialog> renders nothing to test — so it is mounted with `open = true` and its wt-dialog's first
 * render (which calls showModal) is settled before axe runs, in both themes. axe is run against the
 * themed host so a color-contrast check means what it means in the app.
 *
 * The rendered surface axe sees: the dialog's accessible name (from its `heading`), the two labelled
 * `wt-input` fields (display name, PIN), the labelled role `<select>`, and the primary confirm
 * control in the footer.
 */
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("person-form a11y (%s theme)", (theme) => {
  it("renders accessibly when open", async () => {
    const { el, host } = await mountWidget<PersonForm>(
      "dashboard-person-form",
      { open: true },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });
});
