import { createException } from "@waitron/venue-service";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  orderGroups,
  serviceCommands,
  parties,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { writeReleaseReminderMinutes } from "@waitron/venue-service";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { saveDraft, submitDraft, type Draft, type DraftLineInput } from "./order-drafts.js";
import {
  bumpGroupReady,
  fireGroup,
  moveLinesToGroup,
  readCurrentOrders,
  releaseReminder,
  reorderHeldGroups,
  snoozeReminder,
  submitGroups,
  unsnoozeReminder,
  type GroupLine,
  type GroupRelease,
} from "./order-groups.js";
import { createTable } from "./tables.js";
import type { TillConfig } from "./till-config.js";
import { payWorkingOrder } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import { finishTable, seatTable } from "./parties.js";
import {
  addTabRound,
  listTablesWithState,
  markGroupServed,
  markServed,
  recallLines,
} from "./working-order.js";
import "./errors.js";
import { splitBill } from "./bill-actions.js";
import { joinTables } from "./table-actions.js";
import { nifWithControlLetter } from "./testing/nif.js";

// The release reminder (spec §4 "Remind staff to release the next group"; plan D11), its snooze,
// and the Current orders read a waiter serves from (spec §4; D8, D18, D19).
const LOCALE = "es-ES";
const ALEX = "cccccccc-0000-4000-8000-00000000000a";
const MIA = "cccccccc-0000-4000-8000-00000000000b";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;
let taxIds = 0;

beforeAll(() => {
  clock = {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("current-orders.test: anchor() is not used");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("current-orders.test: filing never contacts AEAT")),
  });
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

const DISHES = {
  croquetas: "8.00",
  steak: "22.00",
  sauce: "1.50",
  flan: "5.00",
  water: "2.00",
} as const;
type Dish = keyof typeof DISHES;

interface Venue {
  cfg: TillConfig;
  zoneId: string;
  offer(dish: Dish): string;
  extrasListId: string;
  sauceId: string;
}

async function setupVenue(): Promise<Venue> {
  taxIds += 1;
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nifWithControlLetter(63_000_000 + taxIds),
        legalName: "Comandas SL",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Restaurante",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  const cfg: TillConfig = {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  return inTx(async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: "Platos" });
    const productId = {} as Record<Dish, string>;
    // Three different names, so a row showing the customer's or the kitchen's name fails.
    for (const [dish, unitPrice] of Object.entries(DISHES) as [Dish, string][]) {
      productId[dish] = (
        await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          name: dish,
          customerName: { [LOCALE]: `menu ${dish}` },
          kitchenName: `KITCHEN ${dish}`,
          pricingUnit: "each",
          unitPrice,
          vatClass: "general",
        })
      ).id;
    }
    const extras = await createExtraList(
      tx,
      {
        name: "Salsas",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [{ productId: productId.sauce, maxQuantity: 1, preselected: false, price: "1.50" }],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, productId.steak, [{ kind: "extras", id: extras.id }]);
    await assignCatalogueToLocation(tx, venue.locationId, catalogue.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    // Bottled water is handed over at the bar: no kitchen ticket, only a sent stamp.
    await createException(tx, cfg, {
      zoneId: null,
      categoryId: null,
      productId: productId.water,
      target: { kind: "no_preparation" },
    });
    return {
      cfg,
      zoneId: offers.zoneId,
      offer: (dish: Dish) => offers.offerFor(productId[dish]),
      extrasListId: extras.id,
      sauceId: productId.sauce,
    };
  });
}

interface Seated {
  partyId: string;
  tabId: string;
  tableId: string;
}

async function seated(v: Venue): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, {
      label: `C-${randomUUID().slice(0, 6)}`,
      zoneId: v.zoneId,
    });
    const { partyId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 2,
      operatorId: ALEX,
    });
    return { partyId, tabId, tableId };
  });
}

function line(v: Venue, dish: Dish, quantity = "1"): GroupLine {
  return { menuItemId: v.offer(dish), quantity };
}

async function revisionOf(partyId: string): Promise<number> {
  const [row] = await suite.db
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!.revision;
}

interface CommandOptions {
  submissionId?: string;
  revision?: number;
}

async function args(partyId: string, opts: CommandOptions = {}) {
  return {
    submissionId: opts.submissionId ?? randomUUID(),
    expectedPartyRevision: opts.revision ?? (await revisionOf(partyId)),
    operatorId: ALEX,
  };
}

/** Submits one group; answers its id and its dish lines. */
async function group(
  v: Venue,
  partyId: string,
  release: GroupRelease,
  lines: GroupLine[],
): Promise<{ id: string; lineIds: string[] }> {
  const command = await args(partyId);
  const { groups } = await inTx((tx) =>
    submitGroups(tx, v.cfg, partyId, { ...command, groups: [{ release, lines }] }),
  );
  return { id: groups[0]!.id, lineIds: groups[0]!.lineIds };
}

async function fire(v: Venue, partyId: string, groupId: string) {
  const command = await args(partyId);
  return inTx((tx) => fireGroup(tx, v.cfg, partyId, groupId, command));
}

async function serveGroup(v: Venue, partyId: string, groupId: string) {
  const command = await args(partyId);
  return inTx((tx) => markGroupServed(tx, v.cfg, partyId, groupId, command));
}

async function serve(v: Venue, partyId: string, items: { lineId: string; quantity: string }[]) {
  const command = await args(partyId);
  return inTx((tx) => markServed(tx, v.cfg, partyId, items, command));
}

async function snooze(
  v: Venue,
  partyId: string,
  groupId: string,
  minutes: number,
  opts: CommandOptions = {},
) {
  const command = await args(partyId, opts);
  return inTx((tx) => snoozeReminder(tx, v.cfg, partyId, groupId, minutes, command));
}

async function unsnooze(v: Venue, partyId: string, groupId: string, opts: CommandOptions = {}) {
  const command = await args(partyId, opts);
  return inTx((tx) => unsnoozeReminder(tx, v.cfg, partyId, groupId, command));
}

async function reorder(partyId: string, heldGroupIds: string[]) {
  const command = await args(partyId);
  return inTx((tx) => reorderHeldGroups(tx, partyId, heldGroupIds, command));
}

async function floorReminder(v: Venue, tableId: string) {
  const rows = await inTx((tx) => listTablesWithState(tx, v.cfg));
  return rows.find((row) => row.id === tableId)!.party!.reminder;
}

async function currentOrders(partyId: string) {
  return inTx((tx) => readCurrentOrders(tx, partyId));
}

async function remindAtOf(groupId: string): Promise<string | null> {
  const [row] = await suite.db
    .select({ remindAt: orderGroups.remindAt })
    .from(orderGroups)
    .where(eq(orderGroups.id, groupId));
  return row!.remindAt;
}

async function servedAtOf(lineIds: string[]) {
  return suite.db
    .select({ id: workingOrderLines.id, servedAt: workingOrderLines.servedAt })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, lineIds))
    .orderBy(workingOrderLines.id);
}

/** 20:mm on the test's evening, as the server stamps it. */
const T = (minute: number, hour = 20) =>
  `2026-09-28T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

/** Runs `fn` with the clock set to `iso`; only `Date` is faked, so the database's timers run. */
async function at<R>(iso: string, fn: () => Promise<R>): Promise<R> {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(iso));
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

/** Groups 1–2 fired (Croquetas, Steak ×2), groups 3–4 held (Flan, then Water), on one party. */
async function fourGroups(v: Venue) {
  const s = await seated(v);
  const g1 = await group(v, s.partyId, "fire", [line(v, "croquetas")]);
  const g2 = await group(v, s.partyId, "fire", [line(v, "steak", "2")]);
  const g3 = await group(v, s.partyId, "hold", [line(v, "flan")]);
  const g4 = await group(v, s.partyId, "hold", [line(v, "water")]);
  return { ...s, g1, g2, g3, g4 };
}

/** {@link fourGroups} with group 1 fully served at 20:00 and group 2 at 20:05. */
async function servedUpToGroupTwo(v: Venue) {
  const s = await fourGroups(v);
  await at(T(0), () => serveGroup(v, s.partyId, s.g1.id));
  await at(T(5), () => serveGroup(v, s.partyId, s.g2.id));
  return s;
}

/** Every row a snooze could write. */
async function snapshot(partyId: string) {
  return {
    party: await suite.db.select().from(parties).where(eq(parties.id, partyId)),
    groups: await suite.db
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.partyId, partyId))
      .orderBy(orderGroups.id),
    lines: await suite.db
      .select()
      .from(workingOrderLines)
      .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
      .where(eq(workingOrders.partyId, partyId))
      .orderBy(workingOrderLines.id),
    commands: await suite.db
      .select()
      .from(serviceCommands)
      .where(eq(serviceCommands.scopeId, partyId))
      .orderBy(serviceCommands.id),
  };
}

async function expectRefusedWithNothingWritten(
  partyId: string,
  attempt: () => Promise<unknown>,
  expected: { code: string; params?: Record<string, unknown> },
): Promise<void> {
  const before = await snapshot(partyId);
  await expect(attempt()).rejects.toMatchObject(expected);
  expect(await snapshot(partyId)).toEqual(before);
}

describe("releaseReminder (pure; D11)", () => {
  const fired = (id: string) => ({ id, state: "fired" as const, remindAt: null });
  const held = (id: string, remindAt: string | null = null) => ({
    id,
    state: "held" as const,
    remindAt,
  });

  it("is due the interval after the latest served time of the fired groups before the first held one", () => {
    expect(
      releaseReminder(
        [fired("g1"), fired("g2"), held("g3"), held("g4")],
        [
          { groupId: "g1", servedAt: T(0) },
          { groupId: "g2", servedAt: T(5) },
          { groupId: "g2", servedAt: T(2) },
        ],
        10,
      ),
    ).toEqual({ groupId: "g3", dueAt: T(15) });
  });

  it("has no time while a dish line of an earlier fired group is unserved", () => {
    expect(
      releaseReminder(
        [fired("g1"), fired("g2"), held("g3")],
        [
          { groupId: "g1", servedAt: T(0) },
          { groupId: "g2", servedAt: null },
        ],
        10,
      ),
    ).toEqual({ groupId: "g3", dueAt: null });
  });

  it("keeps no time for a snooze while an earlier fired group is unserved", () => {
    expect(
      releaseReminder([fired("g1"), held("g2", T(30))], [{ groupId: "g1", servedAt: null }], 10),
    ).toEqual({ groupId: "g2", dueAt: null });
  });

  it("is due at the snooze once the work before it is served", () => {
    expect(
      releaseReminder([fired("g1"), held("g2", T(40))], [{ groupId: "g1", servedAt: T(0) }], 10),
    ).toEqual({ groupId: "g2", dueAt: T(40) });
  });

  it("lets a fired group with no dish line neither hold the reminder up nor date it", () => {
    expect(
      releaseReminder(
        [fired("g1"), fired("empty"), held("g3")],
        [{ groupId: "g1", servedAt: T(0) }],
        10,
      ),
    ).toEqual({ groupId: "g3", dueAt: T(10) });
  });

  it("names a first held group with no fired group before it, without a time unless snoozed", () => {
    expect(releaseReminder([held("g1"), fired("g2")], [], 10)).toEqual({
      groupId: "g1",
      dueAt: null,
    });
    expect(releaseReminder([held("g1", T(20))], [], 10)).toEqual({ groupId: "g1", dueAt: T(20) });
  });

  it("reads only the fired groups BEFORE the waiting one, and ignores lines in no group", () => {
    expect(
      releaseReminder(
        [fired("g1"), held("g2"), fired("g3")],
        [
          { groupId: "g1", servedAt: T(0) },
          { groupId: "g3", servedAt: null },
          { groupId: null, servedAt: null },
        ],
        10,
      ),
    ).toEqual({ groupId: "g2", dueAt: T(10) });
  });

  it("is none with no held group, and none at all while reminders are off", () => {
    expect(releaseReminder([fired("g1")], [{ groupId: "g1", servedAt: T(0) }], 10)).toBeNull();
    expect(releaseReminder([fired("g1"), held("g2", T(20))], [], null)).toBeNull();
  });
});

describe("the reminder on the floor and in Current orders (D11)", () => {
  it("makes group 3 due at 20:15 when group 1 was fully served at 20:00 and group 2 at 20:05", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);

    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(15) });
    expect((await currentOrders(s.partyId)).reminder).toEqual({
      groupId: s.g3.id,
      dueAt: T(15),
    });
  });

  it("shows group 3 without a time while group 2 is not fully served", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);
    await at(T(0), () => serveGroup(v, s.partyId, s.g1.id));

    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: null });

    await at(T(5), () => serve(v, s.partyId, [{ lineId: s.g2.lineIds[0]!, quantity: "1" }]));

    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: null });
    expect((await currentOrders(s.partyId)).reminder).toEqual({ groupId: s.g3.id, dueAt: null });
  });

  it("makes it due at 20:20 when snoozed 5 minutes at 20:15, leaving group 2's served time as it was", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const servedBefore = await servedAtOf(s.g2.lineIds);
    const revision = await revisionOf(s.partyId);

    const answer = await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));

    expect(answer).toEqual({ revision: revision + 1 });
    expect(await remindAtOf(s.g3.id)).toBe(T(20));
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(20) });
    expect(await servedAtOf(s.g2.lineIds)).toEqual(servedBefore);
    expect(servedBefore[0]!.servedAt).toBe(T(5));
  });

  it("clears the reminder when group 3 fires, and group 4 becomes the one waiting", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));

    await fire(v, s.partyId, s.g3.id);

    expect(await remindAtOf(s.g3.id)).toBeNull();
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g4.id, dueAt: null });
    await at(T(30), () => serveGroup(v, s.partyId, s.g3.id));
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g4.id, dueAt: T(40) });
  });

  it("moves the reminder to group 4 when it is reordered ahead of group 3, clearing group 3's snooze", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));

    await reorder(s.partyId, [s.g4.id, s.g3.id]);

    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g4.id, dueAt: T(15) });
    expect(await remindAtOf(s.g3.id)).toBeNull();
  });

  it("keeps a snooze through a reorder that leaves its group where it was", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));

    await reorder(s.partyId, [s.g3.id, s.g4.id]);

    expect(await remindAtOf(s.g3.id)).toBe(T(20));
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(20) });
  });

  it("clears the snooze of a group reordered FORWARD, which a merge left behind the waiting one", async () => {
    const v = await setupVenue();
    const a = await seated(v);
    const aFired = await group(v, a.partyId, "fire", [line(v, "croquetas")]);
    const aHeld = await group(v, a.partyId, "hold", [line(v, "flan")]);
    await at(T(0), () => serveGroup(v, a.partyId, aFired.id));
    const b = await seated(v);
    const bHeld = await group(v, b.partyId, "hold", [line(v, "water")]);
    await at(T(15), () => snooze(v, b.partyId, bHeld.id, 5));
    const command = {
      bills: "merge" as const,
      expectedPartyRevision: await revisionOf(a.partyId),
      otherPartyId: b.partyId,
      expectedOtherPartyRevision: await revisionOf(b.partyId),
      operatorId: ALEX,
    };
    await inTx((tx) => joinTables(tx, v.cfg, a.partyId, b.tableId, command));
    expect(await remindAtOf(bHeld.id)).toBe(T(20));
    expect(await floorReminder(v, a.tableId)).toEqual({ groupId: aHeld.id, dueAt: T(10) });

    await reorder(a.partyId, [bHeld.id, aHeld.id]);

    expect(await remindAtOf(bHeld.id)).toBeNull();
    expect(await floorReminder(v, a.tableId)).toEqual({ groupId: bHeld.id, dueAt: T(10) });
  });

  it("moves the reminder on when group 3 is emptied, which removes it and clears its snooze", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));
    const command = await args(s.partyId);

    await inTx((tx) =>
      moveLinesToGroup(
        tx,
        v.cfg,
        s.partyId,
        [{ lineId: s.g3.lineIds[0]!, quantity: "1" }],
        { groupId: s.g4.id },
        command,
      ),
    );

    const [removed] = await suite.db
      .select({ state: orderGroups.state, remindAt: orderGroups.remindAt })
      .from(orderGroups)
      .where(eq(orderGroups.id, s.g3.id));
    expect(removed).toEqual({ state: "removed", remindAt: null });
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g4.id, dueAt: T(15) });
    expect((await currentOrders(s.partyId)).groups.map((g) => g.id)).toEqual([
      s.g1.id,
      s.g2.id,
      s.g4.id,
    ]);
  });

  it("shows no reminder at all while the venue has reminders off", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await inTx((tx) => writeReleaseReminderMinutes(tx, null));

    expect(await floorReminder(v, s.tableId)).toBeNull();
    expect((await currentOrders(s.partyId)).reminder).toBeNull();
  });

  it("measures from the venue's interval, and shows none for a party with no held group", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const bare = await seated(v);
    await group(v, bare.partyId, "fire", [line(v, "croquetas")]);
    await inTx((tx) => writeReleaseReminderMinutes(tx, 25));

    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(30) });
    expect(await floorReminder(v, bare.tableId)).toBeNull();
  });

  it("gives each party on the floor its own reminder from one read", async () => {
    const v = await setupVenue();
    const a = await servedUpToGroupTwo(v);
    const b = await fourGroups(v);

    const rows = await inTx((tx) => listTablesWithState(tx, v.cfg));

    expect(rows.find((row) => row.id === a.tableId)!.party!.reminder).toEqual({
      groupId: a.g3.id,
      dueAt: T(15),
    });
    expect(rows.find((row) => row.id === b.tableId)!.party!.reminder).toEqual({
      groupId: b.g3.id,
      dueAt: null,
    });
  });
});

describe("snoozeReminder (D8, D11, D19)", () => {
  it("answers a repeat of the same submission with the first answer and moves nothing", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const submissionId = randomUUID();
    const revision = await revisionOf(s.partyId);
    const first = await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5, { submissionId }));
    const before = await snapshot(s.partyId);

    const again = await at(T(18), () =>
      snooze(v, s.partyId, s.g3.id, 5, { submissionId, revision }),
    );

    expect(again).toEqual(first);
    expect(await snapshot(s.partyId)).toEqual(before);
    expect(await remindAtOf(s.g3.id)).toBe(T(20));
  });

  it("refuses the same submission id with other minutes (submission.id_reused), writing nothing", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const submissionId = randomUUID();
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5, { submissionId }));

    await expectRefusedWithNothingWritten(
      s.partyId,
      () => snooze(v, s.partyId, s.g3.id, 10, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses a stale revision (party.out_of_date), writing nothing", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const revision = await revisionOf(s.partyId);

    await expectRefusedWithNothingWritten(
      s.partyId,
      () => snooze(v, s.partyId, s.g3.id, 5, { revision: revision - 1 }),
      { code: "party.out_of_date", params: { partyId: s.partyId, revision } },
    );
  });

  it("refuses a fired group (group.not_held), writing nothing", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);

    await expectRefusedWithNothingWritten(s.partyId, () => snooze(v, s.partyId, s.g1.id, 5), {
      code: "group.not_held",
      params: { groupId: s.g1.id },
    });
  });

  it("refuses a held group that is not the one waiting (group.not_waiting), writing nothing", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));

    await at(T(16), () =>
      expectRefusedWithNothingWritten(s.partyId, () => snooze(v, s.partyId, s.g4.id, 120), {
        code: "group.not_waiting",
        params: { groupId: s.g4.id },
      }),
    );

    expect(await remindAtOf(s.g3.id)).toBe(T(20));
    expect(await remindAtOf(s.g4.id)).toBeNull();
    await fire(v, s.partyId, s.g3.id);
    await at(T(30), () => serveGroup(v, s.partyId, s.g3.id));
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g4.id, dueAt: T(40) });
  });

  it("takes the waiting group from the sequence: after group 4 is reordered ahead, it is snoozed and group 3 refused", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await reorder(s.partyId, [s.g4.id, s.g3.id]);

    await at(T(15), () => snooze(v, s.partyId, s.g4.id, 5));

    expect(await remindAtOf(s.g4.id)).toBe(T(20));
    await expectRefusedWithNothingWritten(s.partyId, () => snooze(v, s.partyId, s.g3.id, 5), {
      code: "group.not_waiting",
      params: { groupId: s.g3.id },
    });
  });

  it("takes a snooze on the first held group while the work ahead of it is still unserved", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);

    await at(T(0), () => snooze(v, s.partyId, s.g3.id, 5));

    expect(await remindAtOf(s.g3.id)).toBe(T(5));
  });

  it("refuses a group of another party, an unknown one and a removed one (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);
    const other = await fourGroups(v);
    const command = await args(s.partyId);
    await inTx((tx) =>
      moveLinesToGroup(
        tx,
        v.cfg,
        s.partyId,
        [{ lineId: s.g3.lineIds[0]!, quantity: "1" }],
        { groupId: s.g4.id },
        command,
      ),
    );

    for (const groupId of [other.g3.id, randomUUID(), s.g3.id]) {
      await expectRefusedWithNothingWritten(s.partyId, () => snooze(v, s.partyId, groupId, 5), {
        code: "group.not_found",
        params: { groupId },
      });
    }
  });

  it.each([0, -5, 121, 2.5, Number.NaN])(
    "refuses %s minutes (management.request_invalid naming minutes), writing nothing",
    async (minutes) => {
      const v = await setupVenue();
      const s = await fourGroups(v);

      await expectRefusedWithNothingWritten(
        s.partyId,
        () => snooze(v, s.partyId, s.g3.id, minutes),
        { code: "management.request_invalid", params: { field: "minutes" } },
      );
    },
  );

  it("takes 1 and 120 minutes", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);

    await at(T(0), () => snooze(v, s.partyId, s.g3.id, 1));
    expect(await remindAtOf(s.g3.id)).toBe(T(1));

    await at(T(0), () => snooze(v, s.partyId, s.g3.id, 120));
    expect(await remindAtOf(s.g3.id)).toBe(T(0, 22));
  });
});

describe("unsnoozeReminder (D8, D11, D19)", () => {
  it("makes a snoozed group due at its unsnoozed time again, answering the party's revision", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(20) });
    const revision = await revisionOf(s.partyId);

    const answer = await at(T(16), () => unsnooze(v, s.partyId, s.g3.id));

    expect(answer).toEqual({ revision: revision + 1 });
    expect(await remindAtOf(s.g3.id)).toBeNull();
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(15) });
    expect((await currentOrders(s.partyId)).reminder).toEqual({ groupId: s.g3.id, dueAt: T(15) });
  });

  it("accepts clearing a group with no snooze, moving only the party's revision", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const revision = await revisionOf(s.partyId);

    const answer = await unsnooze(v, s.partyId, s.g3.id);

    expect(answer).toEqual({ revision: revision + 1 });
    expect(await remindAtOf(s.g3.id)).toBeNull();
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(15) });
  });

  it("answers a repeat of the same submission with the first answer, leaving a snooze taken since", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));
    const submissionId = randomUUID();
    const revision = await revisionOf(s.partyId);
    const first = await unsnooze(v, s.partyId, s.g3.id, { submissionId });
    await at(T(17), () => snooze(v, s.partyId, s.g3.id, 5));
    const before = await snapshot(s.partyId);

    const again = await unsnooze(v, s.partyId, s.g3.id, { submissionId, revision });

    expect(again).toEqual(first);
    expect(await snapshot(s.partyId)).toEqual(before);
    expect(await remindAtOf(s.g3.id)).toBe(T(22));
  });

  it("refuses the same submission id for another group (submission.id_reused), writing nothing", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const submissionId = randomUUID();
    await unsnooze(v, s.partyId, s.g3.id, { submissionId });

    await expectRefusedWithNothingWritten(
      s.partyId,
      () => unsnooze(v, s.partyId, s.g4.id, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses a stale revision (party.out_of_date), writing nothing", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));
    const revision = await revisionOf(s.partyId);

    await expectRefusedWithNothingWritten(
      s.partyId,
      () => unsnooze(v, s.partyId, s.g3.id, { revision: revision - 1 }),
      { code: "party.out_of_date", params: { partyId: s.partyId, revision } },
    );
  });

  it("refuses a fired group (group.not_held), writing nothing", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);

    await expectRefusedWithNothingWritten(s.partyId, () => unsnooze(v, s.partyId, s.g1.id), {
      code: "group.not_held",
      params: { groupId: s.g1.id },
    });
  });

  it("refuses a group of another party, an unknown one and a removed one (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);
    const other = await fourGroups(v);
    const command = await args(s.partyId);
    await inTx((tx) =>
      moveLinesToGroup(
        tx,
        v.cfg,
        s.partyId,
        [{ lineId: s.g3.lineIds[0]!, quantity: "1" }],
        { groupId: s.g4.id },
        command,
      ),
    );

    for (const groupId of [other.g3.id, randomUUID(), s.g3.id]) {
      await expectRefusedWithNothingWritten(s.partyId, () => unsnooze(v, s.partyId, groupId), {
        code: "group.not_found",
        params: { groupId },
      });
    }
  });

  it("refuses a held group that is not the one waiting (group.not_waiting), leaving the waiting group's snooze", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.partyId, s.g3.id, 5));

    await expectRefusedWithNothingWritten(s.partyId, () => unsnooze(v, s.partyId, s.g4.id), {
      code: "group.not_waiting",
      params: { groupId: s.g4.id },
    });

    expect(await remindAtOf(s.g3.id)).toBe(T(20));
  });

  it("clears a merged group's leftover snooze only once it is the one waiting, which then falls due at its normal time", async () => {
    const v = await setupVenue();
    const a = await seated(v);
    const aFired = await group(v, a.partyId, "fire", [line(v, "croquetas")]);
    const aHeld = await group(v, a.partyId, "hold", [line(v, "flan")]);
    await at(T(0), () => serveGroup(v, a.partyId, aFired.id));
    const b = await seated(v);
    const bHeld = await group(v, b.partyId, "hold", [line(v, "water")]);
    await at(T(15), () => snooze(v, b.partyId, bHeld.id, 5));
    const command = {
      bills: "merge" as const,
      expectedPartyRevision: await revisionOf(a.partyId),
      otherPartyId: b.partyId,
      expectedOtherPartyRevision: await revisionOf(b.partyId),
      operatorId: ALEX,
    };
    await inTx((tx) => joinTables(tx, v.cfg, a.partyId, b.tableId, command));
    expect(await remindAtOf(bHeld.id)).toBe(T(20));

    await expectRefusedWithNothingWritten(a.partyId, () => unsnooze(v, a.partyId, bHeld.id), {
      code: "group.not_waiting",
      params: { groupId: bHeld.id },
    });
    expect(await remindAtOf(bHeld.id)).toBe(T(20));

    await fire(v, a.partyId, aHeld.id);
    await at(T(30), () => serveGroup(v, a.partyId, aHeld.id));
    expect(await floorReminder(v, a.tableId)).toEqual({ groupId: bHeld.id, dueAt: T(20) });

    await at(T(31), () => unsnooze(v, a.partyId, bHeld.id));

    expect(await remindAtOf(bHeld.id)).toBeNull();
    expect(await floorReminder(v, a.tableId)).toEqual({ groupId: bHeld.id, dueAt: T(40) });
  });
});

type RowShape = Awaited<ReturnType<typeof currentOrders>>["groups"][number]["rows"][number];

/** A row as Current orders shows it, with the fields a case does not vary filled in. */
function row(fields: Partial<RowShape> & Pick<RowShape, "lineId" | "name">): RowShape {
  return {
    workingOrderId: expect.any(String) as unknown as string,
    lineNo: expect.any(Number) as unknown as number,
    quantity: "1.000",
    unitPrecision: 0,
    servedQuantity: "0.000",
    servedAt: null,
    released: true,
    kitchen: null,
    note: null,
    extras: [],
    ...fields,
  };
}

async function linesByName(partyId: string) {
  const rows = await suite.db
    .select({
      id: workingOrderLines.id,
      name: workingOrderLines.name,
      workingOrderId: workingOrderLines.workingOrderId,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(eq(workingOrders.partyId, partyId));
  return rows;
}

describe("readCurrentOrders (spec §4)", () => {
  it("reads every group in sequence with each dish row's served count and kitchen state, across a paid bill, a split one and a later one", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const starters = await group(v, s.partyId, "fire", [
      line(v, "croquetas", "3"),
      line(v, "water"),
    ]);
    const [croqLine] = (await linesByName(s.partyId)).filter((l) => l.name === "croquetas");
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo: croqLine!.lineNo, quantity: "1" }], {
        expectedPartyRevision: await revisionOf(s.partyId),
        operatorId: MIA,
      }),
    );
    await serve(v, s.partyId, [{ lineId: croqLine!.id, quantity: "1" }]);
    await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: s.tabId,
      lines: [],
      tender: { method: "cash", amount: "18.00" },
    });
    const mains = await group(v, s.partyId, "hold", [
      {
        ...line(v, "steak"),
        extras: [{ listId: v.extrasListId, picks: [{ productId: v.sauceId, quantity: 1 }] }],
      },
    ]);
    const laterTab = (await linesByName(s.partyId)).find((l) => l.name === "steak")!.workingOrderId;
    expect(laterTab).not.toBe(s.tabId);
    await inTx((tx) => addTabRound(tx, v.cfg, laterTab, [line(v, "flan")]));
    const lines = await linesByName(s.partyId);
    const named = (name: string, bill: string) =>
      lines.find((l) => l.name === name && l.workingOrderId === bill)!;
    const split = named("croquetas", checkId);
    const steak = named("steak", laterTab);
    const sauce = lines.find((l) => l.parentLineId === steak.id)!;
    const flan = named("flan", laterTab);
    const [bill] = await suite.db
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, s.tabId));
    expect(bill!.status).toBe("settled");

    const read = await currentOrders(s.partyId);

    expect(read).toEqual({
      revision: await revisionOf(s.partyId),
      reminder: { groupId: mains.id, dueAt: null },
      groups: [
        {
          id: starters.id,
          position: 1,
          state: "fired",
          firedAt: expect.any(String),
          remindAt: null,
          sentAt: expect.any(String),
          sentBy: null,
          rows: [
            row({
              lineId: croqLine!.id,
              workingOrderId: s.tabId,
              lineNo: croqLine!.lineNo,
              name: "croquetas",
              quantity: "2.000",
              servedQuantity: "1.000",
              kitchen: {
                state: "queued",
                firedAt: expect.any(String),
                awayAt: null,
                stationId: expect.any(String),
                movable: false,
              },
            }),
            row({
              lineId: named("water", s.tabId).id,
              workingOrderId: s.tabId,
              name: "water",
            }),
            row({
              lineId: split.id,
              workingOrderId: checkId,
              name: "croquetas",
              kitchen: {
                state: "queued",
                firedAt: expect.any(String),
                awayAt: null,
                stationId: expect.any(String),
                movable: true,
              },
            }),
          ],
        },
        {
          id: mains.id,
          position: 2,
          state: "held",
          firedAt: null,
          remindAt: null,
          sentAt: expect.any(String),
          sentBy: null,
          rows: [
            row({
              lineId: steak.id,
              workingOrderId: laterTab,
              name: "steak",
              released: false,
              kitchen: {
                state: "queued",
                firedAt: null,
                awayAt: null,
                stationId: expect.any(String),
                movable: true,
              },
              extras: [{ lineId: sauce.id, name: "sauce", quantity: "1.000" }],
            }),
          ],
        },
      ],
      ungrouped: [
        row({
          lineId: flan.id,
          workingOrderId: laterTab,
          name: "flan",
          kitchen: {
            state: "queued",
            firedAt: expect.any(String),
            awayAt: null,
            stationId: expect.any(String),
            movable: true,
          },
        }),
      ],
    });
  });

  it("reports a fired item at a station that never records ready as fired, with its fired time, and never ready", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const starters = await group(v, s.partyId, "fire", [line(v, "croquetas")]);
    const mains = await group(v, s.partyId, "fire", [line(v, "steak")]);
    const command = await args(s.partyId);
    await inTx((tx) => bumpGroupReady(tx, v.cfg, s.partyId, mains.id, command));

    const read = await currentOrders(s.partyId);

    const [croq] = read.groups[0]!.rows;
    const [steak] = read.groups[1]!.rows;
    expect(read.groups.map((g) => g.id)).toEqual([starters.id, mains.id]);
    expect(croq!.kitchen).toEqual({
      state: "queued",
      firedAt: expect.any(String),
      awayAt: null,
      stationId: expect.any(String),
      movable: true,
    });
    expect(JSON.stringify(read.groups[0])).not.toContain("ready");
    expect(steak!.kitchen).toEqual({
      state: "ready",
      firedAt: expect.any(String),
      awayAt: null,
      stationId: expect.any(String),
      movable: false,
    });
  });

  it("shows a served row fully served, and a recalled one no longer released", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const starters = await group(v, s.partyId, "fire", [line(v, "croquetas", "2")]);
    await serveGroup(v, s.partyId, starters.id);
    const mains = await group(v, s.partyId, "fire", [line(v, "steak")]);
    const steak = (await linesByName(s.partyId)).find((l) => l.name === "steak")!;
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [steak.lineNo]));

    const read = await currentOrders(s.partyId);

    expect(read.groups[0]!.rows[0]).toMatchObject({
      quantity: "2.000",
      servedQuantity: "2.000",
      servedAt: expect.any(String),
      released: true,
    });
    expect(read.groups[1]).toMatchObject({ id: mains.id, state: "fired" });
    expect(read.groups[1]!.rows[0]).toMatchObject({
      lineId: steak.id,
      released: false,
      kitchen: {
        state: "queued",
        firedAt: null,
        awayAt: null,
        stationId: expect.any(String),
        movable: true,
      },
    });
  });

  it("reads a party with nothing ordered as empty, and refuses an unknown one (party.not_open)", async () => {
    const v = await setupVenue();
    const s = await seated(v);

    expect(await currentOrders(s.partyId)).toEqual({
      revision: await revisionOf(s.partyId),
      reminder: null,
      groups: [],
      ungrouped: [],
    });
    const unknown = randomUUID();
    await expect(currentOrders(unknown)).rejects.toMatchObject({
      code: "party.not_open",
      params: { partyId: unknown },
    });
  });
});

describe("a party another was merged into", () => {
  it("reads the merged party's groups and its paid bill's rows as its own", async () => {
    const v = await setupVenue();
    const a = await seated(v);
    const starters = await group(v, a.partyId, "fire", [line(v, "croquetas")]);
    const b = await seated(v);
    const dessert = await group(v, b.partyId, "fire", [line(v, "flan")]);
    await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: b.tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    const drinks = await group(v, b.partyId, "fire", [line(v, "water")]);
    const bNext = (await linesByName(b.partyId)).find((l) => l.name === "water")!.workingOrderId;
    expect(bNext).not.toBe(b.tabId);
    const command = {
      bills: "merge" as const,
      expectedPartyRevision: await revisionOf(a.partyId),
      otherPartyId: b.partyId,
      expectedOtherPartyRevision: await revisionOf(b.partyId),
      operatorId: ALEX,
    };
    await inTx((tx) => joinTables(tx, v.cfg, a.partyId, b.tableId, command));

    const read = await currentOrders(a.partyId);

    expect(read.groups.map((g) => [g.id, g.rows.map((r) => [r.name, r.workingOrderId])])).toEqual([
      [starters.id, [["croquetas", a.tabId]]],
      [dessert.id, [["flan", b.tabId]]],
      [drinks.id, [["water", a.tabId]]],
    ]);

    const away = await currentOrders(b.partyId);
    expect(away.groups).toEqual([]);
    expect(away.ungrouped).toEqual([]);
  });
});

describe("an abandoned bill", () => {
  it("neither holds up nor dates the reminder, and its rows are not shown", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const starters = await group(v, s.partyId, "fire", [line(v, "croquetas", "2")]);
    const desserts = await group(v, s.partyId, "hold", [line(v, "flan")]);
    const [croq] = (await linesByName(s.partyId)).filter((l) => l.name === "croquetas");
    const { billId: checkId } = await inTx(async (tx) =>
      splitBill(tx, v.cfg, s.tabId, [{ lineNo: croq!.lineNo, quantity: "1" }], {
        expectedPartyRevision: await revisionOf(s.partyId),
        operatorId: MIA,
      }),
    );
    await at(T(0), () => serve(v, s.partyId, [{ lineId: croq!.id, quantity: "1" }]));
    expect((await currentOrders(s.partyId)).reminder).toEqual({
      groupId: desserts.id,
      dueAt: null,
    });
    // What cancelling a bill leaves (`cancelPlacedOrder`): the bill abandoned with its lines.
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, checkId));

    const read = await currentOrders(s.partyId);

    expect(read.reminder).toEqual({ groupId: desserts.id, dueAt: T(10) });
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: desserts.id, dueAt: T(10) });
    expect(read.groups[0]!.id).toBe(starters.id);
    expect(read.groups[0]!.rows.map((r) => r.workingOrderId)).toEqual([s.tabId]);
  });
});

describe("a party that has left", () => {
  it("still reads its groups, with no reminder, since nothing can fire or snooze them now", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const starters = await group(v, s.partyId, "fire", [line(v, "croquetas")]);
    const desserts = await group(v, s.partyId, "hold", [line(v, "flan")]);
    await at(T(0), () => serveGroup(v, s.partyId, starters.id));
    expect((await currentOrders(s.partyId)).reminder).toEqual({
      groupId: desserts.id,
      dueAt: T(10),
    });
    await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: s.tabId,
      lines: [],
      tender: { method: "cash", amount: "13.00" },
    });
    const expectedPartyRevision = await revisionOf(s.partyId);
    await inTx((tx) =>
      finishTable(tx, { partyId: s.partyId, expectedPartyRevision, operatorId: ALEX }),
    );
    const [party] = await suite.db
      .select({ state: parties.state })
      .from(parties)
      .where(eq(parties.id, s.partyId));
    expect(party!.state).not.toBe("open");

    const read = await currentOrders(s.partyId);

    expect(read.reminder).toBeNull();
    expect(read.groups.map((g) => [g.id, g.state])).toEqual([
      [starters.id, "fired"],
      [desserts.id, "held"],
    ]);
  });
});

describe("where each submission's groups go (spec §3)", () => {
  const item = (v: Venue, dish: Dish): DraftLineInput => ({
    menuItemId: v.offer(dish),
    variantId: null,
    menuVersionId: null,
    options: [],
    extras: [],
    note: null,
    quantity: "1",
    courseId: null,
    noMerge: false,
  });
  const save = (v: Venue, partyId: string, operatorId: string, lines: DraftLineInput[]) =>
    inTx((tx) => saveDraft(tx, v.cfg, partyId, operatorId, { draftId: null, revision: 0, lines }));
  const submit = async (
    v: Venue,
    partyId: string,
    draft: Draft,
    groups: { lineIds: string[]; release: GroupRelease }[],
  ) => {
    const expectedPartyRevision = await revisionOf(partyId);
    return inTx((tx) =>
      submitDraft(tx, v.cfg, partyId, draft.id, {
        operatorId: draft.ownerId,
        submissionId: randomUUID(),
        draftRevision: draft.revision,
        expectedPartyRevision,
        groups,
      }),
    );
  };
  const placed = async (partyId: string) =>
    (await currentOrders(partyId)).groups.map((g) => [
      g.position,
      g.state,
      g.rows.map((r) => r.name),
    ]);

  it("numbers a draft's partial sends, and drafts sent after them, in the order they were sent", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const alex = await save(v, s.partyId, ALEX, [item(v, "croquetas"), item(v, "steak")]);
    const mia = await save(v, s.partyId, MIA, [item(v, "water")]);
    const { draft: rest } = await submit(v, s.partyId, alex, [
      { lineIds: [alex.lines[0]!.id], release: "fire" },
    ]);
    await submit(v, s.partyId, mia, [{ lineIds: [mia.lines[0]!.id], release: "fire" }]);
    await submit(v, s.partyId, rest!, [{ lineIds: [rest!.lines[0]!.id], release: "hold" }]);
    const dessert = await save(v, s.partyId, ALEX, [item(v, "flan")]);
    await submit(v, s.partyId, dessert, [{ lineIds: [dessert.lines[0]!.id], release: "hold" }]);

    expect(await placed(s.partyId)).toEqual([
      [1, "fired", ["croquetas"]],
      [2, "fired", ["water"]],
      [3, "held", ["steak"]],
      [4, "held", ["flan"]],
    ]);
  });

  it("puts a later submission joined to a held group in that group, starting none", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = await args(s.partyId);
    const { groups } = await inTx((tx) =>
      submitGroups(tx, v.cfg, s.partyId, {
        ...first,
        groups: [
          { release: "fire", lines: [line(v, "croquetas")] },
          { release: "hold", lines: [line(v, "steak")] },
        ],
      }),
    );
    const command = await args(s.partyId);
    await inTx((tx) =>
      submitGroups(tx, v.cfg, s.partyId, {
        ...command,
        groups: [{ release: "hold", lines: [line(v, "flan")] }],
        joinGroupId: groups[1]!.id,
      }),
    );

    expect(await placed(s.partyId)).toEqual([
      [1, "fired", ["croquetas"]],
      [2, "held", ["steak", "flan"]],
    ]);
  });
});

describe("when each group was sent and who sent it (spec §4; owner 2026-09-28)", () => {
  const staff = async (displayName: string) => {
    const [row] = await suite.db
      .insert(persons)
      .values({ displayName })
      .returning({ id: persons.id });
    return row!.id;
  };
  const submitAs = async (
    v: Venue,
    partyId: string,
    operatorId: string,
    release: GroupRelease,
    lines: GroupLine[],
  ) => {
    const command = { ...(await args(partyId)), operatorId };
    const { groups } = await inTx((tx) =>
      submitGroups(tx, v.cfg, partyId, { ...command, groups: [{ release, lines }] }),
    );
    return groups[0]!;
  };
  const fireAs = async (v: Venue, partyId: string, groupId: string, operatorId: string) => {
    const command = { ...(await args(partyId)), operatorId };
    await inTx((tx) => fireGroup(tx, v.cfg, partyId, groupId, command));
  };
  const stored = async (groupId: string) => {
    const [row] = await suite.db
      .select({
        createdAt: orderGroups.createdAt,
        firedAt: orderGroups.firedAt,
        submittedBy: orderGroups.submittedBy,
        firedBy: orderGroups.firedBy,
      })
      .from(orderGroups)
      .where(eq(orderGroups.id, groupId));
    return row!;
  };
  const sent = async (partyId: string) =>
    (await currentOrders(partyId)).groups.map((g) => [g.id, g.sentAt, g.sentBy]);

  it("shows a group fired at once as sent when it fired, by the person who fired it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const alex = await staff("Alex");
    const starters = await at(T(0), () =>
      submitAs(v, s.partyId, alex, "fire", [line(v, "croquetas")]),
    );

    const { firedAt } = await stored(starters.id);
    expect(firedAt).toBe(T(0));
    expect(await sent(s.partyId)).toEqual([[starters.id, firedAt, "Alex"]]);
  });

  it("shows a held group as sent when it was held, by the person who held it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const alex = await staff("Alex");
    const mains = await at(T(0), () => submitAs(v, s.partyId, alex, "hold", [line(v, "steak")]));

    const { createdAt } = await stored(mains.id);
    expect(createdAt).toBe(T(0));
    expect(await sent(s.partyId)).toEqual([[mains.id, createdAt, "Alex"]]);
  });

  it("shows a held group fired later by someone else as sent when it fired, by the person who fired it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const alex = await staff("Alex");
    const mia = await staff("Mía");
    const mains = await at(T(0), () => submitAs(v, s.partyId, alex, "hold", [line(v, "steak")]));
    await at(T(7), () => fireAs(v, s.partyId, mains.id, mia));

    expect(await stored(mains.id)).toEqual({
      createdAt: T(0),
      firedAt: T(7),
      submittedBy: alex,
      firedBy: mia,
    });
    expect(await sent(s.partyId)).toEqual([[mains.id, T(7), "Mía"]]);
  });

  it("shows a group moved lines start as sent when they moved, by the person who moved them", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const alex = await staff("Alex");
    const mia = await staff("Mía");
    const mains = await at(T(0), () =>
      submitAs(v, s.partyId, alex, "hold", [line(v, "steak"), line(v, "flan")]),
    );
    const command = { ...(await args(s.partyId)), operatorId: mia };
    await at(T(9), () =>
      inTx((tx) =>
        moveLinesToGroup(
          tx,
          v.cfg,
          s.partyId,
          [{ lineId: mains.lineIds[1]!, quantity: "1" }],
          "new",
          command,
        ),
      ),
    );

    const read = await currentOrders(s.partyId);
    expect(read.groups.map((g) => [g.rows.map((r) => r.name), g.sentAt, g.sentBy])).toEqual([
      [["steak"], T(0), "Alex"],
      [["flan"], T(9), "Mía"],
    ]);
  });

  it("reads no sender, and still the time, when the person has no record", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const nobody = randomUUID();
    const starters = await at(T(0), () =>
      submitAs(v, s.partyId, nobody, "fire", [line(v, "croquetas")]),
    );
    const mains = await at(T(1), () => submitAs(v, s.partyId, nobody, "hold", [line(v, "steak")]));

    expect(await sent(s.partyId)).toEqual([
      [starters.id, T(0), null],
      [mains.id, T(1), null],
    ]);
  });
});
