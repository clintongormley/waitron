import type { HolidayDatasetRow, HolidayDatasetYear } from "@waitron/country";
import { ANNEX_2026 } from "./sources.js";

/** The annex's own mark for a row (`*`, `**`, `***`), or the clarifying note it comes from. */
export type SpanishHolidayCategory = "*" | "**" | "***" | "note-1" | "note-2";

export interface SpanishHolidayRow extends HolidayDatasetRow {
  readonly category: SpanishHolidayCategory;
  readonly englishName: string;
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
  englishName: string,
  category: "*" | "**" | "***",
  regions: readonly string[],
  extra: Partial<SpanishHolidayRow> = {},
): SpanishHolidayRow {
  return {
    key: `${SOURCE}:${row}`,
    date,
    name,
    englishName,
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
  englishName: string,
  region: string,
): SpanishHolidayRow {
  return {
    key: `${SOURCE}:note-${number}:${area}`,
    date,
    name,
    englishName,
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
    annex("0101", "2026-01-01", "Año Nuevo", "New Year's Day", "*", ALL),
    annex("0601", "2026-01-06", "Epifanía del Señor", "Epiphany", "**", ALL),
    annex("2802", "2026-02-28", "Día de Andalucía", "Andalusia Day", "***", ["01"]),
    annex(
      "0203",
      "2026-03-02",
      "Lunes siguiente al Día de les Illes Balears",
      "Monday after Balearic Islands Day",
      "***",
      ["04"],
    ),
    annex("1903", "2026-03-19", "San José", "Saint Joseph's Day", "**", [
      "12",
      "14",
      "15",
      "16",
      "10",
    ]),
    annex("2003", "2026-03-20", "Fiesta del Eid Fitr", "Eid al-Fitr", "***", ["19"]),
    annex("0204", "2026-04-02", "Jueves Santo", "Maundy Thursday", "**", [
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
    annex("0304", "2026-04-03", "Viernes Santo", "Good Friday", "*", ALL),
    annex("0604", "2026-04-06", "Lunes de Pascua", "Easter Monday", "***", [
      "04",
      "08",
      "09",
      "15",
      "16",
      "17",
      "10",
    ]),
    annex(
      "2304A",
      "2026-04-23",
      "San Jorge/Día de Aragón",
      "Saint George's Day / Aragon Day",
      "***",
      ["02"],
    ),
    annex("2304B", "2026-04-23", "Fiesta de Castilla y León", "Castile and Leon Day", "***", [
      "07",
    ]),
    annex("0105", "2026-05-01", "Fiesta del Trabajo", "Labour Day", "*", ALL),
    annex(
      "0205",
      "2026-05-02",
      "Fiesta de la Comunidad de Madrid",
      "Community of Madrid Day",
      "***",
      ["13"],
    ),
    annex("2705A", "2026-05-27", "Fiesta Sacrificio-Eidul Adha", "Eid al-Adha", "***", ["18"]),
    annex("2705B", "2026-05-27", "Fiesta Sacrificio-Aid al Adha", "Eid al-Adha", "***", ["19"]),
    annex("3005", "2026-05-30", "Día de Canarias", "Canary Islands Day", "***", ["05"]),
    annex("0406", "2026-06-04", "Corpus Christi", "Corpus Christi", "***", ["08"]),
    annex("0906B", "2026-06-09", "Día de la Región de Murcia", "Region of Murcia Day", "***", [
      "14",
    ]),
    annex("0906A", "2026-06-09", "Día de la Rioja", "La Rioja Day", "***", ["17"]),
    annex("2406", "2026-06-24", "San Juan", "Saint John's Day", "***", ["09", "12", "10"]),
    annex(
      "2507",
      "2026-07-25",
      "Santiago Apóstol/Día Nacional de Galicia",
      "Saint James's Day / Galicia National Day",
      "**",
      ["12", "16"],
    ),
    annex(
      "2807",
      "2026-07-28",
      "Día de las Instituciones de Cantabria",
      "Cantabrian Institutions Day",
      "***",
      ["06"],
    ),
    annex("0508", "2026-08-05", "Nuestra Señora de África", "Our Lady of Africa", "***", ["18"]),
    annex("1508", "2026-08-15", "Asunción de la Virgen", "Assumption of Mary", "*", ALL),
    annex("0209", "2026-09-02", "Día de Ceuta", "Ceuta Day", "***", ["18"]),
    annex("0809A", "2026-09-08", "Día de Asturias", "Asturias Day", "***", ["03"]),
    annex("0809B", "2026-09-08", "Día de Extremadura", "Extremadura Day", "***", ["11"]),
    annex("1109", "2026-09-11", "Fiesta Nacional de Cataluña", "Catalonia National Day", "***", [
      "09",
    ]),
    annex("1509", "2026-09-15", "La Bien Aparecida", "Our Lady of Bien Aparecida", "***", ["06"]),
    annex(
      "0910",
      "2026-10-09",
      "Día de la Comunitat Valenciana",
      "Valencian Community Day",
      "***",
      ["10"],
    ),
    annex("1210", "2026-10-12", "Fiesta Nacional de España", "Spain National Day", "*", ALL),
    annex(
      "0211",
      "2026-11-02",
      "Día siguiente a Todos los Santos",
      "Day after All Saints' Day",
      "**",
      ["01", "02", "03", "05", "08", "07", "11", "13", "15"],
    ),
    annex(
      "0712",
      "2026-12-07",
      "Lunes siguiente al Día de la Constitución Española",
      "Monday after Spanish Constitution Day",
      "**",
      ["01", "02", "03", "06", "07", "11", "13", "14", "17", "19"],
    ),
    annex("0812", "2026-12-08", "Inmaculada Concepción", "Immaculate Conception", "*", ALL),
    annex("2512", "2026-12-25", "Natividad del Señor", "Christmas Day", "*", ALL),
    annex("2612", "2026-12-26", "San Esteban", "Saint Stephen's Day", "***", ["04", "09"], {
      exceptAreas: ["aran"],
    }),
    note(
      1,
      "el-hierro",
      "2026-09-24",
      "Festividad de Nuestra Señora de los Reyes",
      "Our Lady of the Kings",
      "05",
    ),
    note(
      1,
      "fuerteventura",
      "2026-09-18",
      "Festividad de Nuestra Señora de la Peña",
      "Our Lady of La Peña",
      "05",
    ),
    note(
      1,
      "gran-canaria",
      "2026-09-08",
      "Festividad de Nuestra Señora del Pino",
      "Our Lady of the Pine",
      "05",
    ),
    note(
      1,
      "la-gomera",
      "2026-10-05",
      "Festividad de Nuestra Señora de Guadalupe",
      "Our Lady of Guadalupe",
      "05",
    ),
    note(
      1,
      "la-palma",
      "2026-08-05",
      "Festividad de Nuestra Señora de Las Nieves",
      "Our Lady of the Snows",
      "05",
    ),
    note(
      1,
      "lanzarote-la-graciosa",
      "2026-09-15",
      "Festividad de Nuestra Señora de los Volcanes",
      "Our Lady of the Volcanoes",
      "05",
    ),
    note(
      1,
      "tenerife",
      "2026-02-02",
      "Festividad de la Virgen de la Candelaria",
      "Our Lady of Candelaria",
      "05",
    ),
    note(2, "aran", "2026-06-17", "Fiesta de Arán", "Aran Day", "09"),
  ],
};
