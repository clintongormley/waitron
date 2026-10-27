import { eq, sql } from "drizzle-orm";
import { catalogues, locationCatalogues, locations, tenants } from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import {
  getCountryPack,
  resolveInstalledStarterLanguages,
  resolveInstalledStartingContentLanguages,
  starterName,
  starterNames,
} from "@waitron/country-packs";
import { catalogueSettings } from "./schema/settings.js";
import type { VatClass } from "./vat-rates.js";
import { contentLanguages } from "./schema/menu.js";
import { createMenuShell } from "./menu-structure.js";
import { unitSeedStates, units } from "./schema/units.js";
import { STARTER_UNIT_NAMES } from "./starter-content.js";

/** The starter units, by their English staff names; their words in other languages are in
 * `starter-content.ts`. */
export const STARTER_UNITS = [
  { seedKey: "g", staffName: "Gram", staffAbbreviation: "g", precision: 0, hardwareUnit: "g" },
  {
    seedKey: "kg",
    staffName: "Kilogram",
    staffAbbreviation: "kg",
    precision: 3,
    hardwareUnit: "kg",
  },
  {
    seedKey: "mg",
    staffName: "Milligram",
    staffAbbreviation: "mg",
    precision: 0,
    hardwareUnit: "mg",
  },
  {
    seedKey: "ml",
    staffName: "Millilitre",
    staffAbbreviation: "ml",
    precision: 0,
    hardwareUnit: null,
  },
  { seedKey: "l", staffName: "Litre", staffAbbreviation: "l", precision: 3, hardwareUnit: null },
] as const;

// The pale blue swatch of CATEGORY_PALETTE (packages/ui/src/category-color.ts).
const NEW_VENUE_DEFAULT_COLOR = "#abcced";

export const CATALOGUE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the venue's initial menu and content languages",
    async run(tx, node) {
      const [location] = await tx
        .select({
          catalogueId: locations.catalogueId,
          area: locations.province,
          invoiceLocales: locations.invoiceLocales,
          country: tenants.country,
        })
        .from(locations)
        .innerJoin(tenants, eq(tenants.id, 1))
        .where(eq(locations.id, node.locationId));
      const country = location?.country;
      const area = location?.area;
      const defaultProductVatClass =
        (country === undefined ? undefined : getCountryPack(country)?.defaultProductVatClass) ??
        "general";
      await tx
        .insert(catalogueSettings)
        .values({
          defaultProductVatClass: defaultProductVatClass as VatClass,
          defaultColor: NEW_VENUE_DEFAULT_COLOR,
        })
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
        const { languages, staffLanguage } = resolveInstalledStarterLanguages({
          country,
          area,
          receiptLocale: location?.invoiceLocales[0],
        });
        await tx.insert(units).values(
          STARTER_UNITS.map(({ staffName: english, staffAbbreviation, ...unit }) => {
            const name = starterNames(STARTER_UNIT_NAMES, english, languages);
            return {
              ...unit,
              staffName: starterName(STARTER_UNIT_NAMES, english, staffLanguage),
              staffAbbreviation,
              name,
              abbreviation: Object.fromEntries(
                Object.keys(name).map((language) => [language, staffAbbreviation]),
              ),
              measure: true,
            };
          }),
        );
      }
      let catalogueId = location?.catalogueId ?? null;
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
