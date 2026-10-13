import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { installChangeFeed, locations, printers, runMigrations } from "@waitron/db";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

const options = migrationOptionsFor(manifestSets(), null);
const core = options.find((set) => set.migrationsFolder.endsWith("/db/drizzle"))!;
const journal = JSON.parse(
  readFileSync(join(core.migrationsFolder, "meta/_journal.json"), "utf8"),
) as {
  entries: { tag: string }[];
};
const index = journal.entries.findIndex((entry) => entry.tag === "0149_steep_deathbird");
if (index < 0) throw new Error("pick-up migration is missing");
let previousFolder: string | undefined;
afterAll(() => {
  if (previousFolder) rmSync(previousFolder, { recursive: true, force: true });
});
try {
  previousFolder = mkdtempSync(join(tmpdir(), "waitron-pickup-upgrade-"));
  cpSync(core.migrationsFolder, previousFolder, { recursive: true });
  writeFileSync(
    join(previousFolder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }),
  );
} catch (error) {
  if (previousFolder) rmSync(previousFolder, { recursive: true, force: true });
  throw error;
}
const suite = useVenueDb({
  migrations: options.map((set) =>
    set === core ? { ...set, migrationsFolder: previousFolder! } : set,
  ),
});

it("upgrades populated printers without changing their settings, holder or device choices", async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Restaurant" })
    .returning({ id: locations.id });
  const device = await seedDevice(suite.db, { locationId: location!.id });
  const printerId = randomUUID();
  await suite.db.execute(
    sql`insert into printers (id, location_id, name, transport, host, portable, paper_width, resolution) values (${printerId}, ${location!.id}, 'Portable', 'network_tcp', '10.0.0.9', 1, '58mm', '203dpi')`,
  );
  await suite.db.execute(
    sql`update devices set receipt_printer_id = ${printerId}, payment_slip_printer_id = ${printerId} where id = ${device.deviceId}`,
  );
  await suite.db.execute(
    sql`insert into printer_holders (printer_id, device_id, held_at) values (${printerId}, ${device.deviceId}, '2026-10-12T12:00:00.000Z')`,
  );
  const beforePrinters = suite.db.all<Record<string, unknown>>(
    sql`select * from printers order by id`,
  );
  const beforeHolders = suite.db.all(sql`select * from printer_holders order by printer_id`);
  const beforeDevices = suite.db.all(sql`select * from devices order by id`);
  await installChangeFeed(suite.db, [{ table: "printers", type: "printer" }]);
  await runMigrations(suite.db, core);
  const after = suite.db.all<Record<string, unknown>>(sql`select * from printers order by id`);
  expect(
    after.map(({ pickup_roles, ...row }) => {
      expect(JSON.parse(pickup_roles as string)).toEqual(["receipt", "payment_slip"]);
      return row;
    }),
  ).toEqual(beforePrinters);
  expect(suite.db.all(sql`select * from printer_holders order by printer_id`)).toEqual(
    beforeHolders,
  );
  expect(suite.db.all(sql`select * from devices order by id`)).toEqual(beforeDevices);
  await installChangeFeed(suite.db, [{ table: "printers", type: "printer" }]);
  await suite.db
    .update(printers)
    .set({ pickupRoles: ["payment_slip"] })
    .where(eq(printers.id, printerId));
  expect(
    (
      await suite.db
        .select({ pickupRoles: printers.pickupRoles })
        .from(printers)
        .where(eq(printers.id, printerId))
    )[0]!.pickupRoles,
  ).toEqual(["payment_slip"]);
});
