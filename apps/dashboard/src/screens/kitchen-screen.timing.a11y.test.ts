import { page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { WtInput } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import type { KitchenScreen } from "./kitchen-screen.js";
import "./kitchen-screen.js";
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
it.each([
  ["en", "light", 390],
  ["en", "dark", 390],
  ["es", "light", 390],
  ["es", "dark", 390],
  ["en", "light", 1280],
  ["en", "dark", 1280],
  ["es", "light", 1280],
  ["es", "dark", 1280],
] as const)(
  "late flags render saved, invalid and refused values in %s %s at %ipx",
  async (locale, theme, width) => {
    const previous = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 900);
      setLocale(locale);
      const api = {
        getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
        getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
        listCourses: vi.fn().mockResolvedValue([]),
        getKitchenTimingDefaults: vi.fn().mockResolvedValue({
          warmAfterMinutes: 3,
          overdueAfterMinutes: 7,
          forgottenAfterMinutes: 12,
        }),
        setKitchenTimingDefaults: vi.fn().mockRejectedValue({
          code: "station.thresholds_invalid",
          params: { field: "overdueAfterMinutes", name: "Parrilla", stationId: "grill" },
        }),
      } as unknown as DashboardApi;
      const { el, host } = await mountWidget<KitchenScreen>(
        "dashboard-kitchen-screen",
        { api },
        theme,
      );
      const q = (selector: string) => el.shadowRoot!.querySelector<HTMLElement>(selector)!;
      await vi.waitFor(() => expect(q('[data-test="timing-values"]')?.textContent).toContain("12"));
      expect(window.innerWidth).toBe(width);
      expect(q('[data-test="edit-timing"]').getBoundingClientRect().width).toBeLessThan(
        host.getBoundingClientRect().width,
      );
      expect(host.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/venue-defaults-${locale}-${theme}-${width}-saved.png`,
      });
      q('[data-test="edit-timing"]').click();
      await el.updateComplete;
      const saveAction = q('[data-test="save-timing"]') as HTMLElementTagNameMap["wt-button"];
      expect([saveAction.variant, saveAction.disabled]).toEqual(["secondary", true]);
      await expectNoA11yViolations(host);
      const input = q('wt-input[name="overdueAfterMinutes"]') as WtInput;
      input.value = "3";
      input.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "3" }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      q('[data-test="save-timing"]').click();
      await vi.waitFor(() => expect(input.error).not.toBe(""));
      await vi.waitFor(() =>
        expect(input.shadowRoot!.activeElement).toBe(input.shadowRoot!.querySelector("input")),
      );
      expect(host.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/venue-defaults-${locale}-${theme}-${width}-invalid.png`,
      });
      input.value = "8";
      input.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "8" }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      q('[data-test="save-timing"]').click();
      await vi.waitFor(() => expect(input.error).toContain("Parrilla"));
      await vi.waitFor(() =>
        expect(q('[data-test="save-timing"]').shadowRoot!.querySelector("button")!.disabled).toBe(
          false,
        ),
      );
      expect(saveAction.variant).toBe("primary");
      expect(host.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/venue-defaults-${locale}-${theme}-${width}-refused.png`,
      });
    } finally {
      await page.viewport(previous.width, previous.height);
    }
  },
);
