import { page } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./fiscal-test-screen.js";
import type { SetupFiscalTestScreen } from "./fiscal-test-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-fiscal-test-screen a11y (%s theme)", (theme) => {
  it.each([undefined, "accepted", "rejected", "uncertain"] as const)(
    "has no violations for status %s",
    async (status) => {
      const { host } = await mountWidget<SetupFiscalTestScreen>(
        "setup-fiscal-test-screen",
        { status },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );
});

describe.each(["light", "dark"] as const)("readiness refusal (%s theme)", (theme) => {
  it("shows the reason in both languages at phone and desktop widths", async () => {
    const { host, el } = await mountWidget<SetupFiscalTestScreen>(
      "setup-fiscal-test-screen",
      { status: "rejected", rejections: [{ code: "1161", message: "Importe total incorrecto" }] },
      theme,
    );
    try {
      for (const locale of ["en-GB", "es-ES"] as const) {
        setLocale(locale);
        await el.updateComplete;
        for (const width of [390, 1280]) {
          await page.viewport(width, 900);
          await expectNoA11yViolations(host);
          if (import.meta.env.VITE_W41S_VISUAL === "1")
            await page.screenshot({
              path: `__screenshots__/w41s-readiness-${theme}-${locale}-${width}.png`,
            });
        }
      }
    } finally {
      await page.viewport(1280, 720);
      setLocale("en-GB");
    }
  });
});
