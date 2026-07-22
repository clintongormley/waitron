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
  /** Page size for a consulta sweep's `IndicadorPaginacion`/`ClavePaginacion` — small by default so multi-page fixtures stay cheap. */
  consultaPageSize?: number;
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
  /** Overrides a stored record's consulta-reported estado — `annul` is just the `Anulada` special case of this. */
  setConsultaState(key: FacturaKey, estado: StoredRecord["estado"]): void;
  /** Evicts a stored record entirely, driving the `SinDatos`/no-trace consulta path. */
  forget(key: FacturaKey): void;
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
  const consultaPageSize = options.consultaPageSize ?? 2;

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
    // Always scoped to the querying obligado's own NIF (IDEmisorFactura) — a consulta can never
    // return another obligado's records. NumSerieFactura/FechaExpedicionFactura are optional
    // NARROWING filters on top of that: a targeted single-record lookup (Route B) supplies both
    // (and previously required both — 3b widens the same match into a paged period sweep, where
    // neither is supplied and every in-NIF record is a candidate). All stored records are
    // in-period for the fake's fixtures, so PeriodoImputacion itself is not re-derived here — the
    // fixtures control which records exist.
    let all = [...store.values()].filter(
      (s) => s.key.split("|")[0] === cabecera.ObligadoEmision.NIF,
    );
    if (filtro.NumSerieFactura !== undefined) {
      all = all.filter((s) => s.key.split("|")[1] === filtro.NumSerieFactura);
    }
    if (filtro.FechaExpedicionFactura !== undefined) {
      all = all.filter((s) => s.key.split("|")[2] === filtro.FechaExpedicionFactura);
    }
    // Continue after ClavePaginacion (match by the last-returned identity), ordered by insertion.
    // If that identity is no longer found (e.g. `forget`ten between pages), fall back to the full
    // filtered set rather than throwing — a stale cursor is a caller bug this fake surfaces as
    // "start over", not a crash.
    if (filtro.ClavePaginacion !== undefined) {
      const afterKey = `${filtro.ClavePaginacion.IDEmisorFactura}|${filtro.ClavePaginacion.NumSerieFactura}|${filtro.ClavePaginacion.FechaExpedicionFactura}`;
      const idx = all.findIndex((s) => s.key === afterKey);
      all = idx >= 0 ? all.slice(idx + 1) : all;
    }
    const page = all.slice(0, consultaPageSize);
    const more = all.length > consultaPageSize;
    return consultaEnvelope(page, more);
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
    setConsultaState: (key, estado) => {
      const s = store.get(key);
      if (s) s.estado = estado;
    },
    forget: (key) => {
      store.delete(key);
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

/** `<sfRC:ClavePaginacion>`, built from a stored record's own key — echoed verbatim by a caller's next request. */
function clavePaginacionXml(s: StoredRecord): string {
  const [emisor, serie, fecha] = s.key.split("|");
  return (
    "<sfRC:ClavePaginacion>" +
    `<sf:IDEmisorFactura>${escapeXml(emisor)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(serie)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(fecha)}</sf:FechaExpedicionFactura>` +
    "</sfRC:ClavePaginacion>"
  );
}

/** `matches` is the already-paged slice to return; `more` says whether further pages remain beyond it. */
function consultaEnvelope(matches: StoredRecord[], more: boolean): string {
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
        (s.refExterna !== undefined
          ? `<sf:RefExterna>${escapeXml(s.refExterna)}</sf:RefExterna>`
          : "") +
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
  const last = matches[matches.length - 1];
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="sf" xmlns:sfRC="sfRC"><soapenv:Body>` +
    "<sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    `<sfRC:ResultadoConsulta>${matches.length > 0 ? "ConDatos" : "SinDatos"}</sfRC:ResultadoConsulta>` +
    `<sfRC:IndicadorPaginacion>${more ? "S" : "N"}</sfRC:IndicadorPaginacion>` +
    (more && last ? clavePaginacionXml(last) : "") +
    registros +
    "</sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    "</soapenv:Body></soapenv:Envelope>"
  );
}
