import { defineSettingsDocument, type SettingsParse } from "./settings.js";

export interface VenueSettings {
  name: string;
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
      if (field !== "name" && !addressFields.includes(field as (typeof addressFields)[number]))
        return { ok: false, field };
    if (typeof value.name !== "string" || value.name.trim() === "")
      return { ok: false, field: "name" };
    for (const field of addressFields)
      if (value[field] !== null && typeof value[field] !== "string") return { ok: false, field };
    return {
      ok: true,
      doc: {
        name: value.name.trim(),
        addressLine1: value.addressLine1 as string | null,
        addressLine2: value.addressLine2 as string | null,
        postalCode: value.postalCode as string | null,
        city: value.city as string | null,
        province: value.province as string | null,
      },
    };
  },
});
