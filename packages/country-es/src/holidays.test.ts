import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { findAdministrativeArea } from "@waitron/country";
import { describe, expect, it } from "vitest";
import { BOE_COLUMNS, HOLIDAY_AREAS, PROVINCE_REGIONS } from "./data/regions.js";
import { SPAIN_2026 } from "./data/es-2026.js";
import {
  compareRows,
  expectedRowsFromAnnex,
  normalizeShippedRows,
  parseAnnex,
  parseHtmlTable,
} from "./data/official-sources.js";
import { SPAIN_HOLIDAY_CALENDAR } from "./holidays.js";
import { SPAIN } from "./spain.js";

const artifact = (name: string) => readFileSync(new URL(`./data/sources/${name}`, import.meta.url));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

const ANNEX_FILE = "BOE-A-2025-21667.xml";
const annex = parseAnnex(artifact(ANNEX_FILE).toString("utf8"));
const ineRegions = parseHtmlTable(latin1(artifact("ine-cod_ccaa_provincia.htm"))).filter((cells) =>
  /^\d{2}$/.test(cells[0] ?? ""),
);
const ineProvinces = parseHtmlTable(latin1(artifact("ine-cod_provincia.htm"))).filter((cells) =>
  /^\d{2}$/.test(cells[0] ?? ""),
);
const ineIslands = parseHtmlTable(latin1(artifact("ine-cod_islas.htm"))).filter((cells) =>
  /^\d{3}$/.test(cells[0] ?? ""),
);

const calendar = SPAIN_HOLIDAY_CALENDAR;
const ANNEX = "BOE-A-2025-21667";
const codeOf = (province: string) => findAdministrativeArea(SPAIN, province)!.code;
const day = (province: string, date: string, areaKey: string | null = null) =>
  calendar.read({ provinceCode: codeOf(province), areaKey, from: date, to: date });
const ids = (read: { facts: readonly { id: string }[] }) => read.facts.map(({ id }) => id);
const fact = (row: string, date: string, name: string, scope: "national" | "regional") => ({
  id: `shipped:${ANNEX}:${row}`,
  date,
  name,
  scope,
  sourceId: ANNEX,
});
const complete = (regionCode: string) => [
  {
    year: 2026,
    state: "complete",
    regionCode,
    dataVersion: "ES-2026.1",
    sourceIds: [ANNEX],
  },
];

describe("source artifacts", () => {
  const files: Record<string, string> = {
    [ANNEX]: ANNEX_FILE,
    "BOE-A-2015-2294": "BOE-A-2015-2294.xml",
    "INE-cod_ccaa_provincia": "ine-cod_ccaa_provincia.htm",
    "INE-cod_islas": "ine-cod_islas.htm",
  };

  it("pins every shipped source to the SHA-256 of the archived page it was read from", () => {
    expect(calendar.sources.map(({ id }) => id).sort()).toEqual(Object.keys(files).sort());
    for (const source of calendar.sources)
      expect(source.sha256, source.id).toBe(sha256(artifact(files[source.id]!)));
  });

  it("names the BOE resolution by its own title and address", () => {
    const annexSource = calendar.sources.find(({ id }) => id === ANNEX)!;
    expect(annexSource.title).toBe(annex.title);
    expect(annexSource.url).toBe(`https://www.boe.es/buscar/doc.php?id=${ANNEX}`);
  });

  it("pins the INE province list used only to check the inventory", () => {
    expect(sha256(artifact("ine-cod_provincia.htm"))).toBe(
      "47aa7f7e5d80d3af6a22bb2369ebf8bc86ae58a3400caeaa07e145763004f428",
    );
  });
});

describe("province to region", () => {
  it("maps every province in the pack, and in INE's tables, to INE's community code", () => {
    const packCodes = SPAIN.administrativeAreas.map(({ code }) => code).sort();
    expect(Object.keys(PROVINCE_REGIONS).sort()).toEqual(packCodes);
    expect(ineProvinces.map(([code]) => code).sort()).toEqual(packCodes);
    expect(ineRegions.map(([, , province]) => province).sort()).toEqual(packCodes);
    for (const [region, , province] of ineRegions)
      expect(calendar.regionForProvince(province!), province).toBe(region);
  });

  it("includes the autonomous cities", () => {
    expect(calendar.regionForProvince("51")).toBe("18");
    expect(calendar.regionForProvince("52")).toBe("19");
  });

  it("resolves a code, the pack's name and an alias to the same region", () => {
    for (const value of ["41", "Sevilla", " sevilla "])
      expect(calendar.regionForProvince(codeOf(value))).toBe("01");
    for (const value of ["25", "Lleida", "Lérida"])
      expect(calendar.regionForProvince(codeOf(value))).toBe("09");
  });

  it("never defaults an unknown province to Madrid or to all of Spain", () => {
    expect(findAdministrativeArea(SPAIN, "Atlantis")).toBeUndefined();
    expect(calendar.regionForProvince("Madrid")).toBeUndefined();
    expect(calendar.regionForProvince("99")).toBeUndefined();
    expect(
      calendar.read({ provinceCode: "99", areaKey: null, from: "2026-01-01", to: "2026-12-31" }),
    ).toEqual({
      facts: [],
      coverage: [
        { year: 2026, state: "unknown_region", regionCode: null, dataVersion: null, sourceIds: [] },
      ],
    });
  });

  it("reconciles each BOE column with INE's community of the same code", () => {
    expect(BOE_COLUMNS.map(({ boe }) => boe)).toEqual(annex.columns);
    expect(new Set(BOE_COLUMNS.map(({ region }) => region))).toEqual(
      new Set(ineRegions.map(([region]) => region)),
    );
    for (const { boe, ine, region } of BOE_COLUMNS)
      for (const [code, name] of ineRegions) if (code === region) expect(name, boe).toBe(ine);
  });
});

describe("territorial areas", () => {
  it("offers the Canary islands of each Canary province, from INE's island table", () => {
    expect(calendar.areasForProvince("35").map(({ key }) => key)).toEqual([
      "fuerteventura",
      "gran-canaria",
      "lanzarote-la-graciosa",
    ]);
    expect(calendar.areasForProvince("38").map(({ key }) => key)).toEqual([
      "el-hierro",
      "la-gomera",
      "la-palma",
      "tenerife",
    ]);
    const ineName: Record<string, string> = {
      "el-hierro": "Hierro, El",
      fuerteventura: "Fuerteventura",
      "gran-canaria": "Gran Canaria",
      "la-gomera": "Gomera, La",
      "la-palma": "Palma, La",
      "lanzarote-la-graciosa": "Lanzarote",
      tenerife: "Tenerife",
    };
    for (const [key, name] of Object.entries(ineName)) {
      const island = ineIslands.find(([, isle]) => isle === name)!;
      expect(HOLIDAY_AREAS.find((area) => area.key === key)!.provinces, key).toEqual([
        island[0]!.slice(0, 2),
      ]);
    }
  });

  it("offers Arán and the rest of Lleida, the province the Arán law places it in", () => {
    const law = artifact("BOE-A-2015-2294.xml").toString("utf8");
    expect(law).toContain("quedó definitivamente incorporado a la nueva provincia de Lleida");
    expect(calendar.areasForProvince(codeOf("Lleida")).map(({ key }) => key)).toEqual([
      "aran",
      "lleida-except-aran",
    ]);
    for (const province of ["Barcelona", "Girona", "Tarragona", "Madrid", "Sevilla"])
      expect(calendar.areasForProvince(codeOf(province)), province).toEqual([]);
  });
});

describe("Spain's 2026 holidays", () => {
  it("lists 2 November in Andalucía and not in Cataluña", () => {
    expect(day("Sevilla", "2026-11-02")).toEqual({
      facts: [fact("0211", "2026-11-02", "Día siguiente a Todos los Santos", "national")],
      coverage: complete("01"),
    });
    expect(day("Barcelona", "2026-11-02")).toEqual({ facts: [], coverage: complete("09") });
  });

  it("lists a national holiday no region may replace everywhere", () => {
    for (const province of ["Sevilla", "Barcelona", "Ceuta", "Lleida", "Santa Cruz de Tenerife"])
      expect(day(province, "2026-01-01").facts, province).toEqual([
        fact("0101", "2026-01-01", "Año Nuevo", "national"),
      ]);
  });

  it("lists a national holiday a region could replace only where it kept it", () => {
    expect(ids(day("Valencia", "2026-03-19"))).toEqual([`shipped:${ANNEX}:1903`]);
    expect(ids(day("Madrid", "2026-03-19"))).toEqual([]);
    expect(ids(day("Madrid", "2026-04-02"))).toEqual([`shipped:${ANNEX}:0204`]);
    expect(ids(day("Barcelona", "2026-04-02"))).toEqual([]);
  });

  it("lists a region's own holiday only in that region", () => {
    expect(day("Granada", "2026-02-28").facts).toEqual([
      fact("2802", "2026-02-28", "Día de Andalucía", "regional"),
    ]);
    expect(ids(day("Madrid", "2026-02-28"))).toEqual([]);
    expect(ids(day("Zaragoza", "2026-04-23"))).toEqual([`shipped:${ANNEX}:2304A`]);
    expect(ids(day("León", "2026-04-23"))).toEqual([`shipped:${ANNEX}:2304B`]);
  });

  it("returns nothing for an ordinary working day, with complete coverage", () => {
    expect(day("Madrid", "2026-03-10")).toEqual({ facts: [], coverage: complete("13") });
    expect(day("Sevilla", "2026-11-03")).toEqual({ facts: [], coverage: complete("01") });
  });

  it("replaces 26 December with 17 June in Arán, and asks which part of Lleida until told", () => {
    const year = { from: "2026-06-17", to: "2026-12-26" };
    const lleida = codeOf("Lleida");
    const read = (areaKey: string | null) =>
      calendar.read({ provinceCode: lleida, areaKey, ...year });
    expect(ids(read("aran"))).toContain(`shipped:${ANNEX}:note-2:aran`);
    expect(ids(read("aran"))).not.toContain(`shipped:${ANNEX}:2612`);
    expect(ids(read("lleida-except-aran"))).toContain(`shipped:${ANNEX}:2612`);
    expect(ids(read("lleida-except-aran"))).not.toContain(`shipped:${ANNEX}:note-2:aran`);
    expect(ids(read(null))).not.toContain(`shipped:${ANNEX}:2612`);
    expect(ids(read(null))).not.toContain(`shipped:${ANNEX}:note-2:aran`);
    expect(ids(read(null))).toContain(`shipped:${ANNEX}:1109`);
    expect(read(null).coverage[0]!.state).toBe("area_required");
    expect(read("aran").coverage[0]!.state).toBe("complete");
    expect(ids(day("Barcelona", "2026-12-26"))).toEqual([`shipped:${ANNEX}:2612`]);
    expect(day("Barcelona", "2026-12-26").coverage[0]!.state).toBe("complete");
    expect(ids(day("Illes Balears", "2026-12-26"))).toEqual([`shipped:${ANNEX}:2612`]);
  });

  it("adds each Canary island's own day only on that island", () => {
    expect(day("Santa Cruz de Tenerife", "2026-02-02", "tenerife").facts).toEqual([
      {
        id: `shipped:${ANNEX}:note-1:tenerife`,
        date: "2026-02-02",
        name: "Festividad de la Virgen de la Candelaria",
        scope: "regional",
        sourceId: ANNEX,
      },
    ]);
    expect(ids(day("Santa Cruz de Tenerife", "2026-02-02", "la-palma"))).toEqual([]);
    const unknown = day("Santa Cruz de Tenerife", "2026-02-02");
    expect(unknown.facts).toEqual([]);
    expect(unknown.coverage[0]!.state).toBe("area_required");
    expect(ids(day("Las Palmas", "2026-05-30"))).toEqual([`shipped:${ANNEX}:3005`]);
  });

  it("describes 2027, not yet published nationally, as a missing year", () => {
    expect(
      calendar.read({ provinceCode: "41", areaKey: null, from: "2026-12-25", to: "2027-01-06" }),
    ).toEqual({
      facts: [fact("2512", "2026-12-25", "Natividad del Señor", "national")],
      coverage: [
        ...complete("01"),
        { year: 2027, state: "missing_year", regionCode: "01", dataVersion: null, sourceIds: [] },
      ],
    });
  });

  it("allows two local holidays a year, as the resolution's local-holiday paragraph says", () => {
    expect(
      annex.paragraphs.some((text) =>
        text.includes("hasta dos días de cada año natural con carácter de fiestas locales"),
      ),
    ).toBe(true);
    expect(calendar.localEntryLimit).toBe(2);
    expect(SPAIN.holidayCalendar).toBe(SPAIN_HOLIDAY_CALENDAR);
  });
});

describe("the shipped rows against the archived annex", () => {
  const areaByName = (name: string) => HOLIDAY_AREAS.find((area) => area.name === name)?.key;
  const expected = expectedRowsFromAnnex(annex, ANNEX, BOE_COLUMNS, areaByName);
  const regionOfArea = (key: string) => {
    const province = HOLIDAY_AREAS.find((area) => area.key === key)?.provinces[0];
    return province === undefined ? undefined : PROVINCE_REGIONS[province];
  };
  const shipped = normalizeShippedRows(SPAIN_2026, regionOfArea);

  it("reads every dated row and both clarifying notes from the annex", () => {
    expect(annex.year).toBe(2026);
    expect(annex.rows).toHaveLength(36);
    expect(annex.notes).toHaveLength(2);
    expect(annex.codes).toEqual({
      "*": "Fiesta Nacional no sustituible",
      "**": "Fiesta Nacional respecto de la que no se ha ejercido la facultad de sustitución",
      "***": "Fiesta de Comunidad Autónoma",
    });
  });

  it("ships exactly the annex's rows, region by region, with its notes applied", () => {
    expect(compareRows(expected, shipped)).toEqual({ missing: [], extra: [] });
    expect(new Set(shipped).size).toBe(shipped.length);
  });

  it("notices a wrong region, an altered date and a dropped territorial note", () => {
    const rows = SPAIN_2026.rows;
    const mutated = (index: number, change: object) => ({
      ...SPAIN_2026,
      rows: rows.map((row, at) => (at === index ? { ...row, ...change } : row)),
    });
    const november = rows.findIndex(({ key }) => key === `${ANNEX}:0211`);
    const boxing = rows.findIndex(({ key }) => key === `${ANNEX}:2612`);
    for (const broken of [
      mutated(november, { regions: [...rows[november]!.regions, "09"] }),
      mutated(november, { date: "2026-11-03" }),
      mutated(boxing, { exceptAreas: undefined }),
    ]) {
      const result = compareRows(expected, normalizeShippedRows(broken, regionOfArea));
      expect(result.missing.length + result.extra.length).toBeGreaterThan(0);
    }
  });
});

describe("reading an archived page", () => {
  const page = (note: string, cell = "<abbr>*</abbr>") =>
    [
      "<titulo>T&iacute;tulo &#233;&#38; &unknown;</titulo>",
      '<p class="anexo_num">ANEXO</p><p class="anexo_tit">Año 2030</p><table>',
      '<tr><th axis="comunidad">Norte (1)</th></tr>',
      '<tr><td axis="mes">Enero</td><td> </td></tr>',
      `<tr><td axis="fecha" id="header0101">1 Año Nuevo.</td><td>${cell}</td></tr>`,
      `</table><p class="parrafo">${note}</p>`,
    ].join("\n");
  const columns = [{ boe: "Norte", region: "01" }];

  it("decodes named and numeric entities and keeps an unknown one as written", () => {
    expect(parseAnnex(page("")).title).toBe("Título é& &unknown;");
  });

  it("refuses a month it does not know", () => {
    expect(() => parseAnnex(page("").replace("Enero", "Primero"))).toThrow("unknown month");
  });

  it("refuses a note that names an area the data does not have", () => {
    const note =
      "1. En la Comunidad Autónoma de Norte, dispone: «en Isla: el 2 de enero, festividad de Algo».";
    expect(() =>
      expectedRowsFromAnnex(parseAnnex(page(note)), "S", columns, () => undefined),
    ).toThrow("no area is named Isla");
    expect(expectedRowsFromAnnex(parseAnnex(page(note)), "S", columns, () => "isla")).toEqual([
      "S:0101 | 2030-01-01 | Año Nuevo | national | * | 01 | ",
      "S:note-1:isla | 2030-01-02 | Festividad de Algo | regional | note-1 | 01 | only:isla",
    ]);
  });

  it("refuses a note it cannot read rather than skipping it", () => {
    const note = "1. En la Comunidad Autónoma de Norte, dispone otra cosa.";
    expect(() => expectedRowsFromAnnex(parseAnnex(page(note)), "S", columns, () => "x")).toThrow(
      "note 1 was not read",
    );
  });
});
