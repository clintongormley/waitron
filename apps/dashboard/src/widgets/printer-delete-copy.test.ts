import { afterEach, describe, expect, it } from "vitest";
import type { DeleteImpact, DeleteImpactItem } from "@waitron/shared";
import { currentLocale, setLocale } from "../i18n/t.js";
import { printerDeleteCopy } from "./printer-delete-copy.js";

const before = currentLocale();
afterEach(() => setLocale(before));

const clint = { id: "d-clint", name: "Clint" };
const handheld = { id: "p-handheld", name: "Handheld" };
const bar = { id: "d-bar", name: "Bar" };
const pass = { id: "d-pass", name: "Pass" };
const inactive = { id: "d-old", name: "Old till", deleted: true };
const item = (key: string, targets = [clint], count = targets.length): DeleteImpactItem => ({
  key,
  count,
  targets,
});
const impact = (removes: DeleteImpactItem[] = [], ends: DeleteImpactItem[] = []): DeleteImpact => ({
  target: { id: "p1", name: "BlueTooth Printer" },
  refusals: [],
  removes,
  ends,
});

describe("printer delete confirmation", () => {
  it.each([
    [
      "en",
      "Delete BlueTooth Printer?",
      "It will be unpaired, and removed from Clint and the Handheld profile.",
    ],
    [
      "es",
      "¿Eliminar BlueTooth Printer?",
      "Se desvinculará y se quitará de Clint y del perfil Handheld.",
    ],
  ])(
    "names the printer and each affected device and profile once in %s",
    (locale, heading, sentence) => {
      setLocale(locale);
      const copy = printerDeleteCopy("BlueTooth Printer", true);
      expect(copy.heading).toBe(heading);
      expect(
        copy.summary(
          impact([
            item("device_receipt"),
            item("device_cash_drawer_default"),
            item("profile_receipt", [handheld]),
            item("profile_receipt_default", [handheld]),
          ]),
        ),
      ).toEqual({ sentence, ends: [] });
    },
  );

  it.each([
    [[clint, bar, pass, inactive], "It will be removed from Clint, Bar, and Pass."],
    [
      [clint, bar, pass, { id: "d-office", name: "Office" }, inactive],
      "It will be removed from 4 devices.",
    ],
  ] as const)(
    "names up to three active A4 device assignments, then counts them",
    (targets, sentence) => {
      setLocale("en");
      const affected = impact([item("device_invoice", [...targets])]);
      expect(printerDeleteCopy("Office").summary(affected).sentence).toBe(sentence);
    },
  );

  it.each([
    [false, ""],
    [true, "It will be unpaired."],
  ])(
    "has no assignments to name when every assigned device is switched off",
    (bluetooth, sentence) => {
      setLocale("en");
      expect(
        printerDeleteCopy("Receipt", bluetooth).summary(
          impact([item("device_receipt", [inactive])]),
        ),
      ).toEqual({ sentence, ends: [] });
    },
  );

  it("names the holder of a portable printer without calling it work that ends", () => {
    setLocale("en");
    expect(printerDeleteCopy("Portable").summary(impact([], [item("portable_holder")]))).toEqual({
      sentence: "It will be removed from Clint.",
      ends: [],
    });
  });

  it.each([
    [[item("print_jobs", [], 3), item("invoice_receipts", [], 1)], "3 pending print jobs"],
    [[item("print_jobs", [], 0), item("invoice_receipts", [], 1)], "1 unprinted invoice receipt"],
    [[item("invoice_a4", [], 2)], "2 pending A4 invoice print jobs"],
  ])("shows one work line for the jobs the printer will stop", (jobs, line) => {
    setLocale("en");
    expect(printerDeleteCopy("Office").summary(impact([], jobs)).ends).toEqual([line]);
  });

  it("words a refusal with the code's message and any named targets", () => {
    setLocale("en");
    const copy = printerDeleteCopy("Receipt");
    expect(copy.refusal({ code: "printer.not_found", params: {}, targets: [clint, bar] })).toBe(
      "That printer no longer exists: Clint, Bar",
    );
    expect(copy.refusal({ code: "printer.not_found", params: {}, targets: [] })).toBe(
      "That printer no longer exists",
    );
  });
});
