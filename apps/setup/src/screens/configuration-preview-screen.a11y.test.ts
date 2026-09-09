import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { ConfigurationPreview } from "../api/client.js";
import "./configuration-preview-screen.js";
import type { SetupConfigurationPreviewScreen } from "./configuration-preview-screen.js";

afterEach(cleanupWidgets);

const preview: ConfigurationPreview = {
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Prepared SL",
    location: {
      id: "source-location",
      name: "Prepared",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      fiscalTerritory: "ES-common",
      addressLine1: "Calle 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    },
    tillName: "Till",
    seriesCode: "F",
    rectificativeSeriesCode: "R",
  },
  counts: { products: 4 },
  reconnect: ["printers"],
};

describe.each(["light", "dark"] as const)(
  "setup-configuration-preview-screen a11y (%s theme)",
  (theme) => {
    it("has no violations", async () => {
      const { host } = await mountWidget<SetupConfigurationPreviewScreen>(
        "setup-configuration-preview-screen",
        { preview },
        theme,
      );
      await expectNoA11yViolations(host);
    });
  },
);
