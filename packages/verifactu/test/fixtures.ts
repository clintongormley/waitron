import type { AltaInput, SistemaInformatico } from "../src/types.js";

/**
 * Fixtures shared verbatim across the package's unit tests, following the
 * precedent test/vectors.ts already set: one definition, several imports,
 * rather than copy-pasted literals that can silently drift out of sync.
 *
 * qr.test.ts deliberately does NOT use ALTA_INPUT here — its alta fixture
 * uses different dates and amounts because it must match AEAT's published QR
 * example verbatim.
 */

export const SISTEMA: SistemaInformatico = {
  NombreRazon: "Waitron",
  NIF: "89890001K",
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "WT",
  Version: "1.0.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "S",
  IndicadorMultiplesOT: "N",
};

export const CABECERA = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };

/**
 * The canonical AltaInput literal shared by records.test.ts,
 * xml/serialize.test.ts and client.test.ts. Its Huella reproduces AEAT's
 * published vector-1 huella exactly (see records.test.ts's "reproduces
 * AEAT's vector 1 huella from native inputs") — do not change any of its
 * hashed fields without re-verifying that vector still passes.
 */
export const ALTA_INPUT: AltaInput = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678/G33",
  FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F1",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [
    {
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: 111.1,
      CuotaRepercutida: 12.35,
      TipoImpositivo: 21,
    },
  ],
  CuotaTotal: 12.35,
  ImporteTotal: 123.45,
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-01-01T19:20:30+01:00"),
  offsetMinutes: 60,
};
