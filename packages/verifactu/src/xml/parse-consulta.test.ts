import { describe, expect, it } from "vitest";
import { parseRespuestaConsulta } from "./parse-consulta.js";

const RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body>
      <RespuestaConsultaFactuSistemaFacturacion>
        <ResultadoConsulta>ConDatos</ResultadoConsulta>
        <IndicadorPaginacion>N</IndicadorPaginacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>12345678/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion>
            <ImporteTotal>123.45</ImporteTotal>
            <CuotaTotal>12.35</CuotaTotal>
            <Huella>3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60</Huella>
            <TipoHuella>01</TipoHuella>
          </DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-15T08:45:12+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>Correcta</EstadoRegistro>
          </EstadoRegistro>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
      </RespuestaConsultaFactuSistemaFacturacion>
    </soapenv:Body>
  </soapenv:Envelope>`;

// Two registros in one page, so a caller sweeping several invoices in one query does not have its
// second record silently dropped or merged into the first (mirrors the equivalent submission-side
// guard in parse-suministro.test.ts).
const MULTI_RECORD = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body>
      <RespuestaConsultaFactuSistemaFacturacion>
        <ResultadoConsulta>ConDatos</ResultadoConsulta>
        <IndicadorPaginacion>N</IndicadorPaginacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>1/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion><Huella>AAA</Huella></DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-15T08:45:12+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>Correcta</EstadoRegistro>
          </EstadoRegistro>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>2/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion><Huella>BBB</Huella></DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-16T09:10:05+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>AceptadaConErrores</EstadoRegistro>
          </EstadoRegistro>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
      </RespuestaConsultaFactuSistemaFacturacion>
    </soapenv:Body>
  </soapenv:Envelope>`;

// A full page: more results exist, so ClavePaginacion must be echoed into the next request. The
// paginacion key intentionally reuses different field values than the record itself, so a bug
// that reads the record's IDFactura instead of the paginacion key would be caught.
const PAGINATED = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body>
      <RespuestaConsultaFactuSistemaFacturacion>
        <ResultadoConsulta>ConDatos</ResultadoConsulta>
        <IndicadorPaginacion>S</IndicadorPaginacion>
        <ClavePaginacion>
          <IDEmisorFactura>99999999R</IDEmisorFactura>
          <NumSerieFactura>LAST/G99</NumSerieFactura>
          <FechaExpedicionFactura>31-12-2024</FechaExpedicionFactura>
        </ClavePaginacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>12345678/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion><Huella>AAA</Huella></DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-15T08:45:12+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>Correcta</EstadoRegistro>
          </EstadoRegistro>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
      </RespuestaConsultaFactuSistemaFacturacion>
    </soapenv:Body>
  </soapenv:Envelope>`;

// A record can be reported AceptadaConErrores with the error detail nested inside the same
// EstadoRegistro wrapper as the status leaf, not at the record root.
const WITH_ERROR_DETAIL = `<?xml version="1.0" encoding="UTF-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body>
      <RespuestaConsultaFactuSistemaFacturacion>
        <ResultadoConsulta>ConDatos</ResultadoConsulta>
        <IndicadorPaginacion>N</IndicadorPaginacion>
        <RegistroRespuestaConsultaFactuSistemaFacturacion>
          <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
            <NumSerieFactura>12345678/G33</NumSerieFactura>
            <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
          <DatosRegistroFacturacion><Huella>AAA</Huella></DatosRegistroFacturacion>
          <EstadoRegistro>
            <TimestampUltimaModificacion>2024-06-17T11:30:00+02:00</TimestampUltimaModificacion>
            <EstadoRegistro>AceptadaConErrores</EstadoRegistro>
            <CodigoErrorRegistro>1180</CodigoErrorRegistro>
            <DescripcionErrorRegistro>Error de bloque.</DescripcionErrorRegistro>
          </EstadoRegistro>
          <DatosPresentacion>
            <NIFPresentador>89890001K</NIFPresentador>
            <TimestampPresentacion>01-01-2024 19:20:30</TimestampPresentacion>
            <IdPeticion>PET-9</IdPeticion>
          </DatosPresentacion>
        </RegistroRespuestaConsultaFactuSistemaFacturacion>
      </RespuestaConsultaFactuSistemaFacturacion>
    </soapenv:Body>
  </soapenv:Envelope>`;

describe("parseRespuestaConsulta", () => {
  it("reports whether the query returned data", () => {
    expect(parseRespuestaConsulta(RESPONSE).ResultadoConsulta).toBe("ConDatos");
  });

  it("returns the stored huella so it can be compared field-free", () => {
    // Comparing the stored huella is a single-field check equivalent to
    // diffing every hashed field, which is why the 3000 resolution uses it.
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.DatosRegistroFacturacion.Huella).toBe(
      "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
    );
  });

  it("preserves leading/trailing whitespace in DatosRegistroFacturacion literals", () => {
    // trimValues is deliberately off (see parse-common.ts): DatosRegistroFacturacion
    // holds AEAT's stored literals for field-by-field reconciliation, and
    // trimming is exactly as much a transformation of that literal as
    // parseTagValue would be — the setting fast-xml-parser leaves them BOTH
    // off for the same reason. This is contrived (real AEAT responses are not
    // expected to pad a value this way) but it proves the parser passes
    // whatever literal it received through unmangled, rather than "helpfully"
    // cleaning it up.
    const xml = RESPONSE.replace(
      "<ImporteTotal>123.45</ImporteTotal>",
      "<ImporteTotal> 123.45 </ImporteTotal>",
    );
    const [registro] = parseRespuestaConsulta(xml).registros;
    expect(registro?.DatosRegistroFacturacion.ImporteTotal).toBe(" 123.45 ");
  });

  it("preserves leading and trailing zeros in DatosRegistroFacturacion as literal strings", () => {
    // parseTagValue is deliberately off. DatosRegistroFacturacion holds
    // AEAT's stored literals for the reconciliation path — the one whose
    // whole purpose is comparing those literals against ours — so flipping
    // it to true would silently corrupt TipoHuella "01" -> 1 and ImporteTotal
    // "123.40" -> 123.4.
    const xml = RESPONSE.replace(
      "<ImporteTotal>123.45</ImporteTotal>",
      "<ImporteTotal>123.40</ImporteTotal>",
    );
    const [registro] = parseRespuestaConsulta(xml).registros;
    expect(registro?.DatosRegistroFacturacion.TipoHuella).toBe("01");
    expect(registro?.DatosRegistroFacturacion.ImporteTotal).toBe("123.40");
  });

  it("parses TimestampUltimaModificacion, the required last-modified timestamp AEAT holds for the record", () => {
    // Required by EstadoRegFactuType (no minOccurs="0"), unlike everything
    // else nested inside EstadoRegistro. It's how a consumer reconciling its
    // own records against AEAT's knows when the authority's copy last
    // changed.
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.TimestampUltimaModificacion).toBe("2024-06-15T08:45:12+02:00");
  });

  it("uses the consulta enum, which has Anulada and no Incorrecta", () => {
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.EstadoRegistro).toBe("Correcta");
    const annulled = RESPONSE.replace(
      "<EstadoRegistro>Correcta</EstadoRegistro>",
      "<EstadoRegistro>Anulada</EstadoRegistro>",
    );
    expect(parseRespuestaConsulta(annulled).registros[0]?.EstadoRegistro).toBe("Anulada");
  });

  it("exposes no CSV field at all", () => {
    // The CSV exists only in the submission response and can never be
    // retrieved later. A csv property here would be permanently undefined and
    // would invite exactly the bug it looks like it solves.
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro).not.toHaveProperty("CSV");
    expect(parseRespuestaConsulta(RESPONSE)).not.toHaveProperty("CSV");
  });

  it("reports no further pages when IndicadorPaginacion is N", () => {
    expect(parseRespuestaConsulta(RESPONSE).IndicadorPaginacion).toBe("N");
    expect(parseRespuestaConsulta(RESPONSE).ClavePaginacion).toBeUndefined();
  });

  it("returns an empty list when the query found nothing", () => {
    const empty = RESPONSE.replace("ConDatos", "SinDatos").replace(
      /<RegistroRespuestaConsultaFactuSistemaFacturacion>[\s\S]*<\/RegistroRespuestaConsultaFactuSistemaFacturacion>/,
      "",
    );
    const response = parseRespuestaConsulta(empty);
    expect(response.ResultadoConsulta).toBe("SinDatos");
    expect(response.registros).toEqual([]);
  });

  it("parses the record's own invoice identity, not just its status", () => {
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.IDFactura).toEqual({
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "12345678/G33",
      FechaExpedicionFactura: "01-01-2024",
    });
  });

  it("keeps multiple registros distinct instead of collapsing them", () => {
    const registros = parseRespuestaConsulta(MULTI_RECORD).registros;
    expect(registros).toHaveLength(2);
    expect(registros.map((r) => r.IDFactura.NumSerieFactura)).toEqual(["1/G33", "2/G33"]);
    expect(registros.map((r) => r.EstadoRegistro)).toEqual(["Correcta", "AceptadaConErrores"]);
  });

  it("echoes ClavePaginacion verbatim when IndicadorPaginacion is S, for the next page", () => {
    const response = parseRespuestaConsulta(PAGINATED);
    expect(response.IndicadorPaginacion).toBe("S");
    // Distinct from the record's own IDFactura, proving the paginacion key
    // (not the record) is what got read.
    expect(response.ClavePaginacion).toEqual({
      IDEmisorFactura: "99999999R",
      NumSerieFactura: "LAST/G99",
      FechaExpedicionFactura: "31-12-2024",
    });
    expect(response.registros[0]?.IDFactura.NumSerieFactura).toBe("12345678/G33");
  });

  it("extracts the error detail and DatosPresentacion nested inside EstadoRegistro/the record", () => {
    const [registro] = parseRespuestaConsulta(WITH_ERROR_DETAIL).registros;
    expect(registro?.CodigoErrorRegistro).toBe(1180);
    expect(typeof registro?.CodigoErrorRegistro).toBe("number");
    expect(registro?.DescripcionErrorRegistro).toBe("Error de bloque.");
    expect(registro?.DatosPresentacion).toEqual({
      NIFPresentador: "89890001K",
      TimestampPresentacion: "01-01-2024 19:20:30",
      IdPeticion: "PET-9",
    });
  });

  it("leaves the error fields and DatosPresentacion undefined when absent", () => {
    const [registro] = parseRespuestaConsulta(RESPONSE).registros;
    expect(registro?.CodigoErrorRegistro).toBeUndefined();
    expect(registro?.DescripcionErrorRegistro).toBeUndefined();
    expect(registro?.DatosPresentacion).toBeUndefined();
  });

  it("throws a well-formed error instead of returning NaN for a non-numeric CodigoErrorRegistro", () => {
    // Number("not-a-number") is NaN, and NaN silently satisfies the `number`
    // type — this field must fail loudly at the parse boundary instead of
    // handing the caller a poisoned value that happens to typecheck.
    const xml = WITH_ERROR_DETAIL.replace(
      "<CodigoErrorRegistro>1180<",
      "<CodigoErrorRegistro>not-a-number<",
    );
    expect(() => parseRespuestaConsulta(xml)).toThrow(/CodigoErrorRegistro.*not-a-number/);
  });

  it("throws when the body has no RespuestaConsultaFactuSistemaFacturacion", () => {
    expect(() => parseRespuestaConsulta("<foo>bar</foo>")).toThrow(
      /RespuestaConsultaFactuSistemaFacturacion/,
    );
  });

  it("throws the same well-formed error when Envelope is present but Body is missing", () => {
    // A fixture with no Envelope at all (above) short-circuits at the FIRST
    // `?.` in `parsed.Envelope?.Body?.RespuestaConsultaFactuSistemaFacturacion`
    // without ever touching the second — so it can't tell `Body?.X` apart
    // from `Body.X`. This fixture keeps Envelope but omits Body, forcing
    // evaluation through the second optional-chain link: a non-optional
    // `Body.X` throws a TypeError ("Cannot read properties of undefined
    // (reading 'RespuestaConsultaFactuSistemaFacturacion')") instead of this
    // library's own Error — and that TypeError's message happens to also
    // CONTAIN the element name, so a plain `/RespuestaConsulta.../` regex
    // can't tell them apart either. This matches the "does not contain a"
    // phrasing that is unique to the library's own thrown Error.
    const noBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      </soapenv:Envelope>`;
    expect(() => parseRespuestaConsulta(noBody)).toThrow(
      "Response does not contain a RespuestaConsultaFactuSistemaFacturacion body",
    );
  });
});
