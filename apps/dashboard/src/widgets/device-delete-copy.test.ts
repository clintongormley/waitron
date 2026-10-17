import { afterEach, describe, expect, it } from "vitest";
import type { DeleteImpactItem } from "@waitron/shared";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { deviceDeleteCopy } from "./device-delete-copy.js";

const before = currentLocale();
afterEach(() => setLocale(before));

const kitchen = { id: "p-kitchen", name: "Kitchen printer" };
const bar = { id: "p-bar", name: "Bar printer" };
const waiters = { id: "dp-waiters", name: "Waiters" };
const item = (key: string, targets = [kitchen], count = targets.length): DeleteImpactItem => ({
  key,
  count,
  targets,
});

describe("a device's delete dialog copy, in English", () => {
  it("words the dialog's fixed text", () => {
    setLocale("en");
    const copy = deviceDeleteCopy();
    expect([
      copy.heading,
      copy.refusals,
      copy.ends,
      copy.removes,
      copy.irreversible,
      copy.retry,
      copy.loading,
      copy.confirm,
      copy.cancel,
    ]).toEqual([
      "Delete device?",
      "Why it can't be deleted",
      "Work that ends",
      "Settings that are removed",
      "This can't be undone.",
      "Try again",
      "Checking what changes…",
      "Delete",
      "Cancel",
    ]);
  });

  it.each([
    [item("sessions", [], 3), "Signs out 3 people"],
    [item("sessions", [], 1), "Signs out 1 person"],
    [item("held_printers", [kitchen, bar]), "Stops carrying Kitchen printer, Bar printer"],
    [item("held_readers", [{ id: "r-1", name: "Solo" }]), "Stops carrying Solo"],
    [item("join_request", [], 1), "Its request to come back"],
    [item("printer_choices", [kitchen, bar]), "Printers: Kitchen printer, Bar printer"],
    [item("made_here_stations", [{ id: "s-grill", name: "Grill" }]), "Made here, no ticket: Grill"],
    [item("approved_profiles", [waiters]), "Can switch to: Waiters"],
    [item("card_reader", [{ id: "r-1", name: "Solo" }]), "Card reader: Solo"],
    [item("kitchen_screens", [], 2), "2 kitchen screens"],
    [item("zone_selections", [], 2), "2 saved zone selections"],
    [item("zone_selections", [], 1), "Saved zone selection"],
    [item("kitchen_screens", [], 1), "Kitchen screen"],
  ])("words %j", (each, line) => {
    setLocale("en");
    expect(deviceDeleteCopy().item(each)).toBe(line);
  });

  it("names the open orders a payment in progress holds, or says so alone", () => {
    setLocale("en");
    const copy = deviceDeleteCopy();
    const orders = [
      { id: "wo-1", name: "Table 4" },
      { id: "wo-2", name: "Table 7" },
    ];
    expect(copy.refusal({ code: "device.payment_in_progress", params: {}, targets: orders })).toBe(
      "Payment in progress: Table 4, Table 7",
    );
    expect(copy.refusal({ code: "device.payment_in_progress", params: {}, targets: [] })).toBe(
      "Payment in progress",
    );
  });

  it("words a refusal it has no line for by its code, naming its targets", () => {
    setLocale("en");
    const copy = deviceDeleteCopy();
    expect(copy.refusal({ code: "device.not_found", params: {}, targets: [waiters] })).toBe(
      `${codeMessage("device.not_found").replace(/\.$/, "")}: Waiters`,
    );
    expect(copy.refusal({ code: "device.not_found", params: {}, targets: [] })).toBe(
      codeMessage("device.not_found"),
    );
  });
});

describe("a device's delete dialog copy, in Spanish", () => {
  it("words the dialog's fixed text", () => {
    setLocale("es");
    const copy = deviceDeleteCopy();
    expect([
      copy.heading,
      copy.refusals,
      copy.ends,
      copy.removes,
      copy.irreversible,
      copy.retry,
      copy.loading,
      copy.confirm,
      copy.cancel,
    ]).toEqual([
      "¿Eliminar el dispositivo?",
      "Por qué no se puede eliminar",
      "Trabajo que finaliza",
      "Configuración que se elimina",
      "Esta acción no se puede deshacer.",
      "Reintentar",
      "Comprobando qué cambia…",
      "Eliminar",
      "Cancelar",
    ]);
  });

  it.each([
    [item("sessions", [], 3), "Cierra la sesión de 3 personas"],
    [item("sessions", [], 1), "Cierra la sesión de 1 persona"],
    [item("held_printers", [kitchen, bar]), "Deja de llevar Kitchen printer, Bar printer"],
    [item("held_readers", [{ id: "r-1", name: "Solo" }]), "Deja de llevar Solo"],
    [item("join_request", [], 1), "Su solicitud para volver"],
    [item("printer_choices", [kitchen]), "Impresoras: Kitchen printer"],
    [
      item("made_here_stations", [{ id: "s-grill", name: "Grill" }]),
      "Se prepara aquí, sin comanda: Grill",
    ],
    [item("approved_profiles", [waiters]), "Puede cambiar a: Waiters"],
    [item("card_reader", [{ id: "r-1", name: "Solo" }]), "Lector de tarjetas: Solo"],
    [item("kitchen_screens", [], 2), "2 pantallas de cocina"],
    [item("zone_selections", [], 2), "2 selecciones de zonas guardadas"],
    [item("zone_selections", [], 1), "Selección de zonas guardada"],
    [item("kitchen_screens", [], 1), "Pantalla de cocina"],
  ])("words %j", (each, line) => {
    setLocale("es");
    expect(deviceDeleteCopy().item(each)).toBe(line);
  });

  it("names the open orders a payment in progress holds, or says so alone", () => {
    setLocale("es");
    const copy = deviceDeleteCopy();
    const order = [{ id: "wo-1", name: "Mesa 4" }];
    expect(copy.refusal({ code: "device.payment_in_progress", params: {}, targets: order })).toBe(
      "Pago en curso: Mesa 4",
    );
    expect(copy.refusal({ code: "device.payment_in_progress", params: {}, targets: [] })).toBe(
      "Pago en curso",
    );
  });
});

describe.each(["en", "es"])("every fixed item key has its own wording (%s)", (locale) => {
  const keys = [
    "sessions",
    "held_printers",
    "join_request",
    "printer_choices",
    "made_here_stations",
    "approved_profiles",
    "card_reader",
    "kitchen_screens",
  ];

  it("no line shows a key or a target's id, and no two keys share a line", () => {
    setLocale(locale);
    const copy = deviceDeleteCopy();
    const lines = keys.map((key) => copy.item(item(key, [{ id: "0b6e-uuid", name: "Named" }], 3)));
    for (const [index, line] of lines.entries()) {
      expect(line).not.toContain(keys[index]);
      expect(line).not.toContain("0b6e-uuid");
      expect(line).not.toContain("_");
    }
    expect(new Set(lines).size).toBe(keys.length);
  });

  it("a key it does not know reads its names and count, never the key", () => {
    setLocale(locale);
    const copy = deviceDeleteCopy();
    expect(copy.item(item("future_link", [kitchen, bar], 2))).toBe(
      "Kitchen printer, Bar printer (2)",
    );
    expect(copy.item(item("future_count", [], 3))).toBe("(3)");
  });

  it("the payment refusal names the orders, not the code's sentence", () => {
    setLocale(locale);
    const line = deviceDeleteCopy().refusal({
      code: "device.payment_in_progress",
      params: {},
      targets: [{ id: "wo-1", name: "Table 4" }],
    });
    expect(line).toContain("Table 4");
    expect(line).not.toContain("wo-1");
    expect(line).not.toContain(codeMessage("device.payment_in_progress"));
  });
});

describe("the device payment-in-progress message", () => {
  it("reads for any action, not only a profile change", () => {
    setLocale("en");
    expect(codeMessage("device.payment_in_progress")).toBe(
      "A payment on this device is still in progress. Try again once it finishes or is cancelled",
    );
    setLocale("es");
    expect(codeMessage("device.payment_in_progress")).toBe(
      "Hay un pago en curso en este dispositivo. Vuelve a intentarlo cuando termine o se cancele",
    );
  });
});
