import type { Transaction } from "@waitron/db";
import { AppError, colorOrNull, isStoredColor, VAT_CLASSES, type VatClass } from "@waitron/shared";
import { defineSettingsDocument, readSettings, saveSettings } from "@waitron/db";
import "./errors.js";

import type { MenuDefaults } from "./settings-types.js";
export type { MenuDefaults } from "./settings-types.js";

export interface MenuSettings extends MenuDefaults {
  readonly starterUnitsCreated: boolean;
}

export const MENU_SETTINGS = defineSettingsDocument<MenuSettings>({
  module: "menu",
  version: 1,
  transfers: true,
  defaults: () => ({
    defaultProductVatClass: "general",
    defaultColor: null,
    starterUnitsCreated: false,
  }),
  parse(doc) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return { ok: false, field: "doc" };
    const value = doc as Record<string, unknown>;
    for (const key of Object.keys(value))
      if (!["defaultProductVatClass", "defaultColor", "starterUnitsCreated"].includes(key))
        return { ok: false, field: key };
    if (
      typeof value.defaultProductVatClass !== "string" ||
      !VAT_CLASSES.includes(value.defaultProductVatClass as VatClass)
    )
      return { ok: false, field: "defaultProductVatClass" };
    if (value.defaultColor !== null && !isStoredColor(value.defaultColor))
      return { ok: false, field: "defaultColor" };
    if (typeof value.starterUnitsCreated !== "boolean")
      return { ok: false, field: "starterUnitsCreated" };
    return {
      ok: true,
      doc: {
        defaultProductVatClass: value.defaultProductVatClass as VatClass,
        defaultColor: value.defaultColor as string | null,
        starterUnitsCreated: value.starterUnitsCreated,
      },
    };
  },
});

export async function readMenuSettings(tx: Transaction): Promise<MenuDefaults> {
  const { doc } = await readSettings(tx, MENU_SETTINGS);
  return { defaultProductVatClass: doc.defaultProductVatClass, defaultColor: doc.defaultColor };
}

async function upsertSettings(
  tx: Transaction,
  values: Partial<MenuDefaults>,
  personId: string | null,
): Promise<MenuDefaults> {
  const { doc, revision } = await readSettings(tx, MENU_SETTINGS);
  const saved = await saveSettings(tx, MENU_SETTINGS, {
    doc: { ...doc, ...values },
    expectedRevision: revision,
    personId,
  });
  return {
    defaultProductVatClass: saved.doc.defaultProductVatClass,
    defaultColor: saved.doc.defaultColor,
  };
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
