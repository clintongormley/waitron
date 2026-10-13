import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { EquipmentLabel } from "./equipment-label.js";
import "./equipment-label.js";

afterEach(async () => {
  cleanupWidgets();
  vi.unstubAllGlobals();
  setLocale("en");
  await page.viewport(1280, 768);
});

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    describe(`NFC label ${locale}/${theme}`, () => {
      it.each([
        "unavailable",
        "ready",
        "writing",
        "written",
        "confirmation",
        "failed",
        "locked",
        "locking",
      ] as const)("has no axe violations when %s, at phone width", async (state) => {
        await page.viewport(390, 844);
        await vi.waitFor(() => expect(innerWidth).toBe(390));
        setLocale(locale);
        vi.stubGlobal(
          "NDEFReader",
          state === "unavailable"
            ? undefined
            : class {
                write() {
                  if (state === "writing") return new Promise<void>(() => {});
                  if (state === "failed")
                    return Promise.reject(new DOMException("IO error", "NetworkError"));
                  return Promise.resolve();
                }
                makeReadOnly() {
                  if (state === "locking") return new Promise<void>(() => {});
                  return Promise.resolve();
                }
              },
        );
        const { el, host } = await mountWidget<EquipmentLabel>(
          "dashboard-equipment-label",
          {
            kind: "printer",
            itemId: "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b",
            name: "Impresora de terraza",
          },
          theme,
        );
        await vi.waitFor(() => expect(el.shadowRoot!.querySelector("img")).not.toBeNull());
        const action = (test: string) =>
          el.shadowRoot!.querySelector<WtButton>(`[data-test=${test}]`)!;
        if (!["unavailable", "ready"].includes(state)) {
          action("write-equipment-nfc").click();
          await vi.waitFor(() =>
            expect(
              el.shadowRoot!.querySelector("[data-test=equipment-nfc-message]"),
            ).not.toBeNull(),
          );
          if (["written", "confirmation", "locked", "locking"].includes(state)) {
            await vi.waitFor(() => expect(action("lock-equipment-nfc")).not.toBeNull());
          }
          if (["confirmation", "locked", "locking"].includes(state)) {
            action("lock-equipment-nfc").click();
            await el.updateComplete;
            if (state === "locked" || state === "locking") {
              action("confirm-lock-equipment-nfc").click();
              if (state === "locked")
                await vi.waitFor(() => expect(action("lock-equipment-nfc")).toBeNull());
              else {
                await el.updateComplete;
                expect(action("write-equipment-nfc").variant).toBe("secondary");
              }
            }
          }
        }
        await expectNoA11yViolations(host);
      });
    });
  }
}
