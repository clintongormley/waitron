import { describe, expect, it } from "vitest";
import { deviceId, saleId } from "@waitron/shared";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import { altaFor } from "./testing/seed.js";

const INPUT = altaFor(
  { deviceId: deviceId("10000000-0000-4000-8000-000000000001") },
  saleId("10000000-0000-4000-8000-000000000002"),
  1,
  1,
  "preproduction",
).input;

function candidate(identity: string, invoice: string) {
  return buildAltaRecord({
    ...INPUT,
    NumSerieFactura: invoice,
    SistemaInformatico: { ...INPUT.SistemaInformatico, NumeroInstalacion: identity },
    Encadenamiento: { PrimerRegistro: "S" },
  });
}

describe("allocation names through the actual fiscal record validator", () => {
  it.each(["S000001", "P000042", "C999999", "E7ZZZZZZZZZZZZZZZZZZZZZZZZZ"])(
    "validates a complete candidate with installation %s",
    (identity) => {
      expect(validate(candidate(identity, `A-${identity}/1`))).toEqual([]);
    },
  );

  it("validates the 60-character emergency invoice boundary", () => {
    const invoice = "ABCDEFGHIJKLMNOPQRSTU-E7ZZZZZZZZZZZZZZZZZZZZZZZZZ/9999999999";
    expect(invoice).toHaveLength(60);
    expect(validate(candidate("E7ZZZZZZZZZZZZZZZZZZZZZZZZZ", invoice))).toEqual([]);
  });

  it("rejects a 61-character invoice rather than treating the boundary probe as vacuous", () => {
    expect(
      validate(
        candidate(
          "E7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
          "ABCDEFGHIJKLMNOPQRSTUV-E7ZZZZZZZZZZZZZZZZZZZZZZZZZ/9999999999",
        ),
      ),
    ).toContainEqual(expect.objectContaining({ severity: "error", field: "NumSerieFactura" }));
  });
});
