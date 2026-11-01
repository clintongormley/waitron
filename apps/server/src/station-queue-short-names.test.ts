import { testTradingAdmission } from "./testing/trading-admission.js";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  diningTables,
  parties,
  partyTables,
  shortNameColumns,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { seedSessionDevice } from "./testing/session-device.js";
import {
  counterOrder,
  inTx,
  join,
  orderForParty,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { type StationQueueGroup, fireLines, listStationQueue } from "./working-order.js";
import "./errors.js";

let v: PartyVenue;
let grill = "";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await inTx(v, async (tx) => {
      grill = (await createStation(tx, v.cfg, { name: "Grill" })).id;
      await setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: v.productId("Burger") }, zoneId: null },
        { kind: "station", stationId: grill },
      );
    });
  },
});

let serial = 0;
const savedShortNames = new Map<string, string>();

/** A fresh table named `label`, with `shortName` saved as its short name unless it is null. */
async function table(label: string, shortName: string | null): Promise<string> {
  const id = await v.table(`${label} ${++serial}`);
  const short = shortName === null ? null : `${shortName}${serial}`;
  await inTx(v, (tx) =>
    tx.update(diningTables).set(shortNameColumns(short)).where(eq(diningTables.id, id)),
  );
  if (short !== null) savedShortNames.set(id, short);
  return id;
}

/** The short name {@link table} saved, so a case never expects the label in its place. */
function shortOf(tableId: string): string {
  const short = savedShortNames.get(tableId);
  expect(short, `table ${tableId} has a saved short name`).toBeDefined();
  return short!;
}

async function queued(billId: string): Promise<StationQueueGroup> {
  const queue = await inTx(v, (tx) => listStationQueue(tx, grill));
  const group = queue.find((each) => each.orderId === billId);
  expect(group, `bill ${billId} at the Grill`).toBeDefined();
  return group!;
}

/** A counter order of one Burger, fired to the Grill. */
async function counterBurger(): Promise<string> {
  const orderId = await counterOrder(v, "Burger");
  await inTx(v, async (tx) =>
    fireLines(
      tx,
      v.cfg,
      orderId,
      await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          courseId: workingOrderLines.courseId,
          parentLineId: workingOrderLines.parentLineId,
          note: workingOrderLines.note,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId)),
    ),
  );
  return orderId;
}

async function seatedWithBurger(tableId: string): Promise<{ partyId: string; billId: string }> {
  const { partyId } = await seat(v, tableId);
  const { tabId } = await orderForParty(v, partyId, ["Burger"]);
  return { partyId, billId: tabId };
}

describe("the station read names each bill's tables by their short names", () => {
  it("a party's bill names its table's saved short name", async () => {
    const tableId = await table("Terrace", "T");
    const { billId } = await seatedWithBurger(tableId);

    expect((await queued(billId)).tableShortNames).toEqual([shortOf(tableId)]);
  });

  it("a table with no short name is named by its label", async () => {
    const tableId = await table("Window", null);
    const { billId } = await seatedWithBurger(tableId);

    const [row] = await inTx(v, (tx) =>
      tx
        .select({ label: diningTables.label })
        .from(diningTables)
        .where(eq(diningTables.id, tableId)),
    );
    expect((await queued(billId)).tableShortNames).toEqual([row!.label]);
  });

  it("a party at two tables names both, in the order they joined", async () => {
    const first = await table("Patio", "P");
    const second = await table("Patio", "Q");
    const { partyId } = await seat(v, first);
    await join(v, partyId, second);
    const { tabId } = await orderForParty(v, partyId, ["Burger"]);

    expect((await queued(tabId)).tableShortNames).toEqual([shortOf(first), shortOf(second)]);
  });

  it("a bill whose party was merged into another, and holds no table, names the other's tables", async () => {
    const from = await table("Bar", "B");
    const into = await table("Bar", "C");
    const merged = await seatedWithBurger(from);
    const survivor = await seat(v, into);
    await inTx(v, async (tx) => {
      await tx
        .update(partyTables)
        .set({ leftAt: new Date().toISOString() })
        .where(and(eq(partyTables.partyId, merged.partyId), isNull(partyTables.leftAt)));
      await tx
        .update(parties)
        .set({
          state: "closed",
          closedAt: new Date().toISOString(),
          mergedIntoPartyId: survivor.partyId,
        })
        .where(eq(parties.id, merged.partyId));
    });

    expect((await queued(merged.billId)).tableShortNames).toEqual([shortOf(into)]);
  });

  it("a counter order names no table", async () => {
    const billId = await counterBurger();

    expect(await queued(billId)).not.toHaveProperty("tableShortNames");
  });

  it("a counter order delivered to a table names that table", async () => {
    const tableId = await table("Garden", "G");
    const billId = await counterBurger();
    await inTx(v, (tx) =>
      tx
        .update(workingOrders)
        .set({ deliveryTableId: tableId })
        .where(eq(workingOrders.id, billId)),
    );

    expect((await queued(billId)).tableShortNames).toEqual([shortOf(tableId)]);
  });
});

describe("a delivered counter order whose table was let go", () => {
  it("names the table by the name kept when it was let go", async () => {
    const billId = await counterBurger();
    await inTx(v, (tx) =>
      tx
        .update(workingOrders)
        .set({ deliveryTableId: null, deliveryTableLabel: "Garden 9" })
        .where(eq(workingOrders.id, billId)),
    );

    expect((await queued(billId)).tableShortNames).toEqual(["Garden 9"]);
  });
});

describe("the till's station route carries the short names", () => {
  let app: Hono;
  let cookie: string;

  beforeAll(async () => {
    app = new Hono();
    mountTillApi(
      app,
      {
        admission: testTradingAdmission(),
        db: v.db,
        backend: v.backend,
        clock: v.clock,
        cfg: v.cfg,
        tableRemovals: enabledTableRemovals(ALL_MODULES),
        secureCookies: false,
        venueLocale: v.cfg.locale,
      },
      () => {},
    );
    const deviceId = await seedSessionDevice(v.db, v.cfg);
    const session = await inTx(v, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: "Cook", pinHash: hashPin("4321"), role: "staff" })
        .returning({ id: persons.id });
      return loginWithPin(tx, { deviceId, personId: person!.id, pin: "4321" });
    });
    cookie = `${SESSION_COOKIE}=${session.token}`;
  });

  it("GET /api/stations/:id/queue sends a table bill's short names", async () => {
    const tableId = await table("Terrace", "R");
    const { billId } = await seatedWithBurger(tableId);

    const answer = await app.request(`/api/stations/${grill}/queue`, { headers: { cookie } });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const { items } = (await answer.json()) as { items: StationQueueGroup[] };

    expect(items.find((group) => group.orderId === billId)?.tableShortNames).toEqual([
      shortOf(tableId),
    ]);
  });
});
