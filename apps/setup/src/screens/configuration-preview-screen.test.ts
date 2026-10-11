import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { ConfigurationPreview } from "../api/client.js";
import { SetupConfigurationPreviewScreen } from "./configuration-preview-screen.js";

afterEach(cleanupWidgets);

const preview: ConfigurationPreview = {
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Prepared SL",
    taxpayerDomicile: "Calle Fiscal 8, 28001 Madrid",
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
    seriesCode: "F",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
  },
  counts: { products: 4, persons: 3 },
  reconnect: ["printers"],
};

describe("SetupConfigurationPreviewScreen", () => {
  it("shows copied counts, reconnect work and what is not copied", async () => {
    const { el } = await mountWidget<SetupConfigurationPreviewScreen>(
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
    expect(el.shadowRoot!.textContent).toContain("Sales and fiscal records are not copied.");
  });

  it("offers the export's own taxpayer by legal name and tax ID, beside a new one", async () => {
    const { el } = await mountWidget<SetupConfigurationPreviewScreen>(
      "setup-configuration-preview-screen",
      { preview },
    );
    expect(el.shadowRoot!.querySelector("h2[data-test=choice-heading]")?.textContent).toBe(
      "Whose restaurant is this?",
    );
    const same = el.shadowRoot!.querySelector<HTMLElement>("wt-choice-row[data-test=same-tax-id]")!;
    expect(same.getAttribute("heading")).toBe("Same tax ID");
    expect(same.textContent).toBe("Prepared SL (B12345678)");
    const fresh = el.shadowRoot!.querySelector<HTMLElement>("wt-choice-row[data-test=new-tax-id]")!;
    expect(fresh.getAttribute("heading")).toBe("New tax ID");
    expect(fresh.textContent).toBe("A new owner or company. You'll enter its details.");
    expect(el.shadowRoot!.querySelector("[data-test=continue]")).toBeNull();
  });

  it.each([
    ["same-tax-id", false],
    ["new-tax-id", true],
  ])("answers the taxpayer question when %s is clicked", async (row, newTaxpayer) => {
    const { el, host } = await mountWidget<SetupConfigurationPreviewScreen>(
      "setup-configuration-preview-screen",
      { preview },
    );
    const chosen = vi.fn();
    const goto = vi.fn();
    host.addEventListener("taxpayer-chosen", chosen);
    host.addEventListener("setup-goto", goto);
    el.shadowRoot!.querySelector<HTMLElement>(`wt-choice-row[data-test=${row}]`)!.click();
    expect(chosen.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
      { newTaxpayer },
    ]);
    expect(goto).not.toHaveBeenCalled();
  });

  it("sits directly on the wizard's page rather than in a card of its own", async () => {
    // The page paints the same surface a raised card does, so a screen-wide card inside it shows
    // only as a border and a shadow on an identical background.
    const { el } = await mountWidget<SetupConfigurationPreviewScreen>(
      "setup-configuration-preview-screen",
      { preview },
    );
    expect(el.shadowRoot!.querySelector("wt-card")).toBeNull();
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe("Review configuration");
  });

  it("says so when no hardware needs reconnecting", async () => {
    const { el } = await mountWidget<SetupConfigurationPreviewScreen>(
      "setup-configuration-preview-screen",
      { preview: { ...preview, reconnect: [] } },
    );
    expect(el.shadowRoot!.textContent).toContain("No hardware reconnection is listed.");
  });

  it("steps back to the live source choice", async () => {
    const { el, host } = await mountWidget<SetupConfigurationPreviewScreen>(
      "setup-configuration-preview-screen",
      { preview },
    );
    const goto = vi.fn();
    host.addEventListener("setup-goto", goto);
    el.shadowRoot!.querySelector<HTMLElement>(".actions wt-button[variant=ghost]")!.click();
    expect(goto.mock.calls.map(([event]) => (event as CustomEvent).detail.screen)).toEqual([
      "live-source",
    ]);
  });
});

describe("SetupConfigurationPreviewScreen in Spanish", () => {
  afterEach(() => setLocale("en-GB"));

  it("describes the copy in Spanish and leaves the server's names as they came", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupConfigurationPreviewScreen>(
      "setup-configuration-preview-screen",
      { preview: { ...preview, reconnect: [] } },
    );
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe("Revisar la configuración");
    expect(el.shadowRoot!.textContent).toContain("No hay ningún hardware que reconectar.");
    expect(
      el.shadowRoot!.querySelector("wt-choice-row[data-test=same-tax-id]")?.getAttribute("heading"),
    ).toBe("Mismo NIF");
    expect(
      el.shadowRoot!.querySelector("wt-choice-row[data-test=new-tax-id]")?.getAttribute("heading"),
    ).toBe("NIF nuevo");
    expect([...el.shadowRoot!.querySelectorAll("dt")].map((node) => node.textContent)).toContain(
      "products",
    );
  });

  it("switches language live", async () => {
    const { el } = await mountWidget<SetupConfigurationPreviewScreen>(
      "setup-configuration-preview-screen",
      { preview },
    );
    setLocale("es-ES");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe("Revisar la configuración");
  });
});
