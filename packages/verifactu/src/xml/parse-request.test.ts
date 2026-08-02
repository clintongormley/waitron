import { describe, expect, it } from "vitest";
import {
  serializeConsulta,
  serializeEnvio,
  type Cabecera,
  type ConsultaFiltro,
  type EnvioRegistro,
} from "./serialize.js";
import { parseConsulta, parseEnvio } from "./parse-request.js";
import type { RegistroAlta, RegistroAnulacion } from "../types.js";

const cabecera: Cabecera = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };

const alta: RegistroAlta = {
  IDVersion: "1.0",
  IDFactura: {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: "A/1",
    FechaExpedicionFactura: "20-07-2026",
  },
  RefExterna: "11111111-1111-1111-1111-111111111111",
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F2",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [
    {
      CalificacionOperacion: "S1",
      TipoImpositivo: "21",
      BaseImponibleOimporteNoSujeto: "102.02",
      CuotaRepercutida: "21.43",
    },
  ],
  CuotaTotal: "21.43",
  ImporteTotal: "123.45",
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: {
    NombreRazon: "Waitron SL",
    NIF: "89890001K",
    NombreSistemaInformatico: "Waitron POS",
    IdSistemaInformatico: "77",
    Version: "0.0.0",
    NumeroInstalacion: "1",
    TipoUsoPosibleSoloVerifactu: "S",
    TipoUsoPosibleMultiOT: "S",
    IndicadorMultiplesOT: "N",
  },
  FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
  TipoHuella: "01",
  Huella: "ABC123",
};

describe("parseEnvio", () => {
  it("round-trips a single alta losslessly", () => {
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips an anulación", () => {
    const anulacion: RegistroAnulacion = {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFacturaAnulada: "89890001K",
        NumSerieFacturaAnulada: "A/1",
        FechaExpedicionFacturaAnulada: "20-07-2026",
      },
      RefExterna: "22222222-2222-2222-2222-222222222222",
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "A/0",
          FechaExpedicionFactura: "19-07-2026",
          Huella: "PREV",
        },
      },
      SistemaInformatico: alta.SistemaInformatico,
      FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
      TipoHuella: "01",
      Huella: "XYZ",
    };
    const registros: EnvioRegistro[] = [{ RegistroAnulacion: anulacion }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips several records from several SIFs in one envío", () => {
    const other = structuredClone(alta);
    other.IDFactura.NumSerieFactura = "B/1";
    other.SistemaInformatico.NumeroInstalacion = "2";
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }, { RegistroAlta: other }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  it("round-trips a cabecera with a Representante", () => {
    const c: Cabecera = {
      ...cabecera,
      Representante: { NombreRazon: "Gestoría X", NIF: "B12345678" },
    };
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(c, registros))).toEqual({ cabecera: c, registros });
  });

  it("round-trips a value carrying XML-special characters", () => {
    const c: Cabecera = {
      ObligadoEmision: { NombreRazon: "Bar & Grill <Málaga>", NIF: "89890001K" },
    };
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(c, registros))).toEqual({ cabecera: c, registros });
  });

  // `alta` above deliberately leaves most optional RegistroAlta fields absent, so none of the
  // matrix above ever exercises altaOf's/detalleOf's `pick()` calls for them, nor the
  // FacturasRectificadas/FacturasSustituidas/ImporteRectificacion/OperacionExenta branches. This
  // fixture populates every one of them so a corrupted field name (or a disabled branch) in
  // parse-request.ts shows up as a genuine value mismatch, not just a coverage gap.
  it("round-trips a rectificativa alta exercising every optional field and both Desglose branches", () => {
    const full: RegistroAlta = {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "R/1",
        FechaExpedicionFactura: "20-07-2026",
      },
      RefExterna: "33333333-3333-3333-3333-333333333333",
      NombreRazonEmisor: "Waitron SL",
      Subsanacion: "S",
      RechazoPrevio: "N",
      TipoFactura: "R1",
      TipoRectificativa: "S",
      FacturasRectificadas: {
        IDFacturaRectificada: [
          {
            IDEmisorFactura: "89890001K",
            NumSerieFactura: "A/1",
            FechaExpedicionFactura: "20-07-2026",
          },
        ],
      },
      FacturasSustituidas: {
        IDFacturaSustituida: [
          {
            IDEmisorFactura: "89890001K",
            NumSerieFactura: "A/2",
            FechaExpedicionFactura: "20-07-2026",
          },
        ],
      },
      ImporteRectificacion: {
        BaseRectificada: "100.00",
        CuotaRectificada: "21.00",
        CuotaRecargoRectificado: "1.40",
      },
      FechaOperacion: "18-07-2026",
      DescripcionOperacion: "Rectificativa por descuento",
      FacturaSimplificadaArt7273: "N",
      FacturaSinIdentifDestinatarioArt61d: "N",
      Macrodato: "N",
      Cupon: "N",
      Desglose: [
        {
          Impuesto: "01",
          ClaveRegimen: "01",
          CalificacionOperacion: "S1",
          TipoImpositivo: "21",
          BaseImponibleOimporteNoSujeto: "100.00",
          BaseImponibleACoste: "90.00",
          CuotaRepercutida: "21.00",
          TipoRecargoEquivalencia: "5.2",
          CuotaRecargoEquivalencia: "5.20",
        },
        { OperacionExenta: "E1", BaseImponibleOimporteNoSujeto: "10.00" },
      ],
      CuotaTotal: "21.00",
      ImporteTotal: "121.00",
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: alta.SistemaInformatico,
      FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
      TipoHuella: "01",
      Huella: "FULL1",
    };
    const registros: EnvioRegistro[] = [{ RegistroAlta: full }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  // An F3 canje carries a Destinatarios block the rectificativa fixture above never exercises.
  // One record covers all three of parse-request's destinatarioOf branches — a NIF entry, an
  // IDOtro entry with CodigoPais, and an IDOtro entry without — so a dropped or corrupted branch
  // shows up as a value mismatch, exactly as the FacturasSustituidas coverage above does.
  it("round-trips a Destinatarios block covering NIF, IDOtro with CodigoPais, and IDOtro without CodigoPais", () => {
    const full: RegistroAlta = {
      ...alta,
      TipoFactura: "F3",
      Destinatarios: {
        IDDestinatario: [
          { NombreRazon: "Cliente Uno SL", NIF: "B99999999" },
          { NombreRazon: "Foreign Buyer", IDOtro: { CodigoPais: "FR", IDType: "04", ID: "X1234" } },
          { NombreRazon: "No-Country Buyer", IDOtro: { IDType: "07", ID: "NP-1" } },
        ],
      },
    };
    const registros: EnvioRegistro[] = [{ RegistroAlta: full }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  // Same reasoning as above, for RegistroAnulacion's own optional fields: the "round-trips an
  // anulación" fixture only sets RefExterna, leaving SinRegistroPrevio/RechazoPrevio/GeneradoPor
  // untouched by any test.
  it("round-trips an anulación exercising SinRegistroPrevio, RechazoPrevio and GeneradoPor", () => {
    const anulacion: RegistroAnulacion = {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFacturaAnulada: "89890001K",
        NumSerieFacturaAnulada: "A/1",
        FechaExpedicionFacturaAnulada: "20-07-2026",
      },
      SinRegistroPrevio: "S",
      RechazoPrevio: "S",
      GeneradoPor: "D",
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: alta.SistemaInformatico,
      FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
      TipoHuella: "01",
      Huella: "XYZ2",
    };
    const registros: EnvioRegistro[] = [{ RegistroAnulacion: anulacion }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });

  // toEqual treats an explicit `{ RefExterna: undefined }` as equal to `{}` — it cannot tell
  // pick() correctly skipping an absent key apart from a mutant that copies it through as an
  // explicit undefined (`if (raw[key] !== undefined)` mutated to `if (true)`). toStrictEqual can:
  // it fails when the actual object carries a key the expected object does not, even one holding
  // undefined. `alta` leaves every optional field absent, so this is exactly that case.
  it("does not introduce stray undefined-valued keys for absent optional fields", () => {
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toStrictEqual({ cabecera, registros });
  });

  it("throws when the body has no RegFactuSistemaFacturacion at all", () => {
    expect(() => parseEnvio("<foo>bar</foo>")).toThrow(
      "Envio does not contain a RegFactuSistemaFacturacion Cabecera",
    );
  });

  it("throws the same well-formed error when Envelope is present but Body is missing", () => {
    // Mirrors parse-suministro.test.ts's identical two-fixture reasoning: the fixture above omits
    // Envelope entirely, so `parsed.Envelope?.Body` short-circuits at the FIRST `?.` without ever
    // reaching the second — it cannot distinguish `Body?.X` from `Body.X`. This fixture keeps
    // Envelope but omits Body, forcing evaluation through that second link.
    const noBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      </soapenv:Envelope>`;
    expect(() => parseEnvio(noBody)).toThrow(
      "Envio does not contain a RegFactuSistemaFacturacion Cabecera",
    );
  });

  it("throws the same well-formed error when Body is present but RegFactuSistemaFacturacion is missing", () => {
    // This fixture keeps Envelope AND Body, but omits RegFactuSistemaFacturacion — forcing
    // evaluation through the THIRD link (`body?.Cabecera`, where body IS
    // RegFactuSistemaFacturacion). A non-optional `body.Cabecera` here throws a raw TypeError
    // instead of this library's own Error, so this is the one fixture that actually exercises
    // that third `?.` and the `if (!body?.Cabecera)` guard around it.
    const noRegFactu = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body><foo/></soapenv:Body>
      </soapenv:Envelope>`;
    expect(() => parseEnvio(noRegFactu)).toThrow(
      "Envio does not contain a RegFactuSistemaFacturacion Cabecera",
    );
  });

  it("throws a well-formed error when Cabecera is present but there are zero RegistroFactura", () => {
    // serializeEnvio itself throws ("An envio must contain at least one registro") on an empty
    // registros array, so the parser accepting a Cabecera-only envío would be asymmetric with what
    // this package can ever legitimately produce.
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    const withRecord = serializeEnvio(cabecera, registros);
    const cabeceraOnly = withRecord.replace(
      /<sfLR:RegistroFactura>[\s\S]*<\/sfLR:RegistroFactura>/,
      "",
    );
    expect(() => parseEnvio(cabeceraOnly)).toThrow(
      "Envio does not contain at least one RegistroFactura",
    );
  });
});

describe("parseConsulta", () => {
  it("round-trips a consulta filtro (period + serie + clave de paginación)", () => {
    const filtro: ConsultaFiltro = {
      Ejercicio: "2026",
      Periodo: "07",
      NumSerieFactura: "A/1",
      FechaExpedicionFactura: "20-07-2026",
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "A/9",
        FechaExpedicionFactura: "20-07-2026",
      },
    };
    expect(parseConsulta(serializeConsulta(cabecera, filtro))).toEqual({ cabecera, filtro });
  });

  // Same toStrictEqual reasoning as parseEnvio's equivalent test above, applied to
  // NumSerieFactura/ClavePaginacion: both are plain (non-nested) optional assignments, so forcing
  // their `!== undefined` guards to `if (true)` when the field is genuinely absent just assigns
  // `undefined` rather than crashing — toEqual can't see the difference, toStrictEqual can.
  it("round-trips a consulta filtro with no optional fields, without stray undefined-valued keys", () => {
    const filtro: ConsultaFiltro = { Ejercicio: "2026", Periodo: "07" };
    expect(parseConsulta(serializeConsulta(cabecera, filtro))).toStrictEqual({ cabecera, filtro });
  });

  it("throws when the body has no ConsultaFactuSistemaFacturacion at all", () => {
    expect(() => parseConsulta("<foo>bar</foo>")).toThrow(
      "Consulta does not contain a ConsultaFactuSistemaFacturacion body",
    );
  });

  it("throws the same well-formed error when Envelope is present but Body is missing", () => {
    // Same two-fixture reasoning as parseEnvio's equivalent test: the fixture above omits
    // Envelope entirely, so it can't distinguish `Body?.X` from `Body.X`. This one keeps Envelope
    // but omits Body, forcing evaluation through that second link.
    const noBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      </soapenv:Envelope>`;
    expect(() => parseConsulta(noBody)).toThrow(
      "Consulta does not contain a ConsultaFactuSistemaFacturacion body",
    );
  });

  it("throws the same well-formed error when Body is present but ConsultaFactuSistemaFacturacion is missing", () => {
    const noConsultaBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body><foo/></soapenv:Body>
      </soapenv:Envelope>`;
    expect(() => parseConsulta(noConsultaBody)).toThrow(
      "Consulta does not contain a ConsultaFactuSistemaFacturacion body",
    );
  });

  it("throws the same well-formed error when Cabecera is present but FiltroConsulta is missing", () => {
    // Isolates the second disjunct of `!body?.Cabecera || !body.FiltroConsulta`: body IS defined
    // here (so the first disjunct is false), forcing evaluation of the non-optional
    // `body.FiltroConsulta` on a body that itself does have a FiltroConsulta-shaped hole — the
    // fixture that distinguishes `||` from `&&` and the guard's own true/false mutants.
    const noFiltro = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body>
          <sfLRC:ConsultaFactuSistemaFacturacion xmlns:sfLRC="urn:x">
            <sfLRC:Cabecera>
              <sf:ObligadoEmision xmlns:sf="urn:x">
                <sf:NombreRazon>Waitron SL</sf:NombreRazon>
                <sf:NIF>89890001K</sf:NIF>
              </sf:ObligadoEmision>
            </sfLRC:Cabecera>
          </sfLRC:ConsultaFactuSistemaFacturacion>
        </soapenv:Body>
      </soapenv:Envelope>`;
    expect(() => parseConsulta(noFiltro)).toThrow(
      "Consulta does not contain a ConsultaFactuSistemaFacturacion body",
    );
  });

  it("throws a well-formed error when FiltroConsulta is present but PeriodoImputacion is missing", () => {
    // Without this guard, reading `f.PeriodoImputacion.Ejercicio` off an absent PeriodoImputacion
    // throws a raw, unhelpful TypeError instead of this library's own well-formed Error.
    const noPeriodo = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body>
          <sfLRC:ConsultaFactuSistemaFacturacion xmlns:sfLRC="urn:x">
            <sfLRC:Cabecera>
              <sf:ObligadoEmision xmlns:sf="urn:x">
                <sf:NombreRazon>Waitron SL</sf:NombreRazon>
                <sf:NIF>89890001K</sf:NIF>
              </sf:ObligadoEmision>
            </sfLRC:Cabecera>
            <sfLRC:FiltroConsulta>
              <sfLRC:NumSerieFactura>A/1</sfLRC:NumSerieFactura>
            </sfLRC:FiltroConsulta>
          </sfLRC:ConsultaFactuSistemaFacturacion>
        </soapenv:Body>
      </soapenv:Envelope>`;
    expect(() => parseConsulta(noPeriodo)).toThrow(
      "Consulta FiltroConsulta does not contain a PeriodoImputacion",
    );
  });
});
