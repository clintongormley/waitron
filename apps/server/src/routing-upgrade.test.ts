import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { setProductVariants } from "@waitron/catalogue";
import {
  installChangeFeed,
  openVenueDatabase,
  subscribeToChanges,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import {
  applyMigrations,
  manifestSets,
  migrationOptionsFor,
  type MigrationSet,
} from "@waitron/migrations";
import type { ChangeSource } from "@waitron/shared";
import { setRoutingCell, setStationFallback } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { inTx } from "./testing/bill-venue.js";
import { billlessSale, parked, provisionOrderVenue } from "./testing/order-venue.js";

/** `git merge-base origin/main HEAD` when the routing grid's two migrations were written. */
const BASE = "3158e038d6a06a55a41d3971144e9e62328a7849";
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const RETIRED = ["station_claims", "route_exceptions"];

let scratch: string | undefined;
let store: VenueDatabase | undefined;
afterAll(async () => {
  if (store !== undefined) await store.close();
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});

function archivedSets(root: string): { sets: MigrationSet[]; folders: string } {
  const archive = join(root, "archive");
  const tarball = join(root, "base.tar");
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  // BASE must be reachable: CI's server shards check out with `fetch-depth: 0`.
  execFileSync(
    "git",
    [
      "archive",
      "--format=tar",
      `--output=${tarball}`,
      BASE,
      "--",
      // A plain `packages/*/drizzle` pathspec selected no drizzle folder here; glob magic does.
      ":(glob)packages/*/drizzle/**",
      "packages/migrations/migrations.manifest.json",
    ],
    { cwd: REPO, env },
  );
  execFileSync("mkdir", ["-p", archive]);
  execFileSync("tar", ["-xf", tarball, "-C", archive]);
  const manifestDir = join(archive, "packages", "migrations");
  const sets = JSON.parse(
    readFileSync(join(manifestDir, "migrations.manifest.json"), "utf8"),
  ) as MigrationSet[];
  const folders = join(root, "sets");
  for (const set of sets) {
    const from = join(manifestDir, set.from);
    expect(existsSync(join(from, "meta", "_journal.json")), set.name).toBe(true);
    cpSync(from, join(folders, set.name), { recursive: true });
  }
  return { sets, folders };
}

const SKIPPED = (name: string) =>
  name === "change_log" || name.startsWith("__drizzle_migrations") || RETIRED.includes(name);

function tableNames(db: Database): string[] {
  return db
    .all<{ name: string }>(
      sql`select name from sqlite_schema where type = 'table' and name not glob 'sqlite_*' order by name`,
    )
    .map(({ name }) => name);
}

function rowsOf(db: Database): Record<string, unknown[]> {
  const rows: Record<string, unknown[]> = {};
  for (const name of tableNames(db).filter((table) => !SKIPPED(table)))
    rows[name] = db.all(sql`select * from ${sql.identifier(name)} order by rowid`);
  return rows;
}

function migrationsApplied(db: Database): number {
  return tableNames(db)
    .filter((name) => name.startsWith("__drizzle_migrations"))
    .reduce(
      (sum, name) =>
        sum + db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(name)}`)[0]!.n,
      0,
    );
}

function productTriggers(db: Database): { name: string; table: string }[] {
  return db.all<{ name: string; table: string }>(sql`
    select name, tbl_name as "table" from sqlite_schema
    where type = 'trigger' and name not glob 'waitron_change_*' order by name`);
}

function changeSources(db: Database, base: boolean): ChangeSource[] {
  const present = new Set(tableNames(db));
  // The base build declared the two retired lists where today's declares `routing_cells`.
  return ALL_MODULES.flatMap((module) => module.changes ?? [])
    .flatMap((source) =>
      base && source.table === "routing_cells"
        ? RETIRED.map((table) => ({ ...source, table }))
        : [source],
    )
    .filter((source) => present.has(source.table));
}

it("upgrades a populated base venue: old routing is gone, cells start empty, every unrelated row is unchanged", async () => {
  scratch = mkdtempSync(join(tmpdir(), "waitron-routing-upgrade-"));
  const venueDir = join(scratch, "venue");
  const base = archivedSets(scratch);
  expect(base.sets.map((set) => set.name)).toEqual(manifestSets().map((set) => set.name));
  await applyMigrations(venueDir, migrationOptionsFor(base.sets, base.folders));

  store = await openVenueDatabase(venueDir);
  const db = store.venue;
  expect(tableNames(db)).toEqual(expect.arrayContaining(RETIRED));
  expect(tableNames(db)).not.toContain("routing_cells");

  const venue = await provisionOrderVenue(db);
  await parked(venue, "Paella", "Caña");
  await billlessSale(venue);
  const seeded = await inTx(venue, async (tx) => {
    const grill = (await createStation(tx, venue.cfg, { name: "Grill" })).id;
    const bar = (
      await createStation(tx, venue.cfg, { name: "Bar", thresholds: { warmAfterMinutes: 4 } })
    ).id;
    await setStationFallback(tx, venue.cfg, grill, bar);
    const [paella] = tx.all<{ id: string; category_id: string }>(
      sql`select id, category_id from products where name = 'Paella'`,
    );
    await setProductVariants(
      tx,
      paella!.id,
      [
        {
          name: "Media ración",
          customerName: { es: "Media paella" },
          kitchenName: "MEDIA",
          image: null,
          unitPrice: "20.00",
          available: true,
        },
      ],
      "es",
    );
    return { grill, bar, paella: paella!.id, category: paella!.category_id };
  });
  const location = venue.cfg.locationId;
  db.run(sql`insert into station_claims (id, location_id, category_id, station_id, no_preparation)
      values (${randomUUID()}, ${location}, ${seeded.category}, ${seeded.grill}, 0)`);
  db.run(sql`insert into route_exceptions
      (id, location_id, position, zone_id, category_id, product_id, station_id, no_preparation)
      values (${randomUUID()}, ${location}, 0, ${venue.zoneId}, null, ${seeded.paella}, null, 1)`);
  await installChangeFeed(db, changeSources(db, true));

  const before = rowsOf(db);
  const migratedBefore = migrationsApplied(db);
  const triggersBefore = productTriggers(db);
  expect(before.station_fallbacks).toHaveLength(1);
  expect(before.kitchen_station_timing?.length).toBeGreaterThan(0);
  expect(before.products).toContainEqual(expect.objectContaining({ name: "Media ración" }));
  expect(before.working_order_lines?.length).toBeGreaterThan(0);
  expect(before.registros_facturacion?.length).toBeGreaterThan(0);
  expect(
    triggersBefore.filter((trigger) => trigger.table === "registros_facturacion").length,
  ).toBeGreaterThan(0);
  await store.close();
  store = undefined;

  await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));
  store = await openVenueDatabase(venueDir);
  const after = store.venue;
  await installChangeFeed(after, changeSources(after, false));

  expect(migrationsApplied(after) - migratedBefore).toBe(2);
  expect(tableNames(after).filter((name) => RETIRED.includes(name))).toEqual([]);
  expect(after.all(sql`select * from routing_cells`)).toEqual([]);
  expect(rowsOf(after)).toEqual({ ...before, routing_cells: [] });
  expect(after.all(sql`pragma foreign_key_check`)).toEqual([]);
  expect(productTriggers(after)).toEqual(
    triggersBefore.filter((trigger) => !RETIRED.includes(trigger.table)),
  );

  const announced = new Set<string>();
  const unsubscribe = subscribeToChanges((change) => {
    for (const resource of change.resources) announced.add(resource.type);
  });
  try {
    await inTx({ ...venue, db: after }, (tx) =>
      setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "category", categoryId: seeded.category }, zoneId: null },
        { kind: "station", stationId: seeded.bar },
      ),
    );
  } finally {
    unsubscribe();
  }
  expect(after.all(sql`select category_id, station_id from routing_cells`)).toEqual([
    { category_id: seeded.category, station_id: seeded.bar },
  ]);
  expect([...announced]).toContain("routing_cells");
}, 120_000);
