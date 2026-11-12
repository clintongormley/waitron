import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  diningTables,
  floorTodayJoinTables,
  floorTodayJoins,
  floorTodayTables,
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
import { readPassCardRows, readScopedPassBoard } from "./pass-board.js";
import type { PassBoard, PassCard } from "./pass-card.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { boardCards, EVERY } from "./testing/pass-board-probe.js";
import { seedSessionDevice } from "./testing/session-device.js";
import {
  counterOrder,
  inTx,
  join,
  orderForParty,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import { fireLines } from "./working-order.js";
import "./errors.js";

let v: PartyVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await inTx(v, async (tx) => {
      const grill = (await createStation(tx, { name: "Grill" })).id;
      await setRoutingCell(
        tx,
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

/** The bill's entry on the card of the pass that sees every station and zone. */
function billOn(board: PassBoard, billId: string): PassCard["orders"][number] {
  const order = boardCards(board)
    .flatMap((card) => card.orders)
    .find((each) => each.orderId === billId);
  expect(order, `bill ${billId} on the pass`).toBeDefined();
  return order!;
}

async function onThePass(billId: string): Promise<PassCard["orders"][number]> {
  return billOn(await inTx(v, (tx) => readScopedPassBoard(tx, EVERY)), billId);
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

describe("the pass card names each bill's tables by their short names", () => {
  it("a party's bill names its table's saved short name", async () => {
    const tableId = await table("Terrace", "T");
    const { billId } = await seatedWithBurger(tableId);

    expect((await onThePass(billId)).tableShortNames).toEqual([shortOf(tableId)]);
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
    expect((await onThePass(billId)).tableShortNames).toEqual([row!.label]);
  });

  it("a party at two tables names both", async () => {
    const first = await table("Patio", "P");
    const second = await table("Patio", "Q");
    const { partyId } = await seat(v, first);
    await join(v, partyId, second);
    const { tabId } = await orderForParty(v, partyId, ["Burger"]);

    expect((await onThePass(tabId)).tableShortNames).toEqual([shortOf(first), shortOf(second)]);
  });

  it("a party holding no table names no table", async () => {
    const tableId = await table("Corner", "K");
    const { partyId, billId } = await seatedWithBurger(tableId);
    await inTx(v, (tx) =>
      tx
        .update(partyTables)
        .set({ leftAt: new Date().toISOString() })
        .where(and(eq(partyTables.partyId, partyId), isNull(partyTables.leftAt))),
    );

    expect(await onThePass(billId)).not.toHaveProperty("tableShortNames");
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

    expect((await onThePass(merged.billId)).tableShortNames).toEqual([shortOf(into)]);
  });

  it("a counter order names no table", async () => {
    const billId = await counterBurger();

    expect(await onThePass(billId)).not.toHaveProperty("tableShortNames");
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

    expect((await onThePass(billId)).tableShortNames).toEqual([shortOf(tableId)]);
  });

  it("a delivered counter order whose table was let go names the name kept when it was let go", async () => {
    const billId = await counterBurger();
    await inTx(v, (tx) =>
      tx
        .update(workingOrders)
        .set({ deliveryTableId: null, deliveryTableLabel: "Garden 9" })
        .where(eq(workingOrders.id, billId)),
    );

    expect((await onThePass(billId)).tableShortNames).toEqual(["Garden 9"]);
  });
});

describe("a table named for today keeps its short name on the pass", () => {
  it("a table renamed today names its saved short name, while its label is today's name", async () => {
    const tableId = await table("Terrace", "R");
    await inTx(v, (tx) =>
      tx
        .update(floorTodayTables)
        .set({ name: `García birthday ${serial}` })
        .where(eq(floorTodayTables.tableId, tableId)),
    );
    const { billId } = await seatedWithBurger(tableId);

    expect(await onThePass(billId)).toMatchObject({
      tableLabel: `García birthday ${serial}`,
      tableShortNames: [shortOf(tableId)],
    });
  });

  it("a group named today names its tables' saved short names, while its label is today's name", async () => {
    const first = await table("Counter", "C");
    const second = await table("Counter", "D");
    const name = `Smith wedding ${serial}`;
    const { zoneId } = await tableRow(v, first);
    await inTx(v, async (tx) => {
      const [joined] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId, seats: 4, name })
        .returning({ id: floorTodayJoins.id });
      await tx.insert(floorTodayJoinTables).values(
        [first, second].map((tableId) => ({
          joinId: joined!.id,
          tableId,
          beforeX: 0,
          beforeY: 0,
          beforeRotation: 0,
        })),
      );
    });
    const { partyId } = await seat(v, first);
    const { tabId } = await orderForParty(v, partyId, ["Burger"]);

    expect(await onThePass(tabId)).toMatchObject({
      tableLabel: name,
      tableShortNames: [shortOf(first), shortOf(second)],
    });
  });
});

describe("Fire's release reads a card without its short names", () => {
  it("readPassCardRows leaves a table bill's short names out", async () => {
    const tableId = await table("Terrace", "F");
    const { billId } = await seatedWithBurger(tableId);

    const card = boardCards(await inTx(v, (tx) => readScopedPassBoard(tx, EVERY))).find((each) =>
      each.orders.some((order) => order.orderId === billId),
    );
    const rows = await inTx(v, (tx) => readPassCardRows(tx, card!.target));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.order).not.toHaveProperty("tableShortNames");
  });
});

describe("the till's pass route carries the short names", () => {
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
    const deviceId = await seedSessionDevice(v.db);
    const session = await inTx(v, async (tx) => {
      const [person] = await seedPersons(tx, {
        displayName: "Expo",
        pinHash: hashPin("4321"),
        role: "staff",
      });
      return loginWithPin(tx, { deviceId, personId: person!.id, pin: "4321" });
    });
    cookie = `${SESSION_COOKIE}=${session.token}`;
  });

  it("GET /api/expo/board sends a table bill's short names", async () => {
    const tableId = await table("Terrace", "W");
    const { billId } = await seatedWithBurger(tableId);

    const answer = await app.request("/api/expo/board", { headers: { cookie } });
    expect(answer.status, await answer.clone().text()).toBe(200);
    const { board } = (await answer.json()) as { board: PassBoard };

    expect(billOn(board, billId).tableShortNames).toEqual([shortOf(tableId)]);
  });
});
