import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale, subscribeLocale, t } from "./t.js";
import { catalogues, en, es } from "./strings.js";

afterEach(() => {
  // Reset to the shipped default so a setLocale in one test cannot leak into another.
  setLocale("es-ES");
});

it("resolves an English base key to Spanish", () => {
  expect(t("action.save", "es-ES")).toBe("Guardar");
});

it("falls back to the English base when a locale lacks the key", () => {
  expect(t("action.save", "en")).toBe("Save");
});

it("falls back to the English base for an unknown locale", () => {
  expect(t("action.save", "fr")).toBe("Save");
});

it("defaults to the module locale when none is passed", () => {
  expect(t("action.save")).toBe("Guardar");
  setLocale("en");
  expect(currentLocale()).toBe("en");
  expect(t("action.save")).toBe("Save");
});

it("notifies subscribers on setLocale and stops after unsubscribe", () => {
  let calls = 0;
  const off = subscribeLocale(() => {
    calls += 1;
  });
  setLocale("en-GB");
  expect(calls).toBe(1);
  off();
  setLocale("es-ES");
  expect(calls).toBe(1);
});

it("titles the Sales tender section by device in English and Spanish", () => {
  expect(t("sales.tender_title", "en")).toBe("Tender by device");
  expect(t("sales.tender_title", "es-ES")).toBe("Cobros por dispositivo");
});

it("keeps the cash-register wording for the till form factor", () => {
  expect(en["device_profiles.form_factor.till"]).toBe("Cash register");
});

it("heads the Sales screen's tender column Device, because a sale's origin is a device", () => {
  expect(en["sales.device"]).toBe("Device");
  expect(es["sales.device"]).toBe("Dispositivo");
});

it("calls the Structure tab's picker button Add products in English and Spanish", () => {
  expect(en["sections.add_products"]).toBe("Add products");
  expect(es["sections.add_products"]).toBe("Añadir productos");
});

it("registers en-GB as a first-class catalogue entry", () => {
  expect(catalogues["en-GB"]).toBe(en);
});

it("calls restaurant menus cartas in Spanish, keeping the account menu distinct", () => {
  expect(t("menus.menu_prefix", "es-ES")).toBe("Carta: {name}");
  expect(t("menus.include_menu", "es-ES")).toBe("Incluir una carta");
  expect(t("menus.remove_included", "es-ES")).toBe("Quitar de esta carta");
  expect(t("nav.account_menu", "es-ES")).toBe("Menú de cuenta");
});

it.each([
  ["en-GB", "Search"],
  ["es-ES", "Buscar"],
])("labels the Home preview search simply in %s", (locale, label) => {
  expect(t("home.search", locale)).toBe(label);
});
