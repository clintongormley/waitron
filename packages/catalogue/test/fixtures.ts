import { expect } from "vitest";
import { CORE_MIGRATIONS, invoiceSeries, locations, tills, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  locationId as brandLocationId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "../src/operations.js";
import { CATALOGUE_MIGRATIONS } from "../src/migrations.js";
import { createUnit } from "../src/units.js";
import { units } from "../src/schema/units.js";

export interface SeededVenue {
  locationId: string;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

/**
 * Seed the two legacy product choices with real unit identities.
 *
 * Written through the table rather than as one raw `insert`, because `units.id` is supplied by
 * `$defaultFn` in JavaScript and not by a SQL default — a raw insert naming only the other columns
 * is refused `NOT NULL constraint failed: units.id`. Going through the table also hands the two
 * name maps to the `json()` column mapping, which is what the `::jsonb` casts used to do.
 */
export async function seedLegacySellingUnits(db: Database): Promise<void> {
  await db.insert(units).values([
    {
      seedKey: "each",
      name: { en: "each", fr: "unité" },
      abbreviation: { en: "ea", fr: "u" },
      precision: 0,
      hardwareUnit: null,
    },
    {
      seedKey: "kg",
      name: { en: "kg", fr: "kg" },
      abbreviation: { en: "kg", fr: "kg" },
      precision: 3,
      hardwareUnit: "kg",
    },
  ]);
}

/**
 * Three rows written through their tables, for the reason {@link seedLegacySellingUnits} gives:
 * each carries an `id` a `$defaultFn` supplies. `invoiceLocales` also reaches its column's own
 * mapping, which stores the list as JSON text — the `array['en-GB']` constructor it replaces is not
 * SQL this engine has.
 */
export async function seedVenue(db: Database): Promise<SeededVenue> {
  await seedTenant(db);
  const [loc] = await db
    .insert(locations)
    .values({ name: "Main", invoiceLocales: ["en-GB"], operationDescription: "Test op" })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Till 1" })
    .returning({ id: tills.id });
  const tillId = brandTillId(till!.id);
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  const seriesId = brandSeriesId(series!.id);
  return { locationId, tillId, nodeId, seriesId };
}

export interface SeededCatalogue {
  catalogueId: string;
  categoryIds: { food: string; drinks: string };
  /** The `each`-priced product and the `weight`-priced product, keyed by pricing unit. */
  productIds: { each: string; weight: string };
}

export async function seedCatalogueFixture(
  tx: Transaction,
  venue: { locationId: string },
): Promise<SeededCatalogue> {
  const catalogue = await createCatalogue(tx, { name: "Deli" });
  const food = await createCategory(tx, { name: { en: "Food" } });
  const drinks = await createCategory(tx, { name: { en: "Drinks" } });
  const eachUnitId = (
    await createUnit(tx, { name: { en: "each" }, precision: 0, abbreviation: { en: "ea" } }, "en")
  ).id;
  const kgUnitId = (
    await createUnit(tx, { name: { en: "kg" }, precision: 3, abbreviation: { en: "kg" } }, "en")
  ).id;
  const slicedHam = await createProduct(tx, {
    catalogueId: catalogue.id,
    categoryId: food.id,
    name: "sliced ham",
    unitId: kgUnitId,
    unitPrice: "24.90",
    vatClass: "reduced",
  });
  const water = await createProduct(tx, {
    catalogueId: catalogue.id,
    categoryId: drinks.id,
    name: "water",
    unitId: eachUnitId,
    unitPrice: "1.50",
    vatClass: "general",
  });
  await assignCatalogueToLocation(tx, venue.locationId, catalogue.id);
  return {
    catalogueId: catalogue.id,
    categoryIds: { food: food.id, drinks: drinks.id },
    productIds: { each: water.id, weight: slicedHam.id },
  };
}

/**
 * The migrated database, emptied between tests.
 *
 * The per-test clean-up this function used to run — nine hand-listed `delete`s and one `update`,
 * inside its own transaction — is gone because `useVenueDb` already empties EVERY data table after
 * each test and puts the append-only triggers back as it found them
 * (`buildResetPlan`/`applyReset`, `packages/db/src/testing/venue-db.ts`). That is strictly more
 * than the list here covered, so no suite loses isolation by its removal; what it does lose is a
 * hand-maintained list that had to learn each new catalogue table.
 */
export function useCatalogueDb(): { readonly db: Database } {
  return useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
}

/** A promise plus the function that settles it. */
function latch(): { waited: Promise<void>; open: () => void } {
  let open!: () => void;
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waited, open };
}

/**
 * Starts two write transactions together and reports how each ended.
 *
 * ## What replaced the lock observation, and the measurement behind it
 *
 * On PostgreSQL the suites that used this shape took TWO connections, held the first transaction
 * open, and polled `pg_blocking_pids` until the second backend was seen waiting on a lock the
 * first held. Neither half of that exists here: SQLite has one write connection per file, no row locks,
 * and no advisory locks. What it has instead is the venue file's write queue —
 * `withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`, and
 * `packages/store/src/write-queue.ts` issues `begin immediate`, awaits the body, then `commit`,
 * so the next caller's `begin` does not run until that `commit` has returned.
 *
 * So the thing to observe moved: not "the second one is BLOCKED", but "the second one has not
 * STARTED". This function observes exactly that, and it is the receipt for every `for update`,
 * `for key share` and `pg_advisory_xact_lock` this package dropped. Measured 2026-09-21 on Node
 * v26.7.0 with a control in the other direction: two bodies started this way report
 * `secondStarted === false` while the first is held, and the SAME two bodies run WITHOUT
 * `withTransaction` report `true`. Both readings came from one probe run back to back, so the
 * `false` is not a probe that could never have printed anything else.
 *
 * The first body is held open until the observation is taken, whether it returned or threw — the
 * `await` sits in a `finally`, so a refusal is delayed rather than swallowed and still arrives as
 * this function's first result.
 */
export async function racePair<A, B>(
  db: Database,
  first: (tx: Transaction) => Promise<A>,
  second: (tx: Transaction) => Promise<B>,
): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  const hold = latch();
  const reached = latch();
  let secondStarted = false;
  const one = withTransaction(db, async (tx) => {
    try {
      return await first(tx);
    } finally {
      reached.open();
      await hold.waited;
    }
  });
  // Started without awaiting `one`. Nothing but the write queue keeps it out.
  const two = withTransaction(db, async (tx) => {
    secondStarted = true;
    return second(tx);
  });
  const settled = Promise.allSettled([one, two]);
  try {
    await reached.waited;
    // A real pause, not a microtask turn: this has to give the second transaction every chance to
    // run a statement it must not run. Without the queue it takes it (measured, above).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondStarted, "the second transaction started while the first was still open").toBe(
      false,
    );
  } finally {
    hold.open();
  }
  const [a, b] = await settled;
  return [a as PromiseSettledResult<A>, b as PromiseSettledResult<B>];
}
