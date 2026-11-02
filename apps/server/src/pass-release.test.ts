import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  floorZones,
  incidents,
  kitchenStations,
  parties,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { CapabilityFlag, FormFactor } from "@waitron/layouts";
import type { DeviceKitchenScreen } from "@waitron/module";
import {
  createDepartment,
  createServiceZone,
  setProfileServiceAccess,
} from "@waitron/venue-service";
import { persons } from "@waitron/identity";
import { attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { openTillSession } from "./testing/session-device.js";
import { systemClock } from "./till-backend.js";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { createStation } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, readPassCardRows, readScopedPassBoard } from "./pass-board.js";
import { passCardRelease, type PassCard } from "./pass-card.js";
import { fireOrderLines, markServed, routingOnce } from "./working-order.js";
import { passReleaseAsk, releasePassItems, type PassActor } from "./pass-release.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { addTabRound, moveDishesToStation } from "./testing/order-writer-fixture.js";
import { fireGroup, submitGroups } from "./order-groups.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { setStationToday } from "@waitron/venue-service";
import { createPrinter } from "@waitron/printing";
import type { KitchenAllergyBlock } from "@waitron/module";
import { inTx, seat, setupPartyVenue } from "./testing/party-venue.js";
import { readBillEditState } from "./bill-editing.js";
import { attachPrinterToStation } from "./station-printers.js";
import { withStationDishes } from "./station-closing.js";
import { enqueueKitchenAllergyChanges } from "./kitchen-allergy.js";
import { allergyTargets, applyPartyAllergyPatch, readPartyAllergyView } from "./party-allergy.js";
import { ALLERGEN_NAMES } from "./i18n/kitchen-allergy.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
  useSplitExtrasDb(db);
});
afterEach(() => {
  vi.useRealTimers();
});

const AT = "2026-03-14T12:00:00.000Z";
const LATER = "2026-03-14T12:05:00.000Z";

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;
/** Either fixture venue: the helpers below read its config alone. */
type AnyVenue = Pick<Venue, "cfg">;

const dish = (venue: Venue, product: "burger" | "cheese", chips = false) => ({
  menuItemId: venue.tables.offerFor(venue.products[product]),
  quantity: "1",
  ...(chips
    ? {
        extras: [
          {
            listId: venue.lists.burger,
            picks: [{ productId: venue.products.chips, quantity: 1 }],
          },
        ],
      }
    : {}),
});

async function ticketItemOf(tx: Transaction, lineId: string): Promise<string> {
  const [row] = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  return row!.id;
}

/** A device with its own kitchen profile, which may run the pass. */
async function device(
  venue: AnyVenue,
  name: string,
  choice: { kitchenScreen?: DeviceKitchenScreen; stationId?: string },
): Promise<PassActor> {
  const [profile] = await withTransaction(db, (tx) =>
    tx
      .insert(deviceProfiles)
      .values({
        name: `${name} profile`,
        formFactor: "kds",
        capabilities: ["act-as-kds", "prepare-orders", "run-the-pass"],
      })
      .returning({ id: deviceProfiles.id }),
  );
  const joined = await enrolDeviceForTest(db, venue.cfg, {
    name,
    profileId: profile!.id,
    ...choice,
  });
  return { deviceId: joined.deviceId, personId: null };
}

const passOn = (
  venue: AnyVenue,
  name: string,
  stationIds: string[] | null,
  zoneIds: string[] | null = null,
) => device(venue, name, { kitchenScreen: { kind: "pass", stationIds, zoneIds } });

/** The device's pass screen's To fire cards, read as its board reads them. */
async function toFire(venue: AnyVenue, by: PassActor): Promise<PassCard[]> {
  return withTransaction(db, async (tx) => {
    const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, venue.cfg, by.deviceId)).find(
      (candidate) => candidate.kind === "pass",
    )!;
    return (await readScopedPassBoard(tx, venue.cfg, passScopeOf(screen))).toFire;
  });
}

const askOf = (card: PassCard) => ({
  submissionId: randomUUID(),
  target: card.target,
  ticketItemIds: card.releaseTicketItemIds,
  expectedContext: card.releaseContext,
});

const release = (
  venue: AnyVenue,
  by: PassActor,
  body: unknown,
  attendance?: Parameters<typeof releasePassItems>[4],
) => withTransaction(db, (tx) => releasePassItems(tx, venue.cfg, by, body, attendance));

async function rows(ids: string[]) {
  return withTransaction(db, (tx) =>
    tx.select().from(ticketItems).where(inArray(ticketItems.id, ids)).orderBy(asc(ticketItems.id)),
  );
}

async function jobCount(): Promise<number> {
  const [row] = await withTransaction(db, (tx) =>
    tx.select({ count: sql<number>`count(*)` }).from(printJobs),
  );
  return row!.count;
}

/** Refused with `code`, and the named rows and the print jobs as they were. */
async function refusedWhole(
  attempt: Promise<unknown>,
  code: string,
  ids: string[],
  params?: Record<string, unknown>,
) {
  const before = await rows(ids);
  const jobs = await jobCount();
  await expect(attempt).rejects.toMatchObject(params === undefined ? { code } : { code, params });
  expect(await rows(ids)).toEqual(before);
  expect(await jobCount()).toBe(jobs);
}

/** Grill and Cold wait; one Fire now group of a burger (Grill) and a salad (Cold), and a hot and
 *  a cold pass on the party's zone. */
async function hotAndCold() {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
  const venue = await setupSplitExtrasVenue();
  const placed = await withTransaction(db, async (tx) => {
    const cold = (await createStation(tx, venue.cfg, { name: "Cold" })).id;
    await routeProductTo(tx, venue.cfg, venue.products.cheese, cold);
    await setStationsWaitForPass(tx, true, [venue.stations.grill, cold]);
    const group = (
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger"), dish(venue, "cheese")], release: "fire" }],
      })
    ).groups[0]!;
    const [burgerLine, saladLine] = group.lineIds as [string, string];
    return {
      cold,
      groupId: group.id,
      burgerLine,
      burger: await ticketItemOf(tx, burgerLine),
      salad: await ticketItemOf(tx, saladLine),
    };
  });
  const hot = await passOn(venue, "Hot pass", [venue.stations.grill]);
  const coldPass = await passOn(venue, "Cold pass", [placed.cold]);
  return { venue, ...placed, hot, coldPass };
}

function thrown(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("A773 pass release: set and stamps", () => {
  it("releases disjoint sets from a hot and a cold pass on one zone", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    const [coldCard] = await toFire(f.venue, f.coldPass);
    expect(hotCard!.releaseTicketItemIds).toEqual([f.burger]);
    expect(coldCard!.releaseTicketItemIds).toEqual([f.salad]);
    const [burgerBefore, saladBefore] = [(await rows([f.burger]))[0]!, (await rows([f.salad]))[0]!];
    expect(burgerBefore).toMatchObject({
      requestedAt: AT,
      firedAt: null,
      passControlled: true,
      state: "queued",
    });

    vi.setSystemTime(new Date(LATER));
    expect(await release(f.venue, f.hot, askOf(hotCard!))).toEqual({
      releasedTicketItemIds: [f.burger],
    });
    expect(await rows([f.burger])).toEqual([{ ...burgerBefore, firedAt: LATER, queuedAt: LATER }]);
    expect((await rows([f.burger]))[0]).toMatchObject({
      requestedAt: AT,
      passControlled: true,
      state: "queued",
    });
    expect(await rows([f.salad])).toEqual([saladBefore]);

    expect(await release(f.venue, f.coldPass, askOf(coldCard!))).toEqual({
      releasedTicketItemIds: [f.salad],
    });
    expect(await rows([f.salad])).toEqual([{ ...saladBefore, firedAt: LATER, queuedAt: LATER }]);
  });

  it("refuses a forged mixed batch whole", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    await refusedWhole(
      release(f.venue, f.hot, { ...askOf(hotCard!), ticketItemIds: [f.burger, f.salad] }),
      "ticket.pass_context_changed",
      [f.burger, f.salad],
    );
  });

  it("refuses a pass on the wrong station, and a pass on the right station in another zone", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    const fryer = await passOn(f.venue, "Fryer pass", [f.venue.stations.fryer]);
    const elsewhere = await passOn(
      f.venue,
      "Counter grill pass",
      [f.venue.stations.grill],
      [f.venue.counter.zoneId],
    );
    for (const by of [fryer, elsewhere])
      await refusedWhole(release(f.venue, by, askOf(hotCard!)), "ticket.pass_context_changed", [
        f.burger,
        f.salad,
      ]);
  });

  it("refuses a pass with no zone left, and a dish in no zone to a zone-limited pass", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const group = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [{ lines: [dish(venue, "burger")], release: "fire" }],
        })
      ).groups[0]!;
      const counterId = await fireNewOrder(tx, venue.cfg, [
        { productId: venue.products.burger, quantity: "1" },
      ]);
      await tx.execute(
        sql`delete from order_service_contexts where working_order_id = ${counterId}`,
      );
      const [counterItem] = await tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, counterId));
      return {
        tabBurger: await ticketItemOf(tx, group.lineIds[0]!),
        counterId,
        counterBurger: counterItem!.id,
      };
    });
    const every = await passOn(venue, "Every pass", null);
    const tablesOnly = await passOn(venue, "Tables pass", null, [venue.party.zoneId]);
    const counterOnly = await passOn(venue, "Counter pass", null, [venue.counter.zoneId]);
    const monitor = await device(venue, "Monitor", {
      kitchenScreen: { kind: "pass_monitor", stationIds: null, zoneIds: null },
    });
    const station = await device(venue, "Grill screen", { stationId: venue.stations.grill });
    const cards = await toFire(venue, every);
    const tabCard = cards.find((card) => card.target.kind === "group")!;
    const counterCard = cards.find((card) => card.target.kind === "bill")!;
    expect(counterCard.target).toEqual({ kind: "bill", workingOrderId: placed.counterId });

    await withTransaction(db, (tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.party.zoneId)),
    );
    await refusedWhole(release(venue, tablesOnly, askOf(tabCard)), "ticket.pass_context_changed", [
      placed.tabBurger,
    ]);
    await refusedWhole(
      release(venue, counterOnly, askOf(counterCard)),
      "ticket.pass_context_changed",
      [placed.counterBurger],
    );
    for (const by of [monitor, station])
      await refusedWhole(release(venue, by, askOf(counterCard)), "device.unauthorized", [
        placed.counterBurger,
      ]);

    vi.setSystemTime(new Date(LATER));
    const [before] = await rows([placed.counterBurger]);
    expect(await release(venue, every, askOf(counterCard))).toEqual({
      releasedTicketItemIds: [placed.counterBurger],
    });
    expect(await rows([placed.counterBurger])).toEqual([
      { ...before, firedAt: LATER, queuedAt: LATER },
    ]);
  });

  it("refuses a malformed ask by its field", () => {
    const good = {
      submissionId: randomUUID(),
      target: { kind: "group", partyId: randomUUID(), groupId: randomUUID() },
      ticketItemIds: [randomUUID()],
      expectedContext: "a".repeat(64),
    };
    expect(passReleaseAsk(good)).toEqual(good);
    const id = randomUUID();
    for (const [body, field] of [
      [{ ...good, ticketItemIds: [] }, "ticketItemIds"],
      [{ ...good, ticketItemIds: [id, id] }, "ticketItemIds"],
      [{ ...good, ticketItemIds: ["x"] }, "ticketItemIds"],
      [{ ...good, target: { kind: "counter", orderId: randomUUID() } }, "target"],
      [{ ...good, expectedContext: "a".repeat(63) }, "expectedContext"],
    ] as const)
      expect(thrown(() => passReleaseAsk(body))).toMatchObject({
        code: "management.request_invalid",
        params: { field },
      });
  });

  it("refuses an ask naming anything but exactly the card's candidates", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill, venue.stations.fryer]);
      const groups = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [
            { lines: [dish(venue, "burger", true)], release: "fire" },
            { lines: [dish(venue, "burger")], release: "fire" },
            { lines: [dish(venue, "burger")], release: "hold" },
            { lines: [dish(venue, "burger")], release: "fire" },
            { lines: [dish(venue, "burger")], release: "hold" },
          ],
        })
      ).groups;
      const itemsOf = async (groupId: string) =>
        (
          await tx
            .select({ id: ticketItems.id, parentLineId: workingOrderLines.parentLineId })
            .from(ticketItems)
            .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
            .where(eq(workingOrderLines.groupId, groupId))
        ).sort((a, b) => Number(a.parentLineId !== null) - Number(b.parentLineId !== null));
      const [main, other, held, served, deleted] = groups as [
        (typeof groups)[0],
        (typeof groups)[0],
        (typeof groups)[0],
        (typeof groups)[0],
        (typeof groups)[0],
      ];
      const [burger, chips] = await itemsOf(main.id);
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, venue.party.partyId));
      await markServed(
        tx,
        venue.cfg,
        venue.party.partyId,
        [{ lineId: served.lineIds[0]!, quantity: "1" }],
        {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          expectedPartyRevision: party!.revision,
        },
      );
      const deletedItem = (await itemsOf(deleted.id))[0]!.id;
      await tx.delete(ticketItems).where(eq(ticketItems.id, deletedItem));
      return {
        mainGroup: main.id,
        burger: burger!.id,
        chips: chips!.id,
        other: (await itemsOf(other.id))[0]!.id,
        held: (await itemsOf(held.id))[0]!.id,
        served: (await itemsOf(served.id))[0]!.id,
        deleted: deletedItem,
      };
    });
    const every = await passOn(venue, "Every pass", null);
    const card = (await toFire(venue, every)).find(
      (entry) => entry.target.kind === "group" && entry.target.groupId === placed.mainGroup,
    )!;
    expect([...card.releaseTicketItemIds].sort()).toEqual([placed.burger, placed.chips].sort());
    const ask = askOf(card);
    const watched = [placed.burger, placed.chips, placed.other, placed.held, placed.served];
    for (const extra of [randomUUID(), placed.deleted, placed.served, placed.held, placed.other])
      await refusedWhole(
        release(venue, every, { ...ask, ticketItemIds: [...ask.ticketItemIds, extra] }),
        "ticket.pass_context_changed",
        watched,
      );
    await refusedWhole(
      release(venue, every, { ...ask, ticketItemIds: [placed.burger] }),
      "ticket.pass_context_changed",
      watched,
    );
  });

  it("neither sweeps a released dish nor offers it again", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    const ask = askOf(hotCard!);
    vi.setSystemTime(new Date(LATER));
    await release(f.venue, f.hot, ask);
    const released = await rows([f.burger]);
    expect(released).toEqual([expect.objectContaining({ firedAt: LATER, queuedAt: LATER })]);

    const fresh = await withTransaction(db, async (tx) => {
      const screen = (
        await VENUE_SERVICE.readDeviceKitchenScreens(tx, f.venue.cfg, f.hot.deviceId)
      ).find((candidate) => candidate.kind === "pass")!;
      return passCardRelease(
        hotCard!.target,
        await readPassCardRows(tx, f.venue.cfg, hotCard!.target),
        passScopeOf(screen),
      );
    });
    expect(fresh).toEqual({ ticketItemIds: [], context: null });

    await refusedWhole(
      release(f.venue, f.hot, { ...ask, submissionId: randomUUID() }),
      "ticket.pass_context_changed",
      [f.burger],
    );
    expect(await rows([f.burger])).toEqual(released);

    await withTransaction(db, (tx) =>
      fireOrderLines(
        tx,
        f.venue.cfg,
        f.venue.party.tabId,
        [f.burgerLine],
        undefined,
        routingOnce(tx, f.venue.cfg, new Date("2026-03-14T12:10:00.000Z")),
      ),
    );
    expect(await rows([f.burger])).toEqual(released);
  });
});

const ALL_PASS: CapabilityFlag[] = ["act-as-kds", "prepare-orders", "run-the-pass"];
const EVERY_PASS: DeviceKitchenScreen = { kind: "pass", stationIds: null, zoneIds: null };

/** A pass device on a profile of `formFactor` with exactly `capabilities`. */
async function profiledPass(
  venue: Venue,
  name: string,
  formFactor: FormFactor,
  capabilities: CapabilityFlag[],
): Promise<{ deviceId: string; profileId: string }> {
  const [profile] = await withTransaction(db, (tx) =>
    tx
      .insert(deviceProfiles)
      .values({ name: `${name} profile`, formFactor, capabilities })
      .returning({ id: deviceProfiles.id }),
  );
  const joined = await enrolDeviceForTest(db, venue.cfg, {
    name,
    profileId: profile!.id,
    kitchenScreen: EVERY_PASS,
  });
  return { deviceId: joined.deviceId, profileId: profile!.id };
}

/** A till pass signed in as a new person. */
async function signedInTillPass(venue: Venue, name: string) {
  const made = await profiledPass(venue, name, "till", ALL_PASS);
  const [person] = await withTransaction(db, (tx) =>
    tx
      .insert(persons)
      .values({ displayName: `${name} cook`, pinHash: fixturePinHash("2468"), role: "staff" })
      .returning({ id: persons.id }),
  );
  const personId = person!.id;
  const sessionId = await openTillSession(db, { deviceId: made.deviceId, personId });
  return { ...made, by: { deviceId: made.deviceId, personId, sessionId } satisfies PassActor };
}

/** Limits the profile's service to a department of its own, so the party's zone is not its. */
async function serveElsewhere(venue: Venue, profileId: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    const deli = await createDepartment(tx, venue.cfg, { name: "Deli", orderStart: "counter" });
    const zone = await createServiceZone(tx, venue.cfg, {
      name: "Deli counter",
      departmentId: deli.id,
    });
    await setProfileServiceAccess(tx, venue.cfg, profileId, {
      departmentId: deli.id,
      allowedZoneIds: null,
      startingZoneId: zone.id,
    });
  });
}

describe("A773 pass release: authority", () => {
  it("refuses a profile without the action, the flag, a person or the party's zone, writing nothing", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    const ask = askOf(hotCard!);
    const watched = [f.burger, f.salad];
    const noPrepare = await profiledPass(f.venue, "No prepare", "kds", [
      "act-as-kds",
      "run-the-pass",
    ]);
    const noFlag = await profiledPass(f.venue, "No flag", "kds", ["act-as-kds", "prepare-orders"]);
    const nobody = await profiledPass(f.venue, "Nobody", "till", ALL_PASS);
    const elsewhere = await signedInTillPass(f.venue, "Elsewhere");
    await serveElsewhere(f.venue, elsewhere.profileId);

    await refusedWhole(
      release(f.venue, { deviceId: noPrepare.deviceId, personId: null }, ask),
      "device.forbidden_action",
      watched,
      { action: "prepare-orders" },
    );
    await refusedWhole(
      release(f.venue, { deviceId: noFlag.deviceId, personId: null }, ask),
      "device.forbidden_action",
      watched,
      { action: "run-the-pass" },
    );
    await refusedWhole(
      release(f.venue, { deviceId: nobody.deviceId, personId: null }, ask),
      "session.required",
      watched,
    );
    await refusedWhole(release(f.venue, elsewhere.by, ask), "service_zone.not_allowed", watched);
  });

  it("answers the authority before the ask's shape", async () => {
    const venue = await setupSplitExtrasVenue();
    const body = { submissionId: randomUUID(), expectedPartyRevision: 0 };
    const noPrepare = await profiledPass(venue, "No prepare", "kds", [
      "act-as-kds",
      "run-the-pass",
    ]);
    const noFlag = await profiledPass(venue, "No flag", "kds", ["act-as-kds", "prepare-orders"]);
    const both = await profiledPass(venue, "Both", "kds", ALL_PASS);
    await expect(
      release(venue, { deviceId: noPrepare.deviceId, personId: null }, body),
    ).rejects.toMatchObject({
      code: "device.forbidden_action",
      params: { action: "prepare-orders" },
    });
    await expect(
      release(venue, { deviceId: noFlag.deviceId, personId: null }, body),
    ).rejects.toMatchObject({
      code: "device.forbidden_action",
      params: { action: "run-the-pass" },
    });
    await expect(
      release(venue, { deviceId: both.deviceId, personId: null }, body),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "ticketItemIds" },
    });
  });

  it("checks the party's zone after the ask's shape", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    const ask = askOf(hotCard!);
    const elsewhere = await signedInTillPass(f.venue, "Elsewhere");
    await serveElsewhere(f.venue, elsewhere.profileId);
    const malformed = {
      ...ask,
      target: { kind: "group", partyId: f.venue.party.partyId, groupId: "x" },
    };
    await refusedWhole(
      release(f.venue, elsewhere.by, malformed),
      "management.request_invalid",
      [f.burger, f.salad],
      { field: "target" },
    );
    await refusedWhole(release(f.venue, elsewhere.by, ask), "service_zone.not_allowed", [
      f.burger,
      f.salad,
    ]);
  });

  /** One Fire now group whose two burgers sit on two bills, and its one card. */
  async function burgersOnTwoBills() {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const billId = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger"), dish(venue, "burger")], release: "fire" }],
      });
      const second = placed.groups[0]!.lineIds[1]!;
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, venue.party.partyId));
      return (
        await moveDishes(tx, venue.cfg, venue.party.tabId, null, [second], {
          partyId: venue.party.partyId,
          expectedPartyRevision: party!.revision,
          operatorId: OPERATOR,
        })
      ).billId;
    });
    return { venue, billId };
  }

  const attendance = () => ({ recorder: recordAttendanceFact, clock: systemClock() });
  const factsOf = async (submissionId: string) =>
    (await withTransaction(db, (tx) => tx.select().from(attendanceOperationFacts))).filter((fact) =>
      fact.key.endsWith(`:${submissionId}`),
    );

  it("records the signed-in person's kitchen work once per released bill, and none when refused", async () => {
    const { venue, billId } = await burgersOnTwoBills();
    const till = await signedInTillPass(venue, "Till pass");
    const [card] = await toFire(venue, till.by);
    expect(card!.orders.map((order) => order.orderId).sort()).toEqual(
      [venue.party.tabId, billId].sort(),
    );

    const refused = { ...askOf(card!), expectedContext: "0".repeat(64) };
    await expect(release(venue, till.by, refused, attendance())).rejects.toMatchObject({
      code: "ticket.pass_context_changed",
    });
    expect(await factsOf(refused.submissionId)).toEqual([]);

    const ask = askOf(card!);
    await release(venue, till.by, ask, attendance());
    const facts = await factsOf(ask.submissionId);
    expect(facts.map((fact) => [fact.key, fact.personId, fact.kind, fact.outcome]).sort()).toEqual(
      [venue.party.tabId, billId]
        .map((id) => [`service:${id}:${ask.submissionId}`, till.by.personId, "order", "qualifying"])
        .sort(),
    );
  });

  it("records no kitchen work for a kitchen display's release", async () => {
    const { venue } = await burgersOnTwoBills();
    const display = await profiledPass(venue, "Display pass", "kds", ALL_PASS);
    const by: PassActor = { deviceId: display.deviceId, personId: null };
    const [card] = await toFire(venue, by);
    const ask = askOf(card!);
    expect(await release(venue, by, ask, attendance())).toEqual({
      releasedTicketItemIds: card!.releaseTicketItemIds,
    });
    expect(await factsOf(ask.submissionId)).toEqual([]);
  });
});

/** Every printer's decoded jobs, in the order they were queued. */
async function printed(venue: Venue): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const [name, id] of Object.entries(venue.printers)) out[name] = await printedAt(id);
  return out;
}

async function printedAt(printerId: string): Promise<string[]> {
  return (
    await withTransaction(db, (tx) =>
      tx
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, printerId))
        .orderBy(sql`rowid`),
    )
  ).map((job) => decodeTicket(job.payload));
}

/** What each printer gained between two {@link printed} reads. */
const gained = (before: Record<string, string[]>, after: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(after).map(([name, jobs]) => [name, jobs.slice(before[name]!.length)]),
  );

const nothing = { grill: [], fryer: [], kitchen: [], bar: [], pass: [] };

async function closedStationAlerts(orderId: string) {
  return (
    await withTransaction(db, (tx) =>
      tx.select().from(incidents).where(eq(incidents.code, "route.released_at_closed_station")),
    )
  ).filter((alert) => alert.params.workingOrderId === orderId);
}

async function partyRevisionOf(tx: Transaction, partyId: string): Promise<number> {
  const [row] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!.revision;
}

/** Grill waits; one Fire now group of one burger. */
async function requestedBurger(venue: Venue) {
  return withTransaction(db, async (tx) => {
    await setStationsWaitForPass(tx, true, [venue.stations.grill]);
    const group = (
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "fire" }],
      })
    ).groups[0]!;
    return {
      groupId: group.id,
      line: group.lineIds[0]!,
      item: await ticketItemOf(tx, group.lineIds[0]!),
    };
  });
}

const cardOf = async (venue: AnyVenue, by: PassActor, groupId: string) =>
  (await toFire(venue, by)).find(
    (card) => card.target.kind === "group" && card.target.groupId === groupId,
  )!;

const mover = (venue: Venue) => ({ deviceId: venue.cfg.origin.deviceId, personId: OPERATOR });

const ORIGINAL: KitchenAllergyBlock = {
  who: "Window guest",
  allergens: { milk: {} },
  note: "Separate pan",
  clashes: {},
  labels: {
    en: { avoids: ["Milk"], clashes: [] },
    es: { avoids: [ALLERGEN_NAMES.milk.es], clashes: [] },
  },
};
const CURRENT: KitchenAllergyBlock = { ...ORIGINAL, who: "Corrected guest", note: "New tools" };

describe("A773 pass release: paper", () => {
  it("prints once at each of a waiting station's printers, and only at the release", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const start = await printed(venue);
    const placed = await requestedBurger(venue);
    expect(gained(start, await printed(venue))).toEqual(nothing);
    const every = await passOn(venue, "Every pass", null);
    const card = await cardOf(venue, every, placed.groupId);

    const before = await printed(venue);
    vi.setSystemTime(new Date(LATER));
    await release(venue, every, askOf(card));
    const added = gained(before, await printed(venue));
    expect({ ...added, grill: [], pass: [] }).toEqual(nothing);
    for (const name of ["grill", "pass"] as const)
      expect(added[name]).toEqual(["Grill\nSplit extras\n1\n13:05\nGROUP 1\n1.000 x BURG\n"]);
  });

  it("marks the release FIRE where the group's HOLD paper printed", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const groupId = await withTransaction(db, async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true }, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const id = placed.groups[0]!.id;
      await fireGroup(tx, venue.cfg, venue.party.partyId, id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevisionOf(tx, venue.party.partyId),
      });
      return id;
    });
    expect((await printedAt(venue.printers.grill)).join("\n")).toContain("*** HOLD ***");
    const every = await passOn(venue, "Every pass", null);
    const card = await cardOf(venue, every, groupId);
    const before = await printed(venue);
    await release(venue, every, askOf(card));
    const added = gained(before, await printed(venue));
    expect(added.grill).toHaveLength(1);
    expect(added.grill![0]).toContain(`*** ${kitchenTicketWords("en").fire} ***`);
    expect(added.grill![0]).toContain("1.000 x BURG");
  });

  it("prints what is left to serve, the chips in proportion", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const lineId = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill, venue.stations.fryer]);
      await addTabRound(tx, venue.cfg, venue.party.tabId, [
        { ...dish(venue, "burger", true), quantity: "2" },
      ]);
      const [burger] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.productId, venue.products.burger));
      await markServed(
        tx,
        venue.cfg,
        venue.party.partyId,
        [{ lineId: burger!.id, quantity: "1" }],
        {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          expectedPartyRevision: await partyRevisionOf(tx, venue.party.partyId),
        },
      );
      return burger!.id;
    });
    const every = await passOn(venue, "Every pass", null);
    const [card] = await toFire(venue, every);
    expect(card!.items.find((item) => item.lineId === lineId)!.qty).toBe("1.000");
    const before = await printed(venue);
    await release(venue, every, askOf(card!));
    const added = gained(before, await printed(venue));
    expect(added.grill).toHaveLength(1);
    expect(added.grill![0]).toContain("1.000 x BURG");
    expect(added.fryer).toHaveLength(1);
    expect(added.fryer![0]).toContain("1.000 x CHIPS");
  });
  it("prints the frozen allergy block, then the correction, where the answer changed while the dish waited", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const v = await setupPartyVenue(db);
    const [station] = await v.db
      .select()
      .from(kitchenStations)
      .where(eq(kitchenStations.isDefault, true));
    const stationId = station!.id;
    const printerId = await inTx(v, async (tx) => {
      const p = await createPrinter(tx, {
        name: "Lifecycle paper",
        transport: "cloud_poll",
        pollId: randomUUID(),
      });
      await attachPrinterToStation(tx, {
        locationId: v.cfg.locationId,
        stationId,
        printerId: p.id,
      });
      await setStationsWaitForPass(tx, true, [stationId]);
      return p.id;
    });
    const p = await seat(v, await v.table("Allergy"));
    const submit = (
      guests: { who: string; allergens: KitchenAllergyBlock["allergens"]; note: string }[],
    ) =>
      inTx(v, async (tx) =>
        submitGroups(tx, v.cfg, p.partyId, {
          submissionId: randomUUID(),
          expectedPartyRevision: await partyRevisionOf(tx, p.partyId),
          operatorId: OPERATOR,
          expectedEdit: await readBillEditState(tx, p.tabId),
          groups: [{ release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
          allergy: {
            party: { answer: "allergies", guests },
            ticks: [{ line: { kind: "submitted", groupIndex: 0, lineIndex: 0 }, guestIndex: 0 }],
          },
        }),
      );
    const first = (
      await submit([{ who: ORIGINAL.who, allergens: ORIGINAL.allergens, note: "Separate pan" }])
    ).groups[0]!.id;
    const notices = () => inTx(v, (tx) => VENUE_SERVICE.listStationNotices(tx, v.cfg, stationId));
    const jobs = async () => (await printedAt(printerId)).length;

    const before = await jobs();
    await inTx(v, async (tx) => {
      const view = await readPartyAllergyView(tx, v.cfg, p.partyId);
      const changes = await applyPartyAllergyPatch(
        tx,
        p.partyId,
        {
          party: {
            answer: "allergies",
            guests: [{ ...view.snapshot.guests[0]!, who: CURRENT.who, note: "New tools" }],
          },
          ticks: [],
        },
        OPERATOR,
        allergyTargets(view),
      );
      await enqueueKitchenAllergyChanges(tx, v.cfg, changes);
    });
    expect(await jobs()).toBe(before);
    expect(await notices()).toEqual([]);

    const every = await passOn(v, "Every pass", null);
    await release(v, every, askOf(await cardOf(v, every, first)));
    const added = (await printedAt(printerId)).slice(before);
    expect(added).toEqual([
      "!!! ALERGIA EN ESTE TICKET !!!\nCocina\nAllergy\n1\n13:00\nGRUPO 1\n1.000 x BURG\n" +
        "  *** ALERGIA: Window guest ***\n  LECHE\n  Separate pan\n",
      "*** ALERGIA CAMBIADA ***\nCocina\nAllergy\n1\n13:00\n1.000 x BURG\n" +
        "  *** ALERGIA: Corrected guest ***\n  LECHE\n  New tools\n",
    ]);
    expect((await notices()).map((notice) => notice.kind)).toEqual(["allergy_changed"]);

    const second = (
      await submit([{ who: CURRENT.who, allergens: CURRENT.allergens, note: "New tools" }])
    ).groups[0]!.id;
    const beforeSecond = await jobs();
    const noticesBefore = await notices();
    await release(v, every, askOf(await cardOf(v, every, second)));
    const secondAdded = (await printedAt(printerId)).slice(beforeSecond);
    expect(secondAdded).toHaveLength(1);
    expect(secondAdded[0]).toContain("*** ALERGIA: Corrected guest ***");
    expect(await notices()).toEqual(noticesBefore);
  });

  it("refuses a dish at a station closed since the card was read, and offers it once moved", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await requestedBurger(venue);
    const every = await passOn(venue, "Every pass", null);
    const stale = await cardOf(venue, every, placed.groupId);
    await withTransaction(db, (tx) =>
      setStationToday(tx, venue.cfg, venue.stations.grill, "closed", new Date(AT)),
    );
    await refusedWhole(release(venue, every, askOf(stale)), "ticket.pass_context_changed", [
      placed.item,
    ]);
    const refreshed = await cardOf(venue, every, placed.groupId);
    expect(refreshed.releaseTicketItemIds).toEqual([]);
    expect(refreshed.releaseContext).toBeNull();
    expect(refreshed.items.find((item) => item.id === placed.item)!.stationClosed).toBe(true);

    await withTransaction(db, (tx) =>
      moveDishesToStation(
        tx,
        venue.cfg,
        venue.party.tabId,
        { submissionId: randomUUID(), lineIds: [placed.line], stationId: venue.stations.fryer },
        mover(venue),
      ),
    );
    expect((await rows([placed.item]))[0]).toMatchObject({
      stationId: venue.stations.fryer,
      requestedAt: AT,
      firedAt: null,
    });
    const moved = await cardOf(venue, every, placed.groupId);
    expect(moved.releaseTicketItemIds).toEqual([placed.item]);
    const before = await printed(venue);
    await release(venue, every, askOf(moved));
    const added = gained(before, await printed(venue));
    expect(added.fryer).toHaveLength(1);
    expect(added.fryer![0]).toContain("1.000 x BURG");
    expect(added.grill).toEqual([]);
    expect(await closedStationAlerts(venue.party.tabId)).toEqual([]);
  });

  it("prints at a closed station a dish was left at", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await requestedBurger(venue);
    await withTransaction(db, (tx) =>
      withStationDishes(
        tx,
        venue.cfg,
        venue.stations.grill,
        undefined,
        "leave",
        (at) => setStationToday(tx, venue.cfg, venue.stations.grill, "closed", at),
        { deviceId: venue.cfg.origin.deviceId, personId: null },
      ),
    );
    const every = await passOn(venue, "Every pass", null);
    const card = await cardOf(venue, every, placed.groupId);
    expect(card.releaseTicketItemIds).toEqual([placed.item]);
    const before = await printed(venue);
    await release(venue, every, askOf(card));
    const added = gained(before, await printed(venue));
    expect(added.grill).toHaveLength(1);
    expect(added.grill![0]).toContain("1.000 x BURG");
    expect(await closedStationAlerts(venue.party.tabId)).toEqual([]);
  });

  it("prints at a closed station a settled bill's dish was moved to by hand", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await requestedBurger(venue);
    await withTransaction(db, async (tx) => {
      await tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: AT })
        .where(eq(workingOrders.id, venue.party.tabId));
      await setStationToday(tx, venue.cfg, venue.stations.bar, "closed", new Date(AT));
      await moveDishesToStation(
        tx,
        venue.cfg,
        venue.party.tabId,
        { submissionId: randomUUID(), lineIds: [placed.line], stationId: venue.stations.bar },
        mover(venue),
      );
    });
    const [line] = await withTransaction(db, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, placed.line)),
    );
    expect(line!.makeAtStationId).not.toBe(venue.stations.bar);
    const every = await passOn(venue, "Every pass", null);
    const card = await cardOf(venue, every, placed.groupId);
    expect(card.releaseTicketItemIds).toEqual([placed.item]);
    const before = await printed(venue);
    await release(venue, every, askOf(card));
    const added = gained(before, await printed(venue));
    expect(added.bar).toHaveLength(1);
    expect(added.bar![0]).toContain("1.000 x BURG");
    expect(await closedStationAlerts(venue.party.tabId)).toEqual([]);
  });

  it("fires a split-off extra at its closed station, which no move can free", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await withTransaction(db, async (tx) => {
      const group = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [{ lines: [dish(venue, "burger", true)], release: "hold" }],
        })
      ).groups[0]!;
      const [chips] = await tx
        .select({ id: ticketItems.id, lineId: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.productId, venue.products.chips));
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await setStationToday(tx, venue.cfg, venue.stations.fryer, "closed", new Date(AT));
      await fireGroup(tx, venue.cfg, venue.party.partyId, group.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevisionOf(tx, venue.party.partyId),
      });
      return { groupId: group.id, chips: chips!.id, chipsLine: chips!.lineId };
    });
    const fireAlerts = await closedStationAlerts(venue.party.tabId);
    expect(fireAlerts).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ station: "Fryer", dishes: "Chips" }),
      }),
    ]);
    const every = await passOn(venue, "Every pass", null);
    const card = await cardOf(venue, every, placed.groupId);
    expect(card.releaseTicketItemIds).toEqual([placed.chips]);
    expect(card.releaseContext).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      withTransaction(db, (tx) =>
        moveDishesToStation(
          tx,
          venue.cfg,
          venue.party.tabId,
          {
            submissionId: randomUUID(),
            lineIds: [placed.chipsLine],
            stationId: venue.stations.kitchen,
          },
          mover(venue),
        ),
      ),
    ).rejects.toMatchObject({ code: "ticket.extra_not_movable" });

    const before = await printed(venue);
    vi.setSystemTime(new Date(LATER));
    await release(venue, every, askOf(card));
    const added = gained(before, await printed(venue));
    expect({ ...added, fryer: [], pass: [] }).toEqual(nothing);
    expect(added.fryer).toHaveLength(1);
    expect(added.fryer![0]).toContain("1.000 x CHIPS");
    expect((await rows([placed.chips]))[0]).toMatchObject({
      stationId: venue.stations.fryer,
      firedAt: LATER,
    });
    expect(await closedStationAlerts(venue.party.tabId)).toEqual(fireAlerts);
  });

  it.each([true, false])(
    "raises the closed-station alert at the waiter's fire, and never again (Grill waits: %s)",
    async (waits) => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
      const venue = await setupSplitExtrasVenue();
      const placed = await withTransaction(db, async (tx) => {
        await tx
          .update(kitchenStations)
          .set({ isDefault: false })
          .where(eq(kitchenStations.id, venue.stations.kitchen));
        const group = (
          await placeGroups(tx, venue.cfg, venue.party.partyId, {
            operatorId: OPERATOR,
            groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
          })
        ).groups[0]!;
        if (waits) await setStationsWaitForPass(tx, true, [venue.stations.grill]);
        await setStationToday(tx, venue.cfg, venue.stations.grill, "closed", new Date(AT));
        await fireGroup(tx, venue.cfg, venue.party.partyId, group.id, {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          expectedPartyRevision: await partyRevisionOf(tx, venue.party.partyId),
        });
        return { groupId: group.id, item: await ticketItemOf(tx, group.lineIds[0]!) };
      });
      expect((await rows([placed.item]))[0]).toMatchObject({
        stationId: venue.stations.grill,
        requestedAt: AT,
        firedAt: waits ? null : AT,
      });
      const alerts = await closedStationAlerts(venue.party.tabId);
      expect(alerts).toHaveLength(1);
      if (!waits) return;
      const every = await passOn(venue, "Every pass", null);
      const card = await cardOf(venue, every, placed.groupId);
      expect(card.releaseTicketItemIds).toEqual([]);
      await expect(
        release(venue, every, {
          ...askOf(card),
          ticketItemIds: [placed.item],
          expectedContext: "0".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "ticket.pass_context_changed" });
      expect(await closedStationAlerts(venue.party.tabId)).toEqual(alerts);
    },
  );

  it("prints a moved dish under its current bill's number", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await requestedBurger(venue);
    const billId = await withTransaction(
      db,
      async (tx) =>
        (
          await moveDishes(tx, venue.cfg, venue.party.tabId, null, [placed.line], {
            partyId: venue.party.partyId,
            expectedPartyRevision: await partyRevisionOf(tx, venue.party.partyId),
            operatorId: OPERATOR,
          })
        ).billId,
    );
    const [bill] = await withTransaction(db, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
    );
    const every = await passOn(venue, "Every pass", null);
    const card = await cardOf(venue, every, placed.groupId);
    const header = card.orders.find((order) => order.orderId === billId)!;
    expect(header).not.toHaveProperty("formerNumbers");
    const before = await printed(venue);
    await release(venue, every, askOf(card));
    const added = gained(before, await printed(venue));
    const [tab] = await withTransaction(db, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, venue.party.tabId)),
    );
    expect(bill!.orderNumber).not.toBe(tab!.orderNumber);
    expect({ ...added, grill: [], pass: [] }).toEqual(nothing);
    for (const name of ["grill", "pass"] as const)
      expect(added[name]).toEqual([
        `Grill\nSplit extras\n${bill!.orderNumber}\n13:00\nGROUP 1\n1.000 x BURG\n`,
      ]);
  });
});
