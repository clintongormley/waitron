import { defineSettingsDocument, readSettings, saveSettings, type Transaction } from "@waitron/db";
import {
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  type Decimal,
} from "@waitron/shared";

export interface AdjustmentSettings {
  maxBillComp: Decimal | null;
}

export interface AdjustmentsDocument {
  maxBillComp: number | null;
}
export const ADJUSTMENTS_SETTINGS = defineSettingsDocument<AdjustmentsDocument>({
  module: "adjustments",
  version: 1,
  transfers: true,
  defaults: () => ({ maxBillComp: null }),
  parse(doc) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return { ok: false, field: "doc" };
    const value = doc as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (key !== "maxBillComp") return { ok: false, field: key };
    }
    if (
      value.maxBillComp !== null &&
      (typeof value.maxBillComp !== "number" ||
        !Number.isSafeInteger(value.maxBillComp) ||
        value.maxBillComp < 0)
    )
      return { ok: false, field: "maxBillComp" };
    return {
      ok: true,
      doc: {
        maxBillComp: value.maxBillComp as number | null,
      },
    };
  },
});
export type AdjustmentSettingsRead = AdjustmentSettings & { revision: number };

export async function readAdjustmentSettings(tx: Transaction): Promise<AdjustmentSettingsRead> {
  const { doc, revision } = await readSettings(tx, ADJUSTMENTS_SETTINGS);
  return {
    maxBillComp: doc.maxBillComp === null ? null : centsToDecimal(doc.maxBillComp),
    revision,
  };
}

export async function saveAdjustmentSettings(
  tx: Transaction,
  settings: AdjustmentSettings,
  change: { expectedRevision: number; personId: string | null },
): Promise<AdjustmentSettingsRead> {
  const { maxBillComp } = settings;
  if (
    maxBillComp !== null &&
    (compareDecimal(maxBillComp, decimal("0")) < 0 ||
      compareDecimal(centsToDecimal(decimalToCents(maxBillComp)), maxBillComp) !== 0)
  ) {
    throw new RangeError("maxBillComp is not a nonnegative amount in whole cents");
  }
  const { revision, doc } = await saveSettings(tx, ADJUSTMENTS_SETTINGS, {
    ...change,
    doc: {
      maxBillComp: maxBillComp === null ? null : decimalToCents(maxBillComp),
    },
  });
  return {
    maxBillComp: doc.maxBillComp === null ? null : centsToDecimal(doc.maxBillComp),
    revision,
  };
}
