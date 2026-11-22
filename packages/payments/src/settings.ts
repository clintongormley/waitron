import { defineSettingsDocument, readSettings, type Database, type Transaction } from "@waitron/db";
import type { ModulePermission } from "@waitron/module";

export const PAYMENTS_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "payments.providers.manage", defaultHolders: [] },
];
interface PaymentsDocument {
  providers: Record<string, boolean>;
  tipsEnabled: boolean;
  testProviders: boolean;
}

export const PAYMENTS_SETTINGS = defineSettingsDocument<PaymentsDocument>({
  module: "payments",
  version: 1,
  transfers: ["tipsEnabled", "testProviders"] satisfies (keyof PaymentsDocument)[],
  defaults: () => ({ providers: {}, tipsEnabled: false, testProviders: false }),
  parse(doc) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return { ok: false, field: "doc" };
    const value = doc as Record<string, unknown>;
    const extra = Object.keys(value).find(
      (key) => key !== "providers" && key !== "tipsEnabled" && key !== "testProviders",
    );
    if (extra !== undefined) return { ok: false, field: extra };
    const { tipsEnabled = false, testProviders = false } = value;
    if (typeof tipsEnabled !== "boolean") return { ok: false, field: "tipsEnabled" };
    if (typeof testProviders !== "boolean") return { ok: false, field: "testProviders" };
    if (
      typeof value.providers !== "object" ||
      value.providers === null ||
      Array.isArray(value.providers)
    )
      return { ok: false, field: "providers" };
    if (Object.values(value.providers).some((enabled) => typeof enabled !== "boolean"))
      return { ok: false, field: "providers" };
    return {
      ok: true,
      doc: {
        providers: { ...value.providers } as Record<string, boolean>,
        tipsEnabled,
        testProviders,
      },
    };
  },
});

export function readPaymentsSettings(db: Database | Transaction) {
  return readSettings(db, PAYMENTS_SETTINGS);
}
