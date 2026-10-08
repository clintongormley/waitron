import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { CALENDAR_COLOURS } from "../hours-types.js";
import type { ServiceGrid } from "./service-grid.js";
import "./service-grid.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("service grid (%s)", (theme) => {
  test.each(["empty", "filled", "selected", "read-only", "resizing"])("%s", async (state) => {
    const el = (await mountThemed("<service-grid></service-grid>", theme)) as ServiceGrid;
    const filled = state === "filled" || state === "read-only" || state === "resizing";
    el.columns = [
      {
        key: "monday",
        label: "Monday",
        editable: true,
        periods: CALENDAR_COLOURS.map((colour) => ({ id: colour, name: colour, colour })),
        slots: filled
          ? CALENDAR_COLOURS.map((colour, i) => ({
              periodId: colour,
              startsAt: `${String(8 + i * 2).padStart(2, "0")}:00`,
              endsAt: `${String(10 + i * 2).padStart(2, "0")}:00`,
            }))
          : [],
      },
    ];
    el.readOnly = state === "read-only";
    await el.updateComplete;
    if (state === "selected") {
      const step = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-minute="360"]')!;
      step.focus();
      step.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          shiftKey: true,
          bubbles: true,
          composed: true,
        }),
      );
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".selection")).not.toBeNull();
    }
    if (state === "resizing") {
      const day = el.shadowRoot!.querySelector<HTMLElement>(".day")!.getBoundingClientRect();
      el.shadowRoot!.querySelector(".resize")!.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 12,
          bubbles: true,
          button: 0,
          clientY: day.top + (day.height * 4) / 24,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 12,
          clientY: day.top + (day.height * 3) / 24,
        }),
      );
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});
