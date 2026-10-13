import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtButton, WtCombobox } from "@waitron/ui";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import type { EquipmentLabel } from "./equipment-label.js";
import "./equipment-label.js";
const ID = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";
afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 768);
});
for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const) {
    it.each(["loading", "empty", "read-failed", "choice", "sending", "refused", "queued"])(
      `venue label ${locale}/${theme} %s is accessible at phone width`,
      async (state) => {
        setLocale(locale);
        await page.viewport(390, 844);
        const api = {
          listPrinters: vi.fn(() =>
            state === "loading"
              ? new Promise<never>(() => {})
              : state === "read-failed"
                ? Promise.reject(new Error("offline"))
                : Promise.resolve(
                    state === "empty" ? [] : [{ id: ID, name: "Portable Café", active: true }],
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
        const { el, host } = await mountWidget<EquipmentLabel>(
          "dashboard-equipment-label",
          { itemId: ID, name: "Portable Café", api: api as unknown as DashboardApi },
          theme,
        );
        const button = (test: string) =>
          el.shadowRoot!.querySelector<WtButton>(`[data-test=${test}]`)!;
        await vi.waitFor(() => expect(el.shadowRoot!.querySelector("img")).not.toBeNull());
        button("venue-print-equipment-label").click();
        const choice = () =>
          el.shadowRoot!.querySelector<WtCombobox>("[data-test=equipment-label-printer]")!;
        await vi.waitFor(() => expect(choice()).not.toBeNull());
        if (!["loading", "empty", "read-failed"].includes(state)) {
          await vi.waitFor(() => expect(choice().options).toHaveLength(1));
          choice().dispatchEvent(new CustomEvent("wt-change", { detail: { value: ID } }));
          await el.updateComplete;
          if (state !== "choice") {
            button("send-equipment-label").click();
            await el.updateComplete;
            if (state === "queued")
              await vi.waitFor(() =>
                expect(
                  el.shadowRoot!.querySelector("[data-test=equipment-label-printer-status]"),
                ).not.toBeNull(),
              );
            if (state === "refused")
              await vi.waitFor(() =>
                expect(
                  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
                    "[data-test=equipment-label-printer-actions]",
                  )!.error,
                ).not.toBe(""),
              );
          }
        }
        await expectNoA11yViolations(host);
      },
    );
  }
