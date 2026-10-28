import { afterEach, expect, it } from "vitest";
import { currentLocale, fill, setLocale, subscribeLocale, t } from "./t.js";
import { catalogues, en, es } from "./strings.js";
import { codeMessage } from "./codes.js";

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

it("says menú in Spanish only for an on-screen menu, never a restaurant one", () => {
  const menu = /(?<!\p{L})men[úu]s?(?!\p{L})/iu;
  const saysMenu = Object.entries(es)
    .filter(([, text]) => menu.test(text.replace(/\{\w+\}/g, "")))
    .map(([key]) => key);
  expect(saysMenu.sort()).toEqual(["appearance.colour.surface-raised", "nav.account_menu"]);
  expect(codeMessage("product.on_live_menu", "es")).not.toMatch(menu);
});

it.each([
  ["en-GB", "Search"],
  ["es-ES", "Buscar"],
])("labels the Home preview search simply in %s", (locale, label) => {
  expect(t("home.search", locale)).toBe(label);
});

it("fill inserts each value as written, never reading it as a pattern or a placeholder", () => {
  setLocale("en-GB");
  expect(fill("floor_plan_editor.name_range", { first: "A$&B {last}", last: "$1 $$" })).toBe(
    "A$&B {last} to $1 $$",
  );
  expect(fill("floor_plan_editor.name_range", { first: "X" })).toBe("X to {last}");
});

it("words every part of the Box status page in both languages, with the same placeholders", () => {
  const keys = Object.keys(en).filter((key) => key.startsWith("box_status."));
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  expect(keys).toEqual(expect.arrayContaining(["box_status.title", "box_status.read_error"]));
  for (const key of keys as (keyof typeof en)[]) {
    expect(es[key], key).toBeTruthy();
    expect(es[key], key).not.toBe(en[key]);
    expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
  }
});
