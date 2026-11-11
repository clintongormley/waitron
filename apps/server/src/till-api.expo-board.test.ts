import { floorLabelSuffix } from "./testing/floor-label.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loginWithPin, persons } from "@waitron/identity";
import { createServiceZone, zoneServicePolicies } from "@waitron/venue-service";
import type { PassBoard, PassCard } from "./pass-card.js";
import { offerProducts, routeProductTo } from "./testing/zone-offers.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { mountTillApi } from "./till-api.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { createStation } from "./kitchen.js";
import { createOpenOrder, fireableLineColumns, fireLines } from "./working-order.js";
import { OPERATOR, inTx, orderForParty, seat, setupPartyVenue } from "./testing/party-venue.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { VENUE_SERVICE } from "./modules.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const log = () => {};

/**
 * A Grill burger at a table in the tables zone ("Inside"), a Bar wine at a table in a second zone
 * ("Terrace"), and a fired counter order's water at no table; a till with no pass screen whose
 * profile has no capabilities at all.
 */
async function fixture() {
  const v = await setupPartyVenue(suite.db);
  const { grill, bar, terraceWine } = await inTx(v, async (tx) => {
    const grill = (await createStation(tx, { name: "Grill" })).id;
    const bar = (await createStation(tx, { name: "Bar" })).id;
    await routeProductTo(tx, v.productId("Burger"), grill);
    await routeProductTo(tx, v.productId("Red wine bottle"), bar);
    const [policy] = await tx
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, v.tables.zoneId));
    const terrace = await createServiceZone(tx, {
      name: "Terrace",
      departmentId: policy!.departmentId,
    });
    const offers = await offerProducts(tx, v.cfg, {
      zone: { zoneId: terrace.id },
      orderStart: "table",
    });
    return { grill, bar, terraceWine: { zoneId: terrace.id, offers } };
  });
  const [profile] = await inTx(v, (tx) =>
    tx
      .insert(deviceProfiles)
      .values({ name: "Plain till", formFactor: "till", capabilities: [] })
      .returning({ id: deviceProfiles.id }),
  );
  const joined = await enrolDeviceForTest(suite.db, v.cfg, {
    name: "Till",
    profileId: profile!.id,
  });
  const deviceCookie = `${DEVICE_COOKIE}=${joined.deviceId}.${joined.token}`;
  const [person] = await inTx(v, (tx) => tx.select({ id: persons.id }).from(persons).limit(1));
  const session = await inTx(v, (tx) =>
    loginWithPin(tx, { deviceId: joined.deviceId, personId: person!.id, pin: "1234" }),
  );
  const app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      secureCookies: false,
      venueLocale: "es-ES",
    },
    log,
  );
  return {
    v,
    app,
    grill,
    bar,
    terraceWine,
    deviceCookie,
    signedIn: `${deviceCookie}; ${SESSION_COOKIE}=${session.token}`,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function itemsOf(f: Fixture, workingOrderId: string): Promise<string[]> {
  const rows = await inTx(f.v, (tx) =>
    tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, workingOrderId)),
  );
  return rows.map((row) => row.id);
}

/** Every dish of the three orders, each fired. */
async function threeOrders(f: Fixture) {
  const inside = await seat(f.v, await f.v.table(`Inside ${floorLabelSuffix().padStart(4, "0")}`));
  await orderForParty(f.v, inside.partyId, ["Burger"], inside.tabId);
  const terrace = await seat(
    f.v,
    await f.v.table(`Terrace ${floorLabelSuffix().padStart(4, "0")}`, f.terraceWine.zoneId),
  );
  await inTx(f.v, async (tx) => {
    await VENUE_SERVICE.writePartyAllergy(
      tx,
      terrace.partyId,
      { answer: "none", guests: [] },
      OPERATOR,
    );
    await placeGroups(tx, f.v.cfg, terrace.partyId, {
      groups: [
        {
          lines: [
            {
              menuItemId: f.terraceWine.offers.offerFor(f.v.productId("Red wine bottle")),
              quantity: "1",
            },
          ],
          release: "fire",
        },
      ],
      operatorId: OPERATOR,
    });
  });
  const counterId = randomUUID();
  await inTx(f.v, async (tx) => {
    await createOpenOrder(
      tx,
      f.v.cfg,
      counterId,
      f.v.counter.toOfferLines([{ productId: f.v.productId("Water"), quantity: "1" }]),
      null,
      { zoneId: f.v.counter.zoneId },
    );
    const lines = await tx
      .select(fireableLineColumns)
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, counterId));
    await fireLines(tx, f.v.cfg, counterId, lines);
  });
  return {
    burger: await itemsOf(f, inside.tabId),
    wine: await itemsOf(f, terrace.tabId),
    counter: await itemsOf(f, counterId),
  };
}

const cardsOf = (board: PassBoard): PassCard[] => [
  ...board.held,
  ...board.toFire,
  ...board.inProgress,
  ...board.ready,
];

async function read(f: Fixture, cookie: string) {
  return f.app.request("/api/expo/board", { headers: { cookie } });
}

describe("A773 pass board: all stations", () => {
  it("answers a signed-in till with no pass screen every station's and zone's cards, with nothing to release", async () => {
    const f = await fixture();
    const placed = await threeOrders(f);
    expect([placed.burger, placed.wine, placed.counter].map((ids) => ids.length)).toEqual([
      1, 1, 1,
    ]);
    const response = await read(f, f.signedIn);
    expect(response.status).toBe(200);
    const { board } = (await response.json()) as { board: PassBoard };
    const cards = cardsOf(board);
    const itemIds = cards.flatMap((card) => card.items.map((item) => item.id)).sort();
    expect(itemIds).toEqual([...placed.burger, ...placed.wine, ...placed.counter].sort());
    for (const card of cards) {
      expect(card.releaseTicketItemIds).toEqual([]);
      expect(card.releaseContext).toBeNull();
    }
  });

  it("needs a signed-in session, and nothing else: a till without show-expo still reads it", async () => {
    const f = await fixture();
    await threeOrders(f);
    const anonymous = await read(f, f.deviceCookie);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "session.required" } });
    expect((await read(f, f.signedIn)).status).toBe(200);
  });

  it("answers 404 at the retired /api/expo/queue, signed in or not", async () => {
    const f = await fixture();
    for (const cookie of [f.signedIn, f.deviceCookie]) {
      const answer = await f.app.request("/api/expo/queue", { headers: { cookie } });
      expect(answer.status).toBe(404);
    }
  });

  it("lists a To fire card while Grill waits, with no Fire to offer", async () => {
    const f = await fixture();
    await inTx(f.v, (tx) => setStationsWaitForPass(tx, true, [f.grill]));
    const placed = await threeOrders(f);
    const response = await read(f, f.signedIn);
    expect(response.status).toBe(200);
    const { board } = (await response.json()) as { board: PassBoard };
    const toFire = board.toFire.filter((card) =>
      card.items.some((item) => placed.burger.includes(item.id)),
    );
    expect(toFire).toHaveLength(1);
    expect(toFire[0]!.releaseTicketItemIds).toEqual([]);
    expect(toFire[0]!.releaseContext).toBeNull();
  });
});
