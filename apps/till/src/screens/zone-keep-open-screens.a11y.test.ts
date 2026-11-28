import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { TillFloorScreen } from "./till-floor-screen.js";

afterEach(cleanupWidgets);
for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      it(`keeps the floor's closing status readable at ${width}px in ${locale} ${theme}`, async () => {
        const previous = currentLocale();
        try {
          setLocale(locale);
          await page.viewport(width, 900);
          expect(window.innerWidth).toBe(width);
          const { el, host } = await mountWidget<TillFloorScreen>(
            "till-floor-screen",
            {
              zones: [
                {
                  id: "terrace",
                  name: locale === "en" ? "Terrace" : "Terraza",
                  displayOrder: 0,
                  active: true,
                  closed: false,
                  closesAt: "22:00",
                  hasPlan: false,
                  layoutSetName: null,
                  layoutDue: null,
                  serviceMode: "table_tab",
                },
              ],
              tables: [],
            },
            theme,
          );
          const status = el.shadowRoot!.querySelector("[data-zone-control] p[role=status]")!;
          expect(status.textContent!.trim()).toBe(
            locale === "en" ? "Terrace closes at 22:00 today." : "Hoy Terraza cierra a las 22:00.",
          );
          expect(status.getBoundingClientRect().right).toBeLessThanOrEqual(width);
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../__screenshots__/a1626-floor-closing/${locale}-${theme}-${width}.png`,
          });
        } finally {
          setLocale(previous);
          await page.viewport(1280, 768);
        }
      });
    }
