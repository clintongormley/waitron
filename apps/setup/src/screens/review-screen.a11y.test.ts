import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./review-screen.js";
import type { SetupReviewScreen } from "./review-screen.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

const draft: DeepPartial<ProvisionBody> = {
  mode: "live",
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Deli del Sol SL",
    name: "Calle Mayor",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    staffLanguage: "en",
    seriesCode: "FA",
    rectificativeSeriesCode: "RF",
    admin: {
      firstNames: "Alba",
      lastNames: "Ramos",
      displayName: "Alba",
      email: "alba@example.com",
      pin: "9137",
      password: "pw",
    },
  },
  aeatCert: { pfxBase64: "AAAA", passphrase: "pp", certKind: "sello" },
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-review-screen a11y (%s theme)", (theme) => {
  it("has no violations on the populated summary", async () => {
    const { host } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft }, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations on a demo summary, which has no certificate row", async () => {
    const { el, host } = await mountWidget<SetupReviewScreen>(
      "setup-review-screen",
      { draft: { ...draft, mode: "demo" } },
      theme,
    );
    expect(el.shadowRoot!.querySelector("[data-test=summary-cert]")).toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations and no sideways scroll at phone width in Spanish", async () => {
    const previous = [innerWidth, innerHeight];
    setLocale("es-ES");
    try {
      await page.viewport(390, 2200);
      const { el, host } = await mountWidget<SetupReviewScreen>(
        "setup-review-screen",
        { draft },
        theme,
      );
      expect(el.shadowRoot!.textContent).toContain(t("review.heading", "es-ES"));
      await expectNoA11yViolations(host);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      setLocale("en-GB");
      await page.viewport(previous[0]!, previous[1]!);
    }
  });

  it("has no violations on a bare draft summary", async () => {
    const { host } = await mountWidget<SetupReviewScreen>(
      "setup-review-screen",
      { draft: {} },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
