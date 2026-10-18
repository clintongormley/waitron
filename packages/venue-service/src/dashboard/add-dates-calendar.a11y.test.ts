import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import "./add-dates-calendar.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("Add-dates calendar accessibility (%s)", (theme) => {
  test.each(["at rest", "a run being dragged"])("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("add-dates-calendar");
    Object.assign(el, {
      month: "2026-12",
      selected: ["2026-12-10"],
      taken: new Map([["2026-12-25", "Christmas"]]),
    });
    host.append(el);
    await el.updateComplete;
    const root = el.shadowRoot!;
    const centre = (date: string) => {
      const box = root.querySelector(`[data-date="${date}"] button`)!.getBoundingClientRect();
      return { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    };
    const pointer = { pointerId: 7, button: 0, bubbles: true, composed: true };
    if (state !== "at rest") {
      root
        .querySelector('[data-date="2026-12-14"] button')!
        .dispatchEvent(new PointerEvent("pointerdown", { ...pointer, ...centre("2026-12-14") }));
      window.dispatchEvent(
        new PointerEvent("pointermove", { ...pointer, ...centre("2026-12-16") }),
      );
      await el.updateComplete;
      expect(root.querySelectorAll("[data-picked]")).toHaveLength(3);
    }
    expect(root.querySelector('[aria-pressed="true"]')).not.toBeNull();
    expect(root.querySelector("[data-taken]")).not.toBeNull();
    await expectNoA11yViolations(host);
    window.dispatchEvent(new PointerEvent("pointercancel", pointer));
  });
});
