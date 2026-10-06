import type { HolidaySourceReference } from "@waitron/country";

/** Each hash is of the page archived beside this file in `sources/`, as fetched on 2026-10-06. */
export const ANNEX_2026: HolidaySourceReference = {
  id: "BOE-A-2025-21667",
  title:
    "Resolución de 17 de octubre de 2025, de la Dirección General de Trabajo, por la que se publica la relación de fiestas laborales para el año 2026.",
  url: "https://www.boe.es/buscar/doc.php?id=BOE-A-2025-21667",
  sha256: "f85e22b21de215dafdc2491eab6a535b0c92e744c8d2ae79d3d4c0532c9770e0",
};

export const GEOGRAPHY_SOURCES: readonly HolidaySourceReference[] = [
  {
    id: "INE-cod_ccaa_provincia",
    title: "INE: Relación de provincias por comunidades autónomas y sus códigos",
    url: "https://www.ine.es/daco/daco42/codmun/cod_ccaa_provincia.htm",
    sha256: "f559a786aff364869f0e5bf263e9b8b4a38f991021b387b9130215634ef2e452",
  },
  {
    id: "INE-cod_islas",
    title: "INE: Relación de islas por provincias con sus códigos",
    url: "https://www.ine.es/daco/daco42/codmun/cod_islas.htm",
    sha256: "30429ef73e04d10830e11ec6d81bc40ca5eb1399646ccb43a4f89780acfba47a",
  },
  {
    id: "BOE-A-2015-2294",
    title: "Ley 1/2015, de 5 de febrero, del régimen especial de Arán.",
    url: "https://www.boe.es/buscar/doc.php?id=BOE-A-2015-2294",
    sha256: "a59f3a3219306ec2101d78396346e4a7d5e871f37d539b9fb863ff2b22cf2e6a",
  },
];
