import { ibanProblem, isUuid, normalizeIban, privacyContactProblem } from "@waitron/shared";
import { DEFAULT_TIME_ZONE } from "./schema/taxpayer.js";
import { defineSettingsDocument, type SettingsParse } from "./settings.js";

/** `iban` is stored as `normalizeIban` writes it; `bankName` is never blank. */
export interface BankAccount {
  iban: string;
  bankName: string | null;
}

export interface VenueSettings {
  privacyNoticeUrl: string | null;
  privacyEmail: string | null;
  cloudVenueId: string | null;
  streamId: string | null;
  name: string;
  fiscalTerritory: string;
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
  bankAccount: BankAccount | null;
}

function parseBankAccount(input: unknown): BankAccount | null | undefined {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) return undefined;
  const { iban, bankName, ...rest } = input as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return undefined;
  if (typeof iban !== "string" || iban !== normalizeIban(iban) || ibanProblem(iban) !== undefined)
    return undefined;
  if (bankName !== null && (typeof bankName !== "string" || bankName.trim() === ""))
    return undefined;
  return { iban, bankName };
}

export const VENUE_SETTINGS = defineSettingsDocument<VenueSettings>({
  module: "venue",
  version: 1,
  transfers: false,
  defaults: () => ({
    privacyNoticeUrl: null,
    privacyEmail: null,
    cloudVenueId: null,
    streamId: null,
    name: "",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es"],
    contentLanguages: null,
    defaultContentLanguage: null,
    holidayArea: null,
    addressLine1: null,
    addressLine2: null,
    postalCode: null,
    city: null,
    province: null,
    bankAccount: null,
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
        field !== "privacyNoticeUrl" &&
        field !== "privacyEmail" &&
        field !== "cloudVenueId" &&
        field !== "streamId" &&
        field !== "name" &&
        field !== "fiscalTerritory" &&
        field !== "bankAccount" &&
        !["invoiceLocales", "contentLanguages", "defaultContentLanguage", "holidayArea"].includes(
          field,
        ) &&
        !addressFields.includes(field as (typeof addressFields)[number])
      )
        return { ok: false, field };
    for (const field of ["cloudVenueId", "streamId"])
      if (
        value[field] !== undefined &&
        value[field] !== null &&
        (typeof value[field] !== "string" || !isUuid(value[field]))
      )
        return { ok: false, field };
    if (typeof value.name !== "string" || value.name.trim() === "")
      return { ok: false, field: "name" };
    if (typeof value.fiscalTerritory !== "string" || value.fiscalTerritory.trim() === "")
      return { ok: false, field: "fiscalTerritory" };
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
    for (const field of ["privacyNoticeUrl", "privacyEmail"] as const) {
      const contact = value[field];
      if (
        (contact !== null && typeof contact !== "string") ||
        privacyContactProblem(field, contact as string | null) !== undefined
      )
        return { ok: false, field };
    }
    const bankAccount = parseBankAccount(value.bankAccount);
    if (bankAccount === undefined) return { ok: false, field: "bankAccount" };
    return {
      ok: true,
      doc: {
        privacyNoticeUrl: value.privacyNoticeUrl as string | null,
        privacyEmail: value.privacyEmail as string | null,
        cloudVenueId: (value.cloudVenueId as string | null | undefined) ?? null,
        streamId: (value.streamId as string | null | undefined) ?? null,
        name: value.name.trim(),
        fiscalTerritory: value.fiscalTerritory,
        invoiceLocales: [...invoiceLocales],
        contentLanguages: languages === null ? null : [...(languages as string[])],
        defaultContentLanguage: defaultLanguage as string | null,
        holidayArea: area as VenueSettings["holidayArea"],
        addressLine1: value.addressLine1 as string | null,
        addressLine2: value.addressLine2 as string | null,
        postalCode: value.postalCode as string | null,
        city: value.city as string | null,
        province: value.province as string | null,
        bankAccount,
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
