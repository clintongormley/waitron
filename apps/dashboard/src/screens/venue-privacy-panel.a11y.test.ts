import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { setHelpMode, type WtButton, type WtInput } from "@waitron/ui";
import type { DashboardApi, VenuePrivacy } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { VenuePrivacyPanel } from "./venue-privacy-panel.js";
import "./venue-privacy-panel.js";

const STORED: VenuePrivacy = {
  privacyNoticeUrl: "https://example.com/privacy",
  privacyEmail: "privacy@example.com",
};
const cases = ["light", "dark"].flatMap((theme) =>
  ["en-GB", "es-ES"].map((locale) => ({ theme: theme as "light" | "dark", locale })),
);
afterEach(() => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(cases)("Privacy card: $locale / $theme", async ({ theme, locale }) => {
  setLocale(locale);
  for (const state of ["view", "edit", "changed", "invalid", "saving", "help"] as const) {
    setHelpMode(state === "help");
    const api = {
      liveData: new LiveData(),
      getVenuePrivacy: async () => structuredClone(STORED),
      putVenuePrivacy: async () => new Promise(() => {}),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<VenuePrivacyPanel>(
      "dashboard-venue-privacy-panel",
      { api },
      theme,
    );
    const root = el.shadowRoot!;
    await expect.poll(() => root.querySelector("[data-test=edit]")).toBeTruthy();
    if (state !== "view") {
      root.querySelector<HTMLElement>("[data-test=edit]")!.click();
      await expect.poll(() => root.querySelector("wt-input[name=privacyNoticeUrl]")).toBeTruthy();
    }
    const url = root.querySelector<WtInput>("wt-input[name=privacyNoticeUrl]");
    const save = root.querySelector<WtButton>("[data-test=save]");
    if (state === "changed" || state === "saving" || state === "invalid") {
      await url!.updateComplete;
      await userEvent.fill(
        page.elementLocator(url!.shadowRoot!.querySelector("input")!),
        state === "invalid" ? "example.com/privacy" : "https://example.com/other",
      );
      await el.updateComplete;
      expect(save!.disabled).toBe(false);
      if (state !== "changed") save!.click();
      if (state === "saving") await expect.poll(() => save!.loading).toBe(true);
      if (state === "invalid") await expect.poll(() => url!.error).not.toBe("");
    }
    if (state === "help") {
      const badge = url!.querySelector("wt-help-tooltip")!;
      await expect.poll(() => badge.hasAttribute("data-help-on")).toBe(true);
    }
    await expectNoA11yViolations(host);
    host.remove();
  }
});

const LONG: VenuePrivacy = {
  privacyNoticeUrl: "https://example.com/" + "a".repeat(480),
  privacyEmail: "a@" + "b".repeat(249) + ".es",
};

it.each(cases)(
  "Privacy card with the longest values and a read failure at phone width: $locale / $theme",
  async ({ theme, locale }) => {
    setLocale(locale);
    await page.viewport(390, 900);
    try {
      for (const state of ["long-view", "long-edit", "read-error"] as const) {
        const api = {
          liveData: new LiveData(),
          getVenuePrivacy: async () => {
            if (state === "read-error") throw { code: "management.failed" };
            return structuredClone(LONG);
          },
        } as unknown as DashboardApi;
        const { el, host } = await mountWidget<VenuePrivacyPanel>(
          "dashboard-venue-privacy-panel",
          { api },
          theme,
        );
        const root = el.shadowRoot!;
        const marker = state === "read-error" ? "[data-test=read-error]" : "[data-test=edit]";
        await expect.poll(() => root.querySelector(marker)).toBeTruthy();
        if (state === "long-view")
          expect(root.querySelector("[data-test=saved-privacyNoticeUrl]")!.textContent).toBe(
            LONG.privacyNoticeUrl,
          );
        if (state === "long-edit") {
          root.querySelector<HTMLElement>("[data-test=edit]")!.click();
          await expect
            .poll(() => root.querySelector<WtInput>("wt-input[name=privacyNoticeUrl]")?.value)
            .toBe(LONG.privacyNoticeUrl);
        }
        await expectNoA11yViolations(host);
        expect(el.scrollWidth).toBeLessThanOrEqual(390);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
        host.remove();
      }
    } finally {
      await page.viewport(1280, 900);
    }
  },
);
