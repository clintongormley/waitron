import type { Transaction, VenueSettings } from "@waitron/db";
import { AppError, colorOrNull, isStoredColor, VAT_CLASSES, type VatClass } from "@waitron/shared";
import { defineSettingsDocument, readSettings, saveSettings } from "@waitron/db";
import type { AreaVatRates } from "@waitron/country-packs";
import { readVenueVatRates } from "./takeaway-vat-rates.js";
import "./errors.js";

import type { MenuDefaults } from "./settings-types.js";
export type { MenuDefaults } from "./settings-types.js";

export interface MenuSettings extends Omit<MenuDefaults, "defaultTakeawayVatRate"> {
  /** Null takes the area's default from its pack. */
  readonly defaultTakeawayVatRate: string | null;
  readonly starterUnitsCreated: boolean;
}

const RATE_SPELLING = /^\d+\.\d{2}$/;

export const MENU_SETTINGS = defineSettingsDocument<MenuSettings>({
  module: "menu",
  version: 1,
  transfers: true,
  defaults: () => ({
    defaultProductVatClass: "general",
    defaultTakeawayVatRate: null,
    defaultColor: null,
    starterUnitsCreated: false,
  }),
  parse(doc) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return { ok: false, field: "doc" };
    const value = doc as Record<string, unknown>;
    for (const key of Object.keys(value))
      if (
        ![
          "defaultProductVatClass",
          "defaultTakeawayVatRate",
          "defaultColor",
          "starterUnitsCreated",
        ].includes(key)
      )
        return { ok: false, field: key };
    if (
      typeof value.defaultProductVatClass !== "string" ||
      !VAT_CLASSES.includes(value.defaultProductVatClass as VatClass)
    )
      return { ok: false, field: "defaultProductVatClass" };
    if (
      value.defaultTakeawayVatRate !== null &&
      (typeof value.defaultTakeawayVatRate !== "string" ||
        !RATE_SPELLING.test(value.defaultTakeawayVatRate))
    )
      return { ok: false, field: "defaultTakeawayVatRate" };
    if (value.defaultColor !== null && !isStoredColor(value.defaultColor))
      return { ok: false, field: "defaultColor" };
    if (typeof value.starterUnitsCreated !== "boolean")
      return { ok: false, field: "starterUnitsCreated" };
    return {
      ok: true,
      doc: {
        defaultProductVatClass: value.defaultProductVatClass as VatClass,
        defaultTakeawayVatRate: value.defaultTakeawayVatRate as string | null,
        defaultColor: value.defaultColor as string | null,
        starterUnitsCreated: value.starterUnitsCreated,
      },
    };
  },
});

/** A caller that has already read the area's rates passes them as `rates`. */
export async function readMenuSettings(
  tx: Transaction,
  rates?: AreaVatRates,
): Promise<MenuDefaults> {
  const { doc } = await readSettings(tx, MENU_SETTINGS);
  return menuDefaultsOf(tx, doc, rates);
}

/** The venue's default colour alone, which reads no VAT rates. */
export async function readMenuDefaultColor(tx: Transaction): Promise<string | null> {
  return (await readSettings(tx, MENU_SETTINGS)).doc.defaultColor;
}

/**
 * The area's rates with `defaultTakeaway` the rate new products start at: the venue's saved
 * default, else the area's. A caller that has already read the venue's settings passes them.
 */
export async function readNewProductVatRates(
  tx: Transaction,
  venue?: VenueSettings,
): Promise<AreaVatRates> {
  const area = await readVenueVatRates(tx, venue);
  const saved = (await readSettings(tx, MENU_SETTINGS)).doc.defaultTakeawayVatRate;
  return saved === null ? area : { ...area, defaultTakeaway: saved };
}

async function menuDefaultsOf(
  tx: Transaction,
  doc: MenuSettings,
  rates?: AreaVatRates,
): Promise<MenuDefaults> {
  return {
    defaultProductVatClass: doc.defaultProductVatClass,
    defaultTakeawayVatRate:
      doc.defaultTakeawayVatRate ?? (rates ?? (await readVenueVatRates(tx))).defaultTakeaway,
    defaultColor: doc.defaultColor,
  };
}

async function upsertSettings(
  tx: Transaction,
  values: Partial<MenuSettings>,
  personId: string | null,
): Promise<MenuDefaults> {
  const { doc, revision } = await readSettings(tx, MENU_SETTINGS);
  const saved = await saveSettings(tx, MENU_SETTINGS, {
    doc: { ...doc, ...values },
    expectedRevision: revision,
    personId,
  });
  return menuDefaultsOf(tx, saved.doc);
}

export async function saveMenuSettings(
  tx: Transaction,
  input: { defaultProductVatClass: unknown },
  personId: string | null = null,
): Promise<MenuDefaults> {
  const value = input.defaultProductVatClass;
  if (typeof value !== "string" || !VAT_CLASSES.includes(value as VatClass))
    throw new AppError("product.invalid", { field: "defaultProductVatClass" });
  return upsertSettings(tx, { defaultProductVatClass: value as VatClass }, personId);
}

export async function saveMenuDefaultColor(
  tx: Transaction,
  color: unknown,
  personId: string | null = null,
): Promise<MenuDefaults> {
  const defaultColor = colorOrNull(color, () => {
    throw new AppError("category.invalid", { field: "color" });
  });
  return upsertSettings(tx, { defaultColor }, personId);
}

/** Saves the rate new products' takeaway VAT starts at: one of the area's pickable rates. */
export async function saveMenuDefaultTakeawayVatRate(
  tx: Transaction,
  rate: unknown,
  personId: string | null,
): Promise<MenuDefaults> {
  const rates = await readVenueVatRates(tx);
  if (typeof rate !== "string" || !rates.pickable.includes(rate))
    throw new AppError("product.invalid", { field: "defaultTakeawayVatRate" });
  return upsertSettings(tx, { defaultTakeawayVatRate: rate }, personId);
}
