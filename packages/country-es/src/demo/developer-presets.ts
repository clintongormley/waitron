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
  valencia: {
    ...REGIONAL_ADDRESS,
    dataSet: "casa-delgado-valencia",
    locationName: "Casa Delgado de l'Horta",
    postalCode: "46001",
    city: "València",
    province: "Valencia/València",
    receiptLocale: "es-ES",
  },
  catalonia: {
    ...REGIONAL_ADDRESS,
    postalCode: "08001",
    city: "Barcelona",
    province: "Barcelona",
  },
  balearic: {
    ...REGIONAL_ADDRESS,
    postalCode: "07001",
    city: "Palma",
    province: "Balears, Illes",
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
