import { units } from "@waitron/catalogue";
import type { Database } from "@waitron/db";

const EACH_NAMES = { en: "each", es: "unidad", ca: "unitat", gl: "unidade", eu: "unitatea" };
const EACH_ABBR = { en: "ea", es: "ud", ca: "u", gl: "u", eu: "u" };
const KG_NAMES = { en: "kg", es: "kg", ca: "kg", gl: "kg", eu: "kg" };

/**
 * Seed the two legacy product choices with real unit identities.
 *
 * Inserted through the table definition rather than as raw SQL, so every column generator the
 * storage swap moved into JavaScript runs — `units.id` is one, and a raw insert reaches none of
 * them (`packages/db/src/testing/seed.ts` was converted for the same reason). The names and
 * abbreviations are handed over as objects because the column's own write mapping is what encodes
 * them; the `::jsonb` casts they used to carry are a syntax error on this engine
 * (`unrecognized token: ":"`).
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
