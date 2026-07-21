import { describe, expect, it } from "vitest";
import { buildAltaRecord, buildAnulacionRecord } from "./records.js";
import { computeHuella } from "./huella.js";
import { validate } from "./validate.js";
import { VECTOR_1_HUELLA } from "../test/vectors.js";
import { ALTA_INPUT, SISTEMA } from "../test/fixtures.js";
import type { AltaInput, AnulacionInput } from "./types.js";

describe("buildAltaRecord", () => {
  it("reproduces AEAT's vector 1 huella from native inputs", () => {
    // End-to-end proof that the formatting policy produces the literals AEAT
    // hashed. If any formatter drifts, this breaks.
    expect(buildAltaRecord(ALTA_INPUT).Huella).toBe(VECTOR_1_HUELLA);
  });

  it("formats amounts to two decimals in the record", () => {
    const record = buildAltaRecord(ALTA_INPUT);
    expect(record.CuotaTotal).toBe("12.35");
    expect(record.ImporteTotal).toBe("123.45");
  });

  it("formats the expedition date as DD-MM-YYYY", () => {
    expect(buildAltaRecord(ALTA_INPUT).IDFactura.FechaExpedicionFactura).toBe("01-01-2024");
  });

  it("formats the generation timestamp with a numeric offset", () => {
    expect(buildAltaRecord(ALTA_INPUT).FechaHoraHusoGenRegistro).toBe("2024-01-01T19:20:30+01:00");
  });

  it("sets IDVersion and TipoHuella to their only permitted values", () => {
    const record = buildAltaRecord(ALTA_INPUT);
    expect(record.IDVersion).toBe("1.0");
    expect(record.TipoHuella).toBe("01");
  });

  it("computes a huella consistent with computeHuella on the result", () => {
    const record = buildAltaRecord(ALTA_INPUT);
    expect(computeHuella(record)).toBe(record.Huella);
  });

  it("stores a huella even for the first record of a chain", () => {
    // AEAT: the huella is always informed, "incluso en el caso de que sea el
    // primer registro".
    expect(buildAltaRecord(ALTA_INPUT).Huella).toMatch(/^[0-9A-F]{64}$/);
  });

  it("formats desglose amounts too", () => {
    const record = buildAltaRecord(ALTA_INPUT);
    expect(record.Desglose[0]?.BaseImponibleOimporteNoSujeto).toBe("111.10");
    expect(record.Desglose[0]?.CuotaRepercutida).toBe("12.35");
    expect(record.Desglose[0]?.TipoImpositivo).toBe("21.00");
  });

  it("omits optional top-level and desglose fields that were not supplied", () => {
    // toBeUndefined() can't distinguish a key that's absent from a key set
    // to undefined — both read as undefined on access. Object.hasOwn tests
    // the key itself, which is what the XML serialiser actually branches on.
    const record = buildAltaRecord(ALTA_INPUT);
    expect(Object.hasOwn(record, "RefExterna")).toBe(false);
    expect(Object.hasOwn(record, "Subsanacion")).toBe(false);
    expect(Object.hasOwn(record, "RechazoPrevio")).toBe(false);
    expect(Object.hasOwn(record, "TipoRectificativa")).toBe(false);
    expect(Object.hasOwn(record, "FechaOperacion")).toBe(false);
    expect(Object.hasOwn(record, "FacturaSimplificadaArt7273")).toBe(false);
    expect(Object.hasOwn(record, "FacturaSinIdentifDestinatarioArt61d")).toBe(false);
    expect(Object.hasOwn(record, "Macrodato")).toBe(false);
    expect(Object.hasOwn(record, "Cupon")).toBe(false);
    const detalle = record.Desglose[0]!;
    expect(Object.hasOwn(detalle, "Impuesto")).toBe(false);
    expect(Object.hasOwn(detalle, "ClaveRegimen")).toBe(false);
    // CalificacionOperacion/OperacionExenta are a mandatory either/or (an XSD
    // xsd:choice), not an independent optional pair, so a DetalleDesglose can
    // never omit both — ALTA_INPUT's line supplies CalificacionOperacion (see
    // test/fixtures.ts), so only the branch not chosen, OperacionExenta,
    // stays absent here. The reverse combination is covered separately by
    // "passes through OperacionExenta when supplied instead of
    // CalificacionOperacion" below.
    expect(Object.hasOwn(detalle, "OperacionExenta")).toBe(false);
    expect(Object.hasOwn(detalle, "BaseImponibleACoste")).toBe(false);
    expect(Object.hasOwn(detalle, "TipoRecargoEquivalencia")).toBe(false);
    expect(Object.hasOwn(detalle, "CuotaRecargoEquivalencia")).toBe(false);
  });
});

describe("buildAnulacionRecord", () => {
  const ANULACION: AnulacionInput = {
    IDEmisorFacturaAnulada: "89890001K",
    NumSerieFacturaAnulada: "12345679/G34",
    FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345679/G34",
        FechaExpedicionFactura: "01-01-2024",
        Huella: "F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97",
      },
    },
    SistemaInformatico: SISTEMA,
    generadoEn: new Date("2024-01-01T19:20:40+01:00"),
    offsetMinutes: 60,
  };

  it("reproduces AEAT's vector 3 huella from native inputs", () => {
    expect(buildAnulacionRecord(ANULACION).Huella).toBe(
      "177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68",
    );
  });

  it("uses the ...Anulada identity field names", () => {
    const record = buildAnulacionRecord(ANULACION);
    expect(record.IDFactura.IDEmisorFacturaAnulada).toBe("89890001K");
    expect(record.IDFactura.FechaExpedicionFacturaAnulada).toBe("01-01-2024");
  });

  it("carries no TipoFactura or totals", () => {
    // Object.hasOwn, not toBeUndefined: property access can't tell an
    // absent key from a key explicitly set to undefined.
    const record = buildAnulacionRecord(ANULACION) as unknown as Record<string, unknown>;
    expect(Object.hasOwn(record, "TipoFactura")).toBe(false);
    expect(Object.hasOwn(record, "CuotaTotal")).toBe(false);
    expect(Object.hasOwn(record, "ImporteTotal")).toBe(false);
  });

  it("omits RefExterna, SinRegistroPrevio, RechazoPrevio, and GeneradoPor when not supplied", () => {
    const record = buildAnulacionRecord(ANULACION);
    expect(Object.hasOwn(record, "RefExterna")).toBe(false);
    expect(Object.hasOwn(record, "SinRegistroPrevio")).toBe(false);
    expect(Object.hasOwn(record, "RechazoPrevio")).toBe(false);
    expect(Object.hasOwn(record, "GeneradoPor")).toBe(false);
  });

  it("includes RefExterna, SinRegistroPrevio, RechazoPrevio, and GeneradoPor when supplied", () => {
    // RechazoPrevio is on RegistroAnulacion and already serialised by
    // serialize.ts, but AnulacionInput had no way to populate it — the same
    // "unreachable field" gap as BaseImponibleACoste on the alta side.
    const record = buildAnulacionRecord({
      ...ANULACION,
      RefExterna: "REF-2",
      SinRegistroPrevio: "S",
      RechazoPrevio: "S",
      GeneradoPor: "D",
    });
    expect(record.RefExterna).toBe("REF-2");
    expect(record.SinRegistroPrevio).toBe("S");
    expect(record.RechazoPrevio).toBe("S");
    expect(record.GeneradoPor).toBe("D");
  });
});

describe("buildAltaRecord — optional field pass-through", () => {
  it("includes RefExterna when supplied", () => {
    const record = buildAltaRecord({ ...ALTA_INPUT, RefExterna: "REF-1" });
    expect(record.RefExterna).toBe("REF-1");
  });

  it("formats every optional desglose field when supplied, with CalificacionOperacion", () => {
    // CalificacionOperacion and OperacionExenta are an xsd:choice in
    // DetalleType — exactly one, never both — so this line supplies the
    // former and the sibling test below supplies the latter, rather than
    // asserting both pass through on the same (schema-invalid) line.
    const record = buildAltaRecord({
      ...ALTA_INPUT,
      Desglose: [
        {
          Impuesto: "01",
          ClaveRegimen: "01",
          CalificacionOperacion: "S1",
          TipoImpositivo: "21",
          BaseImponibleOimporteNoSujeto: "100",
          BaseImponibleACoste: "90",
          CuotaRepercutida: "21",
          TipoRecargoEquivalencia: "5.2",
          CuotaRecargoEquivalencia: "5.2",
        },
      ],
    });
    const detalle = record.Desglose[0];
    expect(detalle?.Impuesto).toBe("01");
    expect(detalle?.ClaveRegimen).toBe("01");
    expect(detalle?.CalificacionOperacion).toBe("S1");
    expect(Object.hasOwn(detalle!, "OperacionExenta")).toBe(false);
    expect(detalle?.BaseImponibleACoste).toBe("90.00");
    expect(detalle?.TipoRecargoEquivalencia).toBe("5.20");
    expect(detalle?.CuotaRecargoEquivalencia).toBe("5.20");
  });

  it("passes through OperacionExenta when supplied instead of CalificacionOperacion", () => {
    const record = buildAltaRecord({
      ...ALTA_INPUT,
      Desglose: [
        {
          OperacionExenta: "E1",
          BaseImponibleOimporteNoSujeto: "100",
        },
      ],
    });
    const detalle = record.Desglose[0];
    expect(detalle?.OperacionExenta).toBe("E1");
    expect(Object.hasOwn(detalle!, "CalificacionOperacion")).toBe(false);
  });
});

describe("buildAltaRecord — rectificativa fields", () => {
  // Seven fields RegistroAlta supports and serializeEnvio already serialises,
  // but that AltaInput previously had no way to populate. TipoRectificativa is
  // deliberately NOT in this group: AEAT rule 1115 forbids it whenever
  // TipoFactura is not R1-R5, so an F1 record (ALTA_INPUT's TipoFactura) can
  // never legally carry it. It — and FacturasRectificadas/FacturasSustituidas/
  // ImporteRectificacion, the three rectificativa-specific fields added
  // alongside it — get their own TipoFactura: "R1" fixture below instead of
  // being spread onto ALTA_INPUT unchanged.
  const EXTRAS = {
    Subsanacion: "S",
    RechazoPrevio: "S",
    FechaOperacion: new Date("2024-01-02T00:00:00+01:00"),
    FacturaSimplificadaArt7273: "S",
    FacturaSinIdentifDestinatarioArt61d: "S",
    Macrodato: "S",
    Cupon: "S",
  } as const;

  it("passes through all seven fields when supplied", () => {
    const record = buildAltaRecord({ ...ALTA_INPUT, ...EXTRAS });
    expect(record.Subsanacion).toBe("S");
    expect(record.RechazoPrevio).toBe("S");
    expect(record.FechaOperacion).toBe("02-01-2024");
    expect(record.FacturaSimplificadaArt7273).toBe("S");
    expect(record.FacturaSinIdentifDestinatarioArt61d).toBe("S");
    expect(record.Macrodato).toBe("S");
    expect(record.Cupon).toBe("S");
  });

  it("formats FechaOperacion as DD-MM-YYYY using the record's own offset, like FechaExpedicionFactura", () => {
    const record = buildAltaRecord({
      ...ALTA_INPUT,
      FechaOperacion: new Date("2024-03-15T23:30:00Z"),
      offsetMinutes: 60,
    });
    // 23:30 UTC shifted +60 minutes lands at 00:30 the next day.
    expect(record.FechaOperacion).toBe("16-03-2024");
  });

  it("does not change the huella when the seven non-hashed optional fields are populated", () => {
    // Critical invariant: none of these seven fields feed the huella — the
    // canonical hash string (CadenaAltaInput) uses only IDEmisorFactura,
    // NumSerieFactura, FechaExpedicionFactura, TipoFactura, CuotaTotal,
    // ImporteTotal, the predecessor huella and FechaHoraHusoGenRegistro.
    // Building the same record with and without them must produce an
    // identical Huella — that is what makes adding them safe.
    const base = buildAltaRecord(ALTA_INPUT);
    const withExtras = buildAltaRecord({ ...ALTA_INPUT, ...EXTRAS });
    expect(withExtras.Huella).toBe(base.Huella);
    expect(withExtras.Huella).toBe(VECTOR_1_HUELLA);
  });
});

describe("buildAltaRecord — TipoRectificativa, FacturasRectificadas, FacturasSustituidas, ImporteRectificacion", () => {
  // These four are only ever legal together with a rectificativa TipoFactura
  // (R1-R5) — rules 1114/1115 — so, unlike the seven fields above, they get
  // their own TipoFactura: "R1" base rather than being layered onto
  // ALTA_INPUT's F1 unchanged.
  // Explicitly typed (via Pick<AltaInput, ...>) rather than `as const`: an
  // `as const` array literal is readonly, which is incompatible with
  // AltaInput's mutable IDFacturaARInput[] — unlike EXTRAS above, whose
  // fields are all scalars.
  const RECTIFICATIVA_EXTRAS: Pick<
    AltaInput,
    | "TipoFactura"
    | "TipoRectificativa"
    | "FacturasRectificadas"
    | "FacturasSustituidas"
    | "ImporteRectificacion"
  > = {
    TipoFactura: "R1",
    TipoRectificativa: "S",
    FacturasRectificadas: [
      {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345677/G32",
        FechaExpedicionFactura: new Date("2023-12-01T00:00:00+01:00"),
      },
    ],
    FacturasSustituidas: [
      {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345676/G31",
        FechaExpedicionFactura: new Date("2023-12-01T00:00:00+01:00"),
      },
    ],
    ImporteRectificacion: {
      BaseRectificada: "100",
      CuotaRectificada: "21",
      CuotaRecargoRectificado: "5",
    },
  };

  it("passes through TipoRectificativa when supplied", () => {
    const record = buildAltaRecord({ ...ALTA_INPUT, ...RECTIFICATIVA_EXTRAS });
    expect(record.TipoRectificativa).toBe("S");
  });

  it("formats FacturasRectificadas as one IDFacturaRectificada per entry", () => {
    const record = buildAltaRecord({ ...ALTA_INPUT, ...RECTIFICATIVA_EXTRAS });
    expect(record.FacturasRectificadas).toEqual({
      IDFacturaRectificada: [
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "12345677/G32",
          FechaExpedicionFactura: "01-12-2023",
        },
      ],
    });
  });

  it("formats FacturasSustituidas as one IDFacturaSustituida per entry", () => {
    const record = buildAltaRecord({ ...ALTA_INPUT, ...RECTIFICATIVA_EXTRAS });
    expect(record.FacturasSustituidas).toEqual({
      IDFacturaSustituida: [
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "12345676/G31",
          FechaExpedicionFactura: "01-12-2023",
        },
      ],
    });
  });

  it("formats ImporteRectificacion, including the optional CuotaRecargoRectificado", () => {
    const record = buildAltaRecord({ ...ALTA_INPUT, ...RECTIFICATIVA_EXTRAS });
    expect(record.ImporteRectificacion).toEqual({
      BaseRectificada: "100.00",
      CuotaRectificada: "21.00",
      CuotaRecargoRectificado: "5.00",
    });
  });

  it("omits CuotaRecargoRectificado from ImporteRectificacion when not supplied", () => {
    const record = buildAltaRecord({
      ...ALTA_INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "S",
      ImporteRectificacion: { BaseRectificada: "100", CuotaRectificada: "21" },
    });
    expect(record.ImporteRectificacion).toEqual({
      BaseRectificada: "100.00",
      CuotaRectificada: "21.00",
    });
    expect(Object.hasOwn(record.ImporteRectificacion!, "CuotaRecargoRectificado")).toBe(false);
  });

  it("omits TipoRectificativa, FacturasRectificadas, FacturasSustituidas and ImporteRectificacion when not supplied", () => {
    const record = buildAltaRecord(ALTA_INPUT);
    expect(Object.hasOwn(record, "TipoRectificativa")).toBe(false);
    expect(Object.hasOwn(record, "FacturasRectificadas")).toBe(false);
    expect(Object.hasOwn(record, "FacturasSustituidas")).toBe(false);
    expect(Object.hasOwn(record, "ImporteRectificacion")).toBe(false);
  });

  it("does not change the huella when TipoRectificativa, FacturasRectificadas, FacturasSustituidas or ImporteRectificacion are populated", () => {
    // Same invariant as the seven-field group above, extended to these four —
    // none of them are among the eight fields CadenaAltaInput hashes. Both
    // sides fix TipoFactura at "R1" (unlike that test's F1 base) so that the
    // comparison isolates these four fields' effect rather than also picking
    // up TipoFactura's own (legitimate, pre-existing) contribution to the hash.
    const base = buildAltaRecord({ ...ALTA_INPUT, TipoFactura: "R1" });
    const withExtras = buildAltaRecord({ ...ALTA_INPUT, ...RECTIFICATIVA_EXTRAS });
    expect(withExtras.Huella).toBe(base.Huella);
  });

  it("builds a full rectificativa por sustitución end to end, valid per AEAT rules 1114/1115/1118", () => {
    const record = buildAltaRecord({ ...ALTA_INPUT, ...RECTIFICATIVA_EXTRAS });
    expect(record.TipoFactura).toBe("R1");
    expect(record.TipoRectificativa).toBe("S");
    expect(record.ImporteRectificacion).toBeDefined();
    // The record hashes and validates like any other alta — a rectificativa
    // is not a special case for either concern, provided the fields rules
    // 1114/1115/1118 require are actually present.
    expect(computeHuella(record)).toBe(record.Huella);
    expect(validate(record)).toEqual([]);
  });

  it("builds a full rectificativa por diferencia (I) end to end, where ImporteRectificacion is not required", () => {
    const record = buildAltaRecord({
      ...ALTA_INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "I",
    });
    expect(computeHuella(record)).toBe(record.Huella);
    expect(validate(record)).toEqual([]);
  });
});
