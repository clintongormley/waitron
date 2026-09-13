import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

const EACH_NAMES = { en: "each", es: "unidad", ca: "unitat", gl: "unidade", eu: "unitatea" };

/** Seed the two legacy product choices with real tenant-scoped unit identities. */
export async function seedLegacySellingUnits(db: Database, tenantId: string): Promise<void> {
  await db.execute(sql`
    insert into units (tenant_id, seed_key, name, precision, hardware_unit) values
      (${tenantId}, 'each', ${JSON.stringify(EACH_NAMES)}::jsonb, 0, null),
      (${tenantId}, 'kg', '{"en":"kg","es":"kg","ca":"kg","gl":"kg","eu":"kg"}'::jsonb, 3, 'kg')`);
}
