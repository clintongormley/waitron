import { describe, expect, it } from "vitest";
import { createFakeAeat, keyOf } from "./fake-aeat.js";
import type { RegistroAlta, RegistroAnulacion } from "../types.js";

const cabecera = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };

const SISTEMA = {
  NombreRazon: "Waitron SL",
  NIF: "89890001K",
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "77",
  Version: "0.0.0",
  NumeroInstalacion: "1",
  TipoUsoPosibleSoloVerifactu: "S" as const,
  TipoUsoPosibleMultiOT: "S" as const,
  IndicadorMultiplesOT: "N" as const,
};

function altaFixture(numSerie: string, fecha = "20-07-2026", refExterna?: string): RegistroAlta {
  return {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFactura: "89890001K",
      NumSerieFactura: numSerie,
      FechaExpedicionFactura: fecha,
    },
    ...(refExterna !== undefined ? { RefExterna: refExterna } : {}),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: "Venta",
    Desglose: [
      {
        CalificacionOperacion: "S1",
        TipoImpositivo: "21",
        BaseImponibleOimporteNoSujeto: "100.00",
        CuotaRepercutida: "21.00",
      },
    ],
    CuotaTotal: "21.00",
    ImporteTotal: "121.00",
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: SISTEMA,
    FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
    TipoHuella: "01",
    Huella: "H-" + numSerie,
  };
}

// A RegistroAnulacion's own IDFactura identifies the SAME invoice its alta did, just spelled with
// the ...Anulada field names — this fixture cancels whatever alta was filed under `numSerie`.
function anulacionFixture(numSerie: string, fecha = "20-07-2026"): RegistroAnulacion {
  return {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: numSerie,
      FechaExpedicionFacturaAnulada: fecha,
    },
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: numSerie,
        FechaExpedicionFactura: fecha,
        Huella: "H-" + numSerie,
      },
    },
    SistemaInformatico: SISTEMA,
    FechaHoraHusoGenRegistro: "2026-07-20T19:25:00+02:00",
    TipoHuella: "01",
    Huella: "H-ANUL-" + numSerie,
  };
}

describe("fake AEAT — submit", () => {
  it("accepts a clean alta, issues a CSV, and stores it with its huella", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const respuesta = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);

    expect(respuesta.EstadoEnvio).toBe("Correcto");
    expect(respuesta.CSV).toMatch(/./);
    expect(respuesta.TiempoEsperaEnvio).toBe(60);
    expect(respuesta.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()).toEqual([
      {
        key: keyOf(altaFixture("A/1")),
        huella: "H-A/1",
        estado: "Correcta",
        tipo: "alta",
        refExterna: undefined,
      },
    ]);
  });

  it("rejects a record on the configured reject list, marking the envío ParcialmenteCorrecto", async () => {
    const aeat = createFakeAeat();
    aeat.reject(keyOf(altaFixture("A/9")), 1100, "Campo obligatorio ausente");
    const r = await aeat
      .client()
      .submit(cabecera, [
        { RegistroAlta: altaFixture("A/1") },
        { RegistroAlta: altaFixture("A/9") },
      ]);
    expect(r.EstadoEnvio).toBe("ParcialmenteCorrecto");
    expect(r.RespuestaLinea[1]?.EstadoRegistro).toBe("Incorrecto");
    expect(r.RespuestaLinea[1]?.CodigoErrorRegistro).toBe(1100);
    expect(aeat.stored().map((s) => s.key)).toEqual([keyOf(altaFixture("A/1"))]); // rejected one not stored
  });

  it("flags a future-dated record with 2004 (AceptadoConErrores) without rejecting it", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-20T00:00:00Z") });
    const r = await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "25-07-2026") }]);
    expect(r.RespuestaLinea[0]?.EstadoRegistro).toBe("AceptadoConErrores");
    expect(r.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(2004);
    expect(aeat.stored()[0]?.estado).toBe("AceptadaConErrores");
  });

  it("decreases TiempoEsperaEnvio on each response", async () => {
    const aeat = createFakeAeat();
    const first = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const second = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/2") }]);
    expect(second.TiempoEsperaEnvio).toBeLessThan(first.TiempoEsperaEnvio);
  });

  // --- beyond the brief's four cases: closing gaps found in self-review ---

  it("marks a clean anulación's key Anulada rather than Correcta, tagged tipo anulacion", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const r = await aeat
      .client()
      .submit(cabecera, [{ RegistroAnulacion: anulacionFixture("A/1") }]);

    expect(r.EstadoEnvio).toBe("Correcto");
    expect(r.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()).toEqual([
      {
        key: keyOf(anulacionFixture("A/1")),
        huella: "H-ANUL-A/1",
        estado: "Anulada",
        tipo: "anulacion",
        refExterna: undefined,
      },
    ]);
  });

  it("round-trips RefExterna onto the response line and the stored record", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const r = await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "20-07-2026", "ext-ref-1") }]);
    expect(r.RespuestaLinea[0]?.RefExterna).toBe("ext-ref-1");
    expect(aeat.stored()[0]?.refExterna).toBe("ext-ref-1");
  });

  it("setServerNow changes what counts as future-dated for later submissions", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-25T00:00:00Z") });
    const before = await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "20-07-2026") }]);
    expect(before.RespuestaLinea[0]?.EstadoRegistro).toBe("Correcto");

    aeat.setServerNow(new Date("2026-07-19T00:00:00Z"));
    const after = await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/2", "20-07-2026") }]);
    expect(after.RespuestaLinea[0]?.EstadoRegistro).toBe("AceptadoConErrores");
    expect(after.RespuestaLinea[0]?.CodigoErrorRegistro).toBe(2004);
  });

  it("never reports TiempoEsperaEnvio below 1", async () => {
    const aeat = createFakeAeat({ tiempoEsperaInicial: 1 });
    const first = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const second = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/2") }]);
    expect(first.TiempoEsperaEnvio).toBe(1);
    expect(second.TiempoEsperaEnvio).toBe(1);
  });

  // Distinct from the test above: `tiempoEsperaInicial: 1` already sits above the floor, so it
  // never exercises the INITIAL clamp — only the decrement's own `Math.max(1, …)`. A caller
  // passing 0 (or negative) hits the initial clamp specifically: without `Math.max(1, …)` on
  // construction, this FIRST response (before any decrement runs) would report 0, contradicting
  // the schema (a real AEAT wait is always >= 1).
  it("clamps an out-of-domain tiempoEsperaInicial of 0 (or negative) up to 1 on the very first response", async () => {
    const zero = createFakeAeat({ tiempoEsperaInicial: 0 });
    const first = await zero.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    expect(first.TiempoEsperaEnvio).toBe(1);

    const negative = createFakeAeat({ tiempoEsperaInicial: -5 });
    const firstNegative = await negative
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    expect(firstNegative.TiempoEsperaEnvio).toBe(1);
  });
});

describe("fake AEAT — resubmit (error 3000) and consulta", () => {
  it("returns error 3000 with the stored state on a resubmit of the same identity", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const again = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const linea = again.RespuestaLinea[0];
    expect(linea.EstadoRegistro).toBe("Incorrecto");
    expect(linea.CodigoErrorRegistro).toBe(3000);
    expect(linea.RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Correcta");
  });

  it("consultar returns the stored record with its huella", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    const r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
      FechaExpedicionFactura: "20-07-2026",
    });
    expect(r.ResultadoConsulta).toBe("ConDatos");
    expect(r.registros[0].DatosRegistroFacturacion.Huella).toBe("H-A/1");
    expect(r.registros[0].EstadoRegistro).toBe("Correcta");
  });

  // handleConsulta must match the FULL identity (obligado NIF + NumSerieFactura +
  // FechaExpedicionFactura), not NumSerieFactura alone — otherwise a targeted Route B consulta can
  // return the wrong record, or several, when two different obligados (or two different
  // expedition dates) happen to reuse the same série.
  it("a targeted consulta matches on the full identity, not NumSerieFactura alone", async () => {
    const aeat = createFakeAeat();
    const otherCabecera = { ObligadoEmision: { NombreRazon: "Otro SL", NIF: "B99999999" } };
    // Three near-misses, each sharing exactly two of the three identity fields with the target
    // (NIF "89890001K" | "A/1" | "20-07-2026") — proving all three fields are actually compared,
    // not just a subset: a different obligado NIF, a different expedition date, and (this one)
    // the SAME NIF/fecha but a different NumSerieFactura.
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    await aeat.client().submit(otherCabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/1"),
          IDFactura: {
            IDEmisorFactura: "B99999999",
            NumSerieFactura: "A/1",
            FechaExpedicionFactura: "20-07-2026",
          },
          Huella: "H-OTHER-NIF",
        },
      },
    ]);
    await aeat.client().submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/1", "21-07-2026"),
          Huella: "H-OTHER-FECHA",
        },
      },
    ]);
    await aeat.client().submit(cabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/2"),
          Huella: "H-OTHER-SERIE",
        },
      },
    ]);

    const r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
      FechaExpedicionFactura: "20-07-2026",
    });
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]?.DatosRegistroFacturacion.Huella).toBe("H-A/1");
  });

  it("omits EstadoRegistroDuplicado when detail is dropped (the duplicate_unknown case)", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    aeat.dropRegistroDuplicadoDetail(keyOf(altaFixture("A/1")));
    const again = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    expect(again.RespuestaLinea[0].CodigoErrorRegistro).toBe(3000);
    expect(again.RespuestaLinea[0].RegistroDuplicado?.EstadoRegistroDuplicado).toBeUndefined();
  });

  it("reports an annulled stored record as Anulada on resubmit", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    aeat.annul(keyOf(altaFixture("A/1")));
    const again = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    expect(again.RespuestaLinea[0].RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Anulada");
  });
});

describe("fake AEAT — consulta pagination + RefExterna echo + state hooks", () => {
  it("paginates consulta results via ClavePaginacion, ordered by insertion (presentation-date stand-in)", async () => {
    const aeat = createFakeAeat({ consultaPageSize: 2 });
    for (const numSerie of ["A/1", "A/2", "A/3"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }

    const page1 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(page1.registros).toHaveLength(2);
    expect(page1.IndicadorPaginacion).toBe("S");
    expect(page1.ClavePaginacion).toBeDefined();

    const page2 = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      ClavePaginacion: page1.ClavePaginacion,
    });
    expect(page2.registros).toHaveLength(1);
    expect(page2.IndicadorPaginacion).toBe("N");
    expect(page2.ClavePaginacion).toBeUndefined();
  });

  it("reports no further pages when the filtered set exactly fills one page", async () => {
    const aeat = createFakeAeat({ consultaPageSize: 2 });
    for (const numSerie of ["A/1", "A/2"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }
    const r = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(r.registros).toHaveLength(2);
    expect(r.IndicadorPaginacion).toBe("N");
    expect(r.ClavePaginacion).toBeUndefined();
  });

  // The ClavePaginacion cursor found at index 0 of the filtered set is the edge case that
  // distinguishes `idx >= 0` from an off-by-one `idx > 0`: both agree once idx is 1 or more.
  it("continues correctly when the ClavePaginacion cursor matches the very first record in the filtered set", async () => {
    const aeat = createFakeAeat({ consultaPageSize: 1 });
    for (const numSerie of ["A/1", "A/2", "A/3"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }
    const page1 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(page1.registros[0]?.IDFactura.NumSerieFactura).toBe("A/1");

    const page2 = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      ClavePaginacion: page1.ClavePaginacion,
    });
    expect(page2.registros[0]?.IDFactura.NumSerieFactura).toBe("A/2");
  });

  // Distinct from the pagination tests above (which all pin an explicit consultaPageSize): this
  // one exercises the UNSET-option default itself, so a mutant changing the `?? 2` fallback to
  // some other N is caught even though no test ever asserts the literal default value directly.
  it("defaults consultaPageSize to 2 when the option is not given", async () => {
    const aeat = createFakeAeat();
    for (const numSerie of ["A/1", "A/2", "A/3"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }
    const page1 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(page1.registros).toHaveLength(2);
    expect(page1.IndicadorPaginacion).toBe("S");
  });

  it("falls back to the full filtered set when a ClavePaginacion cursor's record has since been forgotten", async () => {
    const aeat = createFakeAeat({ consultaPageSize: 2 });
    for (const numSerie of ["A/1", "A/2", "A/3"]) {
      await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture(numSerie) }]);
    }
    const page1 = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });

    aeat.forget(keyOf(altaFixture("A/2")));
    const page2 = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      ClavePaginacion: page1.ClavePaginacion,
    });
    expect(page2.registros.map((r) => r.IDFactura.NumSerieFactura)).toEqual(["A/1", "A/3"]);
  });

  it("a full-period sweep only returns records under the queried obligado's NIF", async () => {
    const aeat = createFakeAeat();
    const otherCabecera = { ObligadoEmision: { NombreRazon: "Otro SL", NIF: "B99999999" } };
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
    await aeat.client().submit(otherCabecera, [
      {
        RegistroAlta: {
          ...altaFixture("A/2"),
          IDFactura: {
            IDEmisorFactura: "B99999999",
            NumSerieFactura: "A/2",
            FechaExpedicionFactura: "20-07-2026",
          },
          Huella: "H-OTHER-NIF",
        },
      },
    ]);

    const r = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07" });
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]?.IDFactura.NumSerieFactura).toBe("A/1");
  });

  it("echoes RefExterna in the consulta DatosRegistroFacturacion", async () => {
    const aeat = createFakeAeat();
    await aeat
      .client()
      .submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "20-07-2026", "reg-uuid-1") }]);

    const r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
    });
    // Exact-shape equality (not just a `.RefExterna` property check) also pins that no stray
    // content lands in DatosRegistroFacturacion alongside it.
    expect(r.registros[0]?.DatosRegistroFacturacion).toEqual({
      RefExterna: "reg-uuid-1",
      Huella: "H-A/1",
      TipoHuella: "01",
    });
  });

  it("omits RefExterna from DatosRegistroFacturacion when the record has none", async () => {
    const aeat = createFakeAeat();
    await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);

    const r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
    });
    // Exact-shape equality: no RefExterna key at all, and nothing else sneaks in either.
    expect(r.registros[0]?.DatosRegistroFacturacion).toEqual({
      Huella: "H-A/1",
      TipoHuella: "01",
    });
  });

  it("setConsultaState/forget drive the drift and no-trace cases", async () => {
    const aeat = createFakeAeat();
    const alta = altaFixture("A/1", "20-07-2026", "reg-uuid-1");
    await aeat.client().submit(cabecera, [{ RegistroAlta: alta }]);

    aeat.setConsultaState(keyOf(alta), "AceptadaConErrores");
    let r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
    });
    expect(r.registros[0]?.EstadoRegistro).toBe("AceptadaConErrores");

    aeat.forget(keyOf(alta));
    r = await aeat.client().consultar(cabecera, {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
    });
    expect(r.ResultadoConsulta).toBe("SinDatos");
    expect(r.registros).toHaveLength(0);
  });

  it("setConsultaState and forget are no-ops for a key that was never stored", async () => {
    const aeat = createFakeAeat();
    expect(() =>
      aeat.setConsultaState("89890001K|A/9|20-07-2026", "AceptadaConErrores"),
    ).not.toThrow();
    expect(() => aeat.forget("89890001K|A/9|20-07-2026")).not.toThrow();
    expect(aeat.stored()).toEqual([]);
  });
});
