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
