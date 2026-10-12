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
  const inserted = await tx
    .insert(seasons)
    .values(DEFAULT_SEASONS.map((season) => ({ ...season, locationId: cfg.locationId })))
    .returning({ id: seasons.id, name: seasons.name, startsOn: seasons.startsOn });
  // "The rows emitted by the RETURNING clause appear in an arbitrary order" (sqlite.org/lang_returning.html).
  return inserted.sort((a, b) => (a.startsOn < b.startsOn ? -1 : Number(a.startsOn > b.startsOn)));
}
