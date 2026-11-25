import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtButton, WtRowActions } from "@waitron/ui";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import type { EquipmentQrLabel } from "./equipment-qr-label.js";
import "./equipment-qr-label.js";

const ID = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";
afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 768);
});
for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const) {
    it.each([
      "loading",
      "empty",
      "read-failed",
      "closed",
      "code",
      "copied",
      "choice",
      "sending",
      "refused",
      "queued",
    ])(`QR label ${locale}/${theme} %s is accessible at phone width`, async (state) => {
      setLocale(locale);
      await page.viewport(390, 844);
      await vi.waitFor(() => expect(innerWidth).toBe(390));
      const api = {
        listPrinters: vi.fn(() =>
          state === "loading"
            ? new Promise<never>(() => {})
            : state === "read-failed"
              ? Promise.reject(new Error("offline"))
              : Promise.resolve(
                  state === "empty" ? [] : [{ id: ID, name: "Portable Cafe", active: true }],
                ),
        ),
        printEquipmentLabel: vi.fn(() =>
          state === "sending"
            ? new Promise<never>(() => {})
            : state === "refused"
              ? Promise.reject(new Error("offline"))
              : Promise.resolve({ jobId: "label-job" }),
        ),
      };
      const { el, host } = await mountWidget<EquipmentQrLabel>(
        "dashboard-equipment-qr-label",
        { itemId: ID, name: "Portable Cafe", api: api as unknown as DashboardApi },
        theme,
      );
      const find = <T extends Element>(test: string) =>
        el.shadowRoot!.querySelector<T>(`[data-test=${test}]`)!;
      await vi.waitFor(() => expect(find("equipment-label-qr")).not.toBeNull());
      const actions = find<HTMLElementTagNameMap["wt-form-actions"]>("equipment-label-actions");
      if (state === "loading") expect(find<WtButton>("print-equipment-label").loading).toBe(true);
      else if (state === "empty")
        await vi.waitFor(() =>
          expect(find<WtButton>("print-equipment-label").variant).toBe("primary"),
        );
      else await vi.waitFor(() => expect(find("print-label-on-this-computer")).not.toBeNull());
      if (state === "read-failed") expect(actions.error).not.toBe("");
      if (state === "code" || state === "copied") {
        find<WtButton>("show-equipment-code").click();
        await el.updateComplete;
        if (state === "copied") {
          const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
          find<WtButton>("copy-equipment-code").click();
          await vi.waitFor(() => expect(find("equipment-code-message")).not.toBeNull());
          copy.mockRestore();
        }
      }
      if (state === "choice") find<WtRowActions>("print-equipment-label").show();
      if (["sending", "refused", "queued"].includes(state)) {
        find<WtButton>(`print-label-on-${ID}`).click();
        await el.updateComplete;
        if (state === "sending") expect(find<WtButton>("print-equipment-label").loading).toBe(true);
        else if (state === "queued")
          await vi.waitFor(() => expect(find("equipment-label-printer-status")).not.toBeNull());
        else await vi.waitFor(() => expect(actions.error).not.toBe(""));
      }
      await expectNoA11yViolations(host);
    });
  }
