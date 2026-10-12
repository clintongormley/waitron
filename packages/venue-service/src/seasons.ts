import { asc, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { VenueScope } from "./operations.js";
import { DEFAULT_SEASONS, type Season } from "./season-rules.js";
import { seasons } from "./schema/seasons.js";

export async function readSeasons(tx: Transaction, cfg: VenueScope): Promise<Season[]> {
  return tx
    .select({ id: seasons.id, name: seasons.name, startsOn: seasons.startsOn })
    .from(seasons)
    .where(eq(seasons.locationId, cfg.locationId))
    .orderBy(asc(seasons.startsOn));
}

export async function ensureDefaultSeasons(tx: Transaction, cfg: VenueScope): Promise<Season[]> {
  const existing = await readSeasons(tx, cfg);
  if (existing.length > 0) return existing;
  await tx
    .insert(seasons)
    .values(DEFAULT_SEASONS.map((season) => ({ ...season, locationId: cfg.locationId })));
  return readSeasons(tx, cfg);
}
