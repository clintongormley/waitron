import { describe, expect, it } from "vitest";
import {
  buildAltaRecord,
  buildQrPayload,
  createClient,
  serializeEnvio,
  validate,
} from "./index.js";
import type { SistemaInformatico } from "./index.js";

/**
 * A coherence check on the package root, not a duplicate of the per-module
 * unit tests. Every module already has its own suite exercising its own
 * behaviour in depth; this file only proves that `./index.js` re-exports the
 * right things — that a consumer importing from the package root, rather
 * than reaching into individual files, gets a surface that actually works
 * end to end.
 */
describe("package public surface (./index.js)", () => {
  const sistema: SistemaInformatico = {
    NombreRazon: "Example SL",
    NIF: "B12345678",
    NombreSistemaInformatico: "Example POS",
    IdSistemaInformatico: "01",
    Version: "1.0",
    NumeroInstalacion: "001",
    TipoUsoPosibleSoloVerifactu: "S",
    TipoUsoPosibleMultiOT: "N",
    IndicadorMultiplesOT: "N",
  };

  it("builds, validates, serialises and generates a QR for a record via the package root", () => {
    const record = buildAltaRecord({
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "T01/000123",
      FechaExpedicionFactura: new Date("2024-01-01T12:00:00Z"),
      NombreRazonEmisor: "Example SL",
      TipoFactura: "F2",
      DescripcionOperacion: "Venta en establecimiento",
      Desglose: [
        {
          CalificacionOperacion: "S1",
          BaseImponibleOimporteNoSujeto: 10,
          CuotaRepercutida: 2.1,
          TipoImpositivo: 21,
        },
      ],
      CuotaTotal: 2.1,
      ImporteTotal: 12.1,
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: sistema,
      generadoEn: new Date("2024-01-01T12:00:00Z"),
      offsetMinutes: 60,
    });

    expect(validate(record)).toEqual([]);

    const xml = serializeEnvio(
      { ObligadoEmision: { NombreRazon: sistema.NombreRazon, NIF: "B12345678" } },
      [{ RegistroAlta: record }],
    );
    expect(xml).toContain("<sf:RegistroAlta>");
    expect(xml).toContain(record.Huella);

    const qr = buildQrPayload(record, "production");
    expect(qr).toBe(
      "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR" +
        "?nif=89890001K&numserie=T01%2F000123&fecha=01-01-2024&importe=12.10",
    );

    // createClient is re-exported too — construct one to prove it is wired,
    // without making a real network call.
    const client = createClient({
      endpoint: "https://example.invalid",
      fetch: async () => new Response(""),
    });
    expect(typeof client.submit).toBe("function");
    expect(typeof client.consultar).toBe("function");
  });
});
