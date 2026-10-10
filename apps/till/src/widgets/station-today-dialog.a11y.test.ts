import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { page } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import type { TillStationTodayDialog } from "./station-today-dialog.js";
import "./station-today-dialog.js";
beforeEach(() => setLocale("es"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("station today dialog %s", (theme) => {
  it.each([
    "ready",
    "empty",
    "busy",
    "refused",
    "committed",
    "unfinished",
    "send",
    "leave",
  ] as const)("has no violations when %s", async (state) => {
    const { el, host } = await mountWidget<TillStationTodayDialog>(
      "till-station-today-dialog",
      {
        stationName: "Parrilla",
        openDishCount: ["unfinished", "send", "leave"].includes(state) ? 3 : 0,
        destinations: state === "empty" ? [] : [{ id: "pass", name: "Pase", isDefault: true }],
        busy: state === "busy",
        refusal: state === "refused" ? "station.destination_invalid" : null,
      },
      theme,
    );
    expect(el.shadowRoot).not.toBeNull();
    if (state === "committed") {
      el.commit();
      await el.updateComplete;
    }
    if (state === "send" || state === "leave") {
      el.shadowRoot!.querySelector('wt-combobox[name="openDishes"]')!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: state } }),
      );
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`keeps both closing choices and their action visible in ${locale}/${theme}/${width}`, async () => {
        await page.viewport(width, 900);
        setLocale(locale);
        try {
          const { el, host } = await mountWidget<TillStationTodayDialog>(
            "till-station-today-dialog",
            {
              stationName: locale === "en" ? "Downstairs kitchen" : "Cocina de la planta baja",
              openDishCount: 12,
              destinations: [
                {
                  id: "pass",
                  name: locale === "en" ? "Main kitchen" : "Cocina principal",
                  isDefault: true,
                },
                {
                  id: "bar",
                  name: locale === "en" ? "Downstairs bar" : "Barra de la planta baja",
                  isDefault: false,
                },
              ],
            },
            theme,
          );
          await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const choice = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
            'wt-combobox[name="openDishes"]',
          )!;
          choice.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "send" } }));
          await el.updateComplete;
          const submit =
            el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")!;
          await choice.updateComplete;
          await submit.updateComplete;
          expect(submit.disabled).toBe(false);
          for (const field of [
            choice,
            submit,
            el.shadowRoot!.querySelector('wt-combobox[name="sendsToStationId"]')!,
          ]) {
            const rect = field.getBoundingClientRect();
            expect(rect.left).toBeGreaterThanOrEqual(0);
            expect(rect.right).toBeLessThanOrEqual(width);
            expect(rect.top).toBeGreaterThanOrEqual(0);
            expect(rect.bottom).toBeLessThanOrEqual(900);
          }
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/a366-4b-close/${locale}-${theme}-${width}.png`,
          });
        } finally {
          setLocale("en");
          await page.viewport(1280, 768);
        }
      });
    }
  }
}
