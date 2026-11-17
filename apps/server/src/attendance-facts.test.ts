import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { beforeEach, describe, expect, it } from "vitest";

import { CORE_MIGRATIONS, newId, parties, withTransaction, type Transaction } from "@waitron/db";
import { seedDevice, seedNode, seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registerModulePermissions } from "@waitron/identity";

import {
  WORKFORCE_MIGRATIONS,
  WORKFORCE_PERMISSIONS,
  rosterVersions,
  shifts,
  requestSwap,
  acceptSwap,
  decideSwap,
  type AttendanceDay,
} from "@waitron/workforce";

registerModulePermissions(WORKFORCE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);

let anna: string, beth: string, carol: string, david: string;
let nodeId: string, orderId: string, partyId: string;
const day = (): AttendanceDay => ({
  businessDay: "2026-01-05",
  startAt: "2026-01-05T03:00:00.000Z",
  endAt: "2026-01-06T03:00:00.000Z",
});

async function planned(scope = day()) {
  const { readPlannedAttendanceShifts } = await import("./attendance-facts.js");
  return run((tx) => readPlannedAttendanceShifts(tx, scope));
}

beforeEach(async () => {
  await seedVenue(suite.db, {
    name: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "04:00",
    invoiceLocales: ["es"],
  });
  nodeId = await seedNode(suite.db);
  await seedDevice(suite.db);
  const people = await seedPersons(
    suite.db,
    ["Anna", "Beth", "Carol", "David"].map((displayName) => ({
      displayName,
      pinHash: "scrypt$00$00",
      role: "admin" as const,
    })),
  );
  [anna, beth, carol, david] = people.map((r) => r.id) as [string, string, string, string];
  partyId = newId();
  orderId = newId();
  await suite.db.insert(parties).values({ id: partyId, openedBy: david });
  await seedWorkingOrder(suite.db, {
    id: orderId,
    source: "dashboard",
    nodeId,
    orderNumber: 1,
    partyId,
  });
});

describe("planned attendance shifts", () => {
  async function version(status: "draft" | "published" | "superseded") {
    const id = newId();
    await suite.db.insert(rosterVersions).values({
      id,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      status,
      publishedAt: status === "draft" ? null : "2026-01-04T12:00:00Z",
    });
    return id;
  }
  async function shift(rosterVersionId: string, startsAt: string, endsAt: string) {
    const id = newId();
    await suite.db.insert(shifts).values({
      id,
      personId: anna,
      startsAt,
      endsAt,
      startsOffsetMinutes: 60,
      endsOffsetMinutes: 60,
      rosterVersionId,
    });
    return id;
  }
  it("returns only current published shifts by start-day, retaining split and spillover ends", async () => {
    const published = await version("published");
    const first = await shift(published, "2026-01-05T03:00:00.000Z", "2026-01-05T11:00:00.000Z");
    const second = await shift(published, "2026-01-05T17:00:00.000Z", "2026-01-06T04:00:00.000Z");
    await shift(await version("draft"), "2026-01-05T09:00:00.000Z", "2026-01-05T10:00:00.000Z");
    await shift(
      await version("superseded"),
      "2026-01-05T09:00:00.000Z",
      "2026-01-05T10:00:00.000Z",
    );
    await shift(published, "2026-01-06T03:00:00.000Z", "2026-01-06T04:00:00.000Z");
    await shift(published, "2026-01-04T20:00:00.000Z", "2026-01-05T04:00:00.000Z");
    expect(await planned()).toEqual([
      {
        id: first,
        personId: anna,
        startsAt: "2026-01-05T03:00:00.000Z",
        endsAt: "2026-01-05T11:00:00.000Z",
        rosterVersionId: published,
      },
      {
        id: second,
        personId: anna,
        startsAt: "2026-01-05T17:00:00.000Z",
        endsAt: "2026-01-06T04:00:00.000Z",
        rosterVersionId: published,
      },
    ]);
  });
  it("swap approval does not pretend to reassign the source shift", async () => {
    const published = await version("published");
    const id = await shift(published, "2026-01-05T09:00:00.000Z", "2026-01-05T17:00:00.000Z");
    const swap = await run((tx) =>
      requestSwap(tx, {
        requestedByPersonId: anna,
        fromShiftId: id,
        toPersonId: beth,
        toShiftId: null,
      }),
    );
    await run((tx) => acceptSwap(tx, { swapId: swap, acceptingPersonId: beth }));
    await run((tx) =>
      decideSwap(tx, { swapId: swap, decision: "approved", decidedByPersonId: carol }),
    );
    expect((await planned()).map((s) => [s.id, s.personId])).toEqual([[id, anna]]);
  });
});
