import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parties, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeKitchenNote } from "@waitron/venue-service";
import { hashSessionToken, tillSessions } from "@waitron/identity";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { SimulatorPaymentProvider } from "@waitron/payments/src/simulator.js";
import { readOrderKitchenNotes } from "./order-kitchen-note.js";
import { takeBillPayment, takeReaderBillPayment } from "./bill-payments.js";
import { mountTillApi, type TillApiDeps } from "./till-api.js";
import {
  counterOrder,
  floorRow,
  inTx,
  order,
  OPERATOR,
  seat,
  split,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { getHeldOrder, getPlacedCounterOrder, parkOrder } from "./working-order.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;

beforeEach(async () => {
  await seedPersons(suite.db, { id: OPERATOR, displayName: "Kitchen note author" });
  v = await setupPartyVenue(suite.db);
});

describe("initial kitchen notes on ordering paths", () => {
  const note = (id: string) =>
    inTx(v, async (tx) => (await readOrderKitchenNotes(tx, [id])).get(id));
  const lines = () => [{ menuItemId: v.counterItem("Burger"), quantity: "1", note: "No onions" }];
  const deps = () => ({ db: v.db, clock: v.clock, backend: v.backend });

  it.each(["park", "cash", "reader"] as const)(
    "accepts the initial note through %s",
    async (path) => {
      const token = randomUUID();
      await suite.db.insert(tillSessions).values({
        deviceId: v.cfg.origin.deviceId,
        personId: OPERATOR,
        tokenHash: hashSessionToken(token),
      });
      const app = new Hono();
      mountTillApi(
        app,
        {
          admission: testTradingAdmission(),
          ...deps(),
          cfg: v.cfg,
          secureCookies: false,
          venueLocale: "es-ES",
          cardProvider: new SimulatorPaymentProvider(v.db),
        } as TillApiDeps,
        () => {},
      );
      const requestCookie = await sessionCookieForTest(suite.db, token);
      const id = randomUUID();
      const basket = {
        zoneId: v.counter.zoneId,
        lines: lines(),
        kitchenNote: "Shared kitchen instruction",
      };
      const response = await app.request(
        path === "park" ? "/api/working-orders" : `/api/working-orders/${id}/payments`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: requestCookie },
          body: JSON.stringify(
            path === "park"
              ? { id, dining: "eat_in", ...basket }
              : {
                  dining: "eat_in",
                  submissionId: id,
                  kind: "share",
                  shareOf: 1,
                  ...(path === "cash"
                    ? { method: "cash", tendered: "12.00" }
                    : { method: "card", entry: "reader" }),
                  basket,
                },
          ),
        },
      );
      expect(response.status, JSON.stringify(await response.json())).toBe(200);
      expect(await note(id)).toMatchObject({ note: "Shared kitchen instruction", revision: 1 });
    },
  );

  it("saves a parked note and ignores initial text on a replay", async () => {
    const id = randomUUID();
    const req = { id, lines: lines(), zoneId: v.counter.zoneId, kitchenNote: "Train at 14:30" };
    const parked = await parkOrder({ db: v.db }, v.cfg, req);
    expect(await note(id)).toMatchObject({ note: "Train at 14:30", revision: 1 });
    await inTx(v, (tx) => writeKitchenNote(tx, { workingOrderId: id }, 1, "New departure time"));
    expect(await parkOrder({ db: v.db }, v.cfg, req)).toEqual(parked);
    expect(await note(id)).toMatchObject({ note: "New departure time", revision: 2 });
  });

  it.each(["cash", "card"] as const)(
    "saves the initial %s sale note without including it on the receipt",
    async (method) => {
      const id = randomUUID();
      const pay = () =>
        takeBillPayment(
          { ...deps(), admission: testTradingAdmission() },
          v.cfg,
          id,
          {
            expectedEdit: null,
            submissionId: id,
            kind: "share",
            shareOf: 1,
            method,
            ...(method === "cash" ? { tendered: "12.00" } : { entry: "manual" }),
            applied: "0.00",
            tip: "0.00",
          },
          v.operator,
          { zoneId: v.counter.zoneId, lines: lines(), kitchenNote: "All together; train at 14:30" },
        );
      const { invoice } = await pay();
      expect(await note(id)).toMatchObject({ note: "All together; train at 14:30", revision: 1 });
      expect(invoice).toMatchObject({ total: "12.00" });
      expect(JSON.stringify(invoice)).not.toContain("All together; train at 14:30");
      await inTx(v, (tx) => writeKitchenNote(tx, { workingOrderId: id }, 1, "New departure time"));
      expect((await pay()).invoice).toEqual(invoice);
      expect(await note(id)).toMatchObject({ note: "New departure time", revision: 2 });
    },
  );

  it("stores a fresh integrated-card note before contacting the reader, retaining it on retry", async () => {
    const id = randomUUID();
    const provider = new FakePaymentProvider(v.db);
    const collect = provider.collect.bind(provider);
    vi.spyOn(provider, "collect").mockImplementation(async (args) => {
      expect(await note(id)).toMatchObject({ note: "All together before the train", revision: 1 });
      return collect(args);
    });
    const pay = () =>
      takeReaderBillPayment(
        { admission: testTradingAdmission(), ...deps(), provider },
        v.cfg,
        id,
        {
          expectedEdit: null,
          submissionId: id,
          kind: "share",
          shareOf: 1,
          method: "card",
          entry: "reader",
          applied: "0.00",
          tip: "0.00",
        },
        v.operator,
        { zoneId: v.counter.zoneId, lines: lines(), kitchenNote: "All together before the train" },
      );
    const result = await pay();
    expect(result).toMatchObject({ outcome: "received", invoice: { total: "12.00" } });
    expect(await note(id)).toMatchObject({ note: "All together before the train", revision: 1 });
    await inTx(v, (tx) => writeKitchenNote(tx, { workingOrderId: id }, 1, "Later update"));
    expect(await pay()).toEqual(result);
    expect(await note(id)).toMatchObject({ note: "Later update", revision: 2 });
  });

  it.each([{ kitchenNote: 42 }, { kitchenNote: [] }, { kitchenNote: "x".repeat(2001) }])(
    "rolls back a fresh order with an invalid initial note",
    async ({ kitchenNote }) => {
      const id = randomUUID();
      await expect(
        parkOrder({ db: v.db }, v.cfg, {
          id,
          zoneId: v.counter.zoneId,
          lines: lines(),
          kitchenNote,
        } as Parameters<typeof parkOrder>[2]),
      ).rejects.toMatchObject({
        code: typeof kitchenNote === "string" ? "kitchen_note.too_long" : "kitchen_note.invalid",
      });
      expect(await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id))).toEqual(
        [],
      );
      expect(
        await suite.db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id)),
      ).toEqual([]);
    },
  );
});

describe("whole-order kitchen note read projections", () => {
  it.each(["open", "placed"] as const)(
    "retrieves a %s counter note separately from dish notes",
    async (status) => {
      const id = await counterOrder(v, "Burger");
      await inTx(v, async (tx) => {
        await tx
          .update(workingOrderLines)
          .set({ note: "No onions" })
          .where(eq(workingOrderLines.workingOrderId, id));
        await tx.update(workingOrders).set({ status }).where(eq(workingOrders.id, id));
        await writeKitchenNote(tx, { workingOrderId: id }, 0, "Train at 14:30");
      });
      const read = status === "open" ? getHeldOrder : getPlacedCounterOrder;
      const result = await read({ db: v.db }, id);
      expect(result).toMatchObject({
        kitchenNote: {
          note: "Train at 14:30",
          revision: 1,
          ownerRevision: 0,
          scope: { workingOrderId: id },
        },
        lines: [{ note: "No onions", quantity: "1.000" }],
      });
    },
  );

  it("retrieves the canonical party note on each bill, ignoring an old counter scope", async () => {
    const table = await v.table("1");
    const seated = await seat(v, table);
    await order(v, seated.tabId, "Burger", "Flan");
    const secondBill = await split(v, seated.partyId, seated.tabId, [2]);
    await inTx(v, async (tx) => {
      await writeKitchenNote(
        tx,
        { workingOrderId: seated.tabId },
        0,
        "Obsolete counter instruction",
      );
      await writeKitchenNote(tx, { partyId: seated.partyId }, 0, "Bring everything together");
    });
    for (const id of [seated.tabId, secondBill]) {
      const result = await getHeldOrder({ db: v.db }, id);
      expect(result).toMatchObject({
        kitchenNote: {
          note: "Bring everything together",
          revision: 1,
          scope: { partyId: seated.partyId },
        },
      });
      expect(result.lines).toHaveLength(1);
    }
  });

  it("returns the surviving party scope for an absorbed party's retained bill", async () => {
    const source = await seat(v, await v.table("Source"));
    const target = await seat(v, await v.table("Target"));
    await inTx(v, async (tx) => {
      await tx
        .update(parties)
        .set({
          state: "closed",
          closedAt: new Date().toISOString(),
          mergedIntoPartyId: target.partyId,
        })
        .where(eq(parties.id, source.partyId));
      await writeKitchenNote(tx, { partyId: source.partyId }, 0, "Old source");
      await writeKitchenNote(tx, { partyId: target.partyId }, 0, "Surviving instruction");
      await tx.update(parties).set({ revision: 7 }).where(eq(parties.id, target.partyId));
    });
    expect(await getHeldOrder({ db: v.db }, source.tabId)).toMatchObject({
      kitchenNote: {
        note: "Surviving instruction",
        revision: 1,
        ownerRevision: 7,
        scope: { partyId: target.partyId },
      },
    });
  });

  it("shows a party's note before it has any dishes, and keeps the cleared revision", async () => {
    const table = await v.table("Empty party");
    const { partyId } = await seat(v, table);
    expect((await floorRow(v, table)).party).toMatchObject({
      kitchenNote: {
        note: null,
        revision: 0,
        scope: { partyId },
      },
    });
    await inTx(v, (tx) => writeKitchenNote(tx, { partyId }, 0, "Train at 14:30"));
    expect((await floorRow(v, table)).party).toMatchObject({
      kitchenNote: {
        note: "Train at 14:30",
        revision: 1,
        scope: { partyId },
      },
    });
    await inTx(v, (tx) => writeKitchenNote(tx, { partyId }, 1, null));
    expect((await floorRow(v, table)).party).toMatchObject({
      kitchenNote: {
        note: null,
        revision: 2,
        scope: { partyId },
      },
    });
  });
});
