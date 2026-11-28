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
        { displayName: "Javier Torres" },
        {
          action: "break-end" as const,
          displayName: "Javier Torres",
          breakStart: { eventAt: new Date().toISOString(), offsetMinutes: 60 },
        },
        { reading: true, canAct: false },
        { error: "Clock unavailable", canAct: false },
      ]) {
        const { el, host } = await mountWidget<TillClockInScreen>(
          "till-clock-in-screen",
          props,
          theme,
        );
        expect(el.shadowRoot!.querySelector("[data-clock-in], [data-end-break]")).not.toBeNull();
        await expectNoA11yViolations(host);
        cleanupWidgets();
      }
    } finally {
      setLocale(locale);
    }
  });
});
