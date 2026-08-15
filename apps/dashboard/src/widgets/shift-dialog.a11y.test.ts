import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./shift-dialog.js";
import type { ShiftDialog } from "./shift-dialog.js";
import type { Shift } from "../api/client.js";

/**
 * The shift dialog only exposes anything to the accessibility tree once it is OPEN — a closed
 * <dialog> renders nothing to test — so it is mounted with `open = true` and its wt-dialog's first
 * render (which calls showModal) is settled before axe runs, in both themes and in both shapes: an
 * ADD (shift null, blank fields, no Remove button) and an EDIT (shift set, pre-filled + a Remove
 * button). axe is run against the themed host so a color-contrast check means what it means in the app.
 */
afterEach(cleanupWidgets);

const shift: Shift = {
  id: "s1",
  personId: "p1",
  locationId: "loc-1",
  startsAt: "2026-03-02T09:00:00Z",
  startsOffsetMinutes: 0,
  endsAt: "2026-03-02T13:00:00Z",
  endsOffsetMinutes: 0,
  role: "bar",
  rosterVersionId: "v1",
};

describe.each(["light", "dark"] as const)("shift-dialog a11y (%s theme)", (theme) => {
  it("renders accessibly when open for a new shift", async () => {
    const { el, host } = await mountWidget<ShiftDialog>(
      "dashboard-shift-dialog",
      { open: true, day: "2026-03-02", personId: "p1", shift: null },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders accessibly when open for an existing shift", async () => {
    const { el, host } = await mountWidget<ShiftDialog>(
      "dashboard-shift-dialog",
      { open: true, day: "2026-03-02", personId: "p1", shift },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });
});
