import { units } from "@waitron/catalogue";
import type { Database } from "@waitron/db";

const EACH_NAMES = { en: "each", es: "unidad", ca: "unitat", gl: "unidade", eu: "unitatea" };
const EACH_ABBR = { en: "ea", es: "ud", ca: "u", gl: "u", eu: "u" };
const KG_NAMES = { en: "kg", es: "kg", ca: "kg", gl: "kg", eu: "kg" };

/**
 * Seed the two legacy product choices with real unit identities, through the table definition so
 * each column's `$defaultFn` runs and its write mapping encodes the names.
 */
export async function seedLegacySellingUnits(db: Database): Promise<void> {
  await db.insert(units).values([
    {
      seedKey: "each",
      name: EACH_NAMES,
      abbreviation: EACH_ABBR,
      precision: 0,
      hardwareUnit: null,
    },
    { seedKey: "kg", name: KG_NAMES, abbreviation: KG_NAMES, precision: 3, hardwareUnit: "kg" },
  ]);
}
