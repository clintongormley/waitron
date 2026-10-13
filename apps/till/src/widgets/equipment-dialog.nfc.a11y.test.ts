import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { FakeNdefReader, installNfc, NFC_EQUIPMENT } from "../../test/equipment-nfc.js";
import "./equipment-dialog.js";
import type { TillEquipmentDialog } from "./equipment-dialog.js";

afterEach(async () => {
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale("en");
  await page.viewport(1280, 768);
});
for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      describe(`NFC ${locale}/${theme}/${width}`, () => {
        it.each(["prompt", "granted", "armed", "read-error", "unavailable"])(
          "accessible %s state fits the viewport",
          async (state) => {
            installNfc(state === "prompt" ? "prompt" : "granted");
            if (state === "unavailable")
              FakeNdefReader.scanResult = () =>
                Promise.reject(new DOMException("unavailable", "NotSupportedError"));
            setLocale(locale);
            await page.viewport(width, 844);
            const { el, host } = await mountWidget<TillEquipmentDialog>(
              "till-equipment-dialog",
              { open: true, equipment: NFC_EQUIPMENT },
              theme,
            );
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector("[data-equipment-nfc]")).not.toBeNull(),
            );
            if (state === "armed") {
              el.shadowRoot!.querySelector<HTMLElement>(
                '[data-equipment-row="receipt"] [data-equipment-scan]',
              )!.click();
              await el.updateComplete;
            }
            if (state === "read-error") {
              FakeNdefReader.instances.at(-1)!.dispatchEvent(new Event("readingerror"));
              await el.updateComplete;
            }
            await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            expect(window.innerWidth).toBe(width);
            for (const element of el.shadowRoot!.querySelectorAll<HTMLElement>(
              "wt-button, wt-combobox, [data-equipment-nfc-message]",
            )) {
              const rect = element.getBoundingClientRect();
              expect(rect.left).toBeGreaterThanOrEqual(0);
              expect(rect.right).toBeLessThanOrEqual(width);
            }
            await expectNoA11yViolations(host);
            if (state === "prompt" || state === "armed")
              await page.screenshot({
                path: `__screenshots__/w102-1/${locale}-${theme}-${width}-${state}.png`,
              });
          },
        );
      });
    }
  }
}
