import { randomUUID } from "node:crypto";
import {
  CORE_MIGRATIONS,
  locations,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { jsonFile } from "@waitron/module";
import { describe, expect, it } from "vitest";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { ADJUSTMENTS_PERSONAL_DATA } from "./personal-data.js";
import type { AdjustmentAction } from "./policy.js";
import { adjustments, type AdjustmentStage } from "./schema/adjustments.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS] });

const MARTA = "10000000-0000-4000-8000-00000000000a";
const LUIS = "20000000-0000-4000-8000-00000000000b";
const ANA = "30000000-0000-4000-8000-00000000000c";
const NOBODY = "40000000-0000-4000-8000-00000000000d";

const subject = (personId: string) => ({
  personId,
  language: "en" as const,
  at: new Date("2026-10-24T10:00:00.000Z"),
  timeZone: "UTC",
  locationId: null,
});

/** Prepares inside a write-lock turn and builds after it, as `sendPersonalData` does. */
async function download(personId: string): Promise<{ name: string; text: string }[]> {
  const db = suite.db;
  const build = await db.withWriteLock(() =>
    ADJUSTMENTS_PERSONAL_DATA.prepare(db, subject(personId)),
  );
  const files = await build();
  return files.map((f) => {
    if (typeof f.content !== "string") throw new Error(`${f.name} is not text`);
    return { name: f.name, text: f.content };
  });
}

async function fileOf(personId: string): Promise<string> {
  const files = await download(personId);
  expect(files.map((f) => f.name)).toEqual(["adjustments.json"]);
  return files[0]!.text;
}

async function seedOrders(db: Database): Promise<Record<41 | 42 | 43, string>> {
  const [location] = await db
    .insert(locations)
    .values({ name: "Dining room", invoiceLocales: ["es"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  const orders = {} as Record<41 | 42 | 43, string>;
  for (const orderNumber of [41, 42, 43] as const) {
    const [order] = await db
      .insert(workingOrders)
      .values({ source: "dashboard", deviceId: null, locationId: location!.id, orderNumber })
      .returning({ id: workingOrders.id });
    orders[orderNumber] = order!.id;
  }
  return orders;
}

interface Row {
  id: string;
  createdAt: string;
  workingOrderId: string;
  action: AdjustmentAction;
  /** Null for a discount on the whole bill. */
  line: { name: string; quantity: number; stage: AdjustmentStage } | null;
  percentBp: number | null;
  before: number;
  after: number;
  nominal: number;
  reason: string;
  chargeKept: boolean;
  preparationStarted: boolean | null;
  requestedBy: string;
  approvedBy: string | null;
  byGuest?: boolean;
  note: string;
}

async function insertRow(db: Database, row: Row): Promise<void> {
  await db.insert(adjustments).values({
    id: row.id,
    createdAt: row.createdAt,
    workingOrderId: row.workingOrderId,
    lineId: row.line === null ? null : randomUUID(),
    splits: [],
    lineName: row.line?.name ?? null,
    lineQuantity: row.line === null ? null : row.line.quantity + 1000,
    lineListUnitPrice: row.line === null ? null : row.nominal,
    creditedTo: null,
    reasonId: randomUUID(),
    reasonName: row.reason,
    policySnapshot: {
      kind: "comp",
      actions: [row.action],
      maxPercentBp: null,
      maxAmount: null,
      applyRoles: [],
      approverRoles: [],
      noteRequired: false,
    },
    action: row.action,
    quantity: row.line?.quantity ?? null,
    percentBp: row.percentBp,
    beforeAmount: row.before,
    afterAmount: row.after,
    reduction: row.before - row.after,
    nominalValue: row.nominal,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    note: row.note,
    stage: row.line?.stage ?? null,
    byGuest: row.byGuest ?? false,
    chargeKept: row.chargeKept,
    preparationStarted: row.preparationStarted,
  });
}

/** The plan's fixture: ids run against time, and m3 and m4 share one time. */
function fixtureRows(orders: Record<41 | 42 | 43, string>): Row[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000000006",
      createdAt: "2026-10-03T19:05:00.000Z",
      workingOrderId: orders[41],
      action: "cancel",
      line: { name: "Grilled squid", quantity: 1000, stage: "fired" },
      percentBp: null,
      before: 1235,
      after: 0,
      nominal: 1235,
      reason: "Sent to the wrong table",
      chargeKept: false,
      preparationStarted: true,
      requestedBy: MARTA,
      approvedBy: LUIS,
      note: "note for m1",
    },
    {
      id: "00000000-0000-4000-8000-000000000005",
      createdAt: "2026-10-03T19:20:00.000Z",
      workingOrderId: orders[41],
      action: "cancel",
      line: { name: "House red", quantity: 1000, stage: "served" },
      percentBp: null,
      before: 485,
      after: 485,
      nominal: 485,
      reason: "Kitchen error",
      chargeKept: true,
      preparationStarted: true,
      requestedBy: MARTA,
      approvedBy: null,
      note: "note for m2",
    },
    // m3 before m4: without the id tie-break, insertion order would put m3 first.
    {
      id: "00000000-0000-4000-8000-000000000004",
      createdAt: "2026-10-04T13:10:00.000Z",
      workingOrderId: orders[42],
      action: "comp",
      line: { name: "Chocolate cake", quantity: 1000, stage: "unsent" },
      percentBp: null,
      before: 615,
      after: 0,
      nominal: 615,
      reason: "Birthday treat",
      chargeKept: false,
      preparationStarted: null,
      requestedBy: MARTA,
      approvedBy: LUIS,
      note: "note for m3",
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      createdAt: "2026-10-04T13:10:00.000Z",
      workingOrderId: orders[42],
      action: "discount_percent",
      line: null,
      percentBp: 1250,
      before: 2568,
      after: 2247,
      nominal: 2568,
      reason: "Regular guest",
      chargeKept: false,
      preparationStarted: null,
      requestedBy: MARTA,
      approvedBy: null,
      note: "note for m4",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      createdAt: "2026-10-05T20:45:00.000Z",
      workingOrderId: orders[43],
      action: "cancel",
      line: { name: "Sparkling water", quantity: 2000, stage: "fired" },
      percentBp: null,
      before: 470,
      after: 0,
      nominal: 470,
      reason: "Spilled",
      chargeKept: false,
      preparationStarted: true,
      requestedBy: ANA,
      approvedBy: LUIS,
      note: "note for a1",
    },
    {
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-10-06T12:00:00.000Z",
      workingOrderId: orders[43],
      action: "discount_amount",
      line: { name: "Lemon tart", quantity: 1000, stage: "fired" },
      percentBp: null,
      before: 590,
      after: 440,
      nominal: 590,
      reason: "Late dish",
      chargeKept: false,
      preparationStarted: null,
      requestedBy: LUIS,
      approvedBy: null,
      note: "note for l1",
    },
  ];
}

async function seedFixture(): Promise<Record<41 | 42 | 43, string>> {
  const orders = await seedOrders(suite.db);
  for (const row of fixtureRows(orders)) await insertRow(suite.db, row);
  return orders;
}

const m1 = {
  action: "cancel",
  at: "2026-10-03T19:05:00.000Z",
  order: 41,
  item: "Grilled squid",
  quantity: "1.000",
  percent: null,
  takenOff: "12.35",
  listValue: "12.35",
  reason: "Sent to the wrong table",
  stage: "fired",
  chargeKept: false,
  preparationStarted: true,
};
const m2 = {
  action: "cancel",
  at: "2026-10-03T19:20:00.000Z",
  order: 41,
  item: "House red",
  quantity: "1.000",
  percent: null,
  takenOff: "0.00",
  listValue: "4.85",
  reason: "Kitchen error",
  stage: "served",
  chargeKept: true,
  preparationStarted: true,
};
const m3 = {
  action: "comp",
  at: "2026-10-04T13:10:00.000Z",
  order: 42,
  item: "Chocolate cake",
  quantity: "1.000",
  percent: null,
  takenOff: "6.15",
  listValue: "6.15",
  reason: "Birthday treat",
  stage: "unsent",
  chargeKept: false,
  preparationStarted: null,
};
const m4 = {
  action: "discount_percent",
  at: "2026-10-04T13:10:00.000Z",
  order: 42,
  item: null,
  quantity: null,
  percent: "12.50",
  takenOff: "3.21",
  listValue: "25.68",
  reason: "Regular guest",
  stage: null,
  chargeKept: false,
  preparationStarted: null,
};
const a1 = {
  action: "cancel",
  at: "2026-10-05T20:45:00.000Z",
  order: 43,
  item: "Sparkling water",
  quantity: "2.000",
  percent: null,
  takenOff: "4.70",
  listValue: "4.70",
  reason: "Spilled",
  stage: "fired",
  chargeKept: false,
  preparationStarted: true,
};
const l1 = {
  action: "discount_amount",
  at: "2026-10-06T12:00:00.000Z",
  order: 43,
  item: "Lemon tart",
  quantity: "1.000",
  percent: null,
  takenOff: "1.50",
  listValue: "5.90",
  reason: "Late dish",
  stage: "fired",
  chargeKept: false,
  preparationStarted: null,
};

describe("ADJUSTMENTS_PERSONAL_DATA", () => {
  it("gives Marta her four requests, by time and then id, with the line columns null on a bill discount", async () => {
    await seedFixture();
    const expected = {
      counts: { cancel: 2, comp: 1, discount_percent: 1, discount_amount: 0 },
      entries: [
        { ...m1, yourPart: ["requested"] },
        { ...m2, yourPart: ["requested"] },
        { ...m4, yourPart: ["requested"] },
        { ...m3, yourPart: ["requested"] },
      ],
    };
    const text = await fileOf(MARTA);
    expect(JSON.parse(text)).toEqual(expected);
    expect(text).toBe(jsonFile("adjustments.json", expected).content);
  });

  it("gives Luis the rows he approved and the one he requested, ordered by time", async () => {
    await seedFixture();
    const expected = {
      counts: { cancel: 2, comp: 1, discount_percent: 0, discount_amount: 1 },
      entries: [
        { ...m1, yourPart: ["approved"] },
        { ...m3, yourPart: ["approved"] },
        { ...a1, yourPart: ["approved"] },
        { ...l1, yourPart: ["requested"] },
      ],
    };
    const text = await fileOf(LUIS);
    expect(JSON.parse(text)).toEqual(expected);
    expect(text).toBe(jsonFile("adjustments.json", expected).content);
  });

  it("names both parts when the person asked for and approved one row", async () => {
    const orders = await seedFixture();
    await insertRow(suite.db, {
      id: "00000000-0000-4000-8000-000000000007",
      createdAt: "2026-10-07T18:30:00.000Z",
      workingOrderId: orders[43],
      action: "comp",
      line: { name: "Olive bread", quantity: 1000, stage: "served" },
      percentBp: null,
      before: 325,
      after: 0,
      nominal: 325,
      reason: "Supervisor's own comp",
      chargeKept: false,
      preparationStarted: true,
      requestedBy: LUIS,
      approvedBy: LUIS,
      note: "note for both",
    });
    const parsed = JSON.parse(await fileOf(LUIS)) as { entries: unknown[] };
    expect(parsed.entries.at(-1)).toEqual({
      action: "comp",
      at: "2026-10-07T18:30:00.000Z",
      order: 43,
      item: "Olive bread",
      quantity: "1.000",
      percent: null,
      takenOff: "3.25",
      listValue: "3.25",
      reason: "Supervisor's own comp",
      stage: "served",
      chargeKept: false,
      preparationStarted: true,
      yourPart: ["requested", "approved"],
    });
  });

  it("does not count a guest's request as the requester's own, but keeps its approval", async () => {
    const orders = await seedOrders(suite.db);
    const guest = (
      id: string,
      createdAt: string,
      item: string,
      requestedBy: string,
      approvedBy: string | null,
    ): Row => ({
      id,
      createdAt,
      workingOrderId: orders[41],
      action: "comp",
      line: { name: item, quantity: 1000, stage: "served" },
      percentBp: null,
      before: 245,
      after: 0,
      nominal: 245,
      reason: "Guest's choice",
      chargeKept: false,
      preparationStarted: true,
      requestedBy,
      approvedBy,
      byGuest: true,
      note: `note for ${item}`,
    });
    await insertRow(
      suite.db,
      guest(
        "00000000-0000-4000-8000-000000000011",
        "2026-10-08T12:01:00.000Z",
        "g1 croquettes",
        MARTA,
        null,
      ),
    );
    await insertRow(
      suite.db,
      guest(
        "00000000-0000-4000-8000-000000000012",
        "2026-10-08T12:02:00.000Z",
        "g2 olives",
        MARTA,
        LUIS,
      ),
    );
    await insertRow(
      suite.db,
      guest(
        "00000000-0000-4000-8000-000000000013",
        "2026-10-08T12:03:00.000Z",
        "g3 almonds",
        MARTA,
        MARTA,
      ),
    );
    const marta = JSON.parse(await fileOf(MARTA)) as {
      entries: { item: string; yourPart: string[] }[];
    };
    expect(marta.entries.map((e) => [e.item, e.yourPart])).toEqual([["g3 almonds", ["approved"]]]);
    const luis = JSON.parse(await fileOf(LUIS)) as {
      entries: { item: string; yourPart: string[] }[];
    };
    expect(luis.entries.map((e) => [e.item, e.yourPart])).toEqual([["g2 olives", ["approved"]]]);
  });

  it("builds no file for a person on no row", async () => {
    await seedFixture();
    expect(await download(NOBODY)).toEqual([]);
  });

  it("holds none of Ana's or Luis's own rows in Marta's file", async () => {
    await seedFixture();
    const text = await fileOf(MARTA);
    const parsed = JSON.parse(text) as { entries: { order: number }[] };
    expect(parsed.entries.filter((e) => e.order === 43)).toEqual([]);
    for (const value of ["Sparkling water", "Spilled", "4.70", "Lemon tart", "Late dish", "1.50"]) {
      expect(text, value).not.toContain(value);
    }
  });

  it("names no person and carries no note", async () => {
    const notes = fixtureRows(await seedFixture()).map((row) => row.note);
    const files = { marta: await fileOf(MARTA), luis: await fileOf(LUIS), ana: await fileOf(ANA) };
    expect(files.marta).toContain("Grilled squid");
    for (const id of [MARTA, LUIS, ANA]) expect(files.marta, id).not.toContain(id);
    for (const id of [MARTA, ANA]) expect(files.luis, id).not.toContain(id);
    for (const id of [MARTA, LUIS]) expect(files.ana, id).not.toContain(id);
    for (const [who, text] of Object.entries(files)) {
      for (const note of notes) expect(text, `${who}: ${note}`).not.toContain(note);
    }
  });
});

interface CompiledStatement {
  sql: string;
  params: unknown[];
}

interface DrizzleSession {
  prepareQuery(query: CompiledStatement, ...rest: unknown[]): { all(): unknown };
}

/**
 * `tx` with every statement drizzle compiles on it recorded, each with its query plan read through
 * the same session.
 */
function planningEveryStatement(tx: Transaction) {
  const statements: { sql: string; plan: () => string[] }[] = [];
  const recording = new Proxy(tx, {
    get: (target, key, receiver) => {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key !== "session") return value;
      const session = value as DrizzleSession;
      return new Proxy(session, {
        get: (inner, innerKey, innerReceiver) =>
          innerKey === "prepareQuery"
            ? (query: CompiledStatement, ...rest: unknown[]) => {
                statements.push({
                  sql: query.sql,
                  plan: () =>
                    (
                      inner
                        .prepareQuery(
                          { sql: `explain query plan ${query.sql}`, params: query.params },
                          undefined,
                          "all",
                        )
                        .all() as { detail: string }[]
                    ).map((row) => row.detail),
                });
                return inner.prepareQuery(query, ...rest);
              }
            : Reflect.get(inner, innerKey, innerReceiver),
      });
    },
  });
  return { recording, statements };
}

// This read runs while the venue's write lock is held, and the table grows with every void and comp.
describe("prepare's read", () => {
  it("finds every row it reads through an index, scanning no table", async () => {
    await seedFixture();
    const plans = await withTransaction(suite.db, async (tx) => {
      const { recording, statements } = planningEveryStatement(tx);
      await ADJUSTMENTS_PERSONAL_DATA.prepare(recording, subject(MARTA));
      return statements.map((statement) => ({
        from: /^select .*? from "(\w+)"/.exec(statement.sql)?.[1],
        plan: statement.plan(),
      }));
    });
    expect(plans.map((p) => p.from)).toEqual(["adjustments"]);
    expect(plans.flatMap((p) => p.plan.filter((line) => line.startsWith("SCAN")))).toEqual([]);
  });
});
