import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  CORE_CHANGE_SOURCES,
  FORM_FACTOR_REFUSAL,
  captureError,
  locations,
  deviceProfiles,
  withTransaction,
  triggerRaised,
} from "@waitron/db";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

describe("canvas retirement on a fresh venue", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

  it("has no canvas table or live change source", async () => {
    const tables = suite.db
      .execute<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .rows.map((row) => row.name);
    expect(tables).not.toContain("canvases");
    expect(CORE_CHANGE_SOURCES.map((source) => source.table)).not.toContain("canvases");
  });

  it("keeps device profiles without a canvas selector", async () => {
    const columns = suite.db
      .execute<{ name: string }>(sql`select name from pragma_table_info('device_profiles')`)
      .rows.map((row) => row.name);
    expect(columns).toEqual([
      "id",
      "name",
      "form_factor",
      "capabilities",
      "inactivity_timeout_seconds",
      "starting_screen",
      "created_at",
      "updated_at",
      "retired_at",
    ]);
  });

  it("refuses changing a held profile's form factor but permits its rename", async () => {
    await seedTenant(suite.db);
    const [location] = await suite.db
      .insert(locations)
      .values({ name: "Retained venue", invoiceLocales: ["en-GB"], operationDescription: "Food" })
      .returning();
    const { profileId } = await seedDevice(suite.db, { locationId: location!.id });
    const refused = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        await tx
          .update(deviceProfiles)
          .set({ formFactor: "phone-portrait" })
          .where(eq(deviceProfiles.id, profileId));
      }),
    );
    expect(triggerRaised(refused, FORM_FACTOR_REFUSAL)).toBe(true);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(deviceProfiles)
        .set({ name: "Renamed counter" })
        .where(eq(deviceProfiles.id, profileId));
    });
    const [profile] = await suite.db
      .select()
      .from(deviceProfiles)
      .where(eq(deviceProfiles.id, profileId));
    expect(profile).toMatchObject({ name: "Renamed counter", formFactor: "till" });
  });
});

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CORE_MIGRATIONS,
  deviceApprovedProfiles,
  deviceProfilePrinters,
  devices,
  installChangeFeed,
  openVenueDatabase,
  type Database,
} from "@waitron/db";
import { deviceProfileAdmissionPersons, deviceProfileAdmissionRoles } from "@waitron/identity";
import { cardReaders, deviceProfileCardReaders } from "@waitron/payments";
import * as service from "@waitron/venue-service";
import { ALL_MODULES } from "./modules.js";
import { applyMigrations } from "@waitron/migrations";
import { provisionOrderVenue, billlessSale } from "./testing/order-venue.js";
import { seatedWith, send } from "./testing/bill-venue.js";

const scratch: string[] = [];
afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

function predecessor(root: string) {
  const core = join(root, "core-prefix");
  cpSync(CORE_MIGRATIONS.migrationsFolder, core, { recursive: true });
  const journalPath = join(core, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const index = journal.entries.findIndex((entry) => entry.tag.endsWith("_retire_canvases"));
  expect(index).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalPath, JSON.stringify(journal));
  return migrationOptionsFor(manifestSets(), null).map((option) =>
    option.migrationsTable === CORE_MIGRATIONS.migrationsTable
      ? { ...option, migrationsFolder: core }
      : option,
  );
}

function predecessorChangeSources(db: Database) {
  const tables = new Set(
    db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map(({ name }) => name),
  );
  return [
    ...ALL_MODULES.flatMap((module) => module.changes ?? []),
    { table: "canvases", type: "canvases" },
  ].filter((source) => tables.has(source.table));
}

function report(name: string, data: unknown): void {
  const directory = process.env.WAITRON_CANVAS_UPGRADE_RECEIPTS;
  if (directory === undefined) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.json`), JSON.stringify(data, null, 2));
}

function reportedError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    ...("code" in error ? { code: error.code } : {}),
    ...("errcode" in error ? { errcode: error.errcode } : {}),
    ...("cause" in error ? { cause: reportedError(error.cause) } : {}),
  };
}

function snapshot(db: Database): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const { name } of db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  )) {
    result[name] = db
      .all(sql`select * from ${sql.identifier(name)}`)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return result;
}

async function populatePredecessor(db: Database) {
  const venue = await provisionOrderVenue(db);
  const saleId = await billlessSale(venue);
  const party = await seatedWith(venue, "Tarta");
  const draft = await send(venue.app, venue.cookie, "PUT", `/api/parties/${party.partyId}/drafts`, {
    draftId: null,
    revision: 0,
    lines: [{ menuItemId: venue.offerFor("Croquetas"), quantity: "1", note: "Draft only" }],
  });
  expect(draft.status).toBe(200);
  const profileId = randomUUID();
  const retiredId = randomUUID();
  const canvasId = randomUUID();
  await withTransaction(db, async (tx) => {
    await tx.execute(
      sql`insert into canvases (id, name, definition, created_at, updated_at) values (${canvasId}, 'Retired designer', '{}', '2026-10-16T10:00:00Z', '2026-10-16T10:00:00Z')`,
    );
    await tx.insert(deviceProfiles).values([
      {
        id: profileId,
        name: "Assigned live profile",
        formFactor: "till",
        capabilities: ["take-orders", "show-station"],
      },
      {
        id: retiredId,
        name: "Assigned retired profile",
        formFactor: "till",
        retiredAt: "2026-10-16T10:00:00Z",
      },
      { name: "Unassigned live profile", formFactor: "phone-portrait" },
    ]);
    await tx.execute(
      sql`update device_profiles set canvas_id = ${canvasId} where id in (${profileId}, ${retiredId})`,
    );
    await tx.insert(devices).values([
      {
        locationId: venue.cfg.locationId,
        deviceProfileId: profileId,
        label: "Active assigned device",
        tokenHash: "fixture-active",
      },
      {
        locationId: venue.cfg.locationId,
        deviceProfileId: profileId,
        label: "Disabled assigned device",
        tokenHash: "fixture-disabled",
        active: false,
      },
      {
        locationId: venue.cfg.locationId,
        deviceProfileId: retiredId,
        label: "Retired holder",
        tokenHash: "fixture-retired",
        active: false,
      },
    ]);
    await tx
      .insert(deviceApprovedProfiles)
      .values({ deviceId: venue.deviceId, deviceProfileId: profileId });
    await tx
      .insert(deviceProfileAdmissionRoles)
      .values({ deviceProfileId: profileId, role: "staff" });
    await tx
      .insert(deviceProfileAdmissionPersons)
      .values({ deviceProfileId: profileId, personId: venue.operatorId, admitted: false });
    await tx.insert(deviceProfilePrinters).values({
      deviceProfileId: profileId,
      printerId: venue.printerId,
      role: "receipt",
      position: 0,
      isDefault: true,
    });
    const [reader] = await tx.select({ id: cardReaders.id }).from(cardReaders);
    await tx
      .insert(deviceProfileCardReaders)
      .values({ deviceProfileId: profileId, readerId: reader!.id, position: 0, isDefault: true });
    const [access] = await tx.select().from(service.deviceProfileServiceAccess);
    await tx.insert(service.deviceProfileServiceAccess).values({
      deviceProfileId: profileId,
      departmentId: access!.departmentId,
      startingZoneId: access!.startingZoneId,
      everyZone: false,
    });
    await tx
      .insert(service.deviceProfileZones)
      .values({ deviceProfileId: profileId, zoneId: access!.startingZoneId });
    await tx
      .insert(service.departmentTransferDesks)
      .values({ departmentId: access!.departmentId, receivingProfileId: profileId });
    const [station] = tx.all<{ id: string }>(
      sql`select id from kitchen_stations order by id limit 1`,
    );
    await tx.insert(service.deviceProfileKitchenScreens).values({
      deviceProfileId: profileId,
      screen: "pass",
      everyStation: false,
      everyZone: false,
    });
    await tx
      .insert(service.deviceProfileKitchenScreenStations)
      .values({ deviceProfileId: profileId, screen: "pass", stationId: station!.id });
    await tx
      .insert(service.deviceProfileKitchenScreenZones)
      .values({ deviceProfileId: profileId, screen: "pass", zoneId: access!.startingZoneId });
    await service.writeKitchenNote(tx, { partyId: party.partyId }, 0, "Together at 14:00");
  });
  expect(db.all(sql`select * from registros_facturacion where sale_id = ${saleId}`)).toHaveLength(
    1,
  );
}

it("refuses the populated predecessor for reset and retains every row after rollback", async () => {
  const root = mkdtempSync(join(tmpdir(), "waitron-retire-canvases-"));
  scratch.push(root);
  const venue = join(root, "venue");
  await applyMigrations(venue, predecessor(root));
  let before: Record<string, unknown[]>;
  const opened = await openVenueDatabase(venue);
  try {
    await populatePredecessor(opened.venue);
    const incoming = opened.venue.all<{
      child: string;
      column: string;
      parent: string;
      on_delete: string;
    }>(
      sql`select m.name as child, f."from" as column, f."table" as parent, f.on_delete from sqlite_master m join pragma_foreign_key_list(m.name) f where m.type = 'table' and (f."table" in ('canvases', 'device_profiles', 'device_profile_service_access', 'device_profile_kitchen_screens')) order by parent, child, column`,
    );
    report("populated-inventory", {
      node: process.version,
      sqlite: opened.venue.all(sql`select sqlite_version() as version`),
      incoming,
      triggers: opened.venue.all(
        sql`select name, tbl_name, sql from sqlite_master where type = 'trigger' and (sql like '%device_profiles%' or sql like '%canvases%') order by name`,
      ),
    });
    for (const { child } of incoming)
      expect(
        opened.venue.all(sql`select * from ${sql.identifier(child)}`).length,
        child,
      ).toBeGreaterThan(0);
    await installChangeFeed(opened.venue, predecessorChangeSources(opened.venue));
    before = snapshot(opened.venue);
    expect(before.order_drafts!.length).toBeGreaterThan(0);
    expect(before.order_kitchen_notes!.length).toBeGreaterThan(0);
    expect(before.cadenas!.length).toBeGreaterThan(0);
  } finally {
    await opened.close();
  }
  const failure = await applyMigrations(venue, migrationOptionsFor(manifestSets(), null)).then(
    () => undefined,
    (error: unknown) => error,
  );
  const after = await openVenueDatabase(venue);
  try {
    expect(after.venue.all(sql`pragma foreign_key_check`)).toEqual([]);
    expect(after.venue.all(sql`pragma integrity_check`)).toEqual([{ integrity_check: "ok" }]);
    const actual = snapshot(after.venue);
    report("populated-outcome", {
      failure: reportedError(failure),
      before: before!,
      after: actual,
    });
    expect(actual).toEqual(before!);
    expect(failure).toMatchObject({
      code: "migrations.apply_failed",
      params: { set: CORE_MIGRATIONS.migrationsTable },
      cause: {
        message: expect.stringContaining("DROP TABLE `device_profiles`"),
        cause: { errcode: 1811, message: "FOREIGN KEY constraint failed" },
      },
    });
  } finally {
    await after.close();
  }
});

it("records the no-holder admission-rule loss and retains every other surviving value", async () => {
  const root = mkdtempSync(join(tmpdir(), "waitron-retire-canvases-control-"));
  scratch.push(root);
  const venue = join(root, "venue");
  await applyMigrations(venue, predecessor(root));
  const first = await openVenueDatabase(venue);
  let before: Record<string, unknown[]>;
  try {
    await seedTenant(first.venue);
    const [profile] = await first.venue
      .insert(deviceProfiles)
      .values({ name: "No holder", formFactor: "till" })
      .returning();
    await first.venue
      .insert(deviceProfileAdmissionRoles)
      .values({ deviceProfileId: profile!.id, role: "staff" });
    await installChangeFeed(first.venue, predecessorChangeSources(first.venue));
    before = snapshot(first.venue);
  } finally {
    await first.close();
  }
  await applyMigrations(venue, migrationOptionsFor(manifestSets(), null));
  const after = await openVenueDatabase(venue);
  try {
    const actual = snapshot(after.venue);
    report("no-holder-outcome", { before: before!, after: actual });
    expect(before!.device_profile_admission_roles).toHaveLength(1);
    expect(actual.device_profile_admission_roles).toEqual([]);
    const journal = CORE_MIGRATIONS.migrationsTable;
    const oldJournal = before![journal]! as { created_at: number }[];
    const oldTimes = new Set(oldJournal.map((row) => row.created_at));
    const newJournal = actual[journal]! as { created_at: number }[];
    expect(newJournal).toHaveLength(oldJournal.length + 6);
    expect(newJournal.filter((row) => oldTimes.has(row.created_at))).toEqual(oldJournal);
    const retained: Record<string, unknown[]> = {
      ...before!,
      [journal]: newJournal,
      device_profile_admission_roles: [],
      tender_refunds: [],
    };
    delete retained.canvases;
    retained.device_profiles = before!.device_profiles!.map((row) =>
      Object.fromEntries(
        Object.entries(row as Record<string, unknown>).filter(([key]) => key !== "canvas_id"),
      ),
    );
    expect(actual).toEqual(retained);
    expect(after.venue.all(sql`pragma foreign_key_check`)).toEqual([]);
    expect(after.venue.all(sql`pragma integrity_check`)).toEqual([{ integrity_check: "ok" }]);
  } finally {
    await after.close();
  }
});
