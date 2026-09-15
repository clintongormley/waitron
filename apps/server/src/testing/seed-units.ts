import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

const EACH_NAMES = { en: "each", es: "unidad", ca: "unitat", gl: "unidade", eu: "unitatea" };
const EACH_ABBR = { en: "ea", es: "ud", ca: "u", gl: "u", eu: "u" };

/** Seed the two legacy product choices with real unit identities. */
export async function seedLegacySellingUnits(db: Database): Promise<void> {
  await db.execute(sql`
    insert into units (seed_key, name, abbreviation, precision, hardware_unit) values
      ('each', ${JSON.stringify(EACH_NAMES)}::jsonb, ${JSON.stringify(EACH_ABBR)}::jsonb, 0, null),
      ('kg', '{"en":"kg","es":"kg","ca":"kg","gl":"kg","eu":"kg"}'::jsonb, '{"en":"kg","es":"kg","ca":"kg","gl":"kg","eu":"kg"}'::jsonb, 3, 'kg')`);
}
