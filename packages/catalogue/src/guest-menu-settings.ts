import { defineSettingsDocument } from "@waitron/db";

export const GUEST_MENU_SETTINGS = defineSettingsDocument<{ enabled: boolean }>({
  module: "catalogue",
  version: 1,
  transfers: false,
  defaults: () => ({ enabled: false }),
  parse(doc) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return { ok: false, field: "doc" };
    const value = doc as Record<string, unknown>;
    for (const key of Object.keys(value)) if (key !== "enabled") return { ok: false, field: key };
    if (typeof value.enabled !== "boolean") return { ok: false, field: "enabled" };
    return { ok: true, doc: { enabled: value.enabled } };
  },
});
