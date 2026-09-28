import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
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
  visits,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
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
  type GroupLine,
  type GroupRelease,
} from "./order-groups.js";
import { createTable } from "./tables.js";
import type { TillConfig } from "./till-config.js";
import { payWorkingOrder } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import { finishTable, seatTable } from "./visits.js";
import {
  addTabRound,
  listTablesWithState,
  markGroupServed,
  markServed,
  mergeTabs,
  recallLines,
  splitOffCheck,
} from "./working-order.js";
import "./errors.js";

// The release reminder (spec §4 "Remind staff to release the next group"; plan D11, rulings 4 and
// 5), its snooze, and the Current orders read a waiter serves from (spec §4; D8, D18, D19).
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
        taxId: `${String(63_000_000 + taxIds).padStart(8, "0")}K`,
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
    const category = await createCategory(tx, { name: { [LOCALE]: "Platos" } });
    const productId = {} as Record<Dish, string>;
    for (const [dish, unitPrice] of Object.entries(DISHES) as [Dish, string][]) {
      productId[dish] = (
        await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: category.id,
          name: dish,
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
    await tx.run(sql`
      update preparation_routes set station_id = null, no_preparation = 1
      where product_id = ${productId.water}`);
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
  visitId: string;
  tabId: string;
  tableId: string;
}

async function seated(v: Venue): Promise<Seated> {
  return inTx(async (tx) => {
    const { id: tableId } = await createTable(tx, v.cfg, {
      label: `C-${randomUUID().slice(0, 6)}`,
      zoneId: v.zoneId,
    });
    const { visitId, tabId } = await seatTable(tx, v.cfg, {
      tableId,
      guestCount: 2,
      operatorId: ALEX,
    });
    return { visitId, tabId, tableId };
  });
}

function line(v: Venue, dish: Dish, quantity = "1"): GroupLine {
  return { menuItemId: v.offer(dish), quantity };
}

async function revisionOf(visitId: string): Promise<number> {
  const [row] = await suite.db
    .select({ revision: visits.revision })
    .from(visits)
    .where(eq(visits.id, visitId));
  return row!.revision;
}

interface CommandOptions {
  submissionId?: string;
  revision?: number;
}

async function args(visitId: string, opts: CommandOptions = {}) {
  return {
    submissionId: opts.submissionId ?? randomUUID(),
    expectedVisitRevision: opts.revision ?? (await revisionOf(visitId)),
    operatorId: ALEX,
  };
}

/** Submits one group; answers its id and its dish lines. */
async function group(
  v: Venue,
  visitId: string,
  release: GroupRelease,
  lines: GroupLine[],
): Promise<{ id: string; lineIds: string[] }> {
  const command = await args(visitId);
  const { groups } = await inTx((tx) =>
    submitGroups(tx, v.cfg, visitId, { ...command, groups: [{ release, lines }] }),
  );
  return { id: groups[0]!.id, lineIds: groups[0]!.lineIds };
}

async function fire(v: Venue, visitId: string, groupId: string) {
  const command = await args(visitId);
  return inTx((tx) => fireGroup(tx, v.cfg, visitId, groupId, command));
}

async function serveGroup(v: Venue, visitId: string, groupId: string) {
  const command = await args(visitId);
  return inTx((tx) => markGroupServed(tx, v.cfg, visitId, groupId, command));
}

async function serve(v: Venue, visitId: string, items: { lineId: string; quantity: string }[]) {
  const command = await args(visitId);
  return inTx((tx) => markServed(tx, v.cfg, visitId, items, command));
}

async function snooze(
  v: Venue,
  visitId: string,
  groupId: string,
  minutes: number,
  opts: CommandOptions = {},
) {
  const command = await args(visitId, opts);
  return inTx((tx) => snoozeReminder(tx, v.cfg, visitId, groupId, minutes, command));
}

async function reorder(visitId: string, heldGroupIds: string[]) {
  const command = await args(visitId);
  return inTx((tx) => reorderHeldGroups(tx, visitId, heldGroupIds, command));
}

async function floorReminder(v: Venue, tableId: string) {
  const rows = await inTx((tx) => listTablesWithState(tx, v.cfg));
  return rows.find((row) => row.id === tableId)!.visit!.reminder;
}

async function currentOrders(visitId: string) {
  return inTx((tx) => readCurrentOrders(tx, visitId));
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
  const g1 = await group(v, s.visitId, "fire", [line(v, "croquetas")]);
  const g2 = await group(v, s.visitId, "fire", [line(v, "steak", "2")]);
  const g3 = await group(v, s.visitId, "hold", [line(v, "flan")]);
  const g4 = await group(v, s.visitId, "hold", [line(v, "water")]);
  return { ...s, g1, g2, g3, g4 };
}

/** {@link fourGroups} with group 1 fully served at 20:00 and group 2 at 20:05. */
async function servedUpToGroupTwo(v: Venue) {
  const s = await fourGroups(v);
  await at(T(0), () => serveGroup(v, s.visitId, s.g1.id));
  await at(T(5), () => serveGroup(v, s.visitId, s.g2.id));
  return s;
}

/** Every row a snooze could write. */
async function snapshot(visitId: string) {
  return {
    visit: await suite.db.select().from(visits).where(eq(visits.id, visitId)),
    groups: await suite.db
      .select()
      .from(orderGroups)
      .where(eq(orderGroups.visitId, visitId))
      .orderBy(orderGroups.id),
    lines: await suite.db
      .select()
      .from(workingOrderLines)
      .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
      .where(eq(workingOrders.visitId, visitId))
      .orderBy(workingOrderLines.id),
    commands: await suite.db
      .select()
      .from(serviceCommands)
      .where(eq(serviceCommands.scopeId, visitId))
      .orderBy(serviceCommands.id),
  };
}

async function expectRefusedWithNothingWritten(
  visitId: string,
  attempt: () => Promise<unknown>,
  expected: { code: string; params?: Record<string, unknown> },
): Promise<void> {
  const before = await snapshot(visitId);
  await expect(attempt()).rejects.toMatchObject(expected);
  expect(await snapshot(visitId)).toEqual(before);
}

describe("releaseReminder (pure; D11, rulings 4 and 5a–b)", () => {
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

  it("keeps no time for a snooze while an earlier fired group is unserved (ruling 5a)", () => {
    expect(
      releaseReminder([fired("g1"), held("g2", T(30))], [{ groupId: "g1", servedAt: null }], 10),
    ).toEqual({ groupId: "g2", dueAt: null });
  });

  it("is due at the snooze once the work before it is served", () => {
    expect(
      releaseReminder([fired("g1"), held("g2", T(40))], [{ groupId: "g1", servedAt: T(0) }], 10),
    ).toEqual({ groupId: "g2", dueAt: T(40) });
  });

  it("lets a fired group with no dish line neither hold the reminder up nor date it (ruling 5b)", () => {
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
    expect((await currentOrders(s.visitId)).reminder).toEqual({
      groupId: s.g3.id,
      dueAt: T(15),
    });
  });

  it("shows group 3 without a time while group 2 is not fully served", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);
    await at(T(0), () => serveGroup(v, s.visitId, s.g1.id));

    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: null });

    await at(T(5), () => serve(v, s.visitId, [{ lineId: s.g2.lineIds[0]!, quantity: "1" }]));

    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: null });
    expect((await currentOrders(s.visitId)).reminder).toEqual({ groupId: s.g3.id, dueAt: null });
  });

  it("makes it due at 20:20 when snoozed 5 minutes at 20:15, leaving group 2's served time as it was", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const servedBefore = await servedAtOf(s.g2.lineIds);
    const revision = await revisionOf(s.visitId);

    const answer = await at(T(15), () => snooze(v, s.visitId, s.g3.id, 5));

    expect(answer).toEqual({ revision: revision + 1 });
    expect(await remindAtOf(s.g3.id)).toBe(T(20));
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(20) });
    expect(await servedAtOf(s.g2.lineIds)).toEqual(servedBefore);
    expect(servedBefore[0]!.servedAt).toBe(T(5));
  });

  it("clears the reminder when group 3 fires, and group 4 becomes the one waiting", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.visitId, s.g3.id, 5));

    await fire(v, s.visitId, s.g3.id);

    expect(await remindAtOf(s.g3.id)).toBeNull();
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g4.id, dueAt: null });
    await at(T(30), () => serveGroup(v, s.visitId, s.g3.id));
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g4.id, dueAt: T(40) });
  });

  it("moves the reminder to group 4 when it is reordered ahead of group 3, clearing both snoozes", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.visitId, s.g3.id, 5));
    await at(T(15), () => snooze(v, s.visitId, s.g4.id, 30));

    await reorder(s.visitId, [s.g4.id, s.g3.id]);

    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g4.id, dueAt: T(15) });
    expect(await remindAtOf(s.g3.id)).toBeNull();
    expect(await remindAtOf(s.g4.id)).toBeNull();
  });

  it("keeps a snooze through a reorder that leaves its group where it was", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.visitId, s.g3.id, 5));

    await reorder(s.visitId, [s.g3.id, s.g4.id]);

    expect(await remindAtOf(s.g3.id)).toBe(T(20));
    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(20) });
  });

  it("moves the reminder on when group 3 is emptied, which removes it and clears its snooze", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    await at(T(15), () => snooze(v, s.visitId, s.g3.id, 5));
    const command = await args(s.visitId);

    await inTx((tx) =>
      moveLinesToGroup(
        tx,
        v.cfg,
        s.visitId,
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
    expect((await currentOrders(s.visitId)).groups.map((g) => g.id)).toEqual([
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
    expect((await currentOrders(s.visitId)).reminder).toBeNull();
  });

  it("measures from the venue's interval, and shows none for a party with no held group", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const bare = await seated(v);
    await group(v, bare.visitId, "fire", [line(v, "croquetas")]);
    await inTx((tx) => writeReleaseReminderMinutes(tx, 25));

    expect(await floorReminder(v, s.tableId)).toEqual({ groupId: s.g3.id, dueAt: T(30) });
    expect(await floorReminder(v, bare.tableId)).toBeNull();
  });

  it("gives each party on the floor its own reminder from one read", async () => {
    const v = await setupVenue();
    const a = await servedUpToGroupTwo(v);
    const b = await fourGroups(v);

    const rows = await inTx((tx) => listTablesWithState(tx, v.cfg));

    expect(rows.find((row) => row.id === a.tableId)!.visit!.reminder).toEqual({
      groupId: a.g3.id,
      dueAt: T(15),
    });
    expect(rows.find((row) => row.id === b.tableId)!.visit!.reminder).toEqual({
      groupId: b.g3.id,
      dueAt: null,
    });
  });
});

describe("snoozeReminder (D8, D11, D19; ruling 5d)", () => {
  it("answers a repeat of the same submission with the first answer and moves nothing", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const submissionId = randomUUID();
    const revision = await revisionOf(s.visitId);
    const first = await at(T(15), () => snooze(v, s.visitId, s.g3.id, 5, { submissionId }));
    const before = await snapshot(s.visitId);

    const again = await at(T(18), () =>
      snooze(v, s.visitId, s.g3.id, 5, { submissionId, revision }),
    );

    expect(again).toEqual(first);
    expect(await snapshot(s.visitId)).toEqual(before);
    expect(await remindAtOf(s.g3.id)).toBe(T(20));
  });

  it("refuses the same submission id with other minutes (submission.id_reused), writing nothing", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const submissionId = randomUUID();
    await at(T(15), () => snooze(v, s.visitId, s.g3.id, 5, { submissionId }));

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => snooze(v, s.visitId, s.g3.id, 10, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses a stale revision (visit.out_of_date), writing nothing", async () => {
    const v = await setupVenue();
    const s = await servedUpToGroupTwo(v);
    const revision = await revisionOf(s.visitId);

    await expectRefusedWithNothingWritten(
      s.visitId,
      () => snooze(v, s.visitId, s.g3.id, 5, { revision: revision - 1 }),
      { code: "visit.out_of_date", params: { visitId: s.visitId, revision } },
    );
  });

  it("refuses a fired group (group.not_held), writing nothing", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);

    await expectRefusedWithNothingWritten(s.visitId, () => snooze(v, s.visitId, s.g1.id, 5), {
      code: "group.not_held",
      params: { groupId: s.g1.id },
    });
  });

  it("refuses a group of another party, an unknown one and a removed one (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);
    const other = await fourGroups(v);
    const command = await args(s.visitId);
    await inTx((tx) =>
      moveLinesToGroup(
        tx,
        v.cfg,
        s.visitId,
        [{ lineId: s.g3.lineIds[0]!, quantity: "1" }],
        { groupId: s.g4.id },
        command,
      ),
    );

    for (const groupId of [other.g3.id, randomUUID(), s.g3.id]) {
      await expectRefusedWithNothingWritten(s.visitId, () => snooze(v, s.visitId, groupId, 5), {
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
        s.visitId,
        () => snooze(v, s.visitId, s.g3.id, minutes),
        { code: "management.request_invalid", params: { field: "minutes" } },
      );
    },
  );

  it("takes 1 and 120 minutes, and may snooze a held group that is not yet the one waiting", async () => {
    const v = await setupVenue();
    const s = await fourGroups(v);

    await at(T(0), () => snooze(v, s.visitId, s.g3.id, 1));
    await at(T(0), () => snooze(v, s.visitId, s.g4.id, 120));

    expect(await remindAtOf(s.g3.id)).toBe(T(1));
    expect(await remindAtOf(s.g4.id)).toBe(T(0, 22));
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

async function linesByName(visitId: string) {
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
    .where(eq(workingOrders.visitId, visitId));
  return rows;
}

describe("readCurrentOrders (spec §4)", () => {
  it("reads every group in sequence with each dish row's served count and kitchen state, across a paid bill, a split one and a later one", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const starters = await group(v, s.visitId, "fire", [
      line(v, "croquetas", "3"),
      line(v, "water"),
    ]);
    const [croqLine] = (await linesByName(s.visitId)).filter((l) => l.name === "croquetas");
    const { checkId } = await inTx(async (tx) =>
      splitOffCheck(tx, v.cfg, s.tabId, [{ lineNo: croqLine!.lineNo, quantity: "1" }], {
        expectedVisitRevision: await revisionOf(s.visitId),
        operatorId: MIA,
      }),
    );
    await serve(v, s.visitId, [{ lineId: croqLine!.id, quantity: "1" }]);
    await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: s.tabId,
      lines: [],
      tender: { method: "cash", amount: "18.00" },
    });
    const mains = await group(v, s.visitId, "hold", [
      {
        ...line(v, "steak"),
        extras: [{ listId: v.extrasListId, picks: [{ productId: v.sauceId, quantity: 1 }] }],
      },
    ]);
    const laterTab = (await linesByName(s.visitId)).find((l) => l.name === "steak")!.workingOrderId;
    expect(laterTab).not.toBe(s.tabId);
    await inTx((tx) => addTabRound(tx, v.cfg, laterTab, [line(v, "flan")]));
    const lines = await linesByName(s.visitId);
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

    const read = await currentOrders(s.visitId);

    expect(read).toEqual({
      revision: await revisionOf(s.visitId),
      reminder: { groupId: mains.id, dueAt: null },
      groups: [
        {
          id: starters.id,
          position: 1,
          state: "fired",
          firedAt: expect.any(String),
          remindAt: null,
          addedLater: false,
          rows: [
            row({
              lineId: croqLine!.id,
              workingOrderId: s.tabId,
              lineNo: croqLine!.lineNo,
              name: "croquetas",
              quantity: "2.000",
              servedQuantity: "1.000",
              kitchen: { state: "queued", firedAt: expect.any(String), awayAt: null },
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
              kitchen: { state: "queued", firedAt: expect.any(String), awayAt: null },
            }),
          ],
        },
        {
          id: mains.id,
          position: 2,
          state: "held",
          firedAt: null,
          remindAt: null,
          addedLater: true,
          rows: [
            row({
              lineId: steak.id,
              workingOrderId: laterTab,
              name: "steak",
              released: false,
              kitchen: { state: "queued", firedAt: null, awayAt: null },
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
          kitchen: { state: "queued", firedAt: expect.any(String), awayAt: null },
        }),
      ],
    });
  });

  it("reports a fired item at a station that never records ready as fired, with its fired time, and never ready", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const starters = await group(v, s.visitId, "fire", [line(v, "croquetas")]);
    const mains = await group(v, s.visitId, "fire", [line(v, "steak")]);
    const command = await args(s.visitId);
    await inTx((tx) => bumpGroupReady(tx, v.cfg, s.visitId, mains.id, command));

    const read = await currentOrders(s.visitId);

    const [croq] = read.groups[0]!.rows;
    const [steak] = read.groups[1]!.rows;
    expect(read.groups.map((g) => g.id)).toEqual([starters.id, mains.id]);
    expect(croq!.kitchen).toEqual({ state: "queued", firedAt: expect.any(String), awayAt: null });
    expect(JSON.stringify(read.groups[0])).not.toContain("ready");
    expect(steak!.kitchen).toEqual({ state: "ready", firedAt: expect.any(String), awayAt: null });
  });

  it("shows a served row fully served, and a recalled one no longer released", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const starters = await group(v, s.visitId, "fire", [line(v, "croquetas", "2")]);
    await serveGroup(v, s.visitId, starters.id);
    const mains = await group(v, s.visitId, "fire", [line(v, "steak")]);
    const steak = (await linesByName(s.visitId)).find((l) => l.name === "steak")!;
    await inTx((tx) => recallLines(tx, v.cfg, s.tabId, [steak.lineNo]));

    const read = await currentOrders(s.visitId);

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
      kitchen: { state: "queued", firedAt: null, awayAt: null },
    });
  });

  it("reads a party with nothing ordered as empty, and refuses an unknown one (visit.not_open)", async () => {
    const v = await setupVenue();
    const s = await seated(v);

    expect(await currentOrders(s.visitId)).toEqual({
      revision: await revisionOf(s.visitId),
      reminder: null,
      groups: [],
      ungrouped: [],
    });
    const unknown = randomUUID();
    await expect(currentOrders(unknown)).rejects.toMatchObject({
      code: "visit.not_open",
      params: { visitId: unknown },
    });
  });
});

describe("a party another was merged into", () => {
  it("reads the merged party's groups and its paid bill's rows as its own", async () => {
    const v = await setupVenue();
    const a = await seated(v);
    const starters = await group(v, a.visitId, "fire", [line(v, "croquetas")]);
    const b = await seated(v);
    const dessert = await group(v, b.visitId, "fire", [line(v, "flan")]);
    await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: b.tabId,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    const drinks = await group(v, b.visitId, "fire", [line(v, "water")]);
    const bNext = (await linesByName(b.visitId)).find((l) => l.name === "water")!.workingOrderId;
    const command = {
      expectedVisitRevision: await revisionOf(a.visitId),
      expectedSourceVisitRevision: await revisionOf(b.visitId),
      operatorId: ALEX,
    };
    await inTx((tx) =>
      mergeTabs(tx, v.cfg, a.tabId, bNext, { freeSourceTable: false, ...command }),
    );

    const read = await currentOrders(a.visitId);

    expect(read.groups.map((g) => [g.id, g.rows.map((r) => [r.name, r.workingOrderId])])).toEqual([
      [starters.id, [["croquetas", a.tabId]]],
      [dessert.id, [["flan", b.tabId]]],
      [drinks.id, [["water", a.tabId]]],
    ]);
  });
});

describe("a party that has left", () => {
  it("still reads its groups, with no reminder, since nothing can fire or snooze them now", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const starters = await group(v, s.visitId, "fire", [line(v, "croquetas")]);
    const desserts = await group(v, s.visitId, "hold", [line(v, "flan")]);
    await at(T(0), () => serveGroup(v, s.visitId, starters.id));
    expect((await currentOrders(s.visitId)).reminder).toEqual({
      groupId: desserts.id,
      dueAt: T(10),
    });
    await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: s.tabId,
      lines: [],
      tender: { method: "cash", amount: "13.00" },
    });
    const expectedVisitRevision = await revisionOf(s.visitId);
    await inTx((tx) =>
      finishTable(tx, { visitId: s.visitId, expectedVisitRevision, operatorId: ALEX }),
    );
    const [visit] = await suite.db
      .select({ state: visits.state })
      .from(visits)
      .where(eq(visits.id, s.visitId));
    expect(visit!.state).not.toBe("open");

    const read = await currentOrders(s.visitId);

    expect(read.reminder).toBeNull();
    expect(read.groups.map((g) => [g.id, g.state])).toEqual([
      [starters.id, "fired"],
      [desserts.id, "held"],
    ]);
  });
});

describe("which groups were added later (spec §4; the till's laterAddition)", () => {
  type LineInput = DraftLineInput;
  const item = (v: Venue, dish: Dish): LineInput => ({
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
  const save = (v: Venue, visitId: string, operatorId: string, lines: LineInput[]) =>
    inTx((tx) => saveDraft(tx, v.cfg, visitId, operatorId, { draftId: null, revision: 0, lines }));
  const submit = async (
    v: Venue,
    visitId: string,
    draft: Draft,
    groups: { lineIds: string[]; release: GroupRelease }[],
  ) => {
    const expectedVisitRevision = await revisionOf(visitId);
    return inTx((tx) =>
      submitDraft(tx, v.cfg, visitId, draft.id, {
        operatorId: draft.ownerId,
        submissionId: randomUUID(),
        draftRevision: draft.revision,
        expectedVisitRevision,
        groups,
      }),
    );
  };
  const later = async (visitId: string) =>
    Object.fromEntries(
      (await currentOrders(visitId)).groups.map((g) => [g.position, g.addedLater]),
    );

  it("counts every group of the first submission as the order, and a later submission's as added", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const command = await args(s.visitId);
    await at(T(0), () =>
      inTx((tx) =>
        submitGroups(tx, v.cfg, s.visitId, {
          ...command,
          groups: [
            { release: "fire", lines: [line(v, "croquetas")] },
            { release: "hold", lines: [line(v, "steak")] },
            { release: "hold", lines: [line(v, "flan")] },
          ],
        }),
      ),
    );
    await at(T(10), () => group(v, s.visitId, "fire", [line(v, "water")]));

    expect(await later(s.visitId)).toEqual({ 1: false, 2: false, 3: false, 4: true });
  });

  it("counts a draft's partial submissions as the order, and a draft started after the first group as added, but not one started before it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const alex = await at(T(0), () =>
      save(v, s.visitId, ALEX, [item(v, "croquetas"), item(v, "steak")]),
    );
    const mia = await at(T(1), () => save(v, s.visitId, MIA, [item(v, "water")]));
    const { draft: rest } = await at(T(2), () =>
      submit(v, s.visitId, alex, [{ lineIds: [alex.lines[0]!.id], release: "fire" }]),
    );
    await at(T(3), () =>
      submit(v, s.visitId, rest!, [{ lineIds: [rest!.lines[0]!.id], release: "hold" }]),
    );
    await at(T(4), () =>
      submit(v, s.visitId, mia, [{ lineIds: [mia.lines[0]!.id], release: "fire" }]),
    );
    const dessert = await at(T(20), () => save(v, s.visitId, ALEX, [item(v, "flan")]));
    await at(T(21), () =>
      submit(v, s.visitId, dessert, [{ lineIds: [dessert.lines[0]!.id], release: "hold" }]),
    );

    expect(await later(s.visitId)).toEqual({ 1: false, 2: false, 3: false, 4: true });
  });

  it("keeps a group's own first submission when a later one adds to it", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const first = await args(s.visitId);
    const { groups } = await at(T(0), () =>
      inTx((tx) =>
        submitGroups(tx, v.cfg, s.visitId, {
          ...first,
          groups: [
            { release: "fire", lines: [line(v, "croquetas")] },
            { release: "hold", lines: [line(v, "steak")] },
          ],
        }),
      ),
    );
    const mains = groups[1]!;
    const command = await args(s.visitId);
    await at(T(10), () =>
      inTx((tx) =>
        submitGroups(tx, v.cfg, s.visitId, {
          ...command,
          groups: [{ release: "hold", lines: [line(v, "flan")] }],
          joinGroupId: mains.id,
        }),
      ),
    );

    expect(await later(s.visitId)).toEqual({ 1: false, 2: false });
  });
});
