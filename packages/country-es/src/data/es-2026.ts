import type { HolidayDatasetRow, HolidayDatasetYear } from "@waitron/country";
import { ANNEX_2026 } from "./sources.js";

/** The annex's own mark for a row (`*`, `**`, `***`), or the clarifying note it comes from. */
export type SpanishHolidayCategory = "*" | "**" | "***" | "note-1" | "note-2";

export interface SpanishHolidayRow extends HolidayDatasetRow {
  readonly category: SpanishHolidayCategory;
}

export interface SpanishHolidayYear extends HolidayDatasetYear {
  readonly rows: readonly SpanishHolidayRow[];
}

const SOURCE = ANNEX_2026.id;
const ALL = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].concat([
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
]);

/** A row of the annex, keyed by the row's own element id in the BOE's XML. */
function annex(
  row: string,
  date: string,
  name: string,
  category: "*" | "**" | "***",
  regions: readonly string[],
  extra: Partial<SpanishHolidayRow> = {},
): SpanishHolidayRow {
  return {
    key: `${SOURCE}:${row}`,
    date,
    name,
    scope: category === "***" ? "regional" : "national",
    category,
    regions,
    sourceId: SOURCE,
    ...extra,
  };
}

/** A holiday a clarifying note gives one area. */
function note(
  number: 1 | 2,
  area: string,
  date: string,
  name: string,
  region: string,
): SpanishHolidayRow {
  return {
    key: `${SOURCE}:note-${number}:${area}`,
    date,
    name,
    scope: "regional",
    category: `note-${number}`,
    regions: [region],
    onlyAreas: [area],
    sourceId: SOURCE,
  };
}

export const SPAIN_2026: SpanishHolidayYear = {
  year: 2026,
  dataVersion: "ES-2026.1",
  sourceIds: [SOURCE],
  rows: [
    annex("0101", "2026-01-01", "Año Nuevo", "*", ALL),
    annex("0601", "2026-01-06", "Epifanía del Señor", "**", ALL),
    annex("2802", "2026-02-28", "Día de Andalucía", "***", ["01"]),
    annex("0203", "2026-03-02", "Lunes siguiente al Día de les Illes Balears", "***", ["04"]),
    annex("1903", "2026-03-19", "San José", "**", ["12", "14", "15", "16", "10"]),
    annex("2003", "2026-03-20", "Fiesta del Eid Fitr", "***", ["19"]),
    annex("0204", "2026-04-02", "Jueves Santo", "**", [
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "08",
      "07",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
    ]),
    annex("0304", "2026-04-03", "Viernes Santo", "*", ALL),
    annex("0604", "2026-04-06", "Lunes de Pascua", "***", [
      "04",
      "08",
      "09",
      "15",
      "16",
      "17",
      "10",
    ]),
    annex("2304A", "2026-04-23", "San Jorge/Día de Aragón", "***", ["02"]),
    annex("2304B", "2026-04-23", "Fiesta de Castilla y León", "***", ["07"]),
    annex("0105", "2026-05-01", "Fiesta del Trabajo", "*", ALL),
    annex("0205", "2026-05-02", "Fiesta de la Comunidad de Madrid", "***", ["13"]),
    annex("2705A", "2026-05-27", "Fiesta Sacrificio-Eidul Adha", "***", ["18"]),
    annex("2705B", "2026-05-27", "Fiesta Sacrificio-Aid al Adha", "***", ["19"]),
    annex("3005", "2026-05-30", "Día de Canarias", "***", ["05"]),
    annex("0406", "2026-06-04", "Corpus Christi", "***", ["08"]),
    annex("0906B", "2026-06-09", "Día de la Región de Murcia", "***", ["14"]),
    annex("0906A", "2026-06-09", "Día de la Rioja", "***", ["17"]),
    annex("2406", "2026-06-24", "San Juan", "***", ["09", "12", "10"]),
    annex("2507", "2026-07-25", "Santiago Apóstol/Día Nacional de Galicia", "**", ["12", "16"]),
    annex("2807", "2026-07-28", "Día de las Instituciones de Cantabria", "***", ["06"]),
    annex("0508", "2026-08-05", "Nuestra Señora de África", "***", ["18"]),
    annex("1508", "2026-08-15", "Asunción de la Virgen", "*", ALL),
    annex("0209", "2026-09-02", "Día de Ceuta", "***", ["18"]),
    annex("0809A", "2026-09-08", "Día de Asturias", "***", ["03"]),
    annex("0809B", "2026-09-08", "Día de Extremadura", "***", ["11"]),
    annex("1109", "2026-09-11", "Fiesta Nacional de Cataluña", "***", ["09"]),
    annex("1509", "2026-09-15", "La Bien Aparecida", "***", ["06"]),
    annex("0910", "2026-10-09", "Día de la Comunitat Valenciana", "***", ["10"]),
    annex("1210", "2026-10-12", "Fiesta Nacional de España", "*", ALL),
    annex("0211", "2026-11-02", "Día siguiente a Todos los Santos", "**", [
      "01",
      "02",
      "03",
      "05",
      "08",
      "07",
      "11",
      "13",
      "15",
    ]),
    annex("0712", "2026-12-07", "Lunes siguiente al Día de la Constitución Española", "**", [
      "01",
      "02",
      "03",
      "06",
      "07",
      "11",
      "13",
      "14",
      "17",
      "19",
    ]),
    annex("0812", "2026-12-08", "Inmaculada Concepción", "*", ALL),
    annex("2512", "2026-12-25", "Natividad del Señor", "*", ALL),
    annex("2612", "2026-12-26", "San Esteban", "***", ["04", "09"], { exceptAreas: ["aran"] }),
    note(1, "el-hierro", "2026-09-24", "Festividad de Nuestra Señora de los Reyes", "05"),
    note(1, "fuerteventura", "2026-09-18", "Festividad de Nuestra Señora de la Peña", "05"),
    note(1, "gran-canaria", "2026-09-08", "Festividad de Nuestra Señora del Pino", "05"),
    note(1, "la-gomera", "2026-10-05", "Festividad de Nuestra Señora de Guadalupe", "05"),
    note(1, "la-palma", "2026-08-05", "Festividad de Nuestra Señora de Las Nieves", "05"),
    note(
      1,
      "lanzarote-la-graciosa",
      "2026-09-15",
      "Festividad de Nuestra Señora de los Volcanes",
      "05",
    ),
    note(1, "tenerife", "2026-02-02", "Festividad de la Virgen de la Candelaria", "05"),
    note(2, "aran", "2026-06-17", "Fiesta de Arán", "09"),
  ],
};
