import { defineSettingsDocument } from "@waitron/db";
import type { ModulePermission } from "@waitron/module";

export const PAYMENTS_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "payments.providers.manage", defaultHolders: [] },
];
export const PAYMENTS_SETTINGS = defineSettingsDocument<{ providers: Record<string, boolean> }>({
  module: "payments",
  version: 1,
  transfers: false,
  defaults: () => ({ providers: {} }),
  parse(doc) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return { ok: false, field: "doc" };
    const value = doc as Record<string, unknown>;
    if (Object.keys(value).some((key) => key !== "providers")) return { ok: false, field: "doc" };
    if (
      typeof value.providers !== "object" ||
      value.providers === null ||
      Array.isArray(value.providers)
    )
      return { ok: false, field: "providers" };
    if (Object.values(value.providers).some((enabled) => typeof enabled !== "boolean"))
      return { ok: false, field: "providers" };
    return { ok: true, doc: { providers: { ...value.providers } as Record<string, boolean> } };
  },
});
