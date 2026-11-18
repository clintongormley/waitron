import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { checkFailed } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedDeviceProfiles, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { isRefusal } from "../unique-violation.js";
import { newId } from "./columns.js";

const heldAt = "2026-11-18T10:00:00.000Z";

describe("printer row constraints", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let deviceId: string;

  beforeEach(async () => {
    await seedVenue(suite.db, { name: "Venue", invoiceLocales: ["es"] });
    const [profile] = await seedDeviceProfiles(suite.db, { name: "Till", formFactor: "till" });
    ({ deviceId } = await seedDevice(suite.db, { profileId: profile!.id, label: "Till A" }));
  });

  async function insertPrinter({
    holder = null,
    time = null,
    portable = 1,
  }: { holder?: string | null; time?: string | null; portable?: number } = {}) {
    const id = newId();
    await withTransaction(suite.db, async (tx) => {
      tx.run(sql`insert into printers (id, name, transport, host, portable, held_by_device_id, held_at)
        values (${id}, 'Printer', 'network_tcp', '10.0.0.5', ${portable}, ${holder}, ${time})`);
    });
    return id;
  }

  it.each(["device", "time"])("refuses a holder with only the %s set", async (part) => {
    const error = await captureError(() =>
      insertPrinter(part === "device" ? { holder: deviceId } : { time: heldAt }),
    );
    expect(checkFailed(error, "printers_held_pair_ck")).toBe(true);
  });

  it("refuses a holder on a fixed printer", async () => {
    const error = await captureError(() =>
      insertPrinter({ holder: deviceId, time: heldAt, portable: 0 }),
    );
    expect(checkFailed(error, "printers_held_portable_ck")).toBe(true);
  });

  it("lets one device hold two portable printers", async () => {
    const first = await insertPrinter({ holder: deviceId, time: heldAt });
    const second = await insertPrinter({ holder: deviceId, time: heldAt });
    expect(
      suite.db.all(sql`select id, held_by_device_id, held_at from printers order by id`),
    ).toEqual(
      [first, second].sort().map((id) => ({ id, held_by_device_id: deviceId, held_at: heldAt })),
    );
  });

  it("refuses marking an active printer deleted until it is switched off", async () => {
    const id = newId();
    await withTransaction(suite.db, async (tx) => {
      tx.run(sql`insert into printers (id, name, transport, host)
        values (${id}, 'Printer', 'network_tcp', '10.0.0.5')`);
    });
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        tx.run(sql`update printers set deleted_at = ${heldAt} where id = ${id}`);
      }),
    );
    expect(checkFailed(error, "printers_deleted_ck")).toBe(true);
    await withTransaction(suite.db, async (tx) => {
      tx.run(sql`update printers set active = 0, deleted_at = ${heldAt} where id = ${id}`);
    });
    expect(suite.db.get(sql`select active, deleted_at from printers where id = ${id}`)).toEqual({
      active: 0,
      deleted_at: heldAt,
    });
  });

  it("defaults to picking up receipts and payment slips", async () => {
    const id = newId();
    await withTransaction(suite.db, async (tx) => {
      tx.run(sql`insert into printers (id, name, transport, host)
        values (${id}, 'Printer', 'network_tcp', '10.0.0.5')`);
    });
    expect(
      suite.db.get(
        sql`select picks_up_receipts, picks_up_payment_slips from printers where id = ${id}`,
      ),
    ).toEqual({ picks_up_receipts: 1, picks_up_payment_slips: 1 });
  });

  it("refuses deleting a device while it holds a printer", async () => {
    const id = await insertPrinter({ holder: deviceId, time: heldAt });
    const deleteDevice = () =>
      withTransaction(suite.db, async (tx) => {
        tx.run(sql`delete from devices where id = ${deviceId}`);
      });
    expect(isRefusal(await captureError(deleteDevice), FOREIGN_KEY_VIOLATION)).toBe(true);
    await withTransaction(suite.db, async (tx) => {
      tx.run(sql`update printers set held_by_device_id = null, held_at = null where id = ${id}`);
    });
    await deleteDevice();
    expect(suite.db.get(sql`select id from devices where id = ${deviceId}`)).toBeUndefined();
  });
});
