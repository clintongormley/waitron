import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { EMPTY_MENU_FILTERS } from "../menu-filter.js";
import "./diet-filter.js";
import type { TillDietFilter } from "./diet-filter.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-diet-filter a11y (%s theme)", (theme) => {
  it("the closed Filter and its open choices have no violations (none selected)", async () => {
    const { el, host } = await mountWidget<TillDietFilter>(
      "till-diet-filter",
      { selected: EMPTY_MENU_FILTERS },
      theme,
    );
    await expectNoA11yViolations(host);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-filter-open]")!);
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with an active lens (aria-pressed)", async () => {
    const { el, host } = await mountWidget<TillDietFilter>(
      "till-diet-filter",
      { selected: { diets: ["vegan"], exclude: { nuts: ["walnuts"] } } },
      theme,
    );
    await expectNoA11yViolations(host);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-filter-open]")!);
    await el.updateComplete;
    await expectNoA11yViolations(host);
    for (const code of ["nuts", "gluten"]) {
      await userEvent.click(
        el.shadowRoot!.querySelector<HTMLElement>(`[data-allergen="${code}"]`)!,
      );
      await el.updateComplete;
      await expectNoA11yViolations(host);
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-filter-back]")!);
    }
  });
});

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`A738 Filter remains readable and keyboard dismissible: ${locale}/${theme}/${width}`, async () => {
        const previous = currentLocale();
        const size = { width: window.innerWidth, height: window.innerHeight };
        await page.viewport(width, 844);
        setLocale(locale);
        try {
          const { el, host } = await mountWidget<TillDietFilter>(
            "till-diet-filter",
            {
              selected: { diets: ["vegan", "no-fish"], exclude: { nuts: ["walnuts", "almonds"] } },
            },
            theme,
          );
          expect(window.innerWidth).toBe(width);
          const trigger = el.shadowRoot!.querySelector<HTMLElement>("[data-filter-open]")!;
          await userEvent.click(trigger);
          await el.updateComplete;
          const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
          await dialog.updateComplete;
          const native = dialog.shadowRoot!.querySelector("dialog")!;
          const box = native.getBoundingClientRect();
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          expect(native.scrollWidth).toBeLessThanOrEqual(native.clientWidth + 1);
          for (const button of el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")) {
            if (button === trigger) continue;
            const bounds = button.getBoundingClientRect();
            expect(bounds.height).toBeGreaterThanOrEqual(
              parseFloat(getComputedStyle(host).getPropertyValue("--wt-tap-min")),
            );
            expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
          }
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `__screenshots__/a738-filter/${locale}-${theme}-${width}.png`,
          });
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLElement>('[data-allergen="nuts"]')!,
          );
          await el.updateComplete;
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `__screenshots__/a738-filter/${locale}-${theme}-${width}-nuts.png`,
          });
          const closed = new Promise<void>((resolve) =>
            dialog.addEventListener("wt-close", () => resolve(), { once: true }),
          );
          await userEvent.keyboard("{Escape}");
          await closed;
          await el.updateComplete;
          expect(native.open).toBe(false);
          expect(el.shadowRoot!.activeElement).toBe(trigger);
          expect(el.selected).toEqual({
            diets: ["vegan", "no-fish"],
            exclude: { nuts: ["walnuts", "almonds"] },
          });
        } finally {
          setLocale(previous);
          await page.viewport(size.width, size.height);
        }
      });
    }
  }
}
