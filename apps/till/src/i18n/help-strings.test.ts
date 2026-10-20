import { afterEach, describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "./t.js";
import { helpBadgeLabel, helpEn, helpEs, helpText } from "./help-strings.js";
import { es } from "./strings.js";

const original = currentLocale();
afterEach(() => setLocale(original));

describe("the till's help strings", () => {
  it("falls back to English for an unknown locale and for a region it does not list", () => {
    expect(helpText("help.label", "fr-FR")).toBe(helpEn["help.label"]);
    expect(helpText("help.label", "es-MX")).toBe(helpEn["help.label"]);
    expect(helpText("help.label", "en-GB")).toBe(helpEn["help.label"]);
  });

  it("reads Spanish for es and es-ES", () => {
    expect(helpText("help.label", "es")).toBe(helpEs["help.label"]);
    expect(helpText("help.label", "es-ES")).toBe(helpEs["help.label"]);
    expect(helpEs["help.label"]).not.toBe(helpEn["help.label"]);
  });

  it("reads the active locale when none is given", () => {
    setLocale("es-ES");
    expect(helpText("help.label")).toBe(helpEs["help.label"]);
    setLocale("en-GB");
    expect(helpText("help.label")).toBe(helpEn["help.label"]);
  });

  it("fills the badge label's part as written, in the active locale", () => {
    setLocale("en-GB");
    expect(helpBadgeLabel("Profile")).toBe(helpEn["help.badge_label"].replace("{part}", "Profile"));
    expect(helpBadgeLabel("$& {part}")).toBe(
      helpEn["help.badge_label"].replace("{part}", () => "$& {part}"),
    );
    setLocale("es-ES");
    expect(helpBadgeLabel("Perfil")).toBe(helpEs["help.badge_label"].replace("{part}", "Perfil"));
  });

  it("no Spanish help text says menú", () => {
    const menuWord = /(?<!\p{L})men[úu]s?(?!\p{L})/iu;
    const saysMenu = Object.entries(helpEs).filter(([, text]) =>
      menuWord.test(text.replace(/\{[^}]*\}/g, "")),
    );
    expect(saysMenu).toEqual([]);
  });

  it("no Spanish help text says tique", () => {
    const tiqueWord = /(?<!\p{L})tiques?(?!\p{L})/iu;
    const saysTique = Object.entries(helpEs).filter(([, text]) =>
      tiqueWord.test(text.replace(/\{[^}]*\}/g, "")),
    );
    expect(saysTique).toEqual([]);
  });

  it("no Spanish help text says retenido", () => {
    const saysRetenido = Object.entries(helpEs).filter(([, text]) => /retenid/i.test(text));
    expect(saysRetenido).toEqual([]);
  });
});

describe("the order screen's help", () => {
  it("the order screen's Send help calls a held group by the same word", () => {
    expect(helpEs["help.order.send"]).toContain(es["table.group_held"].toLowerCase());
  });
});
