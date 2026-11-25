import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { EquipmentNfcSticker } from "./equipment-nfc-sticker.js";
import "./equipment-nfc-sticker.js";

afterEach(async () => {
  cleanupWidgets();
  vi.unstubAllGlobals();
  setLocale("en");
  await page.viewport(1280, 768);
});

for (const locale of ["en", "es"] as const) {
  for (const theme of ["light", "dark"] as const) {
    describe(`NFC sticker ${locale}/${theme}`, () => {
      it.each([
        "ready",
        "written",
        "confirmation",
        "failed",
        "blocked",
        "locked",
        "locking",
        "lock-failed",
        "lock-blocked",
      ] as const)("has no axe violations when %s, at phone width", async (state) => {
        await page.viewport(390, 844);
        await vi.waitFor(() => expect(innerWidth).toBe(390));
        setLocale(locale);
        const refuse = (name: string) => Promise.reject(new DOMException("refused", name));
        vi.stubGlobal(
          "NDEFReader",
          class {
            scan() {
              return Promise.resolve();
            }
            write() {
              if (state === "ready") return new Promise<void>(() => {});
              if (state === "failed") return refuse("NetworkError");
              if (state === "blocked") return refuse("NotAllowedError");
              return Promise.resolve();
            }
            makeReadOnly() {
              if (state === "locking") return new Promise<void>(() => {});
              if (state === "lock-failed") return refuse("NetworkError");
              if (state === "lock-blocked") return refuse("NotAllowedError");
              return Promise.resolve();
            }
          },
        );
        const { el, host } = await mountWidget<EquipmentNfcSticker>(
          "dashboard-equipment-nfc-sticker",
          {
            kind: "printer",
            itemId: "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b",
            name: "Terrace printer",
          },
          theme,
        );
        const action = (test: string) =>
          el.shadowRoot!.querySelector<WtButton>(`[data-test=${test}]`)!;
        const shows = (key: Parameters<typeof t>[0]) =>
          vi.waitFor(() =>
            expect(
              el
                .shadowRoot!.querySelector("[data-test=equipment-nfc-message]")!
                .textContent!.trim(),
            ).toBe(t(key)),
          );
        await shows(
          {
            ready: "equipment.nfc_ready" as const,
            failed: "equipment.nfc_write_failed" as const,
            blocked: "equipment.nfc_blocked" as const,
          }[state as string] ?? "equipment.nfc_written_printer",
        );
        if (["confirmation", "locked", "locking", "lock-failed", "lock-blocked"].includes(state)) {
          action("lock-equipment-nfc").click();
          await el.updateComplete;
        }
        if (["locked", "locking", "lock-failed", "lock-blocked"].includes(state)) {
          action("confirm-lock-equipment-nfc").click();
          await shows(
            state === "locked"
              ? "equipment.nfc_locked"
              : state === "locking"
                ? "equipment.nfc_hold"
                : state === "lock-blocked"
                  ? "equipment.nfc_blocked"
                  : "equipment.nfc_failed",
          );
        }
        await expectNoA11yViolations(host);
      });
    });
  }
}
