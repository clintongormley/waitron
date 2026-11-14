import { menus, readTaxpayer, readVenue, readSettings, saveSettings, units } from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import {
  getCountryPack,
  resolveInstalledStarterLanguages,
  resolveInstalledStartingContentLanguages,
  starterName,
  starterNames,
} from "@waitron/country-packs";
import type { VatClass } from "@waitron/shared";
import { readSavedContentLanguages, writeContentLanguages } from "./content-languages.js";
import { createMenuShell } from "./menu-structure.js";
import { assignMenuToVenue } from "./operations.js";
import { STARTER_MENU_NAMES, STARTER_UNIT_NAMES } from "./starter-content.js";
import { MENU_SETTINGS } from "./settings.js";
import { readDefaultMenuId } from "./operations.js";

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

export const MENU_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the venue's initial menu and content languages",
    async run(tx, _node, _operation, options) {
      const venue = await readVenue(tx);
      const country = (await readTaxpayer(tx))?.country;
      const area = venue.province;
      const defaultProductVatClass =
        (country === undefined ? undefined : getCountryPack(country)?.defaultProductVatClass) ??
        "general";
      const { doc: saved, revision } = await readSettings(tx, MENU_SETTINGS);
      const doc =
        revision === 0
          ? {
              ...saved,
              defaultProductVatClass: defaultProductVatClass as VatClass,
              defaultColor: NEW_VENUE_DEFAULT_COLOR,
            }
          : saved;
      const { defaultLanguage, languages } = resolveInstalledStartingContentLanguages({
        country,
        area,
      });
      // Every write below goes through its drizzle table rather than through raw SQL, because
      // `id`, `created_at` and `updated_at` are supplied by `$defaultFn` in JavaScript
      // (`packages/db/src/schema/columns.ts`), so a raw `insert into menus (name)` writes a
      // null id and is refused.
      if ((await readSavedContentLanguages(tx)) === undefined)
        await writeContentLanguages(tx, { defaultLanguage, languages: [...languages] }, [], null);
      const starter = resolveInstalledStarterLanguages({
        country,
        area,
        receiptLocale: venue.invoiceLocales[0],
        staffLanguage: options?.staffLanguage,
      });
      if (!doc.starterUnitsCreated) {
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
      if (revision === 0 || !doc.starterUnitsCreated)
        await saveSettings(tx, MENU_SETTINGS, {
          doc: { ...doc, starterUnitsCreated: true },
          expectedRevision: revision,
          personId: null,
        });
      let menuId = await readDefaultMenuId(tx);
      if (menuId === null) {
        const [created] = await tx
          .insert(menus)
          .values({ name: starterName(STARTER_MENU_NAMES, FIRST_MENU_NAME, starter.staffLanguage) })
          .returning({ id: menus.id, name: menus.name });
        menuId = created!.id;
        await createMenuShell(tx, menuId, created!.name);
        await assignMenuToVenue(tx, menuId);
      }
      return "initial menu ready";
    },
  },
};
