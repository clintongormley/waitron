import type { ConfigurationBundle } from "../src/configuration-transfer.js";

export function configurationBundle(): ConfigurationBundle {
  return {
    version: 4,
    createdAt: "2026-10-16T11:40:00Z",
    sourceOperatorId: "source-admin",
    venue: {
      country: "GB",
      taxId: "123456789",
      legalName: "Synthetic restaurant",
      taxpayerDomicile: null,
      seriesCode: "A",
      fullSeriesCode: "FF",
      rectificativeSeriesCode: "R",
      location: {
        id: "source-location",
        name: "Synthetic source",
        invoiceLocales: ["en-GB"],
        operationDescription: "Restaurant",
        fiscalTerritory: "GB-vat",
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: null,
        province: null,
        timeZone: "Europe/London",
        dayCutover: "06:00:00",
        bumpMode: "line",
        fireControl: "waiter",
        catalogueId: null,
      },
    },
    modules: {},
    tables: {},
    reconnect: [],
  };
}
