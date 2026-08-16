// AUTO-GENERATED — DO NOT HAND-EDIT. Regenerate (from the repo root) via:
//   python3 packages/reporting/reference/generate-dr303-layout.py \
//     | npx prettier --parser typescript > packages/reporting/src/dr303-layout.ts
//
// PRIMARY SOURCE (AEAT-published record design, committed verbatim):
//   file : packages/reporting/reference/DR303e26.xlsx
//   md5  : e42cbe6baf7f21dd95c274b4c6f11bbe
//   url  : https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos_26/DR303e26.xlsx
//   what : modelo 303 diseño de registro, ejercicio 2026 (version 1.01).
//
// Positions are 1-based (as in the AEAT design); the serializer converts to a 0-based byte
// offset as posición − 1. Every field's { pos, len, type } is transcribed from the .xlsx and
// self-validated by dr303-layout.test.ts (per-segment contiguity + declared length). The AEAT
// Descripción of each field (which carries the casilla-27/45 summation formulas verbatim) is the
// // comment ABOVE each field — a comment, not a string literal, because the english-only guard
// scans string literals in packages/reporting but excludes comments (the descriptions are Spanish).

/** A single fixed-layout field, transcribed from the DR303e26 record design. */
export interface Dr303Field {
  /** Nº — the field's order number within its segment (AEAT column 1). */
  readonly n: number;
  /** Posición — 1-based start position within the segment (AEAT column 2). */
  readonly pos: number;
  /** Longitud — number of character positions the field occupies (AEAT column 3). */
  readonly len: number;
  /** Tipo/Naturaleza: A alfabético, Num numérico sin signo, N numérico con signo, An alfanumérico. */
  readonly type: "A" | "Num" | "N" | "An";
  /** Casilla (box) number this field carries, e.g. "27"; null for constants/headers/reserved. */
  readonly casilla: string | null;
  /** Decimal places packed into the field (2 for importe/tipo/percentage; 0 otherwise). */
  readonly decimals: number;
  /**
   * How the serializer fills this field (roles are English; the Spanish AEAT term is in each
   * field's // comment):
   *  - "constant"        emit `value` verbatim (envelope tags, Tipo % constants, </AUX>, …).
   *  - "year"            the 4-digit EEEE ejercicio, from options.
   *  - "period"          the 2-char PP período ("01".."12" | "1T".."4T"), from options.
   *  - "taxId"           the obligado NIF, alfanumeric, from options.
   *  - "name"            apellidos y nombre o razón social, alfanumeric, from options.
   *  - "declarationType" the tipo de declaración indicator, from options.
   *  - "amount"          a data box (importe), looked up by `casilla` in the Modelo303 map (0 when absent).
   *  - "blank"           reserved / optional indicator: type-neutral blank fill.
   */
  readonly role:
    "constant" | "year" | "period" | "taxId" | "name" | "declarationType" | "amount" | "blank";
  /** The literal to emit when role === "constant" (already exactly `len` chars); else null. */
  readonly value: string | null;
}

/** One segment (record) of the fixed-layout file, with its AEAT-declared total length. */
export interface Dr303Segment {
  readonly name: string;
  /** Total character positions in the segment (last field's pos + len − 1). */
  readonly length: number;
  readonly fields: readonly Dr303Field[];
}

const DR303_COMUN: Dr303Segment = {
  name: "comun",
  length: 328,
  fields: [
    // Constante.
    { n: 1, pos: 1, len: 2, type: "An", casilla: null, decimals: 0, role: "constant", value: "<T" },
    // Modelo
    {
      n: 2,
      pos: 3,
      len: 3,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "303",
    },
    // Discriminante
    { n: 3, pos: 6, len: 1, type: "An", casilla: null, decimals: 0, role: "constant", value: "0" },
    // Ejercicio de devengo (EEEE)
    { n: 4, pos: 7, len: 4, type: "An", casilla: null, decimals: 0, role: "year", value: null },
    // Período. (PP)
    { n: 5, pos: 11, len: 2, type: "An", casilla: null, decimals: 0, role: "period", value: null },
    // Tipo y cierre
    {
      n: 6,
      pos: 13,
      len: 5,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "0000>",
    },
    // Constante
    {
      n: 7,
      pos: 18,
      len: 5,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "<AUX>",
    },
    // Reservado para la Administración. Rellenar con blancos
    { n: 8, pos: 23, len: 70, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Versión del Programa (Nota 1)
    { n: 9, pos: 93, len: 4, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Reservado para la Administración. Rellenar con blancos
    { n: 10, pos: 97, len: 4, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // NIF Empresa Desarrollo (Nota 1)
    { n: 11, pos: 101, len: 9, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Reservado para la Administración. Rellenar con blancos
    {
      n: 12,
      pos: 110,
      len: 213,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Constante
    {
      n: 13,
      pos: 323,
      len: 6,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "</AUX>",
    },
  ],
};

const DR303_PAGINA1: Dr303Segment = {
  name: "pagina1",
  length: 1581,
  fields: [
    // Inicio del identificador de modelo y página.
    { n: 1, pos: 1, len: 2, type: "An", casilla: null, decimals: 0, role: "constant", value: "<T" },
    // Modelo.
    {
      n: 2,
      pos: 3,
      len: 3,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "303",
    },
    // Página.
    {
      n: 3,
      pos: 6,
      len: 5,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "01000",
    },
    // Fin de identificador de modelo.
    { n: 4, pos: 11, len: 1, type: "An", casilla: null, decimals: 0, role: "constant", value: ">" },
    // Indicador de página complementaria.
    { n: 5, pos: 12, len: 1, type: "A", casilla: null, decimals: 0, role: "blank", value: null },
    // Tipo Declaración
    {
      n: 6,
      pos: 13,
      len: 1,
      type: "A",
      casilla: null,
      decimals: 0,
      role: "declarationType",
      value: null,
    },
    // Identificación (1) - NIF
    { n: 7, pos: 14, len: 9, type: "An", casilla: null, decimals: 0, role: "taxId", value: null },
    // Identificación (1) - Apellidos y nombre o Razón social
    { n: 8, pos: 23, len: 80, type: "An", casilla: null, decimals: 0, role: "name", value: null },
    // Devengo (2) - Ejercicio
    { n: 9, pos: 103, len: 4, type: "Num", casilla: null, decimals: 0, role: "year", value: null },
    // Devengo (2) - Período
    {
      n: 10,
      pos: 107,
      len: 2,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "period",
      value: null,
    },
    // Identificación (1) - Tributación exclusivamente foral. Sujeto pasivo que tributa exclusivamente a una Administración tributaria Foral con IVA a la importación liquidado por la Aduana pendiente de ingreso
    {
      n: 11,
      pos: 109,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Sujeto pasivo inscrito en el Registro de devolución mensual (art. 30 RIVA)
    {
      n: 12,
      pos: 110,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Sujeto pasivo que tributa exclusivamente en régimen simplificado
    {
      n: 13,
      pos: 111,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Autoliquidación conjunta
    {
      n: 14,
      pos: 112,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Sujeto pasivo acogido al régimen especial del criterio de Caja (art. 163 undecies LIVA)
    {
      n: 15,
      pos: 113,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Sujeto pasivo destinatario de operaciones acogidas al régimen especial del criterio de caja
    {
      n: 16,
      pos: 114,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Opción por la aplicación de la prorrata especial (art. 103.Dos.1º LIVA)
    {
      n: 17,
      pos: 115,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Revocación de la opción por la aplicación de la prorrata especial
    {
      n: 18,
      pos: 116,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Sujeto pasivo declarado en concurso de acreedores en el presente período de liquidación
    {
      n: 19,
      pos: 117,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Fecha en que se dictó el auto de declaración de concurso
    { n: 20, pos: 118, len: 8, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Identificación (1) - Tipo de autoliquidación si se ha dictado auto de declaración de concurso en este período
    { n: 21, pos: 126, len: 1, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Identificación (1) - Sujeto pasivo acogido voluntariamente al SII
    {
      n: 22,
      pos: 127,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Sujeto pasivo exonerado de la Declaración-resumen anual del IVA, modelo 390
    {
      n: 23,
      pos: 128,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Sujeto pasivo con volumen anual de operaciones distinto de cero (art. 121 LIVA)
    {
      n: 24,
      pos: 129,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Identificación (1) - Sujeto pasivo con derecho a deducir pago a cuenta de entregas de gasolinas, gasóleos y biocarburantes posteriores a la ultimación del régimen de depósito distinto del aduanero
    {
      n: 25,
      pos: 130,
      len: 1,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Base imponible [150]
    {
      n: 26,
      pos: 131,
      len: 17,
      type: "Num",
      casilla: "150",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Tipo % [151]
    {
      n: 27,
      pos: 148,
      len: 5,
      type: "Num",
      casilla: "151",
      decimals: 0,
      role: "constant",
      value: "00000",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Cuota [152]
    {
      n: 28,
      pos: 153,
      len: 17,
      type: "Num",
      casilla: "152",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Base imponible [165]
    {
      n: 29,
      pos: 170,
      len: 17,
      type: "Num",
      casilla: "165",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Tipo % [166]
    {
      n: 30,
      pos: 187,
      len: 5,
      type: "Num",
      casilla: "166",
      decimals: 0,
      role: "constant",
      value: "00000",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Cuota [167]
    {
      n: 31,
      pos: 192,
      len: 17,
      type: "Num",
      casilla: "167",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Base imponible [01]
    {
      n: 32,
      pos: 209,
      len: 17,
      type: "Num",
      casilla: "01",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Tipo % [02]
    {
      n: 33,
      pos: 226,
      len: 5,
      type: "Num",
      casilla: "02",
      decimals: 0,
      role: "constant",
      value: "00400",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Cuota [03]
    {
      n: 34,
      pos: 231,
      len: 17,
      type: "Num",
      casilla: "03",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Base imponible [153]
    {
      n: 35,
      pos: 248,
      len: 17,
      type: "Num",
      casilla: "153",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Tipo % [154]
    {
      n: 36,
      pos: 265,
      len: 5,
      type: "Num",
      casilla: "154",
      decimals: 0,
      role: "constant",
      value: "00000",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Cuota [155]
    {
      n: 37,
      pos: 270,
      len: 17,
      type: "Num",
      casilla: "155",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Base imponible [04]
    {
      n: 38,
      pos: 287,
      len: 17,
      type: "Num",
      casilla: "04",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Tipo % [05]
    {
      n: 39,
      pos: 304,
      len: 5,
      type: "Num",
      casilla: "05",
      decimals: 0,
      role: "constant",
      value: "01000",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Cuota [06]
    {
      n: 40,
      pos: 309,
      len: 17,
      type: "Num",
      casilla: "06",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Base imponible [07]
    {
      n: 41,
      pos: 326,
      len: 17,
      type: "Num",
      casilla: "07",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Tipo % [08]
    {
      n: 42,
      pos: 343,
      len: 5,
      type: "Num",
      casilla: "08",
      decimals: 0,
      role: "constant",
      value: "02100",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Régimen general - Cuota [09]
    {
      n: 43,
      pos: 348,
      len: 17,
      type: "Num",
      casilla: "09",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Adquisiciones intracomunitarias de bienes y servicios - Base imponible [10]
    {
      n: 44,
      pos: 365,
      len: 17,
      type: "Num",
      casilla: "10",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Adquisiciones intracomunitarias de bienes y servicios - Cuota [11]
    {
      n: 45,
      pos: 382,
      len: 17,
      type: "Num",
      casilla: "11",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Otras operaciones con inversión del sujeto pasivo (excepto. adq. intracom) - Base imponible [12]
    {
      n: 46,
      pos: 399,
      len: 17,
      type: "Num",
      casilla: "12",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Otras operaciones con inversión del sujeto pasivo (excepto. adq. intracom) - Cuota [13]
    {
      n: 47,
      pos: 416,
      len: 17,
      type: "Num",
      casilla: "13",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Modificación bases y cuotas- Base imponible [14]
    {
      n: 48,
      pos: 433,
      len: 17,
      type: "N",
      casilla: "14",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Modificación bases y cuotas - Cuota [15]
    {
      n: 49,
      pos: 450,
      len: 17,
      type: "N",
      casilla: "15",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Base imponible [156]
    {
      n: 50,
      pos: 467,
      len: 17,
      type: "Num",
      casilla: "156",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Tipo % [157]
    {
      n: 51,
      pos: 484,
      len: 5,
      type: "Num",
      casilla: "157",
      decimals: 0,
      role: "constant",
      value: "00175",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Cuota [158]
    {
      n: 52,
      pos: 489,
      len: 17,
      type: "Num",
      casilla: "158",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Base imponible [168]
    {
      n: 53,
      pos: 506,
      len: 17,
      type: "Num",
      casilla: "168",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Tipo % [169]
    {
      n: 54,
      pos: 523,
      len: 5,
      type: "Num",
      casilla: "169",
      decimals: 0,
      role: "constant",
      value: "00050",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Cuota [170]
    {
      n: 55,
      pos: 528,
      len: 17,
      type: "Num",
      casilla: "170",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Base imponible [16]
    {
      n: 56,
      pos: 545,
      len: 17,
      type: "Num",
      casilla: "16",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Tipo % [17]
    {
      n: 57,
      pos: 562,
      len: 5,
      type: "Num",
      casilla: "17",
      decimals: 0,
      role: "constant",
      value: "00000",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Cuota [18]
    {
      n: 58,
      pos: 567,
      len: 17,
      type: "Num",
      casilla: "18",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Base imponible [19]
    {
      n: 59,
      pos: 584,
      len: 17,
      type: "Num",
      casilla: "19",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Tipo % [20]
    {
      n: 60,
      pos: 601,
      len: 5,
      type: "Num",
      casilla: "20",
      decimals: 0,
      role: "constant",
      value: "00140",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Cuota [21]
    {
      n: 61,
      pos: 606,
      len: 17,
      type: "Num",
      casilla: "21",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Base imponible [22]
    {
      n: 62,
      pos: 623,
      len: 17,
      type: "Num",
      casilla: "22",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Tipo % [23]
    {
      n: 63,
      pos: 640,
      len: 5,
      type: "Num",
      casilla: "23",
      decimals: 0,
      role: "constant",
      value: "00520",
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Recargo equivalencia - Cuota [24]
    {
      n: 64,
      pos: 645,
      len: 17,
      type: "Num",
      casilla: "24",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Modificaciones bases y cuotas del recargo de equivalencia - Base imponible [25]
    {
      n: 65,
      pos: 662,
      len: 17,
      type: "N",
      casilla: "25",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Modificaciones bases y cuotas del recargo de equivalencia - Cuota [26]
    {
      n: 66,
      pos: 679,
      len: 17,
      type: "N",
      casilla: "26",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Devengado - Total cuota devengada ( [152] + [167] + [03] + [155] + [06] + [09] + [11] + [13] + [15] + [158] + [170] + [18] + [21] + [24] + [26] ) [27]
    {
      n: 67,
      pos: 696,
      len: 17,
      type: "N",
      casilla: "27",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Por cuotas soportadas en operaciones interiores corrientes - Base [28]
    {
      n: 68,
      pos: 713,
      len: 17,
      type: "Num",
      casilla: "28",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Por cuotas soportadas en operaciones interiores corrientes - Cuota [29]
    {
      n: 69,
      pos: 730,
      len: 17,
      type: "Num",
      casilla: "29",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Por cuotas soportadas en operaciones interiores con bienes de inversión - Base [30]
    {
      n: 70,
      pos: 747,
      len: 17,
      type: "Num",
      casilla: "30",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Por cuotas soportadas en operaciones interiores con bienes de inversión - Cuota [31]
    {
      n: 71,
      pos: 764,
      len: 17,
      type: "Num",
      casilla: "31",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Por cuotas soportadas en las importaciones de bienes corrientes - Base [32]
    {
      n: 72,
      pos: 781,
      len: 17,
      type: "Num",
      casilla: "32",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Por cuotas soportadas en las importaciones de bienes corrientes - Cuota [33]
    {
      n: 73,
      pos: 798,
      len: 17,
      type: "Num",
      casilla: "33",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Por cuotas soportadas en las importaciones de bienes de inversión - Base [34]
    {
      n: 74,
      pos: 815,
      len: 17,
      type: "Num",
      casilla: "34",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Por cuotas soportadas en las importaciones de bienes de inversión - Cuota [35]
    {
      n: 75,
      pos: 832,
      len: 17,
      type: "Num",
      casilla: "35",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - En adquisiciones intracomunitarias de bienes y servicios corrientes - Base [36]
    {
      n: 76,
      pos: 849,
      len: 17,
      type: "Num",
      casilla: "36",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - En adquisiciones intracomunitarias de bienes y servicios corrientes - Cuota [37]
    {
      n: 77,
      pos: 866,
      len: 17,
      type: "Num",
      casilla: "37",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - En adquisiciones intracomunitarias de bienes de inversión - Base [38]
    {
      n: 78,
      pos: 883,
      len: 17,
      type: "Num",
      casilla: "38",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - En adquisiciones intracomunitarias de bienes de inversión - Cuota [39]
    {
      n: 79,
      pos: 900,
      len: 17,
      type: "Num",
      casilla: "39",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Rectificación de deducciones - Base [40]
    {
      n: 80,
      pos: 917,
      len: 17,
      type: "N",
      casilla: "40",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Rectificación de deducciones - Cuota [41]
    {
      n: 81,
      pos: 934,
      len: 17,
      type: "N",
      casilla: "41",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Compensaciones Régimen Especial A.G. y P. - Cuota [42]
    {
      n: 82,
      pos: 951,
      len: 17,
      type: "N",
      casilla: "42",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Regularización inversiones - Cuota [43]
    {
      n: 83,
      pos: 968,
      len: 17,
      type: "N",
      casilla: "43",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Regularización por aplicación del porcentaje definitivo de prorrata - Cuota [44]
    {
      n: 84,
      pos: 985,
      len: 17,
      type: "N",
      casilla: "44",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Total a deducir ( [29] + [31] + [33] + [35] + [37] + [39] + [41] + [42] + [43] + [44] ) - Cuota [45]
    {
      n: 85,
      pos: 1002,
      len: 17,
      type: "N",
      casilla: "45",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Liquidación (3) - Regimen General - IVA Deducible - Resultado régimen general ( [27] - [45] ) - Cuota [46]
    {
      n: 86,
      pos: 1019,
      len: 17,
      type: "N",
      casilla: "46",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Reservado para la AEAT
    {
      n: 87,
      pos: 1036,
      len: 521,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Reservado para la AEAT - Sello electrónico reservado para la AEAT
    {
      n: 88,
      pos: 1557,
      len: 13,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Indicador de fin de registro
    {
      n: 89,
      pos: 1570,
      len: 12,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "</T30301000>",
    },
  ],
};

const DR303_PAGINA3: Dr303Segment = {
  name: "pagina3",
  length: 1017,
  fields: [
    // Inicio del identificador de modelo y página.
    { n: 1, pos: 1, len: 2, type: "An", casilla: null, decimals: 0, role: "constant", value: "<T" },
    // Modelo.
    {
      n: 2,
      pos: 3,
      len: 3,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "303",
    },
    // Página.
    {
      n: 3,
      pos: 6,
      len: 5,
      type: "Num",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "03000",
    },
    // Fin de identificador de modelo.
    { n: 4, pos: 11, len: 1, type: "An", casilla: null, decimals: 0, role: "constant", value: ">" },
    // Información adicional - Entregas intracomunitarias de bienes y servicios [59]
    { n: 5, pos: 12, len: 17, type: "N", casilla: "59", decimals: 2, role: "amount", value: null },
    // Información adicional - Exportaciones y operaciones asimiladas [60]
    { n: 6, pos: 29, len: 17, type: "N", casilla: "60", decimals: 2, role: "amount", value: null },
    // Información adicional - Operaciones no sujetas por reglas de localización (excepto las incluidas en la casilla 123) [120]
    { n: 7, pos: 46, len: 17, type: "N", casilla: "120", decimals: 2, role: "amount", value: null },
    // Información adicional - Operaciones sujetas con inversión del sujeto pasivo [122]
    { n: 8, pos: 63, len: 17, type: "N", casilla: "122", decimals: 2, role: "amount", value: null },
    // Información adicional - Operaciones no sujetas por reglas de localización acogidas a los regímenes especiales de ventanilla única [123]
    { n: 9, pos: 80, len: 17, type: "N", casilla: "123", decimals: 2, role: "amount", value: null },
    // Información adicional - Operaciones sujetas y acogidas a los regímenes especiales de ventanilla única [124]
    {
      n: 10,
      pos: 97,
      len: 17,
      type: "N",
      casilla: "124",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Información adicional - Importes de las entregas de bienes y prestaciones de servicios a las que habiéndoles sido aplicado el régimen especial del criterio de caja hubieran resultado devengadas conforme a la regla general de devengo contenida en el art. 75 LIVA - Base Imponible [62]
    {
      n: 11,
      pos: 114,
      len: 17,
      type: "N",
      casilla: "62",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Información adicional - Importes de las entregas de bienes y prestaciones de servicios a las que habiéndoles sido aplicado el régimen especial del criterio de caja hubieran resultado devengadas conforme a la regla general de devengo contenida en el art. 75 LIVA - Cuota [63]
    {
      n: 12,
      pos: 131,
      len: 17,
      type: "N",
      casilla: "63",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Información adicional - Importes de las adquisiciones de bienes y servicios a las que sea de aplicación o afecte el régimen especial del criterio de caja - Base Imponible [74]
    {
      n: 13,
      pos: 148,
      len: 17,
      type: "N",
      casilla: "74",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Información adicional - Importes de las adquisiciones de bienes y servicios a las que sea de aplicación o afecte el régimen especial del criterio de caja - Cuota [75]
    {
      n: 14,
      pos: 165,
      len: 17,
      type: "N",
      casilla: "75",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Regularización cuotas art. 80.cinco.5ª LIVA [76]
    {
      n: 15,
      pos: 182,
      len: 17,
      type: "N",
      casilla: "76",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Suma de resultados ( [46] + [58] + [76] ) [64]
    {
      n: 16,
      pos: 199,
      len: 17,
      type: "N",
      casilla: "64",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - % Atribuible a la Administración del Estado [65]
    {
      n: 17,
      pos: 216,
      len: 5,
      type: "Num",
      casilla: "65",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Atribuible a la Administración del Estado [66]
    {
      n: 18,
      pos: 221,
      len: 17,
      type: "N",
      casilla: "66",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - IVA a la importación liquidado por la Aduana pendiente de ingreso [77]
    {
      n: 19,
      pos: 238,
      len: 17,
      type: "Num",
      casilla: "77",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Cuotas a compensar pendientes de periodos anteriores [110]
    {
      n: 20,
      pos: 255,
      len: 17,
      type: "Num",
      casilla: "110",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Cuotas a compensar de periodos anteriores aplicadas en este periodo [78]
    {
      n: 21,
      pos: 272,
      len: 17,
      type: "Num",
      casilla: "78",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Cuotas a compensar de periodos previos pendientes para periodos posteriores ([110] - [78]) [87]
    {
      n: 22,
      pos: 289,
      len: 17,
      type: "Num",
      casilla: "87",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Exclusivamente para sujetos pasivos que tributan conjuntamente a la Administración del Estado y a las Haciendas Forales Resultado de la regularización anual [68]
    {
      n: 23,
      pos: 306,
      len: 17,
      type: "N",
      casilla: "68",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Rectificativa - Exclusivamente para determinados supuestos de autoliquidación rectificativa por discrepancia de criterio administrativo que no deban incluirse en otras casillas. Otros ajustes [108]
    {
      n: 24,
      pos: 323,
      len: 17,
      type: "N",
      casilla: "108",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Resultado de la autoliquidación ( [66] + [77] - [78] + [68] + [108] ) [69]
    {
      n: 25,
      pos: 340,
      len: 17,
      type: "N",
      casilla: "69",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Resultados a ingresar de anteriores autoliquidaciones o liquidaciones administrativas correspondientes al ejercicio y período objeto de la autoliquidación [70]
    {
      n: 26,
      pos: 357,
      len: 17,
      type: "Num",
      casilla: "70",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Devoluciones acordadas por la Agencia Tributaria como consecuencia de la tramitación de anteriores autoliquidaciones correspondientes al ejercicio y período objeto de la autoliquidación [109]
    {
      n: 27,
      pos: 374,
      len: 17,
      type: "Num",
      casilla: "109",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Pago a cuenta de entregas de gasolinas, gasóleos y biocarburantes posteriores a la ultimación del régimen de depósito distinto del aduanero atribuible a la Administración del Estado (Suma de la casilla 36 de todos los modelos 319 correspondientes a entregas incluidas en esta autoliquidación) [112]
    {
      n: 28,
      pos: 391,
      len: 17,
      type: "Num",
      casilla: "112",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Resultado - Resultado ( [69] - [70] + [109] - [112] ) [71]
    {
      n: 29,
      pos: 408,
      len: 17,
      type: "N",
      casilla: "71",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Declaración Sin actividad
    { n: 30, pos: 425, len: 1, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Rectificativa - Autoliquidación rectificativa
    { n: 31, pos: 426, len: 1, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Rectificativa - Número justificante identificativo de la autoliquidación anterior
    {
      n: 32,
      pos: 427,
      len: 13,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Rectificativa - Como consecuencia de la presentación de la autoliquidación rectificativa solicito dar de baja/modificar la domiciliación efectuada
    { n: 33, pos: 440, len: 1, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Rectificativa - Rectificación - Importe [111]
    {
      n: 34,
      pos: 441,
      len: 17,
      type: "Num",
      casilla: "111",
      decimals: 2,
      role: "amount",
      value: null,
    },
    // Rectificativa - Motivo de la rectificación: Rectificaciones (excepto incluidas en el motivo siguiente)
    { n: 35, pos: 458, len: 1, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Rectificativa - Motivo de la rectificación: Discrepancia criterio administrativo
    { n: 36, pos: 459, len: 1, type: "An", casilla: null, decimals: 0, role: "blank", value: null },
    // Reservado para la AEAT
    {
      n: 37,
      pos: 460,
      len: 546,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "blank",
      value: null,
    },
    // Indicador de fin de registro
    {
      n: 38,
      pos: 1006,
      len: 12,
      type: "An",
      casilla: null,
      decimals: 0,
      role: "constant",
      value: "</T30303000>",
    },
  ],
};

/** The three segments a régimen-general modelo 303 filing emits, in file order. */
export const DR303_LAYOUT = {
  comun: DR303_COMUN,
  pagina1: DR303_PAGINA1,
  pagina3: DR303_PAGINA3,
} as const;

/**
 * The envelope-closing constant (común field 15, DP30300): `Constante "</T3030AAAAPP0000>"`,
 * length 18, where AAAA = ejercicio and PP = período. Emitted after the last página, closing the
 * outer <T3030{ej}{per}0000> envelope. Its position is variable (it follows the páginas), so it is
 * a template here rather than a positioned field.
 */
export const DR303_ENVELOPE_CLOSE_TEMPLATE = "</T3030AAAAPP0000>";
