import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./shift-dialog.js";
import type { ShiftDialog } from "./shift-dialog.js";
import type { Shift } from "../api/client.js";

/**
 * A closed <dialog> renders nothing to test, so it is mounted with `open = true` and its wt-dialog's
 * first render (which calls showModal) is settled before axe runs.
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

  it("shows a skipped minute's field and form errors accessibly", async () => {
    const { el, host } = await mountWidget<ShiftDialog>(
      "dashboard-shift-dialog",
      {
        open: true,
        day: "2026-03-29",
        personId: "p1",
        timeZone: "Europe/Madrid",
      },
      theme,
    );
    await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
    for (const [field, value] of [
      ["shift-start", "01:00"],
      ["shift-end", "02:30"],
    ])
      el.shadowRoot!.querySelector(`[data-test=${field}]`)!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value } }),
      );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("with Save quiet and then ready", async () => {
    const { el, host } = await mountWidget<ShiftDialog>(
      "dashboard-shift-dialog",
      { open: true, day: "2026-03-02", personId: "p1", shift },
      theme,
    );
    await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
    await save.updateComplete;
    expect([save.variant, save.disabled]).toEqual(["secondary", true]);
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector("[data-test=shift-role]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "kitchen" } }),
    );
    await el.updateComplete;
    await save.updateComplete;
    expect([save.variant, save.disabled]).toEqual(["primary", false]);
    await expectNoA11yViolations(host);
  });
});
