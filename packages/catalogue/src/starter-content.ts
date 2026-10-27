import type { StarterContentLanguage, StarterTranslations } from "@waitron/country-packs";

/** The starter units' names in each language a new venue can start with, keyed by the English
 * staff name `provisioning.ts` seeds. */
export const STARTER_UNIT_NAMES = {
  Gram: { es: "Gramo", ca: "Gram", "ca-ES-valencia": "Gram", gl: "Gramo" },
  Kilogram: {
    es: "Kilogramo",
    ca: "Quilogram",
    "ca-ES-valencia": "Quilogram",
    gl: "Quilogramo",
  },
  Milligram: {
    es: "Miligramo",
    ca: "Mil·ligram",
    "ca-ES-valencia": "Mil·ligram",
    gl: "Miligramo",
  },
  Millilitre: {
    es: "Mililitro",
    ca: "Mil·lilitre",
    "ca-ES-valencia": "Mil·lilitre",
    gl: "Mililitro",
  },
  Litre: { es: "Litro", ca: "Litre", "ca-ES-valencia": "Litre", gl: "Litro" },
} as const satisfies StarterTranslations<StarterContentLanguage>;
