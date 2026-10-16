import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtCombobox } from "@waitron/ui";
import type { DashboardApi, VenueDefaults } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { VenueDefaultsPanel } from "./venue-defaults-panel.js";
import "./venue-defaults-panel.js";

const MADRID: VenueDefaults = {
  receiptLanguage: "es-ES",
  receiptLanguageChoices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
  fixedReceiptLanguage: null,
  defaultProductVatClass: "reduced",
};
const BARCELONA: VenueDefaults = {
  ...MADRID,
  receiptLanguageChoices: ["ca-ES"],
  fixedReceiptLanguage: "ca-ES",
};
const cases = ["light", "dark"].flatMap((theme) =>
  ["en-GB", "es-ES"].map((locale) => ({ theme: theme as "light" | "dark", locale })),
);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(cases)("Defaults card: $locale / $theme", async ({ theme, locale }) => {
  setLocale(locale);
  for (const state of ["view", "edit", "field-error", "barcelona-open"] as const) {
    const api = {
      getVenueDefaults: async () => (state === "barcelona-open" ? BARCELONA : MADRID),
      getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es", "ca"] }),
      putVenueDefaults: async () => {
        throw { code: "receipt.language_orders_open" };
      },
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<VenueDefaultsPanel>(
      "dashboard-venue-defaults-panel",
      { api },
      theme,
    );
    const root = el.shadowRoot!;
    await expect.poll(() => root.querySelector("[data-test=edit]")).toBeTruthy();
    if (state !== "view") {
      root.querySelector<HTMLElement>("[data-test=edit]")!.click();
      await expect.poll(() => root.querySelector("wt-combobox[name=receiptLanguage]")).toBeTruthy();
    }
    const language = root.querySelector<WtCombobox>("wt-combobox[name=receiptLanguage]");
    if (state === "field-error") {
      language!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "ca-ES" }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      root.querySelector<HTMLElement>("[data-test=save]")!.click();
      await expect.poll(() => language!.error).not.toBe("");
    }
    if (state === "barcelona-open") {
      await language!.updateComplete;
      await userEvent.click(page.elementLocator(language!.shadowRoot!.querySelector(".trigger")!));
      await expect
        .poll(() => language!.shadowRoot!.querySelector("[popover]")!.matches(":popover-open"))
        .toBe(true);
    }
    await expectNoA11yViolations(host);
    await page.screenshot({
      element: host,
      path: `__screenshots__/look/a755-defaults-${locale}-${theme}-${state}.png`,
    });
    host.remove();
  }
});
