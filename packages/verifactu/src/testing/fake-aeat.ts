import { createClient, type VerifactuClient } from "../client.js";
import { escapeXml } from "../xml/escape.js";
import { parseConsulta, parseEnvio } from "../xml/parse-request.js";
import type { EstadoEnvio, EstadoRegistroSuministro } from "../xml/parse-suministro.js";
import type { EnvioRegistro } from "../xml/serialize.js";
import { isAlta, type IDFactura, type RegistroAlta, type RegistroAnulacion } from "../types.js";

export type FacturaKey = string;

export interface StoredRecord {
  key: FacturaKey;
  huella: string;
  estado: "Correcta" | "AceptadaConErrores" | "Anulada";
  tipo: "alta" | "anulacion";
  refExterna?: string;
}

export interface FakeAeatOptions {
  serverNow?: Date;
  tiempoEsperaInicial?: number;
}

export interface FakeAeat {
  fetch: typeof globalThis.fetch;
  client(): VerifactuClient;
  setServerNow(now: Date): void;
  reject(key: FacturaKey, code: number, message: string): void;
  stored(): StoredRecord[];
  /** Forces the next resubmit of `key` to omit `RegistroDuplicado.EstadoRegistroDuplicado` (the duplicate_unknown case). */
  dropRegistroDuplicadoDetail(key: FacturaKey): void;
  /** Marks a stored record `Anulada` directly, without going through a RegistroAnulacion submit. */
  annul(key: FacturaKey): void;
}

interface Identity {
  idf: IDFactura;
  tipo: "alta" | "anulacion";
  huella: string;
  ref: string | undefined;
  fecha: string;
}

/**
 * Reads the invoice identity out of either registro shape. A RegistroAnulacion's own IDFactura
 * uses the ...Anulada field names, but it names the SAME invoice its alta did — so this maps it
 * back onto the alta-shaped {IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura} triple that
 * both `keyOf` and the response XML (sf:IDFacturaType, shared by both record kinds) use.
 */
function identityOf(entry: EnvioRegistro): Identity {
  if ("RegistroAlta" in entry) {
    const r = entry.RegistroAlta;
    return {
      idf: r.IDFactura,
      tipo: "alta",
      huella: r.Huella,
      ref: r.RefExterna,
      fecha: r.IDFactura.FechaExpedicionFactura,
    };
  }
  const r = entry.RegistroAnulacion;
  const idf: IDFactura = {
    IDEmisorFactura: r.IDFactura.IDEmisorFacturaAnulada,
    NumSerieFactura: r.IDFactura.NumSerieFacturaAnulada,
    FechaExpedicionFactura: r.IDFactura.FechaExpedicionFacturaAnulada,
  };
  return {
    idf,
    tipo: "anulacion",
    huella: r.Huella,
    ref: r.RefExterna,
    fecha: idf.FechaExpedicionFactura,
  };
}

function keyOfIdentity(idf: IDFactura): FacturaKey {
  return `${idf.IDEmisorFactura}|${idf.NumSerieFactura}|${idf.FechaExpedicionFactura}`;
}

/** The identity key for a bare record — e.g. to build the argument for `reject()`. */
export function keyOf(record: RegistroAlta | RegistroAnulacion): FacturaKey {
  const entry: EnvioRegistro = isAlta(record)
    ? { RegistroAlta: record }
    : { RegistroAnulacion: record };
  return keyOfIdentity(identityOf(entry).idf);
}

// "DD-MM-YYYY" (AEAT's sf:fecha) → a UTC Date at midnight, for the future-dating (2004) check.
function fechaToDate(ddMmYyyy: string): Date {
  const [dd, mm, yyyy] = ddMmYyyy.split("-");
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
}

export function createFakeAeat(options: FakeAeatOptions = {}): FakeAeat {
  const store = new Map<FacturaKey, StoredRecord>();
  const rejections = new Map<FacturaKey, { code: number; message: string }>();
  // Keys for which the next resubmit's 3000 response omits RegistroDuplicado.EstadoRegistroDuplicado
  // entirely (AEAT reporting a duplicate without saying what it holds — duplicate_unknown).
  const noDuplicadoDetail = new Set<FacturaKey>();
  let serverNow = options.serverNow ?? new Date("2026-07-21T00:00:00Z");
  // Clamped into TiempoEsperaEnvio's own schema domain (`\d{0,4}` — at most 9999, and a real wait
  // is always >= 1): a caller (e.g. fiscal-verifactu's drain.test.ts round-trip test) may pass an
  // out-of-domain `tiempoEsperaInicial` deliberately, to prove the CONSUMER handles the extremes
  // the real schema allows rather than whatever arbitrary number a test author typed. Reporting a
  // value the real AEAT could never send would make that a test of nothing.
  let tiempoEspera = Math.max(1, Math.min(9999, options.tiempoEsperaInicial ?? 60));
  let csvSequence = 0;

  function handleEnvio(xml: string): string {
    const { registros } = parseEnvio(xml);
    const lineas: string[] = [];
    let anyRejected = false;
    // Every non-rejected envío issues exactly one CSV (Task 3 will suppress it when the whole
    // envío is Incorrecto).
    const csv = `CSV-${String(++csvSequence).padStart(8, "0")}`;
    for (const entry of registros) {
      const { idf, tipo, huella, ref, fecha } = identityOf(entry);
      const key = keyOfIdentity(idf);
      const existing = store.get(key);
      const forced = rejections.get(key);
      const future = fechaToDate(fecha).getTime() > serverNow.getTime();
      if (existing) {
        // A resubmit of an identity AEAT already holds a record for. The outer EstadoRegistro
        // reads Incorrecto (3000 is an Incorrecto line at the envío level) but RegistroDuplicado
        // reports the ALREADY-STORED state — resolveEstadoEfectivo (parse-suministro.ts) reads
        // that inner state as authoritative, not the outer Incorrecto. The store is left
        // untouched: a resubmit never overwrites what AEAT already holds.
        anyRejected = true;
        const detail = noDuplicadoDetail.has(key) ? undefined : existing.estado;
        lineas.push(duplicadoLineaXml(idf, detail, ref));
        continue;
      }
      if (forced) {
        anyRejected = true;
        lineas.push(lineaXml(idf, "Incorrecto", forced.code, forced.message, ref));
      } else if (future) {
        // 2004 is non-rejecting: the record is still stored and the line reads AceptadoConErrores.
        store.set(key, { key, huella, estado: "AceptadaConErrores", tipo, refExterna: ref });
        lineas.push(
          lineaXml(
            idf,
            "AceptadoConErrores",
            2004,
            "Fecha de expedición posterior a la fecha del sistema",
            ref,
          ),
        );
      } else {
        // A clean alta lands the record; a clean anulación retires the SAME key instead — the two
        // share this branch because both were "successfully processed", but they leave the key in
        // a different final state (Correcta vs Anulada), matching EstadoRegistroDuplicado's
        // vocabulary that Task 3's consulta path will read back.
        const estado = tipo === "anulacion" ? "Anulada" : "Correcta";
        store.set(key, { key, huella, estado, tipo, refExterna: ref });
        lineas.push(lineaXml(idf, "Correcto", undefined, undefined, ref));
      }
    }
    // Hands back the CURRENT wait time (what this response is telling the caller to honour before
    // its next submission), then decrements for the NEXT call — decrementing first would report a
    // wait time one step ahead of what this very response is describing.
    const tiempoParaEsteEnvio = tiempoEspera;
    tiempoEspera = Math.max(1, tiempoEspera - 1);
    return suministroEnvelope(
      csv,
      anyRejected ? "ParcialmenteCorrecto" : "Correcto",
      tiempoParaEsteEnvio,
      lineas,
    );
  }

  function handleConsulta(xml: string): string {
    const { cabecera, filtro } = parseConsulta(xml);
    // Targeted single-record lookup (Route B): match the FULL invoice identity — the obligado's
    // own NIF (IDEmisorFactura) plus NumSerieFactura plus FechaExpedicionFactura — not
    // NumSerieFactura alone, which by itself can span multiple obligados/dates and return the
    // wrong (or multiple) stored record(s). Compared field-by-field against the stored key's own
    // `|`-separated parts (rather than building one comparison key) so a filtro that omits
    // NumSerieFactura/FechaExpedicionFactura just fails those comparisons against real stored
    // values — 3b widens this to a paged period sweep.
    const matches = [...store.values()].filter((s) => {
      const [nif, numSerie, fecha] = s.key.split("|");
      return (
        nif === cabecera.ObligadoEmision.NIF &&
        numSerie === filtro.NumSerieFactura &&
        fecha === filtro.FechaExpedicionFactura
      );
    });
    return consultaEnvelope(matches);
  }

  const fetchImpl: typeof globalThis.fetch = async (_url, init) => {
    const body = String(init?.body ?? "");
    // Dispatch on the consulta operation ELEMENT tag, not a bare substring: a user-controlled leaf
    // value (e.g. NombreRazon/DescripcionOperacion) could legitimately contain the literal text
    // "ConsultaFactuSistemaFacturacion" and mis-route a genuine envío. `escapeXml` escapes `<`/`>`
    // in leaf content, so the `<…ConsultaFactuSistemaFacturacion>` tag form can only come from a real
    // element and cannot be spoofed. (Envío's root is RegFactuSistemaFacturacion.)
    const xml = /<[^<>]*ConsultaFactuSistemaFacturacion>/.test(body)
      ? handleConsulta(body)
      : handleEnvio(body);
    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  };

  return {
    fetch: fetchImpl,
    client: () => createClient({ endpoint: "https://fake.aeat.test/soap", fetch: fetchImpl }),
    setServerNow: (now) => {
      serverNow = now;
    },
    reject: (key, code, message) => rejections.set(key, { code, message }),
    stored: () => [...store.values()],
    dropRegistroDuplicadoDetail: (key) => {
      noDuplicadoDetail.add(key);
    },
    annul: (key) => {
      const s = store.get(key);
      if (s) s.estado = "Anulada";
    },
  };
}

// --- response XML builders (parsed by the unmodified parseRespuestaSuministro) --------------
// Namespace prefixes below are arbitrary: parse-common's shared parser has removeNSPrefix:true,
// so only the local element names need to match what parse-suministro.ts reads.

function lineaXml(
  idf: IDFactura,
  estado: EstadoRegistroSuministro,
  code: number | undefined,
  message: string | undefined,
  ref: string | undefined,
): string {
  return (
    "<sfR:RespuestaLinea>" +
    "<sfR:IDFactura>" +
    `<sf:IDEmisorFactura>${escapeXml(idf.IDEmisorFactura)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(idf.NumSerieFactura)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(idf.FechaExpedicionFactura)}</sf:FechaExpedicionFactura>` +
    "</sfR:IDFactura>" +
    (ref !== undefined ? `<sfR:RefExterna>${escapeXml(ref)}</sfR:RefExterna>` : "") +
    `<sfR:EstadoRegistro>${estado}</sfR:EstadoRegistro>` +
    (code !== undefined ? `<sfR:CodigoErrorRegistro>${code}</sfR:CodigoErrorRegistro>` : "") +
    (message !== undefined
      ? `<sfR:DescripcionErrorRegistro>${escapeXml(message)}</sfR:DescripcionErrorRegistro>`
      : "") +
    "</sfR:RespuestaLinea>"
  );
}

function suministroEnvelope(
  csv: string,
  estadoEnvio: EstadoEnvio,
  tiempo: number,
  lineas: string[],
): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="sf" xmlns:sfR="sfR"><soapenv:Body>` +
    "<sfR:RespuestaRegFactuSistemaFacturacion>" +
    `<sfR:CSV>${escapeXml(csv)}</sfR:CSV>` +
    `<sfR:EstadoEnvio>${estadoEnvio}</sfR:EstadoEnvio>` +
    `<sfR:TiempoEsperaEnvio>${tiempo}</sfR:TiempoEsperaEnvio>` +
    lineas.join("") +
    "</sfR:RespuestaRegFactuSistemaFacturacion>" +
    "</soapenv:Body></soapenv:Envelope>"
  );
}

/** A 3000 (Registro duplicado) response line. `estadoDuplicado` undefined models the
 *  duplicate_unknown case: AEAT reporting a duplicate without saying what it holds. */
function duplicadoLineaXml(
  idf: IDFactura,
  estadoDuplicado: StoredRecord["estado"] | undefined,
  ref: string | undefined,
): string {
  return (
    "<sfR:RespuestaLinea>" +
    "<sfR:IDFactura>" +
    `<sf:IDEmisorFactura>${escapeXml(idf.IDEmisorFactura)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(idf.NumSerieFactura)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(idf.FechaExpedicionFactura)}</sf:FechaExpedicionFactura>` +
    "</sfR:IDFactura>" +
    (ref !== undefined ? `<sfR:RefExterna>${escapeXml(ref)}</sfR:RefExterna>` : "") +
    "<sfR:EstadoRegistro>Incorrecto</sfR:EstadoRegistro>" +
    "<sfR:CodigoErrorRegistro>3000</sfR:CodigoErrorRegistro>" +
    "<sfR:DescripcionErrorRegistro>Registro duplicado</sfR:DescripcionErrorRegistro>" +
    "<sfR:RegistroDuplicado>" +
    (estadoDuplicado !== undefined
      ? `<sfR:EstadoRegistroDuplicado>${estadoDuplicado}</sfR:EstadoRegistroDuplicado>`
      : "") +
    "</sfR:RegistroDuplicado>" +
    "</sfR:RespuestaLinea>"
  );
}

// --- consulta response XML builder (parsed by the unmodified parseRespuestaConsulta) ---------

function consultaEnvelope(matches: StoredRecord[]): string {
  const registros = matches
    .map((s) => {
      const [emisor, serie, fecha] = s.key.split("|");
      return (
        "<sfRC:RegistroRespuestaConsultaFactuSistemaFacturacion>" +
        "<sfRC:IDFactura>" +
        `<sf:IDEmisorFactura>${escapeXml(emisor)}</sf:IDEmisorFactura>` +
        `<sf:NumSerieFactura>${escapeXml(serie)}</sf:NumSerieFactura>` +
        `<sf:FechaExpedicionFactura>${escapeXml(fecha)}</sf:FechaExpedicionFactura>` +
        "</sfRC:IDFactura>" +
        "<sfRC:DatosRegistroFacturacion>" +
        `<sf:Huella>${escapeXml(s.huella)}</sf:Huella><sf:TipoHuella>01</sf:TipoHuella>` +
        "</sfRC:DatosRegistroFacturacion>" +
        "<sfRC:EstadoRegistro>" +
        "<sf:TimestampUltimaModificacion>2026-07-21T00:00:00+00:00</sf:TimestampUltimaModificacion>" +
        `<sf:EstadoRegistro>${s.estado}</sf:EstadoRegistro>` +
        "</sfRC:EstadoRegistro>" +
        "</sfRC:RegistroRespuestaConsultaFactuSistemaFacturacion>"
      );
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="sf" xmlns:sfRC="sfRC"><soapenv:Body>` +
    "<sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    `<sfRC:ResultadoConsulta>${matches.length > 0 ? "ConDatos" : "SinDatos"}</sfRC:ResultadoConsulta>` +
    "<sfRC:IndicadorPaginacion>N</sfRC:IndicadorPaginacion>" +
    registros +
    "</sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    "</soapenv:Body></soapenv:Envelope>"
  );
}
