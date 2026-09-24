import { expect } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  products,
  tills,
  withTransaction,
} from "@waitron/db";
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
import { productUnits, units } from "../src/schema/units.js";

/** The unit a product's OWN `product_units` row names, or null when it has none (a
 * top-level product then reads as Each; a variant reads its parent's unit).
 * Throws when no such product exists, so a null always means "no unit row", never "wrong id". */
export async function storedUnitId(tx: Transaction, productId: string): Promise<string | null> {
  const [row] = await tx
    .select({ unitId: productUnits.unitId })
    .from(products)
    .leftJoin(productUnits, eq(productUnits.productId, products.id))
    .where(eq(products.id, productId));
  if (row === undefined) throw new Error(`storedUnitId: no product with id ${productId}`);
  return row.unitId;
}

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
 * `$defaultFn` in JavaScript and not by a SQL default.
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

/** Three rows written through their tables, for the reason {@link seedLegacySellingUnits} gives. */
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

/** The migrated database, emptied between tests by `useVenueDb`. */
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
 * `withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`, and
 * `packages/store/src/write-queue.ts` issues `begin immediate`, awaits the body, then `commit`,
 * so the next caller's `begin` does not run until that `commit` has returned. The thing to observe
 * is therefore "the second one has not STARTED". Measured 2026-09-21 on Node v26.7.0 with a control
 * in the other direction: two bodies started this way report `secondStarted === false` while the
 * first is held, and the SAME two bodies run WITHOUT `withTransaction` report `true`. Both readings
 * came from one probe run back to back.
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
    // run a statement it must not run.
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
