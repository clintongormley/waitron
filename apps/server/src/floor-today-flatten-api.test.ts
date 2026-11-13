import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { observedTableActionBody } from "./testing/table-action-fixture.js";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import { diningTables, tableMerges, partyTableLabels } from "@waitron/db";
import { hashPin, loginWithPin } from "@waitron/identity";
import { partyTablesName } from "@waitron/shared";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import {
  activeTablesOf,
  billRow,
  inTx,
  order,
  partyAt,
  revisionOf,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import { giveKeptSize, plannedZone } from "./testing/floor-today-venue.js";
import { seedSessionDevice, sessionCookieForTest } from "./testing/session-device.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

beforeAll(async () => {
  // Fixed so a run across the venue's 05:00 day change keeps the room it read:
  // docs/developers/testing-guide.md#a-floor-test-pins-the-till-apis-clock-away-from-the-day-change
  const clock: TrustedClock = { ...v.clock, now: () => ({ ...v.clock.now(), instant: NOW }) };
  app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: v.db,
      backend: v.backend,
      clock,
      cfg: v.cfg,
      tableRemovals: enabledTableRemovals(ALL_MODULES),
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    () => {},
  );
  const deviceId = await seedSessionDevice(v.db);
  const session = await inTx(v, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Anna",
      pinHash: hashPin("5555"),
      role: "staff",
    });
    return loginWithPin(tx, { deviceId, personId: person!.id, pin: "5555" });
  });
  cookie = await sessionCookieForTest(v.db, session.token);
});

const NOW = new Date("2026-10-10T12:00:00Z");

/** Long table (10 seats, 6 × 2 at 10, 20) = Counter 3 (2 seats), 4 (6) and 5 (4), each kept 2 × 2; Bar (4 seats, 2 × 2 at 40, 0). */
async function LONG_TABLE() {
  const zone = await plannedZone(
    v,
    [
      { key: "c3", label: "Counter 3", seats: 2, place: null },
      { key: "c4", label: "Counter 4", seats: 6, place: null },
      { key: "c5", label: "Counter 5", seats: 4, place: null },
      {
        key: "long",
        label: "Long table",
        seats: 10,
        place: { x: 10, y: 20, width: 6, height: 2 },
        partKeys: ["c3", "c4", "c5"],
      },
      { key: "bar", label: "Bar", seats: 4, place: { x: 40, y: 0, width: 2, height: 2 } },
    ],
    NOW,
  );
  for (const key of ["c3", "c4", "c5"])
    await giveKeptSize(v, zone.master[key]!, { width: 2, height: 2 });
  return zone;
}

/** The room's revision as a till's floor read shows it at `tableId`. */
async function readRevision(tableId: string): Promise<number> {
  const answer = await app.request("/api/tables/state", { headers: { cookie } });
  expect(answer.status, await answer.clone().text()).toBe(200);
  const tables = (await answer.json()) as { id: string; today: { zoneRevision: number } | null }[];
  return tables.find((t) => t.id === tableId)!.today!.zoneRevision;
}

/** The party at the path joins `tableId`, `moving` touching `target` on `side`, sending the revision a floor read shows. */
async function joinMerging(
  partyId: string,
  args: {
    tableId: string;
    moving: string;
    target: string;
    side: "left" | "right";
    otherPartyId?: string;
  },
): Promise<Response> {
  const other =
    args.otherPartyId === undefined
      ? { otherPartyId: null }
      : {
          otherPartyId: args.otherPartyId,
          expectedOtherPartyRevision: await revisionOf(v, args.otherPartyId),
        };
  const body = {
    zoneRevision: await readRevision(args.tableId),
    tableId: args.tableId,
    expectedPartyRevision: await revisionOf(v, partyId),
    ...other,
    merge: { moving: args.moving, target: args.target, side: args.side, seats: 12 },
  };
  return app.request(`/api/parties/${partyId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(await observedTableActionBody(v.db, `/api/parties/${partyId}/join`, body)),
  });
}

async function ok(answer: Promise<Response>): Promise<void> {
  const settled = await answer;
  expect(settled.status, await settled.clone().text()).toBe(200);
}

function noticesOn(billIds: string[]) {
  return v.db.all<{ working_order_id: string; kind: string; moved_to: string }>(
    sql`
      select working_order_id, kind, moved_to from kitchen_notices
      where working_order_id in (${sql.join(
        billIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by rowid`,
  );
}

async function withClearing<T>(fn: () => Promise<T>): Promise<T> {
  await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));
  try {
    return await fn();
  } finally {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
  }
}

describe("guests pass to a joined table's tables when it is pushed into a group", () => {
  it("guests at Long table, Bar pushed on: the party holds Bar, Counter 3, 4 and 5, Long table needs no clearing", async () => {
    await withClearing(async () => {
      const { table } = await LONG_TABLE();
      const guests = await seat(v, table.c3!);

      await ok(
        joinMerging(guests.partyId, {
          tableId: table.bar!,
          moving: table.bar!,
          target: table.c3!,
          side: "left",
        }),
      );

      expect((await activeTablesOf(v, guests.partyId)).sort()).toEqual(
        [table.bar!, table.c3!, table.c4!, table.c5!].sort(),
      );
      expect(await partyAt(v, table.c3!)).toBe(guests.partyId);
      expect((await tableRow(v, table.c3!)).needsClearingSince).toBeNull();
    });
  });

  it("adding a table keeps the kitchen's existing real destinations, with no moved notice", async () => {
    const { table } = await LONG_TABLE();
    const guests = await seat(v, table.c3!);
    await order(v, guests.tabId, "Burger");

    await ok(
      joinMerging(guests.partyId, {
        tableId: table.bar!,
        moving: table.bar!,
        target: table.c3!,
        side: "left",
      }),
    );

    expect(await noticesOn([guests.tabId])).toEqual([]);
  });

  it("guests at both, Bar pushed onto Long table: the incoming bill keeps its own moved notice", async () => {
    const { table } = await LONG_TABLE();
    const atLong = await seat(v, table.c3!);
    const atBar = await seat(v, table.bar!);
    await order(v, atLong.tabId, "Burger");
    await order(v, atBar.tabId, "Burger");

    await ok(
      joinMerging(atLong.partyId, {
        tableId: table.bar!,
        moving: table.bar!,
        target: table.c3!,
        side: "left",
        otherPartyId: atBar.partyId,
      }),
    );

    const notices = await noticesOn([atLong.tabId, atBar.tabId]);
    const byBill = (a: { working_order_id: string }, b: { working_order_id: string }) =>
      a.working_order_id.localeCompare(b.working_order_id);
    expect(notices.sort(byBill)).toEqual([
      {
        working_order_id: atBar.tabId,
        kind: "moved",
        moved_to: (
          await inTx(v, (tx) =>
            tx
              .select({ name: tableMerges.name })
              .from(tableMerges)
              .innerJoin(diningTables, eq(diningTables.mergeId, tableMerges.id))
              .where(eq(diningTables.id, table.c3!)),
          )
        )[0]!.name,
      },
    ]);
    expect((await billRow(v, atLong.tabId)).status).toBe("open");
    expect((await billRow(v, atBar.tabId)).status).toBe("open");
  });

  it("the party's display name keeps the saved group name", async () => {
    for (let round = 0; round < 10; round++) {
      const { table } = await LONG_TABLE();
      const guests = await seat(v, table.c3!);

      await ok(
        joinMerging(guests.partyId, {
          tableId: table.bar!,
          moving: table.bar!,
          target: table.c3!,
          side: "left",
        }),
      );

      const labels = await inTx(v, (tx) => partyTableLabels(tx, [guests.partyId]));
      expect(partyTablesName(labels.get(guests.partyId)!), `round ${round}`).toBe(
        (
          await inTx(v, (tx) =>
            tx
              .select({ name: tableMerges.name })
              .from(tableMerges)
              .innerJoin(diningTables, eq(diningTables.mergeId, tableMerges.id))
              .where(eq(diningTables.id, table.c3!)),
          )
        )[0]!.name,
      );
    }
  });

  it("guests at both, food at Long table only, Bar pushed onto Long table: one moved notice, on Long table's own bill", async () => {
    const { table } = await LONG_TABLE();
    const atLong = await seat(v, table.c3!);
    const atBar = await seat(v, table.bar!);
    await order(v, atLong.tabId, "Burger");

    await ok(
      joinMerging(atBar.partyId, {
        tableId: table.c3!,
        moving: table.bar!,
        target: table.c3!,
        side: "left",
        otherPartyId: atLong.partyId,
      }),
    );

    expect(await noticesOn([atLong.tabId, atBar.tabId])).toEqual([]);
    expect((await billRow(v, atLong.tabId)).status).toBe("open");
  });
});

describe("a till join without a merge", () => {
  it("guests at Long table joining Bar, whose party has food: no bill merges, so no moved notice", async () => {
    const { table } = await LONG_TABLE();
    const atLong = await seat(v, table.c3!);
    const atBar = await seat(v, table.bar!);
    await order(v, atLong.tabId, "Burger");
    await order(v, atBar.tabId, "Burger");

    await ok(
      Promise.resolve(
        app.request(`/api/parties/${atLong.partyId}/join`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify(
            await observedTableActionBody(v.db, `/api/parties/${atLong.partyId}/join`, {
              tableId: table.bar!,
              expectedPartyRevision: await revisionOf(v, atLong.partyId),
              otherPartyId: atBar.partyId,
              expectedOtherPartyRevision: await revisionOf(v, atBar.partyId),
            }),
          ),
        }),
      ),
    );

    expect(await noticesOn([atLong.tabId, atBar.tabId])).toEqual([]);
    expect((await billRow(v, atBar.tabId)).status).toBe("open");
  });
});
