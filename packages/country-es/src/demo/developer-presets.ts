import type { CountryDemoDeveloperPreset } from "@waitron/country";
export const DEMO_DEVELOPER_PRESETS = {
  madrid: {
    country: "ES",
    dataSet: "casa-delgado-es",
    locationName: "Casa Delgado",
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    addressLine1: "1 Main Street",
    addressLine2: null,
    dayCutover: "05:00",
    receiptLocale: "es-ES",
  },
} as const satisfies Readonly<Record<string, CountryDemoDeveloperPreset>>;
