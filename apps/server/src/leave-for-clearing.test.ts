import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { captureError, diningTables, floorTodayTables, floorZones } from "@waitron/db";
import { createDepartment, createServiceZone, departments } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { leaveForClearing, markTableCleared } from "./parties.js";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import {
  floorRow,
  inTx,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("leaveForClearing", () => {
  let v: PartyVenue;
  const at = "2026-10-19T20:00:00.000Z";

  beforeEach(async () => {
    v = await setupPartyVenue(suite.db);
  });

  async function secondDepartment(): Promise<{ departmentId: string; zoneId: string }> {
    return inTx(v, async (tx) => {
      const department = await createDepartment(tx, v.cfg, {
        name: `Terraza ${randomUUID()}`,
        orderStart: "table",
      });
      const zone = await createServiceZone(tx, v.cfg, {
        name: `Zona ${randomUUID()}`,
        departmentId: department.id,
      });
      return { departmentId: department.id, zoneId: zone.id };
    });
  }

  async function tableInZoneWithoutDepartment(): Promise<string> {
    const zoneId = randomUUID();
    const tableId = randomUUID();
    await inTx(v, async (tx) => {
      await tx
        .insert(floorZones)
        .values({ id: zoneId, locationId: v.cfg.locationId, name: `Sin departamento ${zoneId}` });
      await tx
        .insert(diningTables)
        .values({ id: tableId, locationId: v.cfg.locationId, label: "Mesa sin", zoneId });
      await tx.insert(floorTodayTables).values({ tableId });
    });
    return tableId;
  }

  async function switchDepartment(departmentId: string, on: boolean): Promise<void> {
    await inTx(v, (tx) =>
      tx.update(departments).set({ needsClearing: on }).where(eq(departments.id, departmentId)),
    );
  }

  it("leaves each table as its own department says when a party spans two", async () => {
    const other = await secondDepartment();
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));
    await switchDepartment(other.departmentId, false);
    const a = await v.table("Mesa A");
    const b = await v.table("Mesa B", other.zoneId);

    await inTx(v, (tx) => leaveForClearing(tx, [a, b], at));

    expect((await tableRow(v, a)).needsClearingSince).toBe(at);
    expect((await tableRow(v, b)).needsClearingSince).toBeNull();
  });

  it("leaves a table whose zone has no department free, even with every department on", async () => {
    const loose = await tableInZoneWithoutDepartment();
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));

    await inTx(v, (tx) => leaveForClearing(tx, [loose], at));

    expect((await tableRow(v, loose)).needsClearingSince).toBeNull();
  });

  it("asks venue-service once for all the leaving tables", async () => {
    const other = await secondDepartment();
    const a = await v.table("Mesa A");
    const b = await v.table("Mesa B", other.zoneId);
    const c = await tableInZoneWithoutDepartment();
    const asked = vi.spyOn(VENUE_SERVICE, "readTablesNeedingClearing");
    try {
      await inTx(v, (tx) => leaveForClearing(tx, [a, b, c], at));
      expect(asked).toHaveBeenCalledTimes(1);
      expect(asked.mock.calls[0]![1]).toEqual([a, b, c]);
    } finally {
      asked.mockRestore();
    }
  });

  it("keeps a table marked after its department is switched off, until Mark cleared", async () => {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));
    const a = await v.table("Mesa A");

    await inTx(v, (tx) => leaveForClearing(tx, [a], at));
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));

    expect((await floorRow(v, a)).condition).toBe("needs_clearing");
    expect(await captureError(() => seat(v, a))).toMatchObject({
      code: "table.needs_clearing",
      params: { tableId: a },
    });
    await inTx(v, (tx) => markTableCleared(tx, a));
    expect((await floorRow(v, a)).condition).toBe("free");
  });
});
