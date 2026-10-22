import crypto, { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { devices, parties } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createServiceZone,
  listDepartments,
  setProfileServiceAccess,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { mergeBills, splitBill } from "./bill-actions.js";
import { VENUE_SERVICE } from "./modules.js";
import { seatTable } from "./parties.js";
import { markServed } from "./working-order.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import { createTable } from "./testing/live-table.js";
import { createZone } from "./testing/service-zone.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  rowsOf,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

let venue: AdjustmentVenue;
let elsewhere: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    elsewhere = (
      await inTx(venue, (tx) => createZone(tx, venue.cfg, { name: `Terrace-${randomUUID()}` }))
    ).id;
  },
});

async function revisionOf(partyId: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  return party!.revision;
}

/** A fired bill at a fresh table in the tables zone, every dish served. */
async function servedParty() {
  const p = await billWith(venue, [{ name: "Burger", quantity: "2" }, { name: "Water" }], {
    release: "fire",
  });
  const lines = await rowsOf(venue, p.billId);
  await inTx(venue, async (tx) =>
    markServed(
      tx,
      venue.cfg,
      p.partyId,
      lines.map((line) => ({ lineId: line.id, quantity: line.quantity })),
      {
        expectedPartyRevision: await revisionOf(p.partyId),
        operatorId: venue.staffId,
        submissionId: randomUUID(),
      },
    ),
  );
  return { ...p, lines };
}

async function pay(billId: string) {
  const total = (await rowsOf(venue, billId))
    .reduce((sum, line) => sum + Number(line.lineTotal), 0)
    .toFixed(2);
  await payWorkingOrder({ db: venue.db, backend: venue.backend, clock: venue.clock }, venue.cfg, {
    id: billId,
    tender: { method: "cash", amount: total },
    lines: [],
  });
}

async function finish(partyId: string, billIds: string[]) {
  const expectedEdits = [];
  for (const billId of [...billIds].sort())
    expectedEdits.push(await inTx(venue, (tx) => readBillEditState(tx, billId)));
  const response = await venue.app.request(`/api/parties/${partyId}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: venue.cookie.staff },
    body: JSON.stringify({
      expectedPartyRevision: await revisionOf(partyId),
      expectedEdits,
      submissionId: randomUUID(),
    }),
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  expect(party!.state).toBe("closed");
}

async function read(partyId: string, lineId: string) {
  const response = await venue.app.request(`/api/parties/${partyId}/lines/${lineId}/cancellation`, {
    headers: { cookie: venue.cookie.staff },
  });
  return { status: response.status, json: await response.json() };
}

/** Runs `fn` while the till's profile may work only in `zones` (or anywhere, for null). */
async function withZones<T>(zones: string[] | null, fn: () => Promise<T>): Promise<T> {
  const [device] = await venue.db.select().from(devices).where(eq(devices.id, venue.deviceId));
  const profileId = device!.deviceProfileId;
  const [department] = await listDepartments(venue.db, venue.cfg);
  await inTx(venue, (tx) =>
    setProfileServiceAccess(
      tx,
      venue.cfg,
      profileId,
      zones === null
        ? { departmentId: null, allowedZoneIds: null, startingZoneId: null }
        : { departmentId: department!.id, allowedZoneIds: zones, startingZoneId: zones[0]! },
    ),
  );
  try {
    return await fn();
  } finally {
    await inTx(venue, (tx) =>
      setProfileServiceAccess(tx, venue.cfg, profileId, {
        departmentId: null,
        allowedZoneIds: null,
        startingZoneId: null,
      }),
    );
  }
}

/** A new zone in the tables zone's department, taking orders at a table as it does. */
async function patioZone() {
  return inTx(venue, async (tx) => {
    const [policy] = await tx
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, venue.tables.zoneId));
    const zone = await createServiceZone(tx, venue.cfg, {
      name: `Patio-${randomUUID()}`,
      departmentId: policy!.departmentId,
      orderStart: "table",
    });
    return zone.id;
  });
}

const refused = { status: 403, json: { error: { code: "service_zone.not_allowed" } } };

describe("a finished party's dishes are checked against its family's bills' zones", () => {
  async function finishedParty() {
    const p = await servedParty();
    await pay(p.billId);
    await finish(p.partyId, [p.billId]);
    return p;
  }

  it("refuses a finished party's cancellation read to a device outside its bill's zone", async () => {
    const p = await finishedParty();
    expect(await withZones([elsewhere], () => read(p.partyId, p.lines[0]!.id))).toMatchObject(
      refused,
    );
  });

  it("serves it to a device in that zone", async () => {
    const p = await finishedParty();
    const answer = await withZones([venue.tables.zoneId], () => read(p.partyId, p.lines[0]!.id));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({ billId: p.billId });
  });

  it("serves it to a device with no zone limit", async () => {
    const p = await finishedParty();
    const answer = await withZones(null, () => read(p.partyId, p.lines[0]!.id));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  });

  it("refuses when any bill of the party is outside the profile's zones", async () => {
    const p = await servedParty();
    const water = p.lines.find((line) => line.name === "Water")!;
    const moved = await inTx(venue, async (tx) =>
      splitBill(tx, venue.cfg, p.billId, [{ lineNo: water.lineNo }], {
        operatorId: venue.staffId,
        expectedPartyRevision: await revisionOf(p.partyId),
        expectedEdit: await readBillEditState(tx, p.billId),
      }),
    );
    await inTx(venue, (tx) =>
      VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, moved.billId, elsewhere),
    );
    await pay(p.billId);
    await pay(moved.billId);
    await finish(p.partyId, [p.billId, moved.billId]);
    const burger = p.lines.find((line) => line.name === "Burger")!;
    expect(await withZones([venue.tables.zoneId], () => read(p.partyId, burger.id))).toMatchObject(
      refused,
    );
    const both = await withZones([venue.tables.zoneId, elsewhere], () =>
      read(p.partyId, burger.id),
    );
    expect(both.status, JSON.stringify(both.json)).toBe(200);
  });

  it.each(["ascending", "descending"] as const)(
    "leaves out a bill emptied by a merge, whatever zone it was recorded in (bill IDs %s)",
    async (order) => {
      let sequence = 0x10000;
      const ids = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
        sequence += order === "ascending" ? 1 : -1;
        return `a1023${order === "ascending" ? "000" : "001"}-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
      });
      syncBuiltinESMExports();
      try {
        const p = await servedParty();
        const water = p.lines.find((line) => line.name === "Water")!;
        const moved = await inTx(venue, async (tx) =>
          splitBill(tx, venue.cfg, p.billId, [{ lineNo: water.lineNo }], {
            operatorId: venue.staffId,
            expectedPartyRevision: await revisionOf(p.partyId),
            expectedEdit: await readBillEditState(tx, p.billId),
          }),
        );
        expect(p.billId < moved.billId).toBe(order === "ascending");
        // Merging needs one service mode, so the emptied bill sits in another zone like the tables'.
        const patio = await patioZone();
        await inTx(venue, (tx) =>
          VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, moved.billId, patio),
        );
        await inTx(venue, async (tx) =>
          mergeBills(tx, venue.cfg, p.billId, moved.billId, {
            operatorId: venue.staffId,
            expectedPartyRevision: await revisionOf(p.partyId),
            expectedEdits: [
              await readBillEditState(tx, p.billId),
              await readBillEditState(tx, moved.billId),
            ].sort((left, right) => left.billId.localeCompare(right.billId)),
          }),
        );
        await pay(p.billId);
        await finish(p.partyId, [p.billId, moved.billId]);
        const burger = p.lines.find((line) => line.name === "Burger")!;
        const answer = await withZones([venue.tables.zoneId], () => read(p.partyId, burger.id));
        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect(await withZones([patio], () => read(p.partyId, burger.id))).toMatchObject(refused);
      } finally {
        ids.mockRestore();
        syncBuiltinESMExports();
      }
    },
  );

  it("refuses a merged party's dish read through the finished party it joined", async () => {
    const survivor = await servedParty();
    const merged = await servedParty();
    await inTx(venue, (tx) =>
      VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, merged.billId, elsewhere),
    );
    // Paid before the merge, so the bill stays the merged party's and keeps its own zone.
    await pay(merged.billId);
    await inTx(venue, (tx) =>
      combineParties(tx, venue.cfg, {
        from: merged.partyId,
        into: survivor.partyId,
        bills: "separate",
        tables: "join",
        operatorId: venue.staffId,
      }),
    );
    await pay(survivor.billId);
    await finish(survivor.partyId, [survivor.billId, merged.billId]);
    expect(
      await withZones([venue.tables.zoneId], () => read(survivor.partyId, merged.lines[0]!.id)),
    ).toMatchObject(refused);
    const both = await withZones([venue.tables.zoneId, elsewhere], () =>
      read(survivor.partyId, merged.lines[0]!.id),
    );
    expect(both.status, JSON.stringify(both.json)).toBe(200);
  });

  it("judges an open party holding two tables by the table it sat at first", async () => {
    const p = await servedParty();
    const patio = await patioZone();
    const joining = await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `P-${randomUUID().slice(0, 8)}`,
        zoneId: patio,
      });
      return seatTable(tx, venue.cfg, {
        tableId: table.id,
        guestCount: null,
        operatorId: venue.staffId,
      });
    });
    await inTx(venue, (tx) =>
      combineParties(tx, venue.cfg, {
        from: joining.partyId,
        into: p.partyId,
        bills: "separate",
        tables: "join",
        operatorId: venue.staffId,
      }),
    );
    const first = await withZones([venue.tables.zoneId], () => read(p.partyId, p.lines[0]!.id));
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(await withZones([patio], () => read(p.partyId, p.lines[0]!.id))).toMatchObject(refused);
  });

  it("still judges an open party by its table's zone, not its bills'", async () => {
    const p = await servedParty();
    await inTx(venue, (tx) =>
      VENUE_SERVICE.retargetOrderContext(tx, venue.cfg, p.billId, elsewhere),
    );
    const tableZone = await withZones([venue.tables.zoneId], () => read(p.partyId, p.lines[0]!.id));
    expect(tableZone.status, JSON.stringify(tableZone.json)).toBe(200);
    expect(await withZones([elsewhere], () => read(p.partyId, p.lines[0]!.id))).toMatchObject(
      refused,
    );
  });
});
