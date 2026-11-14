import { defineSettingsDocument } from "@waitron/db";
import { isStoredColor, type GuestMenuPaperAppearance } from "@waitron/shared";

export const GUEST_MENU_SETTINGS = defineSettingsDocument<{
  enabled: boolean;
  paper?: GuestMenuPaperAppearance;
}>({
  module: "catalogue",
  version: 1,
  transfers: false,
  defaults: () => ({ enabled: false }),
  parse(doc) {
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return { ok: false, field: "doc" };
    const value = doc as Record<string, unknown>;
    for (const key of Object.keys(value))
      if (key !== "enabled" && key !== "paper") return { ok: false, field: key };
    if (typeof value.enabled !== "boolean") return { ok: false, field: "enabled" };
    if (Object.hasOwn(value, "paper")) {
      const p = value.paper;
      if (typeof p !== "object" || p === null || Array.isArray(p))
        return { ok: false, field: "paper" };
      const paper = p as Record<string, unknown>;
      const valid = {
        preset: ["bistro", "lunch-wine"],
        font: ["serif", "sans"],
        spacing: ["compact", "comfortable"],
        key: ["end", "inline"],
      };
      for (const [key, choices] of Object.entries(valid))
        if (typeof paper[key] !== "string" || !choices.includes(paper[key]))
          return { ok: false, field: `paper.${key}` };
      for (const key of ["ink", "accent"])
        if (!isStoredColor(paper[key])) return { ok: false, field: `paper.${key}` };
      for (const key of Object.keys(paper))
        if (![...Object.keys(valid), "ink", "accent"].includes(key))
          return { ok: false, field: `paper.${key}` };
      return {
        ok: true,
        doc: { enabled: value.enabled, paper: paper as unknown as GuestMenuPaperAppearance },
      };
    }
    return { ok: true, doc: { enabled: value.enabled } };
  },
});
