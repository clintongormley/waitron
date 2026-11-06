import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuUndoCommand } from "@waitron/catalogue/src/menu-undo.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { sendMenuUndo, undoRefusalText, type MenuUndoApi } from "./menu-undo.js";

function recordingApi() {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const api = {
    renameCatalogue: record("renameCatalogue"),
    updateMenuItem: record("updateMenuItem"),
    setMenuVariantPrice: record("setMenuVariantPrice"),
    updateSection: record("updateSection"),
    setHomeDisplay: record("setHomeDisplay"),
  } as unknown as MenuUndoApi;
  return { api, calls };
}

const rename: MenuUndoCommand = { method: "renameCatalogue", menuId: "m1", name: "Dinner" };
const dishPrice: MenuUndoCommand = {
  method: "updateMenuItem",
  menuId: "m1",
  menuItemId: "i1",
  input: { grossPrice: null },
  name: "Burger",
};
const variantPrice: MenuUndoCommand = {
  method: "setMenuVariantPrice",
  menuId: "m1",
  menuItemId: "i1",
  variantId: "v1",
  price: "0.00",
  name: "Lemonade",
};
const section: MenuUndoCommand = {
  method: "updateSection",
  sectionId: "s1",
  patch: { color: null },
  name: "Mains",
};
const display: MenuUndoCommand = {
  method: "setHomeDisplay",
  menuId: "m1",
  device: "handheld",
  patch: { columns: 3 },
};

describe("sendMenuUndo", () => {
  it.each([
    [rename, "renameCatalogue", ["m1", "Dinner"]],
    [dishPrice, "updateMenuItem", ["m1", "i1", { grossPrice: null }]],
    [variantPrice, "setMenuVariantPrice", ["m1", "i1", "v1", "0.00"]],
    [section, "updateSection", ["s1", { color: null }]],
    [display, "setHomeDisplay", ["m1", "handheld", { columns: 3 }]],
  ] as const)(
    "sends %o as one %s call with its arguments and no display name",
    async (command, method, args) => {
      const { api, calls } = recordingApi();
      await sendMenuUndo(api, command);
      expect(calls).toEqual([{ method, args }]);
    },
  );

  it("passes a refusal on to the caller", async () => {
    const refusal = { code: "menu.name_taken" };
    const api = {
      renameCatalogue: vi.fn(async () => {
        throw refusal;
      }),
    } as unknown as MenuUndoApi;
    await expect(sendMenuUndo(api, rename)).rejects.toBe(refusal);
  });
});

describe("undoRefusalText", () => {
  const original = currentLocale();
  beforeEach(() => setLocale("en-GB"));
  afterEach(() => setLocale(original));

  const refused = (code: string) => ({ code });
  const tillDisplay: MenuUndoCommand = { ...display, device: "till" } as MenuUndoCommand;

  it.each([
    [
      "menu.name_taken",
      rename,
      "Another menu is now called Dinner. Rename that menu, then undo this again.",
    ],
    ["catalogue.not_found", rename, "This menu has been deleted, so there is nothing to put back."],
    [
      "catalogue.not_found",
      display,
      "This menu has been deleted, so there is nothing to put back.",
    ],
    [
      "menu_item.not_found",
      dishPrice,
      "Burger is no longer on this menu, so its price here cannot be put back. Add it to the menu again first, or hide this change.",
    ],
    [
      "menu_item.not_found",
      variantPrice,
      "Lemonade is no longer on this menu, so its price here cannot be put back. Add it to the menu again first, or hide this change.",
    ],
    [
      "menu_section.not_found",
      section,
      "Section Mains has been deleted, so it cannot be put back.",
    ],
    [
      "menu_section.invalid",
      section,
      "Mains's published photo or colour can no longer be used. Change it on the Structure tab, or hide this change.",
    ],
    [
      "content.translation_invalid",
      section,
      "A language Mains was published in has been switched off since, so its name cannot be put back. Change it on the Structure tab, or hide this change.",
    ],
    [
      "menu.home_display_invalid",
      display,
      "The published Handheld display setting is no longer offered. Choose one on the Home page tab, or hide this change.",
    ],
    [
      "menu.home_display_invalid",
      tillDisplay,
      "The published Till display setting is no longer offered. Choose one on the Home page tab, or hide this change.",
    ],
  ] as const)("words %s from %o", (code, command, expected) => {
    expect(undoRefusalText(refused(code), command)).toBe(expected);
  });

  it("words a refusal in Spanish when the screen is in Spanish", () => {
    setLocale("es");
    expect(undoRefusalText(refused("menu.home_display_invalid"), tillDisplay)).toBe(
      "El ajuste de pantalla publicado para Caja registradora ya no se ofrece. Elige otro en la pestaña Página de inicio u oculta este cambio.",
    );
    expect(undoRefusalText(refused("menu.name_taken"), rename)).toBe(
      "Otra carta se llama ahora Dinner. Cambia el nombre de esa carta y vuelve a deshacer esto.",
    );
  });

  it("falls back to the code's own message for a code no sentence names", () => {
    expect(undoRefusalText(refused("management.request_invalid"), rename)).toBe(
      codeMessage("management.request_invalid"),
    );
  });

  it("falls back to the code's own message for a variant no longer active", () => {
    expect(undoRefusalText(refused("product.variant_not_found"), variantPrice)).toBe(
      codeMessage("product.variant_not_found"),
    );
  });

  it("falls back to the code's own message when the code comes from a write it does not belong to", () => {
    expect(undoRefusalText(refused("menu.name_taken"), section)).toBe(
      codeMessage("menu.name_taken"),
    );
  });
});
