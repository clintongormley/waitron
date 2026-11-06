import type { MenuUndoCommand } from "@waitron/catalogue/src/menu-undo.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import type { DashboardApi } from "./client.js";

export type MenuUndoApi = Pick<DashboardApi, MenuUndoCommand["method"]>;

/** Sends the command's one write; its display names stay behind. */
export async function sendMenuUndo(api: MenuUndoApi, command: MenuUndoCommand): Promise<void> {
  switch (command.method) {
    case "renameCatalogue":
      return api.renameCatalogue(command.menuId, command.name);
    case "updateMenuItem":
      return api.updateMenuItem(command.menuId, command.menuItemId, command.input);
    case "setMenuVariantPrice":
      return api.setMenuVariantPrice(
        command.menuId,
        command.menuItemId,
        command.variantId,
        command.price,
      );
    case "updateSection":
      await api.updateSection(command.sectionId, command.patch);
      return;
    case "setHomeDisplay":
      return api.setHomeDisplay(command.menuId, command.device, command.patch);
  }
}

/** The sentence for a refused Undo; a code its write is not expected to answer keeps its own text. */
export function undoRefusalText(error: unknown, command: MenuUndoCommand): string {
  const code = codeOf(error);
  const sentence = refusalSentence(code, command, refusedField(error));
  return sentence ? fill(sentence.key, sentence.values) : codeMessage(code);
}

const SECTION_REFUSALS: Readonly<Record<string, StringKey>> = {
  "menu_section.not_found": "menu_preview.undo_section_gone",
  "menu_section.invalid": "menu_preview.undo_section_invalid",
  "content.translation_invalid": "menu_preview.undo_language_off",
};

function refusedField(error: unknown): unknown {
  return (error as { params?: { field?: unknown } } | null)?.params?.field;
}

/** `menu_section.invalid` also answers a malformed name; only these fields are the photo or colour. */
const PRESENTATION_FIELDS: readonly unknown[] = ["color", "image"];

/** With no field named, the refusal can be blamed on the photo or colour only when the Undo sent
 * nothing else. */
function refusesPresentation(field: unknown, patch: object): boolean {
  if (field !== undefined) return PRESENTATION_FIELDS.includes(field);
  return Object.keys(patch).every((key) => PRESENTATION_FIELDS.includes(key));
}

function refusalSentence(
  code: string,
  command: MenuUndoCommand,
  field: unknown,
): { key: StringKey; values: Record<string, string> } | null {
  switch (command.method) {
    case "renameCatalogue":
      if (code === "menu.name_taken")
        return { key: "menu_preview.undo_name_taken", values: { name: command.name } };
      if (code === "catalogue.not_found") return { key: "menu_preview.undo_menu_gone", values: {} };
      return null;
    case "updateMenuItem":
    case "setMenuVariantPrice":
      if (code === "menu_item.not_found")
        return { key: "menu_preview.undo_item_gone", values: { name: command.name } };
      return null;
    case "updateSection": {
      if (code === "menu_section.invalid" && !refusesPresentation(field, command.patch))
        return null;
      const key = SECTION_REFUSALS[code];
      return key ? { key, values: { name: command.name } } : null;
    }
    case "setHomeDisplay":
      if (code === "catalogue.not_found") return { key: "menu_preview.undo_menu_gone", values: {} };
      if (code === "menu.home_display_invalid")
        return {
          key: "menu_preview.undo_display_invalid",
          values: {
            device: t(command.device === "handheld" ? "home.device_handheld" : "home.device_till"),
          },
        };
      return null;
  }
}
