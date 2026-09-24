import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale, subscribeLocale, t } from "./t.js";
import { catalogues, en } from "./strings.js";

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

it("uses the cash-register wording for the register-meaning strings", () => {
  // The device-KIND label (devices.kind_till) means the device, and is deliberately not swept here.
  expect(en["devices.till"]).toBe("Cash register");
  expect(en["sales.till"]).toBe("Cash register");
  expect(en["sales.tender_title"]).toBe("Tender by cash register");
  expect(en["printers.no_tills"]).toBe("No cash registers yet");
  expect(en["printers.receipt_printer_title"]).toBe("Receipt printer per cash register");
  expect(en["device_profiles.form_factor.till"]).toBe("Cash register");
});

it("registers en-GB as a first-class catalogue entry", () => {
  expect(catalogues["en-GB"]).toBe(en);
});
