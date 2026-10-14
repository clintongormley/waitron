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
  test.each(["at rest", "Range on, its first date chosen"])("%s", async (state) => {
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
    if (state !== "at rest") {
      root.querySelector<HTMLElement>('[data-test="range"]')!.click();
      await el.updateComplete;
      root.querySelector<HTMLElement>('[data-date="2026-12-14"] button')!.click();
      await el.updateComplete;
      expect(root.querySelector("[data-anchor]")).not.toBeNull();
    }
    expect(root.querySelector('[aria-pressed="true"]')).not.toBeNull();
    expect(root.querySelector("[data-taken]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
