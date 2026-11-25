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
        it.each([
          "prompt",
          "granted",
          "armed",
          "read-error",
          "unavailable",
          "unoffered",
          "blocked",
          "picked-up",
        ])("accessible %s state fits the viewport", async (state) => {
          installNfc(state === "prompt" ? "prompt" : state === "blocked" ? "denied" : "granted");
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
            expect(
              el.shadowRoot!.querySelector(
                state === "blocked" ? "[data-equipment-nfc-blocked]" : "[data-equipment-nfc]",
              ),
            ).not.toBeNull(),
          );
          if (state === "picked-up") {
            el.addEventListener("equipment-change", (event) =>
              el.answered((event as CustomEvent).detail, NFC_EQUIPMENT),
            );
            FakeNdefReader.instances
              .at(-1)!
              .read("waitron-equipment:reader:b45f83b1-2222-4222-8222-222222222222");
            await el.updateComplete;
            expect(el.shadowRoot!.querySelector("[data-equipment-nfc]")!.textContent).toContain(
              "Portable reader",
            );
          }
          if (state === "armed") {
            el.shadowRoot!.querySelector<HTMLElement>(
              '[data-equipment-row="receipt"] [data-equipment-scan]',
            )!.click();
            await el.updateComplete;
          }
          if (state === "unoffered") {
            FakeNdefReader.instances
              .at(-1)!
              .read("waitron-equipment:printer:c45f83b1-3333-4333-8333-333333333333");
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
            "wt-button, wt-combobox, [data-equipment-nfc-message], [data-equipment-nfc-blocked]",
          )) {
            const rect = element.getBoundingClientRect();
            expect(rect.left).toBeGreaterThanOrEqual(0);
            expect(rect.right).toBeLessThanOrEqual(width);
          }
          await expectNoA11yViolations(host);
          if (state === "prompt" || state === "armed" || state === "unoffered")
            await page.screenshot({
              path: `__screenshots__/w102-1/${locale}-${theme}-${width}-${state}.png`,
            });
        });
      });
    }
  }
}
