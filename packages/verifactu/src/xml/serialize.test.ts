import { describe, expect, it } from "vitest";
import { escapeXml } from "./escape.js";
import { serializeConsulta, serializeEnvio } from "./serialize.js";
import type { Cabecera } from "./serialize.js";
import { buildAltaRecord, buildAnulacionRecord } from "../records.js";
import { ALTA_INPUT, CABECERA, SISTEMA } from "../../test/fixtures.js";
import type { AltaInput, AnulacionInput } from "../types.js";

const record = buildAltaRecord(ALTA_INPUT);

describe("escapeXml", () => {
  it("escapes the five XML metacharacters", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("escapes ampersands before other entities, not after", () => {
    // Escaping & last would double-escape the entities just introduced,
    // turning < into &amp;lt;.
    expect(escapeXml("<")).toBe("&lt;");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeXml("12345678/G33")).toBe("12345678/G33");
  });
});

describe("serializeEnvio", () => {
  it("emits a SOAP envelope with one Cabecera and the ObligadoEmision", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(xml).toContain("<sfLR:Cabecera>");
    expect(xml).toContain("<sf:ObligadoEmision>");
    expect(xml).toContain("<sf:NIF>89890001K</sf:NIF>");
  });

  it("includes an optional Representante block when supplied", () => {
    const xml = serializeEnvio(
      { ...CABECERA, Representante: { NombreRazon: "Asesoría Waitron", NIF: "11111111H" } },
      [{ RegistroAlta: record }],
    );
    expect(xml).toContain("<sf:Representante>");
    expect(xml).toContain("<sf:NIF>11111111H</sf:NIF>");
  });

  it("emits the record's literals verbatim so the huella still verifies", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(xml).toContain(`<sf:ImporteTotal>123.45</sf:ImporteTotal>`);
    expect(xml).toContain(`<sf:Huella>${record.Huella}</sf:Huella>`);
    expect(xml).toContain(
      "<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:30+01:00</sf:FechaHoraHusoGenRegistro>",
    );
    // A trailing zero survives only under true pass-through: any reformatting
    // that round-trips the value through Number() (e.g. `${Number(x)}`)
    // silently drops it, producing "111.1" instead of the stored "111.10" —
    // both 123.45 and the huella above are already stable under such a
    // round-trip, so neither can catch that class of bug on its own.
    expect(xml).toContain(
      "<sf:BaseImponibleOimporteNoSujeto>111.10</sf:BaseImponibleOimporteNoSujeto>",
    );
  });

  it("emits PrimerRegistro for a first record and no RegistroAnterior", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(xml).toContain("<sf:PrimerRegistro>S</sf:PrimerRegistro>");
    expect(xml).not.toContain("RegistroAnterior");
  });

  it("emits all four RegistroAnterior sub-fields when chained", () => {
    const chained = buildAltaRecord({
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "12345679/G34",
      FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
      NombreRazonEmisor: "Waitron SL",
      TipoFactura: "F1",
      DescripcionOperacion: "Venta",
      Desglose: [
        {
          CalificacionOperacion: "S1",
          BaseImponibleOimporteNoSujeto: 111.1,
          CuotaRepercutida: 12.35,
        },
      ],
      CuotaTotal: 12.35,
      ImporteTotal: 123.45,
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "12345678/G33",
          FechaExpedicionFactura: "01-01-2024",
          Huella: record.Huella,
        },
      },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:35+01:00"),
      offsetMinutes: 60,
    } satisfies AltaInput);
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: chained }]);
    expect(xml).toContain("<sf:RegistroAnterior>");
    expect(xml).toContain(`<sf:Huella>${record.Huella}</sf:Huella>`);
    expect(xml).not.toContain("PrimerRegistro");
  });

  it("serialises several records into one envio", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: record }, { RegistroAlta: record }]);
    expect(xml.match(/<sfLR:RegistroFactura>/g)).toHaveLength(2);
  });

  it("serialises a RegistroAnulacion using the ...Anulada identity field names", () => {
    const anulacion = buildAnulacionRecord({
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "12345679/G34",
      FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "12345679/G34",
          FechaExpedicionFactura: "01-01-2024",
          Huella: record.Huella,
        },
      },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:40+01:00"),
      offsetMinutes: 60,
    } satisfies AnulacionInput);
    const xml = serializeEnvio(CABECERA, [{ RegistroAnulacion: anulacion }]);
    expect(xml).toContain("<sf:RegistroAnulacion>");
    expect(xml).toContain("<sf:NumSerieFacturaAnulada>12345679/G34</sf:NumSerieFacturaAnulada>");
    expect(xml).toContain(`<sf:Huella>${anulacion.Huella}</sf:Huella>`);
    expect(xml).not.toContain("<sf:RegistroAlta>");
  });

  it("qualifies RegistroAlta and RegistroAnulacion with sf:, never sfLR:", () => {
    // SuministroLR.xsd's RegistroFacturaType is a <choice> of <element ref="sf:RegistroAlta"/>
    // and <element ref="sf:RegistroAnulacion"/>. An XSD `ref` always resolves to the namespace
    // where the element is GLOBALLY declared — both are top-level elements in
    // SuministroInformacion.xsd (the sf namespace) — regardless of which schema references them.
    // The surrounding wrappers (RegFactuSistemaFacturacion, Cabecera, RegistroFactura) are
    // locally declared inside SuministroLR.xsd itself, so those correctly stay sfLR:.
    const altaXml = serializeEnvio(CABECERA, [{ RegistroAlta: record }]);
    expect(altaXml).toMatch(/<sf:RegistroAlta>[\s\S]*<\/sf:RegistroAlta>/);
    expect(altaXml).not.toContain("<sfLR:RegistroAlta>");
    expect(altaXml).not.toContain("</sfLR:RegistroAlta>");
    // The wrappers must still be sfLR:.
    expect(altaXml).toContain("<sfLR:RegFactuSistemaFacturacion>");
    expect(altaXml).toContain("<sfLR:Cabecera>");
    expect(altaXml).toContain("<sfLR:RegistroFactura>");

    const anulacion = buildAnulacionRecord({
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "12345679/G34",
      FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:45+01:00"),
      offsetMinutes: 60,
    } satisfies AnulacionInput);
    const anulacionXml = serializeEnvio(CABECERA, [{ RegistroAnulacion: anulacion }]);
    expect(anulacionXml).toMatch(/<sf:RegistroAnulacion>[\s\S]*<\/sf:RegistroAnulacion>/);
    expect(anulacionXml).not.toContain("<sfLR:RegistroAnulacion>");
    expect(anulacionXml).not.toContain("</sfLR:RegistroAnulacion>");
  });

  it("accepts exactly 1000 records — the maxOccurs boundary itself, not just one past it", () => {
    // The existing "rejects a batch larger than the cap" test uses 1001 and would not notice
    // a `>` -> `>=` mutation at the boundary; this pins the boundary from the accepting side.
    const exactly1000 = Array.from({ length: 1000 }, () => ({ RegistroAlta: record }));
    const xml = serializeEnvio(CABECERA, exactly1000);
    expect(xml.match(/<sfLR:RegistroFactura>/g)).toHaveLength(1000);
  });

  it("emits an optional field that holds an empty string, not just non-empty text", () => {
    // el() must check `value === undefined`, not falsiness — otherwise a legitimately
    // empty-but-present fiscal field would be silently dropped.
    const withEmptyRef = { ...record, RefExterna: "" };
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: withEmptyRef }]);
    expect(xml).toContain("<sf:RefExterna></sf:RefExterna>");
  });

  it("emits an optional monetary field that is legitimately zero, not just non-zero amounts", () => {
    const zeroCuota = buildAltaRecord({
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "12345680/G35",
      FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
      NombreRazonEmisor: "Waitron SL",
      TipoFactura: "F1",
      DescripcionOperacion: "Venta exenta",
      Desglose: [
        {
          CalificacionOperacion: "S1",
          BaseImponibleOimporteNoSujeto: 100,
          CuotaRepercutida: 0,
          TipoImpositivo: 0,
        },
      ],
      CuotaTotal: 0,
      ImporteTotal: 100,
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:50+01:00"),
      offsetMinutes: 60,
    } satisfies AltaInput);
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: zeroCuota }]);
    expect(xml).toContain("<sf:CuotaRepercutida>0.00</sf:CuotaRepercutida>");
    expect(xml).toContain("<sf:CuotaTotal>0.00</sf:CuotaTotal>");
  });

  it("rejects a batch larger than the 1000-record cap", () => {
    // maxOccurs="1000" in the official XSD; exceeding it draws error 4113/4114.
    // The caller batches, but the library refuses to build an invalid envio.
    const many = Array.from({ length: 1001 }, () => ({ RegistroAlta: record }));
    expect(() => serializeEnvio(CABECERA, many)).toThrow(/1000/);
  });

  it("rejects an empty batch", () => {
    expect(() => serializeEnvio(CABECERA, [])).toThrow(/at least one/i);
  });

  it("escapes text content", () => {
    const withEntity = {
      ...record,
      NombreRazonEmisor: "Bar & Grill",
    };
    expect(serializeEnvio(CABECERA, [{ RegistroAlta: withEntity }])).toContain("Bar &amp; Grill");
  });
});

/**
 * Extracts every plain `<sf:Name>` opening tag in document order. Every type
 * in the schema is an xsd:sequence, so order is load-bearing — a misordered
 * document is rejected wholesale — but every assertion elsewhere in this file
 * is a `toContain()` on an individual element, which cannot see order at all.
 * These tests instead compare the FULL emitted sequence against the expected
 * one as a single array, so a swap anywhere breaks the array shape rather
 * than surviving unnoticed.
 *
 * Deliberately matches only `<sf:Name>` (never `</sf:Name>`, which starts
 * with `<` immediately followed by `/`, not `s`) — so this captures opening
 * tags only, both leaves and containers, nested or not, in the order they
 * appear in the string.
 */
function tagOrder(xml: string): string[] {
  return [...xml.matchAll(/<sf:([A-Za-z][A-Za-z0-9]*)>/g)].map((match) => match[1]!);
}

describe("element order — sequence is load-bearing, not just presence", () => {
  // One record exercising every optional field at once (including a full
  // rectificativa and a chained Encadenamiento), so the expected array below
  // pins the position of every element the schema defines a position for.
  const orderInput: AltaInput = {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: "ORDER-1",
    FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
    NombreRazonEmisor: "Waitron SL",
    RefExterna: "REF-ORDER",
    Subsanacion: "S",
    RechazoPrevio: "N",
    TipoFactura: "R1",
    TipoRectificativa: "S",
    FacturasRectificadas: [
      {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "OLD-1",
        FechaExpedicionFactura: new Date("2023-12-01T00:00:00+01:00"),
      },
    ],
    FacturasSustituidas: [
      {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "OLD-2",
        FechaExpedicionFactura: new Date("2023-12-01T00:00:00+01:00"),
      },
    ],
    ImporteRectificacion: {
      BaseRectificada: 100,
      CuotaRectificada: 21,
      CuotaRecargoRectificado: 5,
    },
    FechaOperacion: new Date("2024-01-02T00:00:00+01:00"),
    DescripcionOperacion: "Orden de campos",
    FacturaSimplificadaArt7273: "S",
    FacturaSinIdentifDestinatarioArt61d: "S",
    Macrodato: "S",
    Cupon: "S",
    Desglose: [
      {
        Impuesto: "01",
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        TipoImpositivo: 21,
        BaseImponibleOimporteNoSujeto: 100,
        BaseImponibleACoste: 90,
        CuotaRepercutida: 21,
        TipoRecargoEquivalencia: 5.2,
        CuotaRecargoEquivalencia: 5.2,
      },
    ],
    CuotaTotal: 21,
    ImporteTotal: 121,
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "PREV-1",
        FechaExpedicionFactura: "01-01-2024",
        Huella: "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
      },
    },
    SistemaInformatico: SISTEMA,
    generadoEn: new Date("2024-01-01T19:20:30+01:00"),
    offsetMinutes: 60,
  };

  it("pins registroAlta's full element order, from Cabecera through the Huella tail", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(orderInput) }]);
    expect(tagOrder(xml)).toEqual([
      // sfLR:Cabecera/sf:ObligadoEmision — proves NombreRazon precedes NIF.
      "ObligadoEmision",
      "NombreRazon",
      "NIF",
      // sf:RegistroAlta itself.
      "RegistroAlta",
      "IDVersion",
      "IDFactura",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "RefExterna",
      "NombreRazonEmisor",
      "Subsanacion",
      "RechazoPrevio",
      "TipoFactura",
      "TipoRectificativa",
      "FacturasRectificadas",
      "IDFacturaRectificada",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "FacturasSustituidas",
      "IDFacturaSustituida",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "ImporteRectificacion",
      "BaseRectificada",
      "CuotaRectificada",
      "CuotaRecargoRectificado",
      "FechaOperacion",
      "DescripcionOperacion",
      "FacturaSimplificadaArt7273",
      "FacturaSinIdentifDestinatarioArt61d",
      "Macrodato",
      "Cupon",
      "Desglose",
      "DetalleDesglose",
      "Impuesto",
      "ClaveRegimen",
      "CalificacionOperacion",
      "TipoImpositivo",
      "BaseImponibleOimporteNoSujeto",
      "BaseImponibleACoste",
      "CuotaRepercutida",
      "TipoRecargoEquivalencia",
      "CuotaRecargoEquivalencia",
      // Proves CuotaTotal precedes ImporteTotal.
      "CuotaTotal",
      "ImporteTotal",
      // Proves the Encadenamiento/SistemaInformatico/FechaHoraHusoGenRegistro/
      // TipoHuella/Huella tail is not reordered.
      "Encadenamiento",
      "RegistroAnterior",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "Huella",
      "SistemaInformatico",
      "NombreRazon",
      "NIF",
      "NombreSistemaInformatico",
      "IdSistemaInformatico",
      "Version",
      "NumeroInstalacion",
      "TipoUsoPosibleSoloVerifactu",
      "TipoUsoPosibleMultiOT",
      "IndicadorMultiplesOT",
      "FechaHoraHusoGenRegistro",
      "TipoHuella",
      "Huella",
    ]);
  });

  it("pins detalle's element order within Desglose", () => {
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: buildAltaRecord(orderInput) }]);
    const start = xml.indexOf("<sf:DetalleDesglose>");
    const end = xml.indexOf("</sf:DetalleDesglose>") + "</sf:DetalleDesglose>".length;
    expect(tagOrder(xml.slice(start, end))).toEqual([
      "DetalleDesglose",
      "Impuesto",
      "ClaveRegimen",
      "CalificacionOperacion",
      "TipoImpositivo",
      "BaseImponibleOimporteNoSujeto",
      "BaseImponibleACoste",
      "CuotaRepercutida",
      "TipoRecargoEquivalencia",
      "CuotaRecargoEquivalencia",
    ]);
  });

  it("pins registroAnulacion's full element order, including a chained Encadenamiento", () => {
    const anulacion = buildAnulacionRecord({
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "ORDER-2",
      FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
      RefExterna: "REF-ORDER-ANUL",
      SinRegistroPrevio: "S",
      RechazoPrevio: "S",
      GeneradoPor: "D",
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "PREV-1",
          FechaExpedicionFactura: "01-01-2024",
          Huella: "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
        },
      },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:30+01:00"),
      offsetMinutes: 60,
    });
    const xml = serializeEnvio(CABECERA, [{ RegistroAnulacion: anulacion }]);
    expect(tagOrder(xml)).toEqual([
      "ObligadoEmision",
      "NombreRazon",
      "NIF",
      "RegistroAnulacion",
      "IDVersion",
      "IDFactura",
      "IDEmisorFacturaAnulada",
      "NumSerieFacturaAnulada",
      "FechaExpedicionFacturaAnulada",
      "RefExterna",
      "SinRegistroPrevio",
      "RechazoPrevio",
      "GeneradoPor",
      "Encadenamiento",
      "RegistroAnterior",
      "IDEmisorFactura",
      "NumSerieFactura",
      "FechaExpedicionFactura",
      "Huella",
      "SistemaInformatico",
      "NombreRazon",
      "NIF",
      "NombreSistemaInformatico",
      "IdSistemaInformatico",
      "Version",
      "NumeroInstalacion",
      "TipoUsoPosibleSoloVerifactu",
      "TipoUsoPosibleMultiOT",
      "IndicadorMultiplesOT",
      "FechaHoraHusoGenRegistro",
      "TipoHuella",
      "Huella",
    ]);
  });
});

describe("exact document output — pins the complete serialised string, not fragments", () => {
  // Most `toContain()` assertions above can't tell a closing tag ("</sf:X>")
  // apart from an empty string, or `Array.prototype.join("")` from
  // `join("Stryker was here!")` — a single element never exercises the
  // separator, and a missing closer still leaves every present fragment
  // findable via toContain. These two tests instead build a maximal record
  // and compare the ENTIRE emitted document against one hardcoded string, so
  // any dropped closing tag, blanked namespace URL, or wrong join separator
  // breaks the comparison instead of surviving unnoticed. The Huella values
  // are interpolated from the actual records (SHA-256 output isn't something
  // to hand-compute) — everything else is a literal.
  it("pins serializeEnvio's full output for a maximal alta plus a maximal anulación", () => {
    const cabecera: Cabecera = {
      ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" },
      Representante: { NombreRazon: "Asesoría Waitron", NIF: "11111111H" },
    };
    const altaInput: AltaInput = {
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "EXACT-1",
      FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
      RefExterna: "REF-1",
      NombreRazonEmisor: "Waitron SL",
      Subsanacion: "S",
      RechazoPrevio: "N",
      TipoFactura: "R1",
      TipoRectificativa: "S",
      FacturasRectificadas: [
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "OLD-1",
          FechaExpedicionFactura: new Date("2023-12-01T00:00:00+01:00"),
        },
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "OLD-2",
          FechaExpedicionFactura: new Date("2023-12-02T00:00:00+01:00"),
        },
      ],
      FacturasSustituidas: [
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "SUB-1",
          FechaExpedicionFactura: new Date("2023-12-03T00:00:00+01:00"),
        },
        {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "SUB-2",
          FechaExpedicionFactura: new Date("2023-12-04T00:00:00+01:00"),
        },
      ],
      ImporteRectificacion: {
        BaseRectificada: 100,
        CuotaRectificada: 21,
        CuotaRecargoRectificado: 5,
      },
      FechaOperacion: new Date("2024-01-02T00:00:00+01:00"),
      DescripcionOperacion: "Factura exacta",
      FacturaSimplificadaArt7273: "S",
      FacturaSinIdentifDestinatarioArt61d: "N",
      Macrodato: "S",
      Cupon: "N",
      Desglose: [
        {
          Impuesto: "01",
          ClaveRegimen: "01",
          CalificacionOperacion: "S1",
          TipoImpositivo: 21,
          BaseImponibleOimporteNoSujeto: 100,
          BaseImponibleACoste: 90,
          CuotaRepercutida: 21,
          TipoRecargoEquivalencia: 5.2,
          CuotaRecargoEquivalencia: 5.2,
        },
        { OperacionExenta: "E1", BaseImponibleOimporteNoSujeto: 50 },
      ],
      CuotaTotal: 21,
      ImporteTotal: 171,
      Encadenamiento: {
        RegistroAnterior: {
          IDEmisorFactura: "89890001K",
          NumSerieFactura: "PREV-1",
          FechaExpedicionFactura: "01-01-2024",
          Huella: "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
        },
      },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:30+01:00"),
      offsetMinutes: 60,
    };
    const alta = buildAltaRecord(altaInput);

    const anulacionInput: AnulacionInput = {
      IDEmisorFacturaAnulada: "89890001K",
      NumSerieFacturaAnulada: "EXACT-2",
      FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
      RefExterna: "REF-2",
      SinRegistroPrevio: "S",
      RechazoPrevio: "S",
      GeneradoPor: "D",
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: SISTEMA,
      generadoEn: new Date("2024-01-01T19:20:35+01:00"),
      offsetMinutes: 60,
    };
    const anulacion = buildAnulacionRecord(anulacionInput);

    const xml = serializeEnvio(cabecera, [
      { RegistroAlta: alta },
      { RegistroAnulacion: anulacion },
    ]);

    const sistemaInformaticoXml =
      "<sf:SistemaInformatico>" +
      "<sf:NombreRazon>Waitron</sf:NombreRazon>" +
      "<sf:NIF>89890001K</sf:NIF>" +
      "<sf:NombreSistemaInformatico>Waitron POS</sf:NombreSistemaInformatico>" +
      "<sf:IdSistemaInformatico>WT</sf:IdSistemaInformatico>" +
      "<sf:Version>1.0.0</sf:Version>" +
      "<sf:NumeroInstalacion>001</sf:NumeroInstalacion>" +
      "<sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>" +
      "<sf:TipoUsoPosibleMultiOT>S</sf:TipoUsoPosibleMultiOT>" +
      "<sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT>" +
      "</sf:SistemaInformatico>";

    const expected =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" ` +
      `xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd">` +
      `<soapenv:Body>` +
      `<sfLR:RegFactuSistemaFacturacion>` +
      `<sfLR:Cabecera>` +
      `<sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>` +
      `<sf:Representante><sf:NombreRazon>Asesoría Waitron</sf:NombreRazon><sf:NIF>11111111H</sf:NIF></sf:Representante>` +
      `</sfLR:Cabecera>` +
      `<sfLR:RegistroFactura>` +
      `<sf:RegistroAlta>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:IDFactura>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>EXACT-1</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>` +
      `</sf:IDFactura>` +
      `<sf:RefExterna>REF-1</sf:RefExterna>` +
      `<sf:NombreRazonEmisor>Waitron SL</sf:NombreRazonEmisor>` +
      `<sf:Subsanacion>S</sf:Subsanacion>` +
      `<sf:RechazoPrevio>N</sf:RechazoPrevio>` +
      `<sf:TipoFactura>R1</sf:TipoFactura>` +
      `<sf:TipoRectificativa>S</sf:TipoRectificativa>` +
      `<sf:FacturasRectificadas>` +
      `<sf:IDFacturaRectificada>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>OLD-1</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>01-12-2023</sf:FechaExpedicionFactura>` +
      `</sf:IDFacturaRectificada>` +
      `<sf:IDFacturaRectificada>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>OLD-2</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>02-12-2023</sf:FechaExpedicionFactura>` +
      `</sf:IDFacturaRectificada>` +
      `</sf:FacturasRectificadas>` +
      `<sf:FacturasSustituidas>` +
      `<sf:IDFacturaSustituida>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>SUB-1</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>03-12-2023</sf:FechaExpedicionFactura>` +
      `</sf:IDFacturaSustituida>` +
      `<sf:IDFacturaSustituida>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>SUB-2</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>04-12-2023</sf:FechaExpedicionFactura>` +
      `</sf:IDFacturaSustituida>` +
      `</sf:FacturasSustituidas>` +
      `<sf:ImporteRectificacion>` +
      `<sf:BaseRectificada>100.00</sf:BaseRectificada>` +
      `<sf:CuotaRectificada>21.00</sf:CuotaRectificada>` +
      `<sf:CuotaRecargoRectificado>5.00</sf:CuotaRecargoRectificado>` +
      `</sf:ImporteRectificacion>` +
      `<sf:FechaOperacion>02-01-2024</sf:FechaOperacion>` +
      `<sf:DescripcionOperacion>Factura exacta</sf:DescripcionOperacion>` +
      `<sf:FacturaSimplificadaArt7273>S</sf:FacturaSimplificadaArt7273>` +
      `<sf:FacturaSinIdentifDestinatarioArt61d>N</sf:FacturaSinIdentifDestinatarioArt61d>` +
      `<sf:Macrodato>S</sf:Macrodato>` +
      `<sf:Cupon>N</sf:Cupon>` +
      `<sf:Desglose>` +
      `<sf:DetalleDesglose>` +
      `<sf:Impuesto>01</sf:Impuesto>` +
      `<sf:ClaveRegimen>01</sf:ClaveRegimen>` +
      `<sf:CalificacionOperacion>S1</sf:CalificacionOperacion>` +
      `<sf:TipoImpositivo>21.00</sf:TipoImpositivo>` +
      `<sf:BaseImponibleOimporteNoSujeto>100.00</sf:BaseImponibleOimporteNoSujeto>` +
      `<sf:BaseImponibleACoste>90.00</sf:BaseImponibleACoste>` +
      `<sf:CuotaRepercutida>21.00</sf:CuotaRepercutida>` +
      `<sf:TipoRecargoEquivalencia>5.20</sf:TipoRecargoEquivalencia>` +
      `<sf:CuotaRecargoEquivalencia>5.20</sf:CuotaRecargoEquivalencia>` +
      `</sf:DetalleDesglose>` +
      `<sf:DetalleDesglose>` +
      `<sf:OperacionExenta>E1</sf:OperacionExenta>` +
      `<sf:BaseImponibleOimporteNoSujeto>50.00</sf:BaseImponibleOimporteNoSujeto>` +
      `</sf:DetalleDesglose>` +
      `</sf:Desglose>` +
      `<sf:CuotaTotal>21.00</sf:CuotaTotal>` +
      `<sf:ImporteTotal>171.00</sf:ImporteTotal>` +
      `<sf:Encadenamiento><sf:RegistroAnterior>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>PREV-1</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>` +
      `<sf:Huella>3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60</sf:Huella>` +
      `</sf:RegistroAnterior></sf:Encadenamiento>` +
      sistemaInformaticoXml +
      `<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:30+01:00</sf:FechaHoraHusoGenRegistro>` +
      `<sf:TipoHuella>01</sf:TipoHuella>` +
      `<sf:Huella>${alta.Huella}</sf:Huella>` +
      `</sf:RegistroAlta>` +
      `</sfLR:RegistroFactura>` +
      `<sfLR:RegistroFactura>` +
      `<sf:RegistroAnulacion>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:IDFactura>` +
      `<sf:IDEmisorFacturaAnulada>89890001K</sf:IDEmisorFacturaAnulada>` +
      `<sf:NumSerieFacturaAnulada>EXACT-2</sf:NumSerieFacturaAnulada>` +
      `<sf:FechaExpedicionFacturaAnulada>01-01-2024</sf:FechaExpedicionFacturaAnulada>` +
      `</sf:IDFactura>` +
      `<sf:RefExterna>REF-2</sf:RefExterna>` +
      `<sf:SinRegistroPrevio>S</sf:SinRegistroPrevio>` +
      `<sf:RechazoPrevio>S</sf:RechazoPrevio>` +
      `<sf:GeneradoPor>D</sf:GeneradoPor>` +
      `<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>` +
      sistemaInformaticoXml +
      `<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:35+01:00</sf:FechaHoraHusoGenRegistro>` +
      `<sf:TipoHuella>01</sf:TipoHuella>` +
      `<sf:Huella>${anulacion.Huella}</sf:Huella>` +
      `</sf:RegistroAnulacion>` +
      `</sfLR:RegistroFactura>` +
      `</sfLR:RegFactuSistemaFacturacion>` +
      `</soapenv:Body>` +
      `</soapenv:Envelope>`;

    expect(xml).toBe(expected);
  });

  it("pins serializeConsulta's full output with every optional filter present", () => {
    const cabecera: Cabecera = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };
    const xml = serializeConsulta(cabecera, {
      Ejercicio: "2024",
      Periodo: "01",
      NumSerieFactura: "12345678/G33",
      FechaExpedicionFactura: "01-01-2024",
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "LAST/G99",
        FechaExpedicionFactura: "31-12-2024",
      },
    });

    const expected =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" ` +
      `xmlns:sfLRC="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd">` +
      `<soapenv:Body>` +
      `<sfLRC:ConsultaFactuSistemaFacturacion>` +
      `<sfLRC:Cabecera>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>` +
      `</sfLRC:Cabecera>` +
      `<sfLRC:FiltroConsulta>` +
      `<sfLRC:PeriodoImputacion><sf:Ejercicio>2024</sf:Ejercicio><sf:Periodo>01</sf:Periodo></sfLRC:PeriodoImputacion>` +
      `<sfLRC:NumSerieFactura>12345678/G33</sfLRC:NumSerieFactura>` +
      `<sfLRC:FechaExpedicionFactura>` +
      `<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>` +
      `</sfLRC:FechaExpedicionFactura>` +
      `<sfLRC:ClavePaginacion>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>LAST/G99</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>31-12-2024</sf:FechaExpedicionFactura>` +
      `</sfLRC:ClavePaginacion>` +
      `</sfLRC:FiltroConsulta>` +
      `</sfLRC:ConsultaFactuSistemaFacturacion>` +
      `</soapenv:Body>` +
      `</soapenv:Envelope>`;

    expect(xml).toBe(expected);
  });

  it("pins serializeEnvio's full output for a MINIMAL alta, with every optional block omitted", () => {
    // The maximal test above always supplies Representante, FacturasRectificadas,
    // FacturasSustituidas and ImporteRectificacion, so it never exercises the
    // "absent" branch of any of their guards (`value === undefined ? "" : ...`,
    // or the Representante ternary in cabeceraXml) — those branches only run
    // when the field is OMITTED, which this minimal record (ALTA_INPUT, no
    // Representante) does for all four at once.
    const minimalRecord = buildAltaRecord(ALTA_INPUT);
    const xml = serializeEnvio(CABECERA, [{ RegistroAlta: minimalRecord }]);

    const expected =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" ` +
      `xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd">` +
      `<soapenv:Body>` +
      `<sfLR:RegFactuSistemaFacturacion>` +
      `<sfLR:Cabecera>` +
      `<sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>` +
      `</sfLR:Cabecera>` +
      `<sfLR:RegistroFactura>` +
      `<sf:RegistroAlta>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:IDFactura>` +
      `<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>12345678/G33</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>` +
      `</sf:IDFactura>` +
      `<sf:NombreRazonEmisor>Waitron SL</sf:NombreRazonEmisor>` +
      `<sf:TipoFactura>F1</sf:TipoFactura>` +
      `<sf:DescripcionOperacion>Venta en establecimiento</sf:DescripcionOperacion>` +
      `<sf:Desglose>` +
      `<sf:DetalleDesglose>` +
      `<sf:CalificacionOperacion>S1</sf:CalificacionOperacion>` +
      `<sf:TipoImpositivo>21.00</sf:TipoImpositivo>` +
      `<sf:BaseImponibleOimporteNoSujeto>111.10</sf:BaseImponibleOimporteNoSujeto>` +
      `<sf:CuotaRepercutida>12.35</sf:CuotaRepercutida>` +
      `</sf:DetalleDesglose>` +
      `</sf:Desglose>` +
      `<sf:CuotaTotal>12.35</sf:CuotaTotal>` +
      `<sf:ImporteTotal>123.45</sf:ImporteTotal>` +
      `<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>` +
      `<sf:SistemaInformatico>` +
      `<sf:NombreRazon>Waitron</sf:NombreRazon>` +
      `<sf:NIF>89890001K</sf:NIF>` +
      `<sf:NombreSistemaInformatico>Waitron POS</sf:NombreSistemaInformatico>` +
      `<sf:IdSistemaInformatico>WT</sf:IdSistemaInformatico>` +
      `<sf:Version>1.0.0</sf:Version>` +
      `<sf:NumeroInstalacion>001</sf:NumeroInstalacion>` +
      `<sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>` +
      `<sf:TipoUsoPosibleMultiOT>S</sf:TipoUsoPosibleMultiOT>` +
      `<sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT>` +
      `</sf:SistemaInformatico>` +
      `<sf:FechaHoraHusoGenRegistro>2024-01-01T19:20:30+01:00</sf:FechaHoraHusoGenRegistro>` +
      `<sf:TipoHuella>01</sf:TipoHuella>` +
      `<sf:Huella>${minimalRecord.Huella}</sf:Huella>` +
      `</sf:RegistroAlta>` +
      `</sfLR:RegistroFactura>` +
      `</sfLR:RegFactuSistemaFacturacion>` +
      `</soapenv:Body>` +
      `</soapenv:Envelope>`;

    expect(xml).toBe(expected);
  });

  it("pins serializeConsulta's full output with every optional filter omitted", () => {
    // The maximal consulta test above always supplies NumSerieFactura,
    // FechaExpedicionFactura and ClavePaginacion, so it never exercises the
    // "absent" branch of either optional-block ternary — this omits all
    // three at once.
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });

    const expected =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" ` +
      `xmlns:sfLRC="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd">` +
      `<soapenv:Body>` +
      `<sfLRC:ConsultaFactuSistemaFacturacion>` +
      `<sfLRC:Cabecera>` +
      `<sf:IDVersion>1.0</sf:IDVersion>` +
      `<sf:ObligadoEmision><sf:NombreRazon>Waitron SL</sf:NombreRazon><sf:NIF>89890001K</sf:NIF></sf:ObligadoEmision>` +
      `</sfLRC:Cabecera>` +
      `<sfLRC:FiltroConsulta>` +
      `<sfLRC:PeriodoImputacion><sf:Ejercicio>2024</sf:Ejercicio><sf:Periodo>01</sf:Periodo></sfLRC:PeriodoImputacion>` +
      `</sfLRC:FiltroConsulta>` +
      `</sfLRC:ConsultaFactuSistemaFacturacion>` +
      `</soapenv:Body>` +
      `</soapenv:Envelope>`;

    expect(xml).toBe(expected);
  });
});

describe("serializeConsulta", () => {
  it("emits the mandatory PeriodoImputacion, qualified with sf: (declared locally in SI.xsd)", () => {
    // PeriodoImputacionType's Ejercicio and Periodo children are declared locally inside
    // SuministroInformacion.xsd, so — unlike the sfLRC:-owned wrapper elements around them —
    // they resolve to the sf namespace, not sfLRC.
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(xml).toContain("<sf:Ejercicio>2024</sf:Ejercicio>");
    expect(xml).toContain("<sf:Periodo>01</sf:Periodo>");
    expect(xml).not.toContain("<sfLRC:Ejercicio>");
    expect(xml).not.toContain("<sfLRC:Periodo>");
    // The PeriodoImputacion wrapper itself is declared locally in ConsultaLR.xsd and stays sfLRC:.
    expect(xml).toContain("<sfLRC:PeriodoImputacion>");
  });

  it("emits the mandatory IDVersion as the first element of Cabecera", () => {
    // CabeceraConsultaSf is a mandatory sequence starting with IDVersion (sf:VersionType,
    // enumeration "1.0"); every consulta was previously rejected before business logic ran
    // because this element was absent entirely.
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(xml).toContain("<sf:IDVersion>1.0</sf:IDVersion>");
    const idVersionIndex = xml.indexOf("<sf:IDVersion>");
    const obligadoIndex = xml.indexOf("<sf:ObligadoEmision>");
    expect(idVersionIndex).toBeGreaterThan(-1);
    expect(idVersionIndex).toBeLessThan(obligadoIndex);
  });

  it("includes an optional invoice identity filter when supplied", () => {
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      NumSerieFactura: "12345678/G33",
    });
    expect(xml).toContain("<sfLRC:NumSerieFactura>12345678/G33</sfLRC:NumSerieFactura>");
  });

  it("nests FechaExpedicionFactura inside the FechaExpedicionConsultaType choice wrapper", () => {
    // FechaExpedicionConsultaType is a <choice> complex type: the sfLRC:FechaExpedicionFactura
    // element must wrap an inner sf:FechaExpedicionFactura (or sf:RangoFechaExpedicion), it
    // cannot itself be a flat leaf.
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      FechaExpedicionFactura: "01-01-2024",
    });
    expect(xml).toContain(
      "<sfLRC:FechaExpedicionFactura>" +
        "<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>" +
        "</sfLRC:FechaExpedicionFactura>",
    );
  });

  it("includes ClavePaginacion when continuing a paged sweep, with sf:-qualified children", () => {
    // ClavePaginacion's type, IDFacturaExpedidaBCType, is declared locally inside
    // SuministroInformacion.xsd, so its children (IDEmisorFactura, NumSerieFactura,
    // FechaExpedicionFactura) resolve to sf:. The ClavePaginacion wrapper itself is declared
    // locally in ConsultaLR.xsd's LRFiltroRegFacturacionType and stays sfLRC:.
    const xml = serializeConsulta(CABECERA, {
      Ejercicio: "2024",
      Periodo: "01",
      ClavePaginacion: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345678/G33",
        FechaExpedicionFactura: "01-01-2024",
      },
    });
    expect(xml).toContain("<sfLRC:ClavePaginacion>");
    expect(xml).toContain("<sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>");
    expect(xml).toContain("<sf:NumSerieFactura>12345678/G33</sf:NumSerieFactura>");
    expect(xml).toContain("<sf:FechaExpedicionFactura>01-01-2024</sf:FechaExpedicionFactura>");
    expect(xml).not.toContain("<sfLRC:IDEmisorFactura>");
    // No top-level NumSerieFactura filter was supplied, so the only NumSerieFactura in this
    // document is ClavePaginacion's child — confirming it is not sfLRC:-qualified.
    expect(xml).not.toContain("<sfLRC:NumSerieFactura>");
  });

  it("omits optional filters that were not supplied", () => {
    const xml = serializeConsulta(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(xml).not.toContain("NumSerieFactura");
    expect(xml).not.toContain("ClavePaginacion");
    expect(xml).not.toContain("FechaExpedicionFactura");
  });
});
