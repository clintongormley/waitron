import type { CountryDemoDeveloperPreset } from "@waitron/country";
const REGIONAL_ADDRESS = {
  country: "ES",
  dataSet: "casa-delgado-ca",
  locationName: "Can Delgado",
  timeZone: "Europe/Madrid",
  addressLine1: "1 Main Street",
  addressLine2: null,
  dayCutover: "05:00",
} as const;
export const DEMO_DEVELOPER_PRESETS = {
  catalonia: {
    ...REGIONAL_ADDRESS,
    postalCode: "08001",
    city: "Barcelona",
    province: "Barcelona",
    receiptLocale: "ca-ES",
  },
  balearic: {
    ...REGIONAL_ADDRESS,
    postalCode: "07001",
    city: "Palma",
    province: "Balears, Illes",
    receiptLocale: "es-ES",
  },
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
