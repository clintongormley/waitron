import { afterEach, describe, expect, it } from "vitest";
import type { DeleteImpactItem } from "@waitron/shared";
import { currentLocale, setLocale } from "../i18n/t.js";
import { printerDeleteCopy } from "./printer-delete-copy.js";

const before = currentLocale();
afterEach(() => setLocale(before));

const ana = { id: "d-ana", name: "Handheld Ana" };
const bar = { id: "d-bar", name: "Bar till" };
const waiters = { id: "dp-waiters", name: "Waiters" };
const item = (key: string, targets = [ana], count = targets.length): DeleteImpactItem => ({
  key,
  count,
  targets,
});

describe("a printer's delete dialog copy, in English", () => {
  it("words the dialog's fixed text", () => {
    setLocale("en");
    const copy = printerDeleteCopy();
    expect([
      copy.heading,
      copy.ends,
      copy.removes,
      copy.irreversible,
      copy.confirm,
      copy.cancel,
    ]).toEqual([
      "Delete printer?",
      "Work that will end",
      "Settings that will be removed",
      "This can't be undone.",
      "Delete",
      "Cancel",
    ]);
    expect(copy.refusals).not.toBe("");
    expect(copy.retry).not.toBe("");
    expect(copy.loading).not.toBe("");
  });

  it.each([
    [item("print_jobs", [], 4), "4 pending print jobs"],
    [item("print_jobs", [], 1), "1 pending print job"],
    [item("invoice_receipts", [], 2), "2 unprinted invoice receipts"],
    [item("invoice_receipts", [], 1), "1 unprinted invoice receipt"],
    [item("portable_holder"), "Handheld Ana stops carrying it"],
  ])("words the work %j ends", (ended, line) => {
    setLocale("en");
    expect(printerDeleteCopy().item(ended)).toBe(line);
  });

  it.each([
    [item("device_receipt", [bar, ana]), "Receipt printer of 2 devices: Bar till, Handheld Ana"],
    [item("device_payment_slip"), "Payment slip printer of 1 device: Handheld Ana"],
    [item("device_cash_drawer"), "Cash drawer of 1 device: Handheld Ana"],
    [item("profile_receipt", [waiters]), "Receipt printer in 1 profile: Waiters"],
    [item("profile_payment_slip", [waiters]), "Payment slip printer in 1 profile: Waiters"],
    [item("profile_cash_drawer", [waiters]), "Cash drawer in 1 profile: Waiters"],
    [item("profile_receipt_default", [waiters]), "Default receipt printer of 1 profile: Waiters"],
    [
      item("profile_payment_slip_default", [waiters]),
      "Default payment slip printer of 1 profile: Waiters",
    ],
    [item("profile_cash_drawer_default", [waiters]), "Default cash drawer of 1 profile: Waiters"],
    [item("device_receipt_default", [bar]), "Default receipt printer used by 1 device: Bar till"],
    [
      item("device_payment_slip_default", [bar, ana]),
      "Default payment slip printer used by 2 devices: Bar till, Handheld Ana",
    ],
    [item("device_cash_drawer_default", [bar]), "Default cash drawer used by 1 device: Bar till"],
    [item("station_printers", [{ id: "s-grill", name: "Grill" }]), "Prints for 1 station: Grill"],
  ])("words the setting %j removes, naming each target", (removed, line) => {
    setLocale("en");
    expect(printerDeleteCopy().item(removed)).toBe(line);
  });
});

describe("a printer's delete dialog copy, in Spanish", () => {
  it("words the dialog's fixed text", () => {
    setLocale("es");
    const copy = printerDeleteCopy();
    expect([
      copy.heading,
      copy.ends,
      copy.removes,
      copy.irreversible,
      copy.confirm,
      copy.cancel,
    ]).toEqual([
      "¿Eliminar la impresora?",
      "Trabajo que finalizará",
      "Configuración que se eliminará",
      "Esta acción no se puede deshacer.",
      "Eliminar",
      "Cancelar",
    ]);
  });

  it.each([
    [item("print_jobs", [], 4), "4 trabajos de impresión pendientes"],
    [item("print_jobs", [], 1), "1 trabajo de impresión pendiente"],
    [item("invoice_receipts", [], 2), "2 recibos de factura sin imprimir"],
    [item("invoice_receipts", [], 1), "1 recibo de factura sin imprimir"],
    [item("portable_holder"), "Handheld Ana dejará de llevarla"],
    [
      item("device_receipt", [bar, ana]),
      "Impresora de tickets de 2 dispositivos: Bar till, Handheld Ana",
    ],
    [item("device_cash_drawer"), "Cajón de 1 dispositivo: Handheld Ana"],
    [item("profile_payment_slip", [waiters]), "Impresora de justificantes en 1 perfil: Waiters"],
    [item("profile_cash_drawer_default", [waiters]), "Cajón predeterminado de 1 perfil: Waiters"],
    [
      item("device_receipt_default", [bar]),
      "Impresora de tickets predeterminada que usa 1 dispositivo: Bar till",
    ],
    [
      item("device_receipt_default", [bar, ana]),
      "Impresora de tickets predeterminada que usan 2 dispositivos: Bar till, Handheld Ana",
    ],
    [
      item("station_printers", [{ id: "s-grill", name: "Grill" }]),
      "Imprime para 1 estación: Grill",
    ],
  ])("words %j", (each, line) => {
    setLocale("es");
    expect(printerDeleteCopy().item(each)).toBe(line);
  });
});

describe.each(["en", "es"])("every fixed item key has its own wording (%s)", (locale) => {
  const keys = [
    "print_jobs",
    "invoice_receipts",
    "portable_holder",
    ...["receipt", "payment_slip", "cash_drawer"].flatMap((role) => [
      `device_${role}`,
      `profile_${role}`,
      `profile_${role}_default`,
      `device_${role}_default`,
    ]),
    "station_printers",
  ];

  it("no line shows a key or a target's id, and no two keys share a line", () => {
    setLocale(locale);
    const copy = printerDeleteCopy();
    const lines = keys.map((key) => copy.item(item(key, [{ id: "0b6e-uuid", name: "Named" }], 3)));
    for (const [index, line] of lines.entries()) {
      expect(line).not.toContain(keys[index]);
      expect(line).not.toContain("0b6e-uuid");
      expect(line).not.toContain("_");
    }
    expect(new Set(lines).size).toBe(keys.length);
  });

  it("a key it does not know still shows its count and names, never the key", () => {
    setLocale(locale);
    const line = printerDeleteCopy().item(item("future_link", [ana], 1));
    expect(line).toContain("Handheld Ana");
    expect(line).toContain("1");
    expect(line).not.toContain("future_link");
  });

  it("a key it does not know is worded so it fits under either heading", () => {
    setLocale(locale);
    const copy = printerDeleteCopy();
    expect(copy.item(item("future_link", [ana, bar], 2))).toBe("Handheld Ana, Bar till (2)");
    expect(copy.item(item("future_count", [], 3))).toBe("(3)");
  });
});

describe("a refusal, should a printer ever answer one", () => {
  it("words its code and names what it names, or the code alone", () => {
    setLocale("en");
    const copy = printerDeleteCopy();
    expect(copy.refusal({ code: "printer.not_found", params: {}, targets: [ana, bar] })).toBe(
      "That printer no longer exists: Handheld Ana, Bar till",
    );
    expect(copy.refusal({ code: "printer.not_found", params: {}, targets: [] })).toBe(
      "That printer no longer exists",
    );
    expect(copy.refusal({ code: "printer.unpaired", params: {}, targets: [ana] })).toBe(
      "The printer was unpaired, so this job will not be retried: Handheld Ana",
    );
  });
});
