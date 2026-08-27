import { afterEach, describe, it } from "vitest";
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
    location: { name: "Calle Mayor", fiscalTerritory: "ES-common", invoiceLocales: ["es-ES"] },
    seriesCode: "FA",
    rectificativeSeriesCode: "RF",
    admin: { displayName: "Alba", pin: "9137", password: "pw" },
  },
  aeatCert: { pfxBase64: "AAAA", passphrase: "pp", certKind: "sello" },
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-review-screen a11y (%s theme)", (theme) => {
  it("has no violations on the populated summary", async () => {
    const { host } = await mountWidget<SetupReviewScreen>("setup-review-screen", { draft }, theme);
    await expectNoA11yViolations(host);
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
