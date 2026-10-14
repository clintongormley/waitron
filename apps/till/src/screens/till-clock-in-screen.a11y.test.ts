import { afterEach, describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { TillClockInScreen } from "./till-clock-in-screen.js";
import "./till-clock-in-screen.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("clock page accessibility in %s", (theme) => {
  it.each(["en-GB", "es-ES"])("ready, reading and refused in %s", async (language) => {
    const locale = currentLocale();
    setLocale(language);
    try {
      for (const props of [
        {},
        { reading: true, canClockIn: false },
        { error: "Clock unavailable", canClockIn: false },
      ]) {
        const { el, host } = await mountWidget<TillClockInScreen>(
          "till-clock-in-screen",
          props,
          theme,
        );
        expect(el.shadowRoot!.querySelector("[data-clock-in]")).not.toBeNull();
        await expectNoA11yViolations(host);
      }
    } finally {
      setLocale(locale);
    }
  });
});
