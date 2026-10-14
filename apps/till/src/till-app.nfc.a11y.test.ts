import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtToast } from "@waitron/ui";
import { FakeNdefReader, installNfc, READER_ID } from "../test/equipment-nfc.js";
import { mountEquipmentApp, signIn } from "../test/equipment-app.js";
import { cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(async () => {
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale("en");
  await page.viewport(1280, 768);
});

for (const locale of ["en-GB", "es-ES"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      describe(`NFC pickup notice ${locale}/${theme}/${width}`, () => {
        it.each(["success", "foreign", "refused", "read-error", "unavailable"])(
          "accessible %s feedback fits the viewport",
          async (state) => {
            installNfc();
            await page.viewport(width, 844);
            const { el, host } = await mountEquipmentApp(
              state === "refused"
                ? {
                    setDeviceEquipment: vi
                      .fn()
                      .mockRejectedValue({ code: "reader.payment_in_progress", status: 409 }),
                  }
                : {},
              theme,
            );
            await signIn(el, locale);
            await vi.waitFor(() => expect(FakeNdefReader.instances.at(-1)?.signal).toBeDefined());
            const nfc = FakeNdefReader.instances.at(-1)!;
            if (state === "read-error") nfc.dispatchEvent(new Event("readingerror"));
            else if (state === "unavailable") {
              const visibility = vi
                .spyOn(document, "visibilityState", "get")
                .mockReturnValue("hidden");
              document.dispatchEvent(new Event("visibilitychange"));
              FakeNdefReader.scanResult = () =>
                Promise.reject(new DOMException("unavailable", "NotReadableError"));
              visibility.mockReturnValue("visible");
              document.dispatchEvent(new Event("visibilitychange"));
            } else
              nfc.read(
                state === "foreign" ? "foreign label" : `waitron-equipment:reader:${READER_ID}`,
              );
            const toast = el.shadowRoot!.querySelector<WtToast>("[data-nfc-notice]")!;
            await vi.waitFor(() => expect(toast.open).toBe(true));
            await toast.updateComplete;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            expect(window.innerWidth).toBe(width);
            const box = toast.getBoundingClientRect();
            expect(box.left).toBeGreaterThanOrEqual(0);
            expect(box.right).toBeLessThanOrEqual(width);
            expect(box.top).toBeGreaterThanOrEqual(0);
            expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
            expect(
              toast.shadowRoot!.querySelector(
                toast.tone === "error" ? '[role="alert"]' : '[role="status"]',
              )?.textContent,
            ).toContain(toast.message);
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `__screenshots__/w102-2/${locale}-${theme}-${width}-${state}.png`,
            });
          },
        );
      });
    }
  }
}
