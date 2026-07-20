import { describe, expect, it } from "vitest";
import { parseRespuestaSuministro, resolveEstadoEfectivo } from "./parse-suministro.js";

const envelope = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
     <soapenv:Body>
       <RespuestaRegFactuSistemaFacturacion>${body}</RespuestaRegFactuSistemaFacturacion>
     </soapenv:Body>
   </soapenv:Envelope>`;

const ACCEPTED = envelope(`
  <CSV>ABC123CSV</CSV>
  <DatosPresentacion><NIFPresentador>89890001K</NIFPresentador>
    <TimestampPresentacion>01-01-2024 19:20:30</TimestampPresentacion></DatosPresentacion>
  <EstadoEnvio>Correcto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>12345678/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Correcto</EstadoRegistro>
  </RespuestaLinea>`);

const DUPLICATE_BUT_ACCEPTED = envelope(`
  <EstadoEnvio>Incorrecto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>12345678/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Incorrecto</EstadoRegistro>
    <CodigoErrorRegistro>3000</CodigoErrorRegistro>
    <DescripcionErrorRegistro>Registro de facturacion duplicado.</DescripcionErrorRegistro>
    <RegistroDuplicado>
      <IdPeticionRegistroDuplicado>PET-1</IdPeticionRegistroDuplicado>
      <EstadoRegistroDuplicado>Correcta</EstadoRegistroDuplicado>
    </RegistroDuplicado>
  </RespuestaLinea>`);

// Two lines in one envio, so a caller batching several invoices in one submission does not have
// its second record silently dropped or merged into the first.
const MULTI_LINE = envelope(`
  <EstadoEnvio>ParcialmenteCorrecto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>1/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Correcto</EstadoRegistro>
  </RespuestaLinea>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>2/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>Incorrecto</EstadoRegistro>
    <CodigoErrorRegistro>1180</CodigoErrorRegistro>
  </RespuestaLinea>`);

// A structural rejection (e.g. bad Cabecera) can reject the whole envio before any line is
// evaluated, so RespuestaLinea can legitimately be entirely absent.
const REJECTED_NO_LINES = envelope(`
  <EstadoEnvio>Incorrecto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>`);

// EstadoRegistro's OWN "AceptadoConErrores" (masculine, agreeing with "Registro") is a distinct
// enum value from EstadoRegistroDuplicado's "AceptadaConErrores" (feminine) used inside a 3000
// block — this fixture exercises the outer one, with no CodigoErrorRegistro at all.
const ACCEPTED_WITH_ERRORS = envelope(`
  <EstadoEnvio>Correcto</EstadoEnvio>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <RespuestaLinea>
    <IDFactura><IDEmisorFactura>89890001K</IDEmisorFactura>
      <NumSerieFactura>12345678/G33</NumSerieFactura>
      <FechaExpedicionFactura>01-01-2024</FechaExpedicionFactura></IDFactura>
    <EstadoRegistro>AceptadoConErrores</EstadoRegistro>
  </RespuestaLinea>`);

describe("parseRespuestaSuministro", () => {
  it("extracts the envelope status and wait time", () => {
    const response = parseRespuestaSuministro(ACCEPTED);
    expect(response.EstadoEnvio).toBe("Correcto");
    expect(response.TiempoEsperaEnvio).toBe(60);
  });

  it("returns TiempoEsperaEnvio as a number", () => {
    expect(typeof parseRespuestaSuministro(ACCEPTED).TiempoEsperaEnvio).toBe("number");
  });

  it("round-trips a four-digit wait time", () => {
    // The schema permits \d{0,4}, so up to 9999. Any 8-bit storage overflows
    // silently above 255.
    const xml = ACCEPTED.replace("<TiempoEsperaEnvio>60<", "<TiempoEsperaEnvio>9999<");
    expect(parseRespuestaSuministro(xml).TiempoEsperaEnvio).toBe(9999);
  });

  it("throws a well-formed error instead of returning NaN for a non-numeric TiempoEsperaEnvio", () => {
    // Number("not-a-number") is NaN, which silently satisfies the `number`
    // type. This value drives the caller's next-submission scheduling, so a
    // malformed element must fail loudly here rather than propagate a
    // poisoned NaN into that schedule.
    const xml = ACCEPTED.replace("<TiempoEsperaEnvio>60<", "<TiempoEsperaEnvio>not-a-number<");
    expect(() => parseRespuestaSuministro(xml)).toThrow(/TiempoEsperaEnvio.*not-a-number/);
  });

  it("throws a well-formed error instead of returning NaN when TiempoEsperaEnvio is absent", () => {
    // fast-xml-parser simply omits the key when the element is missing, so
    // `Number(undefined)` (NaN) would otherwise slip through the same way a
    // malformed literal would.
    const xml = ACCEPTED.replace("<TiempoEsperaEnvio>60</TiempoEsperaEnvio>", "");
    expect(() => parseRespuestaSuministro(xml)).toThrow(/TiempoEsperaEnvio/);
  });

  it("extracts the CSV when the envio was accepted", () => {
    expect(parseRespuestaSuministro(ACCEPTED).CSV).toBe("ABC123CSV");
  });

  it("leaves CSV undefined when absent", () => {
    // The CSV is only generated when the envio is not rejected, and it can
    // never be retrieved later — the caller must persist it on receipt.
    expect(parseRespuestaSuministro(DUPLICATE_BUT_ACCEPTED).CSV).toBeUndefined();
  });

  it("parses the per-record lines with their invoice identity", () => {
    const [linea] = parseRespuestaSuministro(ACCEPTED).RespuestaLinea;
    expect(linea?.IDFactura.NumSerieFactura).toBe("12345678/G33");
    expect(linea?.EstadoRegistro).toBe("Correcto");
  });

  it("normalises a single line into an array", () => {
    // fast-xml-parser collapses a lone repeated element into an object; a
    // caller iterating the result would otherwise break on single-record
    // envios, which is the common case for a quiet till.
    expect(Array.isArray(parseRespuestaSuministro(ACCEPTED).RespuestaLinea)).toBe(true);
  });

  it("keeps multiple RespuestaLinea entries distinct instead of collapsing them", () => {
    const lineas = parseRespuestaSuministro(MULTI_LINE).RespuestaLinea;
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.IDFactura.NumSerieFactura)).toEqual(["1/G33", "2/G33"]);
    expect(lineas[1]?.CodigoErrorRegistro).toBe(1180);
  });

  it("returns an empty array when the envio is rejected before any line is evaluated", () => {
    expect(parseRespuestaSuministro(REJECTED_NO_LINES).RespuestaLinea).toEqual([]);
  });

  it("parses the RegistroDuplicado block on a 3000", () => {
    const [linea] = parseRespuestaSuministro(DUPLICATE_BUT_ACCEPTED).RespuestaLinea;
    expect(linea?.CodigoErrorRegistro).toBe(3000);
    expect(linea?.RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Correcta");
  });

  it("throws a well-formed error for a non-numeric RespuestaLinea.CodigoErrorRegistro", () => {
    const xml = MULTI_LINE.replace("<CodigoErrorRegistro>1180<", "<CodigoErrorRegistro>bogus<");
    expect(() => parseRespuestaSuministro(xml)).toThrow(
      /RespuestaLinea\.CodigoErrorRegistro.*bogus/,
    );
  });

  it("throws a well-formed error for a non-numeric RegistroDuplicado.CodigoErrorRegistro", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      /<RegistroDuplicado>[\s\S]*<\/RegistroDuplicado>/,
      "<RegistroDuplicado><EstadoRegistroDuplicado>Correcta</EstadoRegistroDuplicado>" +
        "<CodigoErrorRegistro>bogus</CodigoErrorRegistro></RegistroDuplicado>",
    );
    expect(() => parseRespuestaSuministro(xml)).toThrow(
      /RegistroDuplicado\.CodigoErrorRegistro.*bogus/,
    );
  });

  it("preserves a literal with leading and trailing zeros as a string, not a number", () => {
    // parseTagValue is deliberately off. Flipping it to true would turn
    // "00123.40" into the number 123.4 — destroying the leading zeros AND the
    // trailing decimal zero — which would corrupt any literal of this shape,
    // not just this one field.
    const xml = ACCEPTED.replace("12345678/G33", "00123.40");
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(linea?.IDFactura.NumSerieFactura).toBe("00123.40");
  });

  it("throws when the body has no RespuestaRegFactuSistemaFacturacion", () => {
    expect(() => parseRespuestaSuministro("<foo>bar</foo>")).toThrow(
      /RespuestaRegFactuSistemaFacturacion/,
    );
  });

  it("throws the same well-formed error when Envelope is present but Body is missing", () => {
    // A fixture with no Envelope at all (above) short-circuits at the FIRST
    // `?.` in `parsed.Envelope?.Body?.RespuestaRegFactuSistemaFacturacion`
    // without ever touching the second — so it can't tell `Body?.X` apart
    // from `Body.X`. This fixture keeps Envelope but omits Body, forcing
    // evaluation through the second optional-chain link: a non-optional
    // `Body.X` throws a TypeError ("Cannot read properties of undefined
    // (reading 'RespuestaRegFactuSistemaFacturacion')") instead of this
    // library's own Error — and that TypeError's message happens to also
    // CONTAIN the element name, so a plain `/RespuestaRegFactu.../` regex
    // can't tell them apart either. This matches the "does not contain a"
    // phrasing that is unique to the library's own thrown Error.
    const noBody = `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      </soapenv:Envelope>`;
    expect(() => parseRespuestaSuministro(noBody)).toThrow(
      "Response does not contain a RespuestaRegFactuSistemaFacturacion body",
    );
  });

  it("ignores an XML attribute instead of splitting the leaf into an object", () => {
    // ignoreAttributes must stay true: fast-xml-parser only collapses a leaf
    // with both an attribute and text content into a plain string when
    // attributes are ignored. With ignoreAttributes off, the very same leaf
    // parses to `{ "@_tipo": "NIF", "#text": "89890001K" }` instead of the
    // plain string "89890001K" — silently breaking every consumer that
    // expects a string here (and everywhere else an AEAT response happens
    // to carry an attribute).
    const withAttribute = ACCEPTED.replace(
      "<IDEmisorFactura>89890001K</IDEmisorFactura>",
      '<IDEmisorFactura tipo="NIF">89890001K</IDEmisorFactura>',
    );
    const [linea] = parseRespuestaSuministro(withAttribute).RespuestaLinea;
    expect(linea?.IDFactura.IDEmisorFactura).toBe("89890001K");
    expect(typeof linea?.IDFactura.IDEmisorFactura).toBe("string");
  });
});

describe("resolveEstadoEfectivo", () => {
  it("reports an accepted record as accepted", () => {
    const [linea] = parseRespuestaSuministro(ACCEPTED).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted");
  });

  it("reports an outer AceptadoConErrores (no 3000 involved) as accepted-with-errors", () => {
    const [linea] = parseRespuestaSuministro(ACCEPTED_WITH_ERRORS).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted_with_errors");
  });

  it("reports a 3000 whose stored record is Correcta as ACCEPTED, not rejected", () => {
    // The outer EstadoRegistro reads Incorrecto. Trusting it would mark an
    // accepted record rejected and halt a healthy chain — the exact inversion
    // this function exists to prevent.
    const [linea] = parseRespuestaSuministro(DUPLICATE_BUT_ACCEPTED).RespuestaLinea;
    expect(linea?.EstadoRegistro).toBe("Incorrecto");
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted");
  });

  it("reports a 3000 whose stored record is AceptadaConErrores as accepted-with-errors", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "<EstadoRegistroDuplicado>Correcta<",
      "<EstadoRegistroDuplicado>AceptadaConErrores<",
    );
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("accepted_with_errors");
  });

  it("reports a 3000 whose stored record is Anulada as needing attention", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "<EstadoRegistroDuplicado>Correcta<",
      "<EstadoRegistroDuplicado>Anulada<",
    );
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("duplicate_annulled");
  });

  it("reports a genuine rejection as rejected", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      "<CodigoErrorRegistro>3000<",
      "<CodigoErrorRegistro>1180<",
    ).replace(/<RegistroDuplicado>[\s\S]*<\/RegistroDuplicado>/, "");
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("rejected");
  });

  it("reports a 3000 with no duplicate block as needing a consulta", () => {
    const xml = DUPLICATE_BUT_ACCEPTED.replace(
      /<RegistroDuplicado>[\s\S]*<\/RegistroDuplicado>/,
      "",
    );
    const [linea] = parseRespuestaSuministro(xml).RespuestaLinea;
    expect(resolveEstadoEfectivo(linea!)).toBe("duplicate_unknown");
  });
});
