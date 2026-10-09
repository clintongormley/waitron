import { sql } from "drizzle-orm";
import { catalogues, locationCatalogues } from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import { getCountryPack, resolveInstalledStartingContentLanguages } from "@waitron/country-packs";
import { catalogueSettings } from "./schema/settings.js";
import type { VatClass } from "./vat-rates.js";
import { contentLanguages } from "./schema/menu.js";
import { createMenuShell } from "./menu-structure.js";
import { unitSeedStates, units } from "./schema/units.js";

// Full display name shown in the dashboard; the short abbreviation is frozen onto sold lines.
const UNIT_NAMES = {
  g: { en: "Gram", es: "Gramo", ca: "Gram", "ca-ES-valencia": "Gram", gl: "Gramo", eu: "Gramo" },
  kg: {
    en: "Kilogram",
    es: "Kilogramo",
    ca: "Quilogram",
    "ca-ES-valencia": "Quilogram",
    gl: "Quilogramo",
    eu: "Kilogramo",
  },
  mg: {
    en: "Milligram",
    es: "Miligramo",
    ca: "Mil·ligram",
    "ca-ES-valencia": "Mil·ligram",
    gl: "Miligramo",
    eu: "Miligramo",
  },
  ml: {
    en: "Millilitre",
    es: "Mililitro",
    ca: "Mil·lilitre",
    "ca-ES-valencia": "Mil·lilitre",
    gl: "Mililitro",
    eu: "Mililitro",
  },
  l: { en: "Litre", es: "Litro", ca: "Litre", "ca-ES-valencia": "Litre", gl: "Litro", eu: "Litro" },
} as const;
const UNIT_ABBR = {
  g: { en: "g", es: "g", ca: "g", "ca-ES-valencia": "g", gl: "g", eu: "g" },
  kg: { en: "kg", es: "kg", ca: "kg", "ca-ES-valencia": "kg", gl: "kg", eu: "kg" },
  mg: { en: "mg", es: "mg", ca: "mg", "ca-ES-valencia": "mg", gl: "mg", eu: "mg" },
  ml: { en: "ml", es: "ml", ca: "ml", "ca-ES-valencia": "ml", gl: "ml", eu: "ml" },
  l: { en: "l", es: "l", ca: "l", "ca-ES-valencia": "l", gl: "l", eu: "l" },
} as const;

export const CATALOGUE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the venue's initial menu and content languages",
    async run(tx, node) {
      const location = await tx.execute<{
        catalogue_id: string | null;
        province: string | null;
        country: string;
      }>(sql`
        select l.catalogue_id, l.province, t.country from locations l
        cross join tenants t
        where l.id = ${node.locationId}`);
      const country = location.rows[0]?.country;
      const area = location.rows[0]?.province;
      const defaultProductVatClass =
        (country === undefined ? undefined : getCountryPack(country)?.defaultProductVatClass) ??
        "general";
      await tx
        .insert(catalogueSettings)
        .values({ defaultProductVatClass: defaultProductVatClass as VatClass })
        .onConflictDoNothing({ target: catalogueSettings.id });
      const { defaultLanguage, languages } = resolveInstalledStartingContentLanguages({
        country,
        area,
      });
      // Every write below goes through its drizzle table rather than through raw SQL, because
      // `id`, `created_at` and `updated_at` are supplied by `$defaultFn` in JavaScript
      // (`packages/db/src/schema/columns.ts`), so a raw `insert into catalogues (name)` writes a
      // null id and is refused.
      await tx
        .insert(contentLanguages)
        .values({ defaultLanguage, languages: [...languages] })
        .onConflictDoNothing({ target: contentLanguages.id });
      // The id is stated rather than left out: this table's only column IS the key, and drizzle
      // renders a values object with no columns in it as `insert into … () values ()`, which
      // SQLite refuses. `1` is the value the column defaults to and the singleton check demands.
      const claimed = await tx
        .insert(unitSeedStates)
        .values({ id: 1 })
        .onConflictDoNothing({ target: unitSeedStates.id })
        .returning({ id: unitSeedStates.id });
      if (claimed.length > 0) {
        await tx.insert(units).values([
          {
            seedKey: "g",
            name: UNIT_NAMES.g,
            abbreviation: UNIT_ABBR.g,
            precision: 0,
            hardwareUnit: "g",
          },
          {
            seedKey: "kg",
            name: UNIT_NAMES.kg,
            abbreviation: UNIT_ABBR.kg,
            precision: 3,
            hardwareUnit: "kg",
          },
          {
            seedKey: "mg",
            name: UNIT_NAMES.mg,
            abbreviation: UNIT_ABBR.mg,
            precision: 0,
            hardwareUnit: "mg",
          },
          {
            seedKey: "ml",
            name: UNIT_NAMES.ml,
            abbreviation: UNIT_ABBR.ml,
            precision: 0,
            hardwareUnit: null,
          },
          {
            seedKey: "l",
            name: UNIT_NAMES.l,
            abbreviation: UNIT_ABBR.l,
            precision: 3,
            hardwareUnit: null,
          },
        ]);
      }
      let catalogueId = location.rows[0]?.catalogue_id ?? null;
      if (catalogueId === null) {
        const [created] = await tx
          .insert(catalogues)
          .values({ name: "Menu" })
          .returning({ id: catalogues.id, name: catalogues.name });
        catalogueId = created!.id;
        await createMenuShell(tx, catalogueId, created!.name);
        await tx.execute(sql`
          update locations set catalogue_id = ${catalogueId}
          where id = ${node.locationId}`);
      }
      await tx
        .insert(locationCatalogues)
        .values({ locationId: node.locationId, catalogueId })
        .onConflictDoNothing();
      return "initial menu ready";
    },
  },
};
