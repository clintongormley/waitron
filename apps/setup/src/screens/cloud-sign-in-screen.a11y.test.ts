import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { SetupCloudSignInScreen } from "./cloud-sign-in-screen.js";

afterEach(cleanupWidgets);

for (const theme of ["light", "dark"] as const)
  for (const locale of ["en-GB", "es-ES"] as const)
    for (const width of [390, 1280])
      it(`${locale} ${theme} ${width}: shows accessible sign-in and a retry with Skip`, async () => {
        const previous = { locale: currentLocale(), width: innerWidth, height: innerHeight };
        try {
          setLocale(locale);
          await page.viewport(width, 900);
          const { el, host } = await mountWidget<SetupCloudSignInScreen>(
            "setup-cloud-sign-in-screen",
            {
              start: async () => {
                throw new Error("Cloud did not answer");
              },
            },
            theme,
          );
          await expectNoA11yViolations(host);
          const action = (name: string) =>
            el
              .shadowRoot!.querySelector(`[data-test=${name}]`)!
              .shadowRoot!.querySelector("button")!;
          if (import.meta.env.VITE_SETUP_CLOUD_SIGN_IN_LOOK === "1")
            await page.screenshot({
              path: `__screenshots__/setup-cloud-sign-in/${locale}-${theme}-${width}.png`,
            });
          await userEvent.click(action("sign-in"));
          await expect.poll(() => el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull();
          expect(action("sign-in").disabled).toBe(false);
          expect(action("skip").disabled).toBe(false);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          await expectNoA11yViolations(host);
        } finally {
          setLocale(previous.locale);
          await page.viewport(previous.width, previous.height);
        }
      });
