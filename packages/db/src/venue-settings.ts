import { DEFAULT_TIME_ZONE } from "./schema/tenants.js";
import { defineSettingsDocument, type SettingsParse } from "./settings.js";

export interface VenueSettings {
  name: string;
  fiscalTerritory: string;
  /** vb6 removes the interim venue description. */
  operationDescription: string;
  invoiceLocales: string[];
  contentLanguages: string[] | null;
  defaultContentLanguage: string | null;
  holidayArea: {
    country: string;
    provinceCode: string;
    cityKey: string;
    areaKey: string | null;
  } | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
}

export const VENUE_SETTINGS = defineSettingsDocument<VenueSettings>({
  module: "venue",
  version: 1,
  transfers: false,
  defaults: () => ({
    name: "",
    fiscalTerritory: "ES-common",
    operationDescription: "Restaurant",
    invoiceLocales: ["es"],
    contentLanguages: null,
    defaultContentLanguage: null,
    holidayArea: null,
    addressLine1: null,
    addressLine2: null,
    postalCode: null,
    city: null,
    province: null,
  }),
  parse(input: unknown): SettingsParse<VenueSettings> {
    if (typeof input !== "object" || input === null || Array.isArray(input))
      return { ok: false, field: "doc" };
    const value = input as Record<string, unknown>;
    const addressFields = [
      "addressLine1",
      "addressLine2",
      "postalCode",
      "city",
      "province",
    ] as const;
    for (const field of Object.keys(value))
      if (
        field !== "name" &&
        field !== "fiscalTerritory" &&
        field !== "operationDescription" &&
        !["invoiceLocales", "contentLanguages", "defaultContentLanguage", "holidayArea"].includes(
          field,
        ) &&
        !addressFields.includes(field as (typeof addressFields)[number])
      )
        return { ok: false, field };
    if (typeof value.name !== "string" || value.name.trim() === "")
      return { ok: false, field: "name" };
    if (typeof value.fiscalTerritory !== "string" || value.fiscalTerritory.trim() === "")
      return { ok: false, field: "fiscalTerritory" };
    if (typeof value.operationDescription !== "string")
      return { ok: false, field: "operationDescription" };
    const invoiceLocales = value.invoiceLocales;
    if (
      !Array.isArray(invoiceLocales) ||
      invoiceLocales.length < 1 ||
      invoiceLocales.length > 2 ||
      invoiceLocales.some((locale) => typeof locale !== "string" || locale.trim() === "") ||
      new Set(invoiceLocales).size !== invoiceLocales.length
    )
      return { ok: false, field: "invoiceLocales" };
    const languages = value.contentLanguages;
    const defaultLanguage = value.defaultContentLanguage;
    if (
      !(languages === null && defaultLanguage === null) &&
      (!Array.isArray(languages) ||
        languages.length < 1 ||
        languages.length > 200 ||
        languages.some((language) => typeof language !== "string" || language.trim() === "") ||
        new Set(languages).size !== languages.length ||
        typeof defaultLanguage !== "string" ||
        !languages.includes(defaultLanguage))
    )
      return { ok: false, field: "contentLanguages" };
    const area = value.holidayArea;
    if (area !== null) {
      if (typeof area !== "object" || area === null || Array.isArray(area))
        return { ok: false, field: "holidayArea" };
      const fields = area as Record<string, unknown>;
      if (
        Object.keys(fields).some(
          (key) => !["country", "provinceCode", "cityKey", "areaKey"].includes(key),
        ) ||
        ["country", "provinceCode", "cityKey"].some(
          (key) => typeof fields[key] !== "string" || fields[key].trim() === "",
        ) ||
        (fields.areaKey !== null && typeof fields.areaKey !== "string")
      )
        return { ok: false, field: "holidayArea" };
    }
    for (const field of addressFields)
      if (value[field] !== null && typeof value[field] !== "string") return { ok: false, field };
    return {
      ok: true,
      doc: {
        name: value.name.trim(),
        fiscalTerritory: value.fiscalTerritory,
        operationDescription: value.operationDescription,
        invoiceLocales: [...invoiceLocales],
        contentLanguages: languages === null ? null : [...(languages as string[])],
        defaultContentLanguage: defaultLanguage as string | null,
        holidayArea: area as VenueSettings["holidayArea"],
        addressLine1: value.addressLine1 as string | null,
        addressLine2: value.addressLine2 as string | null,
        postalCode: value.postalCode as string | null,
        city: value.city as string | null,
        province: value.province as string | null,
      },
    };
  },
});

export const FIRST_DAY_START = "2000-01-01";

export interface BusinessDaySettings {
  /** Stored verbatim so the zone repair can read an invalid saved zone. */
  timeZone: string;
}

export const BUSINESS_DAY_SETTINGS = defineSettingsDocument<BusinessDaySettings>({
  module: "business_day",
  version: 1,
  transfers: false,
  defaults: () => ({ timeZone: DEFAULT_TIME_ZONE }),
  parse(input: unknown): SettingsParse<BusinessDaySettings> {
    if (typeof input !== "object" || input === null || Array.isArray(input))
      return { ok: false, field: "doc" };
    const value = input as Record<string, unknown>;
    for (const field of Object.keys(value)) if (field !== "timeZone") return { ok: false, field };
    if (typeof value.timeZone !== "string") return { ok: false, field: "timeZone" };
    return { ok: true, doc: { timeZone: value.timeZone } };
  },
});
