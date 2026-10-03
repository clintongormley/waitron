import { describe, expect, it } from "vitest";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import type { AltaInput } from "@waitron/verifactu";
import { getCountryPack } from "@waitron/country-packs";
import { centsToDecimal, decimal, decimalToCents, subtractDecimal } from "@waitron/shared";
import { VerifactuBackend } from "./backend.js";
import { TEST_SISTEMA } from "./testing/seed.js";

/**
 * The drift guard for the two limits `VerifactuBackend` hands the generic sale path, each a rule
 * `@waitron/verifactu`'s validator owns: the simplified-invoice ceiling (`F2_AMOUNT_LIMIT`) and the
 * recipient name cap (`XSD_TEXT_LENGTH` on `NombreRazon`). Also the customer tax ID check that core
 * makes through the Spanish country pack, against the validator's own `NIF_CONTROL`.
 */

const backend = new VerifactuBackend({
  db: null as never,
  clock: null as never,
  deploymentEnvironment: "preproduction",
  resolveClient: () => Promise.reject(new Error("never called")),
});

/** A record carrying one 21% line whose base plus tax is `total`, so the F2 ceiling is the only
 * rule the total can trip. */
function recordFor(
  total: string,
  options: { tipo?: "F1" | "F2"; recipient?: { NombreRazon: string; NIF: string } } = {},
) {
  const cents = decimalToCents(decimal(total));
  const base = centsToDecimal(Math.round(cents / 1.21));
  const cuota = subtractDecimal(decimal(total), base);
  const input: AltaInput = {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: "FS/1",
    FechaExpedicionFactura: new Date("2026-03-01T00:00:00+01:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: options.tipo ?? "F2",
    DescripcionOperacion: "Venta en establecimiento",
    ...(options.recipient === undefined
      ? {}
      : { Destinatarios: { IDDestinatario: [options.recipient] } }),
    Desglose: [
      {
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: base,
        CuotaRepercutida: cuota,
      },
    ],
    CuotaTotal: cuota,
    ImporteTotal: total,
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date("2026-03-01T19:20:30+01:00"),
    offsetMinutes: 60,
  };
  return buildAltaRecord(input);
}

function codes(record: ReturnType<typeof recordFor>): string[] {
  return validate(record, { now: new Date("2026-03-01T19:20:30+01:00") })
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
}

describe("the simplified-invoice limit matches the validator's F2 ceiling", () => {
  it("is 3,010.00", () => {
    expect(backend.simplifiedInvoiceLimit).toBe("3010.00");
  });

  // Both sides of the limit, so moving it a cent either way flips a case.
  it.each(["3009.99", "3010.00", "3010.01", "3500.00"])(
    "gives the validator's verdict on an F2 of %s",
    (total) => {
      const over = decimalToCents(decimal(total)) > decimalToCents(backend.simplifiedInvoiceLimit!);
      expect(codes(recordFor(total)).includes("F2_AMOUNT_LIMIT")).toBe(over);
    },
  );

  it("the ceiling is the F2's alone: the same total named to a customer (F1) passes", () => {
    expect(
      codes(
        recordFor("3500.00", { tipo: "F1", recipient: { NombreRazon: "A", NIF: "B12345674" } }),
      ),
    ).toEqual([]);
  });
});

describe("the recipient name cap matches the validator's", () => {
  const nameOf = (length: number) => "€".repeat(length - 1) + "😀";

  it("is 120", () => {
    expect(backend.recipientNameMaxLength).toBe(120);
  });

  // The last character is outside the Basic Multilingual Plane, so a cap counted in UTF-16 units
  // (where it is two) rather than characters gives a different verdict at 120.
  it.each([119, 120, 121])("gives the validator's verdict on a %i-character name", (length) => {
    const refused = codes(
      recordFor("10.00", {
        tipo: "F1",
        recipient: { NombreRazon: nameOf(length), NIF: "B12345674" },
      }),
    ).includes("XSD_TEXT_LENGTH");
    expect(Array.from(nameOf(length)).length > backend.recipientNameMaxLength!).toBe(refused);
  });
});

describe("the Spanish country pack's tax ID check matches the validator's", () => {
  const spain = getCountryPack("ES")!.taxIdentifier!;
  // One right and one wrong control per kind the validator distinguishes: a DNI, a NIE, an entity
  // with a digit control, an entity with a letter control, and the K/L/M forms.
  it.each([
    "12345678Z",
    "12345678A",
    "X1234567L",
    "X1234567A",
    "B12345674",
    "B12345678",
    "Q2826000H",
    "Q2826000A",
    "K1234567L",
    "K1234567A",
  ])("gives the validator's verdict on %s", (nif) => {
    const refused = codes(
      recordFor("10.00", { tipo: "F1", recipient: { NombreRazon: "Cliente SL", NIF: nif } }),
    ).some((code) => code === "NIF_CONTROL" || code === "NIF_LENGTH");
    expect(spain.validate(nif).valid).toBe(!refused);
  });
});
