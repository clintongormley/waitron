import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { ConfigurationPreview } from "../api/client.js";
import { SetupConfigurationPreviewScreen } from "./configuration-preview-screen.js";

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
  counts: { products: 4, persons: 3 },
  reconnect: ["printers"],
};

describe("SetupConfigurationPreviewScreen", () => {
  it("shows copied counts and reconnect work before continuing", async () => {
    const { el, host } = await mountWidget<SetupConfigurationPreviewScreen>(
      "setup-configuration-preview-screen",
      { preview },
    );
    expect(el.shadowRoot!.textContent).toContain("Prepared SL");
    expect([...el.shadowRoot!.querySelectorAll("dt")].map((node) => node.textContent)).toContain(
      "products",
    );
    expect([...el.shadowRoot!.querySelectorAll("dd")].map((node) => node.textContent)).toContain(
      "4",
    );
    expect(el.shadowRoot!.textContent).toContain("printers");
    const goto = vi.fn();
    host.addEventListener("setup-goto", goto);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    expect((goto.mock.calls[0]![0] as CustomEvent).detail.screen).toBe("admin");
  });
});
