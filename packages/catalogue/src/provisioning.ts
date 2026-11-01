import {
  catalogues,
  locationCatalogues,
  readTenant,
  readVenue,
  venueLocationId,
} from "@waitron/db";
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
import { assignCatalogueToVenue } from "./operations.js";
import { unitSeedStates, units } from "./schema/units.js";
import { STARTER_MENU_NAMES, STARTER_UNIT_NAMES } from "./starter-content.js";

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

export const FIRST_MENU_NAME = "Menu";

// The pale blue swatch of CATEGORY_PALETTE (packages/ui/src/category-color.ts).
const NEW_VENUE_DEFAULT_COLOR = "#abcced";

export const CATALOGUE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the venue's initial menu and content languages",
    async run(tx) {
      const venue = await readVenue(tx);
      const country = (await readTenant(tx))?.country;
      const area = venue.province;
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
      const starter = resolveInstalledStarterLanguages({
        country,
        area,
        receiptLocale: venue.invoiceLocales[0],
      });
      if (claimed.length > 0) {
        await tx.insert(units).values(
          STARTER_UNITS.map(({ staffName: english, staffAbbreviation, ...unit }) => {
            const name = starterNames(STARTER_UNIT_NAMES, english, starter.languages);
            return {
              ...unit,
              staffName: starterName(STARTER_UNIT_NAMES, english, starter.staffLanguage),
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
      let catalogueId = venue.defaultCatalogueId;
      if (catalogueId === null) {
        const [created] = await tx
          .insert(catalogues)
          .values({ name: starterName(STARTER_MENU_NAMES, FIRST_MENU_NAME, starter.staffLanguage) })
          .returning({ id: catalogues.id, name: catalogues.name });
        catalogueId = created!.id;
        await createMenuShell(tx, catalogueId, created!.name);
        await assignCatalogueToVenue(tx, catalogueId);
      }
      await tx
        .insert(locationCatalogues)
        .values({ locationId: await venueLocationId(tx), catalogueId })
        .onConflictDoNothing();
      return "initial menu ready";
    },
  },
};
