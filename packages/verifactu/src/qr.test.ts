import { describe, expect, it } from "vitest";
import { buildQrPayload } from "./qr.js";
import { buildAltaRecord } from "./records.js";
import { SISTEMA } from "../test/fixtures.js";
import type { AltaInput } from "./types.js";

// This fixture deliberately does NOT use test/fixtures.ts's ALTA_INPUT: its
// dates and amounts must match AEAT's published QR example verbatim.
const record = buildAltaRecord({
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678-G33",
  FechaExpedicionFactura: new Date("2024-09-01T00:00:00+02:00"),
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F1",
  DescripcionOperacion: "Venta",
  Desglose: [
    { CalificacionOperacion: "S1", BaseImponibleOimporteNoSujeto: 199.5, CuotaRepercutida: 41.9 },
  ],
  CuotaTotal: 41.9,
  ImporteTotal: 241.4,
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-09-01T10:00:00+02:00"),
  offsetMinutes: 120,
} satisfies AltaInput);

describe("buildQrPayload", () => {
  it("builds the production URL for AEAT's published example, with the record's own two-decimal importe", () => {
    // AEAT's published example itself writes importe=241.4 (one decimal) and
    // gives only the preproduction URL verbatim — there is no published
    // production-URL example to match text-for-text. This asserts the
    // library's actual (correct) behaviour: it passes the record's own
    // literal through unreformatted, which here is "241.40" because that's
    // what this fixture's ImporteTotal was built as.
    expect(buildQrPayload(record, "production")).toBe(
      "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR" +
        "?nif=89890001K&numserie=12345678-G33&fecha=01-09-2024&importe=241.40",
    );
  });

  it("matches AEAT's published preproduction example verbatim, apart from the decimal-places policy", () => {
    // AEAT's own text uses importe=241.4; this fixture's ImporteTotal is
    // "241.40" (formatAmount always emits two decimal places), so the two
    // literals differ by a trailing zero AEAT's own formatting policy would
    // also have produced from the same value — everything else here matches
    // AEAT's published preproduction example character for character.
    expect(buildQrPayload(record, "preproduction")).toBe(
      "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR" +
        "?nif=89890001K&numserie=12345678-G33&fecha=01-09-2024&importe=241.40",
    );
  });

  it("emits exactly the four mandatory parameters in order", () => {
    const query = buildQrPayload(record, "production").split("?")[1] ?? "";
    expect(query.split("&").map((pair) => pair.split("=")[0])).toEqual([
      "nif",
      "numserie",
      "fecha",
      "importe",
    ]);
  });

  it("percent-encodes an ampersand in the serial", () => {
    // AEAT publishes the unencoded form as explicitly incorrect, because the
    // bare & would be read as a parameter separator.
    const withAmpersand = {
      ...record,
      IDFactura: { ...record.IDFactura, NumSerieFactura: "12345678&G33" },
    };
    expect(buildQrPayload(withAmpersand, "preproduction")).toContain("numserie=12345678%26G33");
  });

  it("never includes the formato parameter", () => {
    // AEAT: "este parametro nunca podra incorporarse en la URL que va en el
    // codigo QR de la factura".
    expect(buildQrPayload(record, "production")).not.toContain("formato");
  });

  it("uses the record's own literals rather than reformatting", () => {
    // The fixture's own literals (e.g. ImporteTotal "241.40") are already in
    // canonical form, so asserting the QR contains those same strings can't
    // tell "passed through verbatim" from "recomputed into the same
    // canonical form" -- both produce an identical result. Force the two to
    // diverge by spreading in non-canonical literals: values a recomputation
    // would normalise but a pass-through would not touch. This is what
    // actually matters for the receipt: AEAT recomputes the hash from
    // whatever literal appears in the printed QR, so any reformatting here
    // would silently break verification of an unrecallable receipt.
    const nonCanonical = {
      ...record,
      IDFactura: {
        ...record.IDFactura,
        NumSerieFactura: "007-a",
        FechaExpedicionFactura: "1-9-2024",
      },
      ImporteTotal: "123.1",
    };

    const query = buildQrPayload(nonCanonical, "production");

    expect(query).toContain("numserie=007-a");
    expect(query).toContain("fecha=1-9-2024");
    expect(query).toContain("importe=123.1");
    expect(query).not.toContain("importe=123.10");
  });
});
