import { seedDeviceProfiles, seedZone } from "@waitron/db/testing/seed.js";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { cancelItemForTest } from "./testing/cancel-line.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  kitchenCourses,
  diningTables,
  orderEvents,
  parties,
  partyTables,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  addStarterServiceSteps,
  createDepartment,
  createServiceZone,
  recordStepCompletions,
  serviceStepCompletions,
  serviceSteps,
} from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { createCourse } from "./kitchen.js";
import { cancelItem } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { fireGroup } from "./order-groups.js";
import { insertPartyBill } from "./parties.js";
import { markServiceStepDone } from "./service-step-done.js";
import {
  readStepFacts,
  readTableSteps,
  stepSignal,
  type StepParty,
} from "./service-step-signals.js";
import { numberBill } from "./testing/bill-identities.js";
import { cancelLine, cancelReasonId, ensureOperator } from "./testing/cancel-line.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { joinTables, splitTable } from "./testing/table-action-fixture.js";
import {
  commandFor,
  inTx,
  join,
  OPERATOR,
  orderForParty,
  pay,
  revisionOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import { serveLine } from "./testing/serve-line.js";
import { departmentOf, setOpenedAt, setSteps } from "./testing/service-steps.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const OPENED = "2020-01-01T20:30:00.000Z";
const NOW = Date.parse("2099-01-01T00:00:00.000Z");
const MINUTE = 60_000;

async function tablesDepartment(v: PartyVenue): Promise<string> {
  return departmentOf(v, v.tables.zoneId);
}

async function stepParty(v: PartyVenue, partyId: string): Promise<StepParty> {
  return inTx(v, async (tx) => {
    const [party] = await tx
      .select({ openedAt: parties.openedAt })
      .from(parties)
      .where(eq(parties.id, partyId));
    const tables = await tx
      .select({ tableId: partyTables.tableId })
      .from(partyTables)
      .where(and(eq(partyTables.partyId, partyId), isNull(partyTables.leftAt)));
    return { partyId, openedAt: party!.openedAt, tableIds: tables.map((row) => row.tableId) };
  });
}

async function stepsOf(v: PartyVenue, partyIds: string[], nowMs = NOW) {
  const given: StepParty[] = [];
  for (const partyId of partyIds) given.push(await stepParty(v, partyId));
  return inTx(v, (tx) => readTableSteps(tx, given, nowMs));
}

async function liveAt(v: PartyVenue, partyId: string, tableId: string, nowMs = NOW) {
  return (await stepsOf(v, [partyId], nowMs)).get(tableId)?.live;
}

async function lineIdOf(v: PartyVenue, billId: string, name: string): Promise<string> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.name, name))),
  );
  return row!.id;
}

async function lineNoOf(v: PartyVenue, billId: string, name: string): Promise<number> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.name, name))),
  );
  return row!.lineNo;
}

async function serve(v: PartyVenue, billId: string, name: string): Promise<number> {
  const lineNo = await lineNoOf(v, billId, name);
  await inTx(v, (tx) => serveLine(tx, v.cfg, billId, lineNo));
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ servedAt: workingOrderLines.servedAt })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
      ),
  );
  return Date.parse(row!.servedAt!);
}

async function setCourse(v: PartyVenue, courseId: string, lineIds: string[]): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(workingOrderLines).set({ courseId }).where(inArray(workingOrderLines.id, lineIds)),
  );
}

async function lastOrderAt(v: PartyVenue, partyId: string): Promise<number> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ at: orderEvents.at })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.partyId, partyId),
          inArray(orderEvents.kind, ["group.submitted", "group.joined"]),
        ),
      ),
  );
  if (rows.length === 0) throw new Error(`no submitted or joined order for party ${partyId}`);
  return Math.max(...rows.map((row) => Date.parse(row.at)));
}

function draftLine(v: PartyVenue, name: string) {
  return {
    menuItemId: v.item(name),
    variantId: null,
    menuVersionId: null,
    options: [],
    extras: [],
    note: null,
    quantity: "1",
    courseId: null,
    noMerge: false,
  };
}

async function openDraft(v: PartyVenue, partyId: string, billId: string): Promise<void> {
  await inTx(v, (tx) =>
    saveDraft(tx, v.cfg, partyId, OPERATOR, {
      billId,
      draftId: null,
      revision: 0,
      lines: [draftLine(v, "Water")],
    }),
  );
}

async function holdGroup(v: PartyVenue, partyId: string, ...names: string[]): Promise<string> {
  const placed = await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, partyId, {
      groups: [
        {
          lines: names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
          release: "hold",
        },
      ],
      operatorId: OPERATOR,
    }),
  );
  return placed.groups[0]!.id;
}

const seated = (name: string, minutes = 0) =>
  ({ name, start: "seated", courseId: null, minutes }) as const;

describe("readTableSteps", () => {
  it("a seated party's step is due at its seating", async () => {
    const v = await setupPartyVenue(suite.db);
    const department = await tablesDepartment(v);
    const ids = await setSteps(v, department, [seated("Set up"), seated("Water?", 5)]);
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    await setOpenedAt(v, partyId, OPENED);

    const steps = (await stepsOf(v, [partyId])).get(tableId);

    expect(steps).toEqual({
      departmentId: department,
      live: [
        {
          stepId: ids[0],
          name: "Set up",
          triggeredAt: Date.parse(OPENED),
          dueAt: Date.parse(OPENED),
        },
        {
          stepId: ids[1],
          name: "Water?",
          triggeredAt: Date.parse(OPENED),
          dueAt: Date.parse(OPENED) + 5 * MINUTE,
        },
      ],
    });
    expect(stepSignal(steps)).toEqual({
      kind: "service_step",
      steps: [
        { stepId: ids[0], name: "Set up", dueAt: OPENED },
        { stepId: ids[1], name: "Water?", dueAt: "2020-01-01T20:35:00.000Z" },
      ],
    });
    expect(stepSignal(undefined)).toBeUndefined();
    expect(stepSignal({ ...steps!, live: [] })).toBeUndefined();
  });

  it("a course served reads the family's dishes of that course", async () => {
    const v = await setupPartyVenue(suite.db);
    const mains = await inTx(v, (tx) => createCourse(tx, { name: "Mains" }));
    const [dessert] = await setSteps(v, await tablesDepartment(v), [
      { name: "Dessert?", start: "course_served", courseId: mains.id, minutes: 10 },
    ]);
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    const { tabId } = await orderForParty(v, partyId, ["Burger", "Paella", "Water"]);
    await setCourse(v, mains.id, [
      await lineIdOf(v, tabId, "Burger"),
      await lineIdOf(v, tabId, "Paella"),
    ]);

    await serve(v, tabId, "Burger");
    expect(await liveAt(v, partyId, tableId)).toEqual([]);

    const servedAt = await serve(v, tabId, "Paella");
    expect(await liveAt(v, partyId, tableId)).toEqual([
      { stepId: dessert, name: "Dessert?", triggeredAt: servedAt, dueAt: servedAt + 10 * MINUTE },
    ]);
  });

  it("a cancelled dish and an abandoned bill's dishes are left out", async () => {
    const v = await setupPartyVenue(suite.db);
    const mains = await inTx(v, (tx) => createCourse(tx, { name: "Mains" }));
    const [dessert] = await setSteps(v, await tablesDepartment(v), [
      { name: "Dessert?", start: "course_served", courseId: mains.id, minutes: 10 },
    ]);
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    const { tabId } = await orderForParty(v, partyId, ["Burger", "Paella", "Flan"]);
    await setCourse(v, mains.id, [
      await lineIdOf(v, tabId, "Burger"),
      await lineIdOf(v, tabId, "Paella"),
      await lineIdOf(v, tabId, "Flan"),
    ]);
    const abandoned = await split(v, partyId, tabId, [await lineNoOf(v, tabId, "Flan")]);
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, abandoned)),
    );
    await openDraft(v, partyId, tabId);
    const paellaNo = await lineNoOf(v, tabId, "Paella");
    await inTx(v, (tx) => cancelItemForTest(tx, v.cfg, tabId, paellaNo, undefined, OPERATOR));

    const servedAt = await serve(v, tabId, "Burger");

    expect(await liveAt(v, partyId, tableId)).toEqual([
      { stepId: dessert, name: "Dessert?", triggeredAt: servedAt, dueAt: servedAt + 10 * MINUTE },
    ]);
  });

  it("everything served is triggered once the last dish is served", async () => {
    const v = await setupPartyVenue(suite.db);
    const [anything] = await setSteps(v, await tablesDepartment(v), [
      { name: "Anything else?", start: "all_served", courseId: null, minutes: 10 },
    ]);
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    const { tabId } = await orderForParty(v, partyId, ["Burger", "Water"]);
    const held = await holdGroup(v, partyId, "Flan");
    expect(await liveAt(v, partyId, tableId)).toEqual([]);

    await serve(v, tabId, "Burger");
    await serve(v, tabId, "Water");
    // The held dessert is still to serve.
    expect(await liveAt(v, partyId, tableId)).toEqual([]);

    const fire = { submissionId: randomUUID(), ...(await commandFor(v, partyId)) };
    await inTx(v, (tx) => fireGroup(tx, v.cfg, partyId, held, fire));
    const servedAt = await serve(v, tabId, "Flan");
    expect(await liveAt(v, partyId, tableId)).toEqual([
      {
        stepId: anything,
        name: "Anything else?",
        triggeredAt: servedAt,
        dueAt: servedAt + 10 * MINUTE,
      },
    ]);
  });

  it("the first order sent through placeGroups clears a step triggered before it", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await tablesDepartment(v), [seated("Set up")]);
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    await setOpenedAt(v, partyId, OPENED);
    expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([setUp]);

    await orderForParty(v, partyId, ["Water"]);

    expect(await liveAt(v, partyId, tableId)).toEqual([]);
  });

  it("every N minutes since the last order counts from that order", async () => {
    const v = await setupPartyVenue(suite.db);
    const [drinks] = await setSteps(v, await tablesDepartment(v), [
      { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 20 },
    ]);
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    expect(await liveAt(v, partyId, tableId)).toEqual([]);

    await orderForParty(v, partyId, ["Caña"]);
    const first = await lastOrderAt(v, partyId);
    const due = (at: number) => [{ stepId: drinks, name: "Drinks?", triggeredAt: at, dueAt: at }];
    expect(await liveAt(v, partyId, tableId, first + 25 * MINUTE)).toEqual(
      due(first + 20 * MINUTE),
    );
    expect(await liveAt(v, partyId, tableId, first + 45 * MINUTE)).toEqual(
      due(first + 40 * MINUTE),
    );

    await orderForParty(v, partyId, ["Caña"]);
    const second = await lastOrderAt(v, partyId);
    expect(await liveAt(v, partyId, tableId, second + 5 * MINUTE)).toEqual(
      due(second + 20 * MINUTE),
    );
  });

  it("a named step is triggered by a recorded Done", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp, takeOrder] = await setSteps(v, await tablesDepartment(v), [
      { ...seated("Set up"), key: "setup" },
      {
        name: "Take order",
        start: "after_step",
        afterStepKey: "setup",
        courseId: null,
        minutes: 2,
      },
    ]);
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    await setOpenedAt(v, partyId, OPENED);
    expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([setUp]);

    const done = "2020-01-01T20:33:00.000Z";
    await inTx(v, (tx) =>
      recordStepCompletions(tx, [{ partyId, stepId: setUp!, doneAt: done, doneBy: OPERATOR }]),
    );

    expect(await liveAt(v, partyId, tableId)).toEqual([
      {
        stepId: takeOrder,
        name: "Take order",
        triggeredAt: Date.parse(done),
        dueAt: Date.parse(done) + 2 * MINUTE,
      },
    ]);
  });

  it("before the first order no step shows while the party has an open draft", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await tablesDepartment(v), [seated("Set up")]);
    const tableId = await v.table("Table 1");
    const { partyId, tabId } = await seat(v, tableId);
    expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([setUp]);

    await openDraft(v, partyId, tabId);

    expect(await liveAt(v, partyId, tableId)).toEqual([]);
  });

  it("each table reads its own zone's department", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await tablesDepartment(v), [seated("Set up")]);
    const terrace = await inTx(v, async (tx) => {
      const department = await createDepartment(tx, { name: "Terrace service" });
      const zone = await createServiceZone(tx, {
        name: "Terrace",
        departmentId: department.id,
      });
      return { departmentId: department.id, zoneId: zone.id };
    });
    const [water] = await setSteps(v, terrace.departmentId, [seated("Water?", 5)]);
    const inside = await v.table("Table 1");
    const outside = await v.table("T1", terrace.zoneId);
    const { partyId } = await seat(v, inside);
    // `joinTables` refuses a table of another zone (`service_zone.join_mismatch`).
    await inTx(v, (tx) => tx.insert(partyTables).values({ partyId, tableId: outside }));
    await setOpenedAt(v, partyId, OPENED);

    const steps = await stepsOf(v, [partyId]);

    expect(steps.get(inside)!.live.map((step) => step.stepId)).toEqual([setUp]);
    expect(steps.get(outside)).toEqual({
      departmentId: terrace.departmentId,
      live: [
        {
          stepId: water,
          name: "Water?",
          triggeredAt: Date.parse(OPENED),
          dueAt: Date.parse(OPENED) + 5 * MINUTE,
        },
      ],
    });
  });

  it("a table whose zone is inactive shows no step", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await tablesDepartment(v), [seated("Set up")]);
    const outside = await inTx(v, async (tx) => {
      const zone = await seedZone(tx, { name: "Inactive", active: false });
      const [table] = await tx
        .insert(diningTables)
        .values({ label: "L1", zoneId: zone!.id })
        .returning({ id: diningTables.id });
      return table!.id;
    });
    const inside = await v.table("Table 1");
    const { partyId } = await seat(v, inside);
    await inTx(v, (tx) => tx.insert(partyTables).values({ partyId, tableId: outside }));

    const steps = await stepsOf(v, [partyId]);

    expect(steps.get(inside)!.live.map((step) => step.stepId)).toEqual([setUp]);
    expect(steps.has(outside)).toBe(false);
  });

  it("a new venue's starter steps reach the floor", async () => {
    const v = await setupPartyVenue(suite.db);
    const department = await tablesDepartment(v);
    await inTx(v, (tx) => addStarterServiceSteps(tx, department));
    const [first] = await inTx(v, (tx) =>
      tx
        .select({ id: serviceSteps.id, name: serviceSteps.name })
        .from(serviceSteps)
        .where(eq(serviceSteps.departmentId, department))
        .orderBy(asc(serviceSteps.position))
        .limit(1),
    );
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    await setOpenedAt(v, partyId, OPENED);

    expect(await liveAt(v, partyId, tableId)).toEqual([
      {
        stepId: first!.id,
        name: first!.name,
        triggeredAt: Date.parse(OPENED),
        dueAt: Date.parse(OPENED),
      },
    ]);
  });

  it.each([false, true])(
    "starter course visits follow servings without gating preordered dessert: %s",
    async (preordered) => {
      const v = await setupPartyVenue(suite.db);
      const department = await tablesDepartment(v);
      const { mains, desserts, visits } = await inTx(v, async (tx) => {
        const courses = await tx.select().from(kitchenCourses);
        const mains = courses.find((row) => row.starterKey === "mains")!;
        const desserts = courses.find((row) => row.starterKey === "desserts")!;
        await addStarterServiceSteps(tx, department, "en");
        const visits = await tx
          .select()
          .from(serviceSteps)
          .where(eq(serviceSteps.departmentId, department))
          .orderBy(serviceSteps.position);
        return { mains, desserts, visits };
      });
      const tableId = await v.table("Table 1");
      const { partyId } = await seat(v, tableId);
      const { tabId } = await orderForParty(v, partyId, ["Burger"]);
      await setCourse(v, mains.id, [await lineIdOf(v, tabId, "Burger")]);
      const held = preordered ? await holdGroup(v, partyId, "Flan") : null;
      if (preordered) await setCourse(v, desserts.id, [await lineIdOf(v, tabId, "Flan")]);
      expect(await liveAt(v, partyId, tableId)).toEqual([]);
      const servedAt = await serve(v, tabId, "Burger");
      expect(await liveAt(v, partyId, tableId)).toEqual([
        {
          stepId: visits[2]!.id,
          name: "Dessert?",
          triggeredAt: servedAt,
          dueAt: servedAt + 5 * MINUTE,
        },
      ]);
      if (held !== null) {
        const fire = { submissionId: randomUUID(), ...(await commandFor(v, partyId)) };
        await inTx(v, (tx) => fireGroup(tx, v.cfg, partyId, held, fire));
        const dessertServedAt = await serve(v, tabId, "Flan");
        const live = await liveAt(v, partyId, tableId);
        expect(live).toContainEqual({
          stepId: visits[3]!.id,
          name: "Coffee or bill?",
          triggeredAt: dessertServedAt,
          dueAt: dessertServedAt + 5 * MINUTE,
        });
      }
    },
  );

  it("a party at two tables of one department gets the same steps on both", async () => {
    const v = await setupPartyVenue(suite.db);
    const department = await tablesDepartment(v);
    const [setUp] = await setSteps(v, department, [seated("Set up")]);
    const firstTable = await v.table("Table 1");
    const secondTable = await v.table("Table 2");
    const { partyId } = await seat(v, firstTable);
    await join(v, partyId, secondTable);
    await setOpenedAt(v, partyId, OPENED);

    const steps = await stepsOf(v, [partyId]);

    const expected = {
      departmentId: department,
      live: [
        {
          stepId: setUp,
          name: "Set up",
          triggeredAt: Date.parse(OPENED),
          dueAt: Date.parse(OPENED),
        },
      ],
    };
    expect(steps.get(firstTable)).toEqual(expected);
    expect(steps.get(secondTable)).toEqual(expected);
  });

  it("a party merged into another brings its orders and dishes", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp, drinks, anything] = await setSteps(v, await tablesDepartment(v), [
      seated("Set up"),
      { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 20 },
      { name: "Anything else?", start: "all_served", courseId: null, minutes: 10 },
    ]);
    const firstTable = await v.table("Table 1");
    const secondTable = await v.table("Table 2");
    const a = await seat(v, firstTable);
    await setOpenedAt(v, a.partyId, OPENED);
    const b = await seat(v, secondTable);
    const { tabId } = await orderForParty(v, b.partyId, ["Water"]);
    const servedAt = await serve(v, tabId, "Water");
    await pay(v, tabId, "2.00");
    const ordered = await lastOrderAt(v, b.partyId);
    expect((await liveAt(v, a.partyId, firstTable))!.map((step) => step.stepId)).toEqual([setUp]);

    const into = await commandFor(v, a.partyId);
    const from = await commandFor(v, b.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, a.partyId, secondTable, {
        ...into,
        otherPartyId: b.partyId,
        expectedOtherPartyRevision: from.expectedPartyRevision,
      }),
    );

    const live = [
      {
        stepId: anything,
        name: "Anything else?",
        triggeredAt: servedAt,
        dueAt: servedAt + 10 * MINUTE,
      },
      {
        stepId: drinks,
        name: "Drinks?",
        triggeredAt: ordered + 20 * MINUTE,
        dueAt: ordered + 20 * MINUTE,
      },
    ];
    expect(await liveAt(v, a.partyId, firstTable, ordered + 25 * MINUTE)).toEqual(live);
    expect(await liveAt(v, a.partyId, secondTable, ordered + 25 * MINUTE)).toEqual(live);
  });

  it("a party seated after an older one's first order has ordered once it takes that party in", async () => {
    const v = await setupPartyVenue(suite.db);
    await setSteps(v, await tablesDepartment(v), [seated("Take order")]);
    const olderTable = await v.table("Table 1");
    const laterTable = await v.table("Table 2");
    const older = await seat(v, olderTable);
    await setOpenedAt(v, older.partyId, OPENED);
    await orderForParty(v, older.partyId, ["Water"]);
    const later = await seat(v, laterTable);
    const seatedAt = new Date((await lastOrderAt(v, older.partyId)) + 5 * MINUTE).toISOString();
    await setOpenedAt(v, later.partyId, seatedAt);

    const into = await commandFor(v, later.partyId);
    const from = await commandFor(v, older.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, later.partyId, olderTable, {
        ...into,
        otherPartyId: older.partyId,
        expectedOtherPartyRevision: from.expectedPartyRevision,
      }),
    );

    expect(await liveAt(v, later.partyId, laterTable)).toEqual([]);
    expect(await liveAt(v, later.partyId, olderTable)).toEqual([]);
  });

  it("reads every fact once, whatever the number of parties", async () => {
    const v = await setupPartyVenue(suite.db);
    const mains = await inTx(v, (tx) => createCourse(tx, { name: "Mains" }));
    const [setUp] = await setSteps(v, await tablesDepartment(v), [
      seated("Set up"),
      { name: "Dessert?", start: "course_served", courseId: mains.id, minutes: 10 },
    ]);
    const busyParty = async (label: string): Promise<string> => {
      const { partyId } = await seat(v, await v.table(label));
      const { tabId } = await orderForParty(v, partyId, ["Burger"]);
      await serve(v, tabId, "Burger");
      await inTx(v, (tx) =>
        recordStepCompletions(tx, [
          { partyId, stepId: setUp!, doneAt: new Date().toISOString(), doneBy: OPERATOR },
        ]),
      );
      return partyId;
    };
    const statements = async (partyIds: string[]) => {
      const given: StepParty[] = [];
      for (const partyId of partyIds) given.push(await stepParty(v, partyId));
      return inTx(v, async (tx) => {
        const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
        try {
          const steps = await readTableSteps(tx, given, NOW);
          return { count: prepare.mock.calls.length, steps };
        } finally {
          prepare.mockRestore();
        }
      });
    };
    const first = await busyParty("Table 1");
    const one = await statements([first]);
    const three = await statements([first, await busyParty("Table 2"), await busyParty("Table 3")]);
    const none = await statements([]);

    expect(three.steps.size).toBe(3);
    expect(one.count).toBe(6);
    expect(three.count).toBe(one.count);
    expect(none).toEqual({ count: 0, steps: new Map() });
  });
});

describe("a party whose dishes arrived from another table or the counter", () => {
  const TAKE_ORDER = seated("Take order");
  const ANOTHER = {
    name: "Another order?",
    start: "since_last_order",
    courseId: null,
    minutes: 10,
  } as const;

  /** A party on its own table with a bill of one dish, on hold or fired. */
  async function partyWith(v: PartyVenue, label: string, release: "hold" | "fire") {
    const { partyId, tabId } = await seat(v, await v.table(label));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [{ lines: [{ menuItemId: v.item("Water"), quantity: "1" }], release }],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    return { partyId, billId: tabId };
  }

  /** Takes the bill to a new party with Move this bill or Split a table; the party and table. */
  async function carryToFreeTable(
    v: PartyVenue,
    how: "move" | "split",
    from: { partyId: string; billId: string },
    label = `Table ${how}`,
  ): Promise<{ partyId: string; tableId: string }> {
    const tableId = await v.table(label);
    if (how === "move") {
      const options = {
        operatorId: OPERATOR,
        partyId: from.partyId,
        expectedPartyRevision: await revisionOf(v, from.partyId),
        otherPartyId: null,
      };
      const moved = await inTx(v, (tx) => moveBill(tx, v.cfg, from.billId, { tableId }, options));
      return { partyId: moved.partyId!, tableId };
    }
    const joining = {
      operatorId: OPERATOR,
      expectedPartyRevision: await revisionOf(v, from.partyId),
    };
    await inTx(v, (tx) => joinTables(tx, v.cfg, from.partyId, tableId, joining));
    const splitting = {
      operatorId: OPERATOR,
      expectedPartyRevision: await revisionOf(v, from.partyId),
    };
    const split = await inTx(v, (tx) =>
      splitTable(tx, v.cfg, from.partyId, tableId, from.billId, splitting),
    );
    return { partyId: split.partyId, tableId };
  }

  /** Moves the bill to the table `partyId` already sits at. */
  async function moveToParty(
    v: PartyVenue,
    from: { partyId: string; billId: string },
    partyId: string,
    tableId: string,
  ): Promise<void> {
    const options = {
      operatorId: OPERATOR,
      partyId: from.partyId,
      expectedPartyRevision: await revisionOf(v, from.partyId),
      otherPartyId: partyId,
      expectedOtherPartyRevision: await revisionOf(v, partyId),
    };
    await inTx(v, (tx) => moveBill(tx, v.cfg, from.billId, { tableId }, options));
  }

  async function factsOf(v: PartyVenue, partyId: string, tableId: string) {
    const given = await stepParty(v, partyId);
    return (await inTx(v, (tx) => readStepFacts(tx, [given]))).get(tableId)!.facts;
  }

  /** When the party's dishes arrived, as the events written for them say. */
  async function arrivalsOf(v: PartyVenue, partyId: string): Promise<number[]> {
    const rows = await inTx(v, (tx) =>
      tx
        .select({ at: orderEvents.at, detail: orderEvents.detail })
        .from(orderEvents)
        .where(and(eq(orderEvents.partyId, partyId), eq(orderEvents.kind, "group.lines_moved"))),
    );
    return rows.filter((row) => row.detail.arrived === true).map((row) => Date.parse(row.at));
  }

  /** A free table holding only a moved-in bill of one dish, its opening older than the arrival. */
  async function arrivedDish(v: PartyVenue, release: "hold" | "fire") {
    const [takeOrder, another] = await setSteps(v, await tablesDepartment(v), [
      TAKE_ORDER,
      ANOTHER,
    ]);
    const from = await partyWith(v, "Table 1", release);
    const { partyId, tableId } = await carryToFreeTable(v, "move", from);
    await setOpenedAt(v, partyId, OPENED);
    return {
      takeOrder: takeOrder!,
      another: another!,
      partyId,
      tableId,
      billId: from.billId,
      arrived: (await arrivalsOf(v, partyId))[0]!,
      lineId: await lineIdOf(v, from.billId, "Water"),
    };
  }

  for (const how of ["move", "split"] as const) {
    for (const release of ["hold", "fire"] as const) {
      it(`${how}, ${release}: the table has ordered, and its order times come from the arrival`, async () => {
        const v = await setupPartyVenue(suite.db);
        const [takeOrder, another] = await setSteps(v, await tablesDepartment(v), [
          TAKE_ORDER,
          ANOTHER,
        ]);
        const from = await partyWith(v, "Table 1", release);

        const { partyId, tableId } = await carryToFreeTable(v, how, from);

        const arrivals = await arrivalsOf(v, partyId);
        expect(arrivals).toHaveLength(1);
        const arrived = arrivals[0]!;
        expect(await factsOf(v, partyId, tableId)).toMatchObject({
          firstOrderAt: arrived,
          lastOrderAt: arrived,
        });
        // With the party's opening older than the arrival, a seated step is a plain "later than".
        await setOpenedAt(v, partyId, OPENED);
        const liveIds = async (at: number) =>
          (await liveAt(v, partyId, tableId, at))!.map((step) => step.stepId);
        expect(await liveIds(arrived + MINUTE)).toEqual([another]);
        expect(await liveIds(arrived + MINUTE)).not.toContain(takeOrder);
        expect(await liveAt(v, partyId, tableId, arrived + 11 * MINUTE)).toEqual([
          {
            stepId: another,
            name: "Another order?",
            triggeredAt: arrived + 10 * MINUTE,
            dueAt: arrived + 10 * MINUTE,
          },
        ]);
      });

      it(`${how}, ${release}: an arrival in the same millisecond as the party opened still clears a seated step`, async () => {
        const v = await setupPartyVenue(suite.db);
        await setSteps(v, await tablesDepartment(v), [TAKE_ORDER]);
        const from = await partyWith(v, "Table 1", release);

        const { partyId, tableId } = await carryToFreeTable(v, how, from);

        const arrived = (await arrivalsOf(v, partyId))[0]!;
        await setOpenedAt(v, partyId, new Date(arrived).toISOString());
        const facts = await factsOf(v, partyId, tableId);
        expect(facts.openedAt).toBe(arrived);
        expect(facts.firstOrderAt).toBe(arrived);
        expect(await liveAt(v, partyId, tableId, arrived + MINUTE)).toEqual([]);
      });

      it(`${how}, ${release}: a real order at the table afterwards takes over the order times`, async () => {
        const v = await setupPartyVenue(suite.db);
        const [, another] = await setSteps(v, await tablesDepartment(v), [TAKE_ORDER, ANOTHER]);
        const from = await partyWith(v, "Table 1", release);
        const { partyId, tableId } = await carryToFreeTable(v, how, from);

        await orderForParty(v, partyId, ["Water"]);

        const ordered = await lastOrderAt(v, partyId);
        expect(await factsOf(v, partyId, tableId)).toMatchObject({
          firstOrderAt: ordered,
          lastOrderAt: ordered,
        });
        expect(await liveAt(v, partyId, tableId, ordered + 11 * MINUTE)).toEqual([
          {
            stepId: another,
            name: "Another order?",
            triggeredAt: ordered + 10 * MINUTE,
            dueAt: ordered + 10 * MINUTE,
          },
        ]);
      });
    }
  }

  for (const release of ["hold", "fire"] as const) {
    it(`${release}: a table with its own orders keeps their times when a bill arrives`, async () => {
      const v = await setupPartyVenue(suite.db);
      const [, another] = await setSteps(v, await tablesDepartment(v), [TAKE_ORDER, ANOTHER]);
      const tableId = await v.table("Table 2");
      const { partyId } = await seat(v, tableId);
      await orderForParty(v, partyId, ["Water"]);
      const ordered = await lastOrderAt(v, partyId);
      const from = await partyWith(v, "Table 1", release);

      await moveToParty(v, from, partyId, tableId);

      expect(await arrivalsOf(v, partyId)).toHaveLength(1);
      expect(await factsOf(v, partyId, tableId)).toMatchObject({
        firstOrderAt: ordered,
        lastOrderAt: ordered,
      });
      expect(await liveAt(v, partyId, tableId, ordered + 11 * MINUTE)).toEqual([
        {
          stepId: another,
          name: "Another order?",
          triggeredAt: ordered + 10 * MINUTE,
          dueAt: ordered + 10 * MINUTE,
        },
      ]);
    });

    it(`${release}: a seated table with no order of its own has ordered once a bill arrives`, async () => {
      const v = await setupPartyVenue(suite.db);
      const [takeOrder] = await setSteps(v, await tablesDepartment(v), [TAKE_ORDER]);
      const tableId = await v.table("Table 2");
      const { partyId } = await seat(v, tableId);
      await setOpenedAt(v, partyId, OPENED);
      expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([takeOrder]);
      const from = await partyWith(v, "Table 1", release);

      await moveToParty(v, from, partyId, tableId);

      const arrived = (await arrivalsOf(v, partyId))[0]!;
      expect(await factsOf(v, partyId, tableId)).toMatchObject({
        firstOrderAt: arrived,
        lastOrderAt: arrived,
      });
      expect(await liveAt(v, partyId, tableId, arrived + MINUTE)).toEqual([]);
    });
  }

  for (const release of ["hold", "fire"] as const) {
    it(`${release}: a seated table a bill only passed through shows its first step again`, async () => {
      const v = await setupPartyVenue(suite.db);
      const [takeOrder, another] = await setSteps(v, await tablesDepartment(v), [
        TAKE_ORDER,
        ANOTHER,
      ]);
      const tableId = await v.table("Table 2");
      const { partyId } = await seat(v, tableId);
      await setOpenedAt(v, partyId, OPENED);
      const liveIds = async () => (await liveAt(v, partyId, tableId))!.map((step) => step.stepId);
      expect(await liveIds()).toEqual([takeOrder]);
      const from = await partyWith(v, "Table 1", release);

      await moveToParty(v, from, partyId, tableId);
      expect(await liveIds()).toEqual([another]);

      await carryToFreeTable(v, "move", { partyId, billId: from.billId }, "Table 3");

      expect(await factsOf(v, partyId, tableId)).toMatchObject({
        firstOrderAt: null,
        lastOrderAt: null,
        ordersArrived: false,
      });
      expect(await liveIds()).toEqual([takeOrder]);
    });

    it(`${release}: a free table a bill only passed through shows its first step`, async () => {
      const v = await setupPartyVenue(suite.db);
      const [takeOrder, another] = await setSteps(v, await tablesDepartment(v), [
        TAKE_ORDER,
        ANOTHER,
      ]);
      const from = await partyWith(v, "Table 1", release);
      const { partyId, tableId } = await carryToFreeTable(v, "move", from);
      await setOpenedAt(v, partyId, OPENED);
      const liveIds = async () => (await liveAt(v, partyId, tableId))!.map((step) => step.stepId);
      expect(await liveIds()).toEqual([another]);

      await carryToFreeTable(v, "move", { partyId, billId: from.billId }, "Table 3");

      expect(await factsOf(v, partyId, tableId)).toMatchObject({
        firstOrderAt: null,
        lastOrderAt: null,
        ordersArrived: false,
      });
      expect(await liveIds()).toEqual([takeOrder]);
    });
  }

  for (const release of ["hold", "fire"] as const) {
    it(`${release}: the only arrived dish cancelled off the bill stops counting`, async () => {
      const v = await setupPartyVenue(suite.db);
      const { takeOrder, partyId, tableId, billId } = await arrivedDish(v, release);
      const lineNo = await lineNoOf(v, billId, "Water");

      await inTx(v, (tx) => cancelLine(tx, v.cfg, billId, lineNo));

      expect(await factsOf(v, partyId, tableId)).toMatchObject({
        firstOrderAt: null,
        lastOrderAt: null,
        ordersArrived: false,
      });
      expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([takeOrder]);
    });
  }

  /** The kitchen's cancel of a whole fired dish whose preparation has started. */
  async function cancelStarted(
    v: PartyVenue,
    dish: { partyId: string; billId: string; lineId: string },
    outcome: "remove_charge" | "keep_charge",
  ): Promise<void> {
    const { partyId, billId, lineId } = dish;
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, async (tx) => {
      await ensureOperator(tx, OPERATOR);
      const [bill] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId));
      await cancelItem(
        tx,
        v.cfg,
        partyId,
        lineId,
        {
          quantity: "1",
          expectedEdit: await readBillEditState(tx, billId),
          outcome,
          preparationStarted: true,
          reasonId: await cancelReasonId(tx),
          expectedPartyRevision,
          expectedBillRevision: bill!.revision,
          expectedContext: await readCancellationContext(tx, partyId, lineId),
          submissionId: randomUUID(),
          admission: testTradingAdmission(),
        },
        OPERATOR,
      );
    });
  }

  it("the only arrived dish cancelled while being made, charge removed, stops counting", async () => {
    const v = await setupPartyVenue(suite.db);
    const dish = await arrivedDish(v, "fire");

    await cancelStarted(v, dish, "remove_charge");

    expect(await factsOf(v, dish.partyId, dish.tableId)).toMatchObject({
      firstOrderAt: null,
      lastOrderAt: null,
      ordersArrived: false,
    });
    expect((await liveAt(v, dish.partyId, dish.tableId))!.map((step) => step.stepId)).toEqual([
      dish.takeOrder,
    ]);
  });

  it("the only arrived dish cancelled while being made, charge kept, stays on the bill and counts", async () => {
    const v = await setupPartyVenue(suite.db);
    const dish = await arrivedDish(v, "fire");

    await cancelStarted(v, dish, "keep_charge");

    expect(await factsOf(v, dish.partyId, dish.tableId)).toMatchObject({
      firstOrderAt: dish.arrived,
      lastOrderAt: dish.arrived,
      ordersArrived: true,
    });
    expect((await liveAt(v, dish.partyId, dish.tableId))!.map((step) => step.stepId)).toEqual([
      dish.another,
    ]);
  });

  it("a bill moved in from the counter counts as the first order of a free table", async () => {
    const v = await setupPartyVenue(suite.db);
    const [, another] = await setSteps(v, await tablesDepartment(v), [TAKE_ORDER, ANOTHER]);
    const from = await partyWith(v, "Table 1", "fire");
    const toCounter = {
      operatorId: OPERATOR,
      partyId: from.partyId,
      expectedPartyRevision: await revisionOf(v, from.partyId),
      otherPartyId: null,
    };
    await inTx(v, (tx) =>
      moveBill(tx, v.cfg, from.billId, { counter: { zoneId: null } }, toCounter),
    );
    const tableId = await v.table("Table 2");
    const toTable = { operatorId: OPERATOR, partyId: null, otherPartyId: null };

    const moved = await inTx(v, (tx) => moveBill(tx, v.cfg, from.billId, { tableId }, toTable));

    const partyId = moved.partyId!;
    await setOpenedAt(v, partyId, OPENED);
    const arrived = (await arrivalsOf(v, partyId))[0]!;
    expect(await factsOf(v, partyId, tableId)).toMatchObject({
      firstOrderAt: arrived,
      lastOrderAt: arrived,
      ordersArrived: true,
    });
    expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([another]);
  });

  it("an arrival with no dish on a bill of the party is not an order", async () => {
    const v = await setupPartyVenue(suite.db);
    const [takeOrder] = await setSteps(v, await tablesDepartment(v), [TAKE_ORDER]);
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    await setOpenedAt(v, partyId, OPENED);

    await inTx(v, (tx) =>
      tx.insert(orderEvents).values({
        partyId,
        kind: "group.lines_moved",
        actorId: OPERATOR,
        detail: { lineIds: ["line"], from: "group", arrived: true },
      }),
    );

    expect(await factsOf(v, partyId, tableId)).toMatchObject({
      firstOrderAt: null,
      lastOrderAt: null,
      ordersArrived: false,
    });
    expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([takeOrder]);
  });

  it("a moved-lines event that does not say the dishes arrived is not an order", async () => {
    const v = await setupPartyVenue(suite.db);
    const [takeOrder] = await setSteps(v, await tablesDepartment(v), [TAKE_ORDER]);
    const tableId = await v.table("Table 1");
    const { partyId } = await seat(v, tableId);
    await setOpenedAt(v, partyId, OPENED);
    // A dish on the party's bill, with no event of this party saying how it got there.
    const other = await partyWith(v, "Table 9", "fire");
    await inTx(v, (tx) => numberBill(tx, other.billId, partyId));
    const movedLines = (detail: Record<string, unknown>) =>
      inTx(v, (tx) =>
        tx
          .insert(orderEvents)
          .values({ partyId, kind: "group.lines_moved", actorId: OPERATOR, detail }),
      );

    await movedLines({ lineIds: ["line"], to: "group" });
    await movedLines({ moves: [], from: ["group"] });

    expect(await factsOf(v, partyId, tableId)).toMatchObject({
      firstOrderAt: null,
      lastOrderAt: null,
    });
    expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([takeOrder]);

    // The control: the same event saying so.
    await movedLines({ lineIds: ["line"], from: "group", arrived: true });

    expect(await factsOf(v, partyId, tableId)).toMatchObject({
      firstOrderAt: expect.any(Number),
      lastOrderAt: expect.any(Number),
    });
    expect(await liveAt(v, partyId, tableId)).toEqual([]);
  });

  for (const own of [false, true]) {
    it(`a party merged with one whose dishes arrived, ${own ? "with" : "with no"} orders of its own`, async () => {
      const v = await setupPartyVenue(suite.db);
      await setSteps(v, await tablesDepartment(v), [TAKE_ORDER]);
      const tableId = await v.table("Table 2");
      const { partyId } = await seat(v, tableId);
      if (own) await orderForParty(v, partyId, ["Water"]);
      const from = await partyWith(v, "Table 1", "hold");
      const arrivedAt = await carryToFreeTable(v, "move", from);
      const into = await commandFor(v, partyId);
      const other = await commandFor(v, arrivedAt.partyId);

      await inTx(v, (tx) =>
        joinTables(tx, v.cfg, partyId, arrivedAt.tableId, {
          ...into,
          otherPartyId: arrivedAt.partyId,
          expectedOtherPartyRevision: other.expectedPartyRevision,
        }),
      );

      const expected = own
        ? await lastOrderAt(v, partyId)
        : (await arrivalsOf(v, arrivedAt.partyId))[0]!;
      expect(await factsOf(v, partyId, tableId)).toMatchObject({
        firstOrderAt: expected,
        lastOrderAt: expected,
        ordersArrived: !own,
      });
    });
  }

  const ARRIVED = { lineIds: ["line"], from: "group", arrived: true };

  async function addEvents(
    v: PartyVenue,
    partyId: string,
    kind: "group.submitted" | "group.joined" | "group.fired" | "group.lines_moved",
    detail: Record<string, unknown>,
    times: readonly string[],
  ): Promise<void> {
    await inTx(v, (tx) =>
      tx
        .insert(orderEvents)
        .values(times.map((at) => ({ partyId, kind, actorId: OPERATOR, detail, at }))),
    );
  }

  /** The read's facts at the table and how many rows its query of the events handed back. */
  async function factsAndEventRows(v: PartyVenue, partyId: string, tableId: string) {
    const given = await stepParty(v, partyId);
    return inTx(v, async (tx) => {
      const all = vi.spyOn(StatementSync.prototype, "all");
      try {
        const facts = (await readStepFacts(tx, [given])).get(tableId)!.facts;
        const eventRows = (all.mock.contexts as StatementSync[]).flatMap((statement, call) =>
          statement.sourceSQL.includes('from "order_events"')
            ? [all.mock.results[call]!.value as unknown[]]
            : [],
        );
        expect(eventRows).toHaveLength(1);
        return { facts, rows: eventRows[0]!.length };
      } finally {
        all.mockRestore();
      }
    });
  }

  it("the read of the events hands back one row per class, however many events the party has", async () => {
    const v = await setupPartyVenue(suite.db);
    const { partyId, tableId, arrived } = await arrivedDish(v, "hold");

    const before = await factsAndEventRows(v, partyId, tableId);
    expect(before.rows).toBe(1);
    expect(before.facts).toMatchObject({ firstOrderAt: arrived, lastOrderAt: arrived });

    const filler = (year: number) =>
      Array.from({ length: 20 }, (_, ms) =>
        new Date(Date.UTC(year, 0, 1, 0, 0, 0, ms)).toISOString(),
      );
    // Neither extreme is the first or last written, and each is a millisecond from its neighbour.
    await addEvents(v, partyId, "group.lines_moved", ARRIVED, [
      ...filler(2050),
      "2090-06-01T12:00:00.998Z",
      "2020-06-01T12:00:00.002Z",
      "2090-06-01T12:00:00.999Z",
      "2020-06-01T12:00:00.001Z",
      ...filler(2051),
    ]);
    const manyArrivals = await factsAndEventRows(v, partyId, tableId);
    expect(manyArrivals.rows).toBe(1);
    expect(manyArrivals.facts).toMatchObject({
      firstOrderAt: Date.parse("2020-06-01T12:00:00.001Z"),
      lastOrderAt: Date.parse("2090-06-01T12:00:00.999Z"),
      ordersArrived: true,
    });

    await addEvents(v, partyId, "group.submitted", { release: "fire" }, [
      ...filler(2060),
      "2070-06-01T12:00:00.998Z",
      "2030-06-01T12:00:00.002Z",
    ]);
    await addEvents(v, partyId, "group.joined", { release: "fire" }, [
      "2070-06-01T12:00:00.999Z",
      "2030-06-01T12:00:00.001Z",
      ...filler(2061),
    ]);
    const ownToo = await factsAndEventRows(v, partyId, tableId);
    expect(ownToo.rows).toBe(2);
    expect(ownToo.facts).toMatchObject({
      firstOrderAt: Date.parse("2030-06-01T12:00:00.001Z"),
      lastOrderAt: Date.parse("2070-06-01T12:00:00.999Z"),
      ordersArrived: false,
    });
  });

  it("a joined family's first and last of each class come from whichever member has them", async () => {
    const v = await setupPartyVenue(suite.db);
    await setSteps(v, await tablesDepartment(v), [TAKE_ORDER]);
    const joinInto = async (partyId: string, other: { partyId: string; tableId: string }) => {
      const into = await commandFor(v, partyId);
      const from = await commandFor(v, other.partyId);
      await inTx(v, (tx) =>
        joinTables(tx, v.cfg, partyId, other.tableId, {
          ...into,
          otherPartyId: other.partyId,
          expectedOtherPartyRevision: from.expectedPartyRevision,
        }),
      );
    };

    // Arrivals alone: the earliest on the party joined in, the latest on the one it joined.
    const arrivalsTable = await v.table("Table 2");
    const arrivals = await seat(v, arrivalsTable);
    const joinedIn = await carryToFreeTable(
      v,
      "move",
      await partyWith(v, "Table 1", "hold"),
      "Table 3",
    );
    await joinInto(arrivals.partyId, joinedIn);
    await addEvents(v, arrivals.partyId, "group.lines_moved", ARRIVED, [
      "2030-06-01T12:00:00.000Z",
      "2090-06-01T12:00:00.999Z",
    ]);
    await addEvents(v, joinedIn.partyId, "group.lines_moved", ARRIVED, [
      "2050-06-01T12:00:00.000Z",
      "2020-06-01T12:00:00.001Z",
    ]);
    expect(await factsOf(v, arrivals.partyId, arrivalsTable)).toMatchObject({
      firstOrderAt: Date.parse("2020-06-01T12:00:00.001Z"),
      lastOrderAt: Date.parse("2090-06-01T12:00:00.999Z"),
      ordersArrived: true,
    });

    // Own orders win, and arrivals and other kinds outside their span do not widen it.
    const ownTable = await v.table("Table 4");
    const own = await seat(v, ownTable);
    const ownJoinedTable = await v.table("Table 5");
    const ownJoined = await seat(v, ownJoinedTable);
    await joinInto(own.partyId, { partyId: ownJoined.partyId, tableId: ownJoinedTable });
    await addEvents(v, own.partyId, "group.submitted", { release: "fire" }, [
      "2070-06-01T12:00:00.998Z",
    ]);
    await addEvents(v, own.partyId, "group.joined", { release: "fire" }, [
      "2030-06-01T12:00:00.000Z",
      "2080-06-01T12:00:00.999Z",
    ]);
    await addEvents(v, ownJoined.partyId, "group.submitted", { release: "fire" }, [
      "2040-06-01T12:00:00.000Z",
    ]);
    await addEvents(v, ownJoined.partyId, "group.joined", { release: "fire" }, [
      "2025-06-01T12:00:00.001Z",
      "2060-06-01T12:00:00.000Z",
    ]);
    await addEvents(v, own.partyId, "group.lines_moved", ARRIVED, ["2010-06-01T12:00:00.000Z"]);
    await addEvents(v, ownJoined.partyId, "group.lines_moved", ARRIVED, [
      "2095-06-01T12:00:00.000Z",
    ]);
    await addEvents(v, own.partyId, "group.fired", { lineId: "line" }, [
      "2005-06-01T12:00:00.000Z",
    ]);
    await addEvents(v, ownJoined.partyId, "group.lines_moved", { lineIds: ["line"], to: "group" }, [
      "2098-06-01T12:00:00.000Z",
    ]);

    // Asked about both at once, a member's times reach its own answer and its family's.
    const otherTable = await v.table("Table 6");
    const given = [
      await stepParty(v, own.partyId),
      { ...(await stepParty(v, ownJoined.partyId)), tableIds: [otherTable] },
    ];
    const facts = await inTx(v, (tx) => readStepFacts(tx, given));
    expect(facts.get(ownTable)!.facts).toMatchObject({
      firstOrderAt: Date.parse("2025-06-01T12:00:00.001Z"),
      lastOrderAt: Date.parse("2080-06-01T12:00:00.999Z"),
      ordersArrived: false,
    });
    expect(facts.get(otherTable)!.facts).toMatchObject({
      firstOrderAt: Date.parse("2025-06-01T12:00:00.001Z"),
      lastOrderAt: Date.parse("2060-06-01T12:00:00.000Z"),
      ordersArrived: false,
    });
  });

  it("an open draft no longer hides the steps of a table whose dishes arrived", async () => {
    const v = await setupPartyVenue(suite.db);
    const [, another] = await setSteps(v, await tablesDepartment(v), [TAKE_ORDER, ANOTHER]);
    const from = await partyWith(v, "Table 1", "hold");
    const { partyId, tableId } = await carryToFreeTable(v, "move", from);
    await openDraft(v, partyId, from.billId);

    const arrived = (await arrivalsOf(v, partyId))[0]!;
    expect(
      (await liveAt(v, partyId, tableId, arrived + 11 * MINUTE))!.map((step) => step.stepId),
    ).toEqual([another]);
  });

  it("the table's own first order clears a step that started when an arrived dish was served", async () => {
    const v = await setupPartyVenue(suite.db);
    const mains = await inTx(v, (tx) => createCourse(tx, { name: "Mains" }));
    const [dessert] = await setSteps(v, await tablesDepartment(v), [
      { name: "Dessert?", start: "course_served", courseId: mains.id, minutes: 10 },
    ]);
    const from = await partyWith(v, "Table 1", "fire");
    await setCourse(v, mains.id, [await lineIdOf(v, from.billId, "Water")]);
    const servedAt = await serve(v, from.billId, "Water");
    const earlier = new Date(servedAt - 60 * MINUTE).toISOString();
    await inTx(v, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ servedAt: earlier })
        .where(eq(workingOrderLines.workingOrderId, from.billId)),
    );
    const { partyId, tableId } = await carryToFreeTable(v, "move", from);
    expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([dessert]);

    await orderForParty(v, partyId, ["Water"]);

    expect(await factsOf(v, partyId, tableId)).toMatchObject({
      ordersArrived: false,
      courseServedAt: new Map([[mains.id, servedAt - 60 * MINUTE]]),
    });
    expect(await liveAt(v, partyId, tableId)).toEqual([]);
  });

  for (const how of ["move", "split"] as const) {
    it(`${how}: dishes served before they arrived keep their served steps, which the arrival does not clear`, async () => {
      const v = await setupPartyVenue(suite.db);
      const [anything] = await setSteps(v, await tablesDepartment(v), [
        { name: "Anything else?", start: "all_served", courseId: null, minutes: 10 },
      ]);
      const from = await partyWith(v, "Table 1", "fire");
      const servedAt = await serve(v, from.billId, "Water");
      // Served a while ago: the arrival is later than the step's due time as well as its trigger.
      const earlier = new Date(servedAt - 60 * MINUTE).toISOString();
      await inTx(v, (tx) =>
        tx
          .update(workingOrderLines)
          .set({ servedAt: earlier })
          .where(eq(workingOrderLines.workingOrderId, from.billId)),
      );

      const { partyId, tableId } = await carryToFreeTable(v, how, from);

      const shown = servedAt - 60 * MINUTE;
      expect(await liveAt(v, partyId, tableId)).toEqual([
        {
          stepId: anything,
          name: "Anything else?",
          triggeredAt: shown,
          dueAt: shown + 10 * MINUTE,
        },
      ]);
    });
  }

  describe("a Done on a step a serving started, when its bill moves, splits or combines", () => {
    async function servedAndDone(v: PartyVenue, markDone: boolean) {
      const mains = await inTx(v, (tx) => createCourse(tx, { name: "Mains" }));
      const [dessert, anything, takeOrder, another] = await setSteps(v, await tablesDepartment(v), [
        { name: "Dessert?", start: "course_served", courseId: mains.id, minutes: 10 },
        { name: "Anything else?", start: "all_served", courseId: null, minutes: 10 },
        TAKE_ORDER,
        ANOTHER,
      ]);
      const from = await partyWith(v, "Table 1", "fire");
      await setCourse(v, mains.id, [await lineIdOf(v, from.billId, "Water")]);
      const servedAt = await serve(v, from.billId, "Water");
      const doneAt = new Date(servedAt + 1).toISOString();
      if (markDone)
        await inTx(v, (tx) =>
          recordStepCompletions(tx, [
            { partyId: from.partyId, stepId: dessert!, doneAt, doneBy: OPERATOR },
            { partyId: from.partyId, stepId: anything!, doneAt, doneBy: OPERATOR },
            { partyId: from.partyId, stepId: takeOrder!, doneAt, doneBy: OPERATOR },
            { partyId: from.partyId, stepId: another!, doneAt, doneBy: OPERATOR },
          ]),
        );
      await untilPast(Date.parse(doneAt));
      return { from, dessert: dessert!, anything: anything!, doneAt };
    }

    /**
     * A carried Done is recorded before the arrival, so a move made in the millisecond these
     * fixtures write their Done at would move it back; a move after a tapped Done comes later.
     */
    async function untilPast(at: number): Promise<void> {
      while (Date.now() <= at) await new Promise((resolve) => setTimeout(resolve, 1));
    }

    /** The live steps a serving started; the repeat counted from the arrival always shows. */
    async function servingStepsAt(v: PartyVenue, partyId: string, tableId: string) {
      return (await liveAt(v, partyId, tableId))!
        .filter((step) => step.name === "Dessert?" || step.name === "Anything else?")
        .map((step) => step.stepId)
        .sort();
    }

    async function doneRows(v: PartyVenue, partyId: string) {
      return inTx(v, (tx) =>
        tx
          .select({
            stepId: serviceStepCompletions.stepId,
            doneAt: serviceStepCompletions.doneAt,
            doneBy: serviceStepCompletions.doneBy,
          })
          .from(serviceStepCompletions)
          .where(eq(serviceStepCompletions.partyId, partyId)),
      );
    }

    for (const how of ["move", "split"] as const) {
      it(`${how}: taken to a free table, the steps done at the old table are not asked again`, async () => {
        const v = await setupPartyVenue(suite.db);
        const { from, dessert, anything, doneAt } = await servedAndDone(v, true);

        const { partyId, tableId } = await carryToFreeTable(v, how, from);

        expect(await servingStepsAt(v, partyId, tableId)).toEqual([]);
        expect(await doneRows(v, partyId)).toEqual(
          expect.arrayContaining([
            { stepId: dessert, doneAt, doneBy: OPERATOR },
            { stepId: anything, doneAt, doneBy: OPERATOR },
          ]),
        );
        expect(await doneRows(v, partyId)).toHaveLength(2);
      });
    }

    it("moved back and forth between two seated parties, no Done travels and every move succeeds", async () => {
      const v = await setupPartyVenue(suite.db);
      const { from } = await servedAndDone(v, true);
      const firstTable = (await stepParty(v, from.partyId)).tableIds[0]!;
      const otherTable = await v.table("Table 2");
      const other = await seat(v, otherTable);
      const stops = [
        { partyId: other.partyId, tableId: otherTable },
        { partyId: from.partyId, tableId: firstTable },
      ];

      let holder = from.partyId;
      for (let move = 0; move < 20; move++) {
        const to = stops[move % 2]!;
        await moveToParty(v, { partyId: holder, billId: from.billId }, to.partyId, to.tableId);
        holder = to.partyId;
      }

      expect(await doneRows(v, other.partyId)).toEqual([]);
      expect(await doneRows(v, from.partyId)).toHaveLength(4);
      expect(await servingStepsAt(v, from.partyId, firstTable)).toEqual([]);
    });

    it("taken on to a new free table again and again, each new party holds one Done per step", async () => {
      const v = await setupPartyVenue(suite.db);
      const { from, dessert, anything, doneAt } = await servedAndDone(v, true);

      let holder = { partyId: from.partyId, tableId: "" };
      for (let move = 0; move < 20; move++) {
        holder = await carryToFreeTable(
          v,
          "move",
          { partyId: holder.partyId, billId: from.billId },
          `Table hop ${move}`,
        );
      }

      expect(await doneRows(v, holder.partyId)).toEqual(
        expect.arrayContaining([
          { stepId: dessert, doneAt, doneBy: OPERATOR },
          { stepId: anything, doneAt, doneBy: OPERATOR },
        ]),
      );
      expect(await doneRows(v, holder.partyId)).toHaveLength(2);
      expect(await servingStepsAt(v, holder.partyId, holder.tableId)).toEqual([]);
    });

    it("only the old table's latest Done of a step travels to a free table", async () => {
      const v = await setupPartyVenue(suite.db);
      const { from, dessert, anything, doneAt } = await servedAndDone(v, true);
      const earlier = new Date(Date.parse(doneAt) - MINUTE).toISOString();
      await inTx(v, (tx) =>
        recordStepCompletions(tx, [
          { partyId: from.partyId, stepId: anything, doneAt: earlier, doneBy: OPERATOR },
        ]),
      );

      const { partyId } = await carryToFreeTable(v, "move", from);

      expect(await doneRows(v, partyId)).toEqual(
        expect.arrayContaining([
          { stepId: dessert, doneAt, doneBy: OPERATOR },
          { stepId: anything, doneAt, doneBy: OPERATOR },
        ]),
      );
      expect(await doneRows(v, partyId)).toHaveLength(2);
    });

    it("combined into another party, the steps the absorbed party had done are asked again", async () => {
      const v = await setupPartyVenue(suite.db);
      const { from, dessert, anything } = await servedAndDone(v, true);
      const fromTable = (await stepParty(v, from.partyId)).tableIds[0]!;
      const intoTable = await v.table("Table 2");
      const into = await seat(v, intoTable);
      expect(await servingStepsAt(v, into.partyId, intoTable)).toEqual([]);

      const intoCommand = await commandFor(v, into.partyId);
      const fromCommand = await commandFor(v, from.partyId);
      await inTx(v, (tx) =>
        joinTables(tx, v.cfg, into.partyId, fromTable, {
          ...intoCommand,
          otherPartyId: from.partyId,
          expectedOtherPartyRevision: fromCommand.expectedPartyRevision,
        }),
      );

      const asked = [dessert, anything].sort();
      expect(await servingStepsAt(v, into.partyId, intoTable)).toEqual(asked);
      expect(await servingStepsAt(v, into.partyId, fromTable)).toEqual(asked);
      expect(await doneRows(v, into.partyId)).toEqual([]);
    });

    it("a follow-on of a repeating step, done at the old table, does not travel to a free table", async () => {
      const v = await setupPartyVenue(suite.db);
      const [drinks, follow] = await setSteps(v, await tablesDepartment(v), [
        { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 20, key: "drinks" },
        {
          name: "Follow up",
          start: "after_step",
          afterStepKey: "drinks",
          courseId: null,
          minutes: 5,
        },
      ]);
      const from = await partyWith(v, "Table 1", "fire");
      const ordered = await lastOrderAt(v, from.partyId);
      const at = (minutes: number) => new Date(ordered + minutes * MINUTE).toISOString();
      await inTx(v, (tx) =>
        recordStepCompletions(tx, [
          { partyId: from.partyId, stepId: drinks!, doneAt: at(21), doneBy: OPERATOR },
          { partyId: from.partyId, stepId: follow!, doneAt: at(26), doneBy: OPERATOR },
        ]),
      );

      const { partyId } = await carryToFreeTable(v, "move", from);

      expect(await doneRows(v, partyId)).toEqual([]);
    });

    /**
     * Table 5's mains are served and nobody has asked it "Dessert?"; table 8's mains are served
     * later and it has tapped Done on "Dessert?" after that.
     */
    async function dessertOwedAndDone(v: PartyVenue) {
      const mains = await inTx(v, (tx) => createCourse(tx, { name: "Mains" }));
      const [dessert] = await setSteps(v, await tablesDepartment(v), [
        { name: "Dessert?", start: "course_served", courseId: mains.id, minutes: 10 },
      ]);
      const owing = await partyWith(v, "Table 5", "fire");
      const owingTable = (await stepParty(v, owing.partyId)).tableIds[0]!;
      await setCourse(v, mains.id, [await lineIdOf(v, owing.billId, "Water")]);
      await serve(v, owing.billId, "Water");
      const arriving = await partyWith(v, "Table 8", "fire");
      const arrivingTable = (await stepParty(v, arriving.partyId)).tableIds[0]!;
      await setCourse(v, mains.id, [await lineIdOf(v, arriving.billId, "Water")]);
      const servedAt = await serve(v, arriving.billId, "Water");
      await inTx(v, (tx) =>
        recordStepCompletions(tx, [
          {
            partyId: arriving.partyId,
            stepId: dessert!,
            doneAt: new Date(servedAt + 1).toISOString(),
            doneBy: OPERATOR,
          },
        ]),
      );
      expect(await servingStepsAt(v, owing.partyId, owingTable)).toEqual([dessert]);
      return { dessert: dessert!, owing, owingTable, arriving, arrivingTable };
    }

    it("moved onto a seated table, the arriving Done does not hide that table's own step", async () => {
      const v = await setupPartyVenue(suite.db);
      const { dessert, owing, owingTable, arriving } = await dessertOwedAndDone(v);

      await moveToParty(v, arriving, owing.partyId, owingTable);

      expect(await servingStepsAt(v, owing.partyId, owingTable)).toEqual([dessert]);
      expect(await doneRows(v, owing.partyId)).toEqual([]);
    });

    it("combined with another party, the absorbed party's Done does not hide the other's own step", async () => {
      const v = await setupPartyVenue(suite.db);
      const { dessert, owing, owingTable, arriving, arrivingTable } = await dessertOwedAndDone(v);

      const intoCommand = await commandFor(v, owing.partyId);
      const fromCommand = await commandFor(v, arriving.partyId);
      await inTx(v, (tx) =>
        joinTables(tx, v.cfg, owing.partyId, arrivingTable, {
          ...intoCommand,
          otherPartyId: arriving.partyId,
          expectedOtherPartyRevision: fromCommand.expectedPartyRevision,
        }),
      );

      expect(await servingStepsAt(v, owing.partyId, owingTable)).toEqual([dessert]);
      expect(await doneRows(v, owing.partyId)).toEqual([]);
    });

    it("moved to a table another party holds, the steps done at the old table are asked again", async () => {
      const v = await setupPartyVenue(suite.db);
      const { from, dessert, anything } = await servedAndDone(v, true);
      const tableId = await v.table("Table 2");
      const { partyId } = await seat(v, tableId);

      await moveToParty(v, from, partyId, tableId);

      expect(await servingStepsAt(v, partyId, tableId)).toEqual([dessert, anything].sort());
      expect(await doneRows(v, partyId)).toEqual([]);
    });

    for (const how of ["move", "split"] as const) {
      it(`${how}: at a free table the arrival clears a step that follows one done at the old table, so its Done need not travel`, async () => {
        const v = await setupPartyVenue(suite.db);
        const [anything] = await setSteps(v, await tablesDepartment(v), [
          { name: "Anything else?", start: "all_served", courseId: null, minutes: 10, key: "any" },
          { name: "Coffee?", start: "after_step", afterStepKey: "any", courseId: null, minutes: 5 },
        ]);
        const from = await partyWith(v, "Table 1", "fire");
        const servedAt = await serve(v, from.billId, "Water");
        await inTx(v, (tx) =>
          recordStepCompletions(tx, [
            {
              partyId: from.partyId,
              stepId: anything!,
              doneAt: new Date(servedAt + 1).toISOString(),
              doneBy: OPERATOR,
            },
          ]),
        );
        await untilPast(servedAt + 1);

        const { partyId, tableId } = await carryToFreeTable(v, how, from);

        expect(await liveAt(v, partyId, tableId)).toEqual([]);
      });
    }

    /** "Anything else?" starts when all is served and "Coffee?" when it is done. */
    async function anythingThenCoffee(v: PartyVenue) {
      const [anything, , drinks] = await setSteps(v, await tablesDepartment(v), [
        { name: "Anything else?", start: "all_served", courseId: null, minutes: 0, key: "any" },
        { name: "Coffee?", start: "after_step", afterStepKey: "any", courseId: null, minutes: 0 },
        { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 1 },
      ]);
      const from = await partyWith(v, "Table 1", "fire");
      const servedAt = await serve(v, from.billId, "Water");
      return { anything: anything!, drinks: drinks!, from, servedAt };
    }

    async function recordDone(v: PartyVenue, partyId: string, stepId: string, at: number) {
      await inTx(v, (tx) =>
        recordStepCompletions(tx, [
          { partyId, stepId, doneAt: new Date(at).toISOString(), doneBy: OPERATOR },
        ]),
      );
    }

    async function namesLiveAt(v: PartyVenue, partyId: string, tableId: string) {
      return ((await liveAt(v, partyId, tableId)) ?? []).map((step) => step.name);
    }

    it("split off with nothing selected, the new party gets no Done and is not asked a follow-on", async () => {
      const v = await setupPartyVenue(suite.db);
      const { anything, from, servedAt } = await anythingThenCoffee(v);
      await recordDone(v, from.partyId, anything, servedAt + 1);
      const tableId = await v.table("Empty split");
      const joining = await commandFor(v, from.partyId);
      await inTx(v, (tx) => joinTables(tx, v.cfg, from.partyId, tableId, joining));
      const splitting = await commandFor(v, from.partyId);

      const split = await inTx(v, (tx) =>
        splitTable(tx, v.cfg, from.partyId, tableId, null, splitting),
      );

      expect(await namesLiveAt(v, split.partyId, tableId)).toEqual([]);
      expect(await doneRows(v, split.partyId)).toEqual([]);
    });

    it("an empty bill moved to a free table takes no Done and is not asked a follow-on", async () => {
      const v = await setupPartyVenue(suite.db);
      const { anything, from, servedAt } = await anythingThenCoffee(v);
      await recordDone(v, from.partyId, anything, servedAt + 1);
      const empty = await inTx(v, (tx) => insertPartyBill(tx, v.cfg, from.partyId));

      const { partyId, tableId } = await carryToFreeTable(v, "move", {
        partyId: from.partyId,
        billId: empty,
      });

      expect(await namesLiveAt(v, partyId, tableId)).toEqual([]);
      expect(await doneRows(v, partyId)).toEqual([]);
    });

    for (const how of ["move", "split"] as const) {
      it(`${how}: a Done in the same millisecond as the arrival still lets the arrival clear its follow-on`, async () => {
        const v = await setupPartyVenue(suite.db);
        const { anything, from, servedAt } = await anythingThenCoffee(v);
        const instant = servedAt + 10 * MINUTE;
        await recordDone(v, from.partyId, anything, instant);

        vi.useFakeTimers({ toFake: ["Date"], now: instant });
        try {
          const { partyId, tableId } = await carryToFreeTable(v, how, from);

          expect((await factsOf(v, partyId, tableId)).firstOrderAt).toBe(instant);
          expect(await namesLiveAt(v, partyId, tableId)).toEqual(["Drinks?"]);
        } finally {
          vi.useRealTimers();
        }
      });

      it(`${how}: a Done recorded ahead of the clock still lets the arrival clear its follow-on`, async () => {
        const v = await setupPartyVenue(suite.db);
        const { anything, drinks, from } = await anythingThenCoffee(v);
        const ordered = await lastOrderAt(v, from.partyId);
        await recordDone(v, from.partyId, drinks, ordered + MINUTE);
        const [profile] = await seedDeviceProfiles(v.db, {
          name: `Till ${randomUUID()}`,
          formFactor: "till",
          capabilities: [...CAPABILITY_FLAGS],
        });
        const due = ordered + 2 * MINUTE;
        const marked = await inTx(v, (tx) =>
          markServiceStepDone(tx, {
            deviceProfileId: profile!.id,
            partyId: from.partyId,
            stepId: drinks,
            dueAt: due,
            personId: OPERATOR,
            nowMs: due - 5_000,
          }),
        );
        expect(marked.cleared).toContain(anything);

        vi.useFakeTimers({ toFake: ["Date"], now: due - 4_000 });
        try {
          const { partyId, tableId } = await carryToFreeTable(v, how, from);

          expect((await factsOf(v, partyId, tableId)).firstOrderAt).toBe(due - 4_000);
          expect(await namesLiveAt(v, partyId, tableId)).toEqual(["Drinks?"]);
        } finally {
          vi.useRealTimers();
        }
      });
    }

    it("with no Done at the old table, the steps still show at the new one", async () => {
      const v = await setupPartyVenue(suite.db);
      const { from, dessert, anything } = await servedAndDone(v, false);

      const { partyId, tableId } = await carryToFreeTable(v, "move", from);

      expect(await servingStepsAt(v, partyId, tableId)).toEqual([dessert, anything].sort());
      expect(await doneRows(v, partyId)).toEqual([]);
    });
  });
});
