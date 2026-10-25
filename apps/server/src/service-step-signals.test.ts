import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  diningTables,
  floorZones,
  orderDraftRecalledLines,
  orderDrafts,
  orderGroupEvents,
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
  serviceSteps,
} from "@waitron/venue-service";
import { createCourse } from "./kitchen.js";
import { fireGroup } from "./order-groups.js";
import { readTableSteps, stepSignal, type StepParty } from "./service-step-signals.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { joinTables } from "./testing/table-action-fixture.js";
import {
  commandFor,
  inTx,
  join,
  OPERATOR,
  orderForParty,
  pay,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import { serveLine } from "./testing/serve-line.js";
import { departmentOf, setOpenedAt, setSteps } from "./testing/service-steps.js";
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
      .select({ at: orderGroupEvents.createdAt })
      .from(orderGroupEvents)
      .where(
        and(
          eq(orderGroupEvents.partyId, partyId),
          inArray(orderGroupEvents.kind, ["submitted", "joined"]),
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
      lines: [draftLine(v, "Agua")],
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
    const tableId = await v.table("Mesa 1");
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
    const mains = await inTx(v, (tx) =>
      createCourse(tx, v.cfg, { name: "Mains", heldUntilFired: false }),
    );
    const [dessert] = await setSteps(v, await tablesDepartment(v), [
      { name: "Dessert?", start: "course_served", courseId: mains.id, minutes: 10 },
    ]);
    const tableId = await v.table("Mesa 1");
    const { partyId } = await seat(v, tableId);
    const { tabId } = await orderForParty(v, partyId, ["Burger", "Paella", "Agua"]);
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

  it("a recalled dish and an abandoned bill's dishes are left out", async () => {
    const v = await setupPartyVenue(suite.db);
    const mains = await inTx(v, (tx) =>
      createCourse(tx, v.cfg, { name: "Mains", heldUntilFired: false }),
    );
    const [dessert] = await setSteps(v, await tablesDepartment(v), [
      { name: "Dessert?", start: "course_served", courseId: mains.id, minutes: 10 },
    ]);
    const tableId = await v.table("Mesa 1");
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
    const paella = await lineIdOf(v, tabId, "Paella");
    await inTx(v, async (tx) => {
      const [draft] = await tx
        .select({ id: orderDrafts.id })
        .from(orderDrafts)
        .where(eq(orderDrafts.partyId, partyId));
      await tx
        .insert(orderDraftRecalledLines)
        .values({ draftId: draft!.id, sourceLineId: paella, position: 1 });
    });

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
    const tableId = await v.table("Mesa 1");
    const { partyId } = await seat(v, tableId);
    const { tabId } = await orderForParty(v, partyId, ["Burger", "Agua"]);
    const held = await holdGroup(v, partyId, "Flan");
    expect(await liveAt(v, partyId, tableId)).toEqual([]);

    await serve(v, tabId, "Burger");
    await serve(v, tabId, "Agua");
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
    const tableId = await v.table("Mesa 1");
    const { partyId } = await seat(v, tableId);
    await setOpenedAt(v, partyId, OPENED);
    expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([setUp]);

    await orderForParty(v, partyId, ["Agua"]);

    expect(await liveAt(v, partyId, tableId)).toEqual([]);
  });

  it("every N minutes since the last order counts from that order", async () => {
    const v = await setupPartyVenue(suite.db);
    const [drinks] = await setSteps(v, await tablesDepartment(v), [
      { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 20 },
    ]);
    const tableId = await v.table("Mesa 1");
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

  it("after the step before is triggered by a recorded Done", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp, takeOrder] = await setSteps(v, await tablesDepartment(v), [
      seated("Set up"),
      { name: "Take order", start: "after_previous", courseId: null, minutes: 2 },
    ]);
    const tableId = await v.table("Mesa 1");
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
    const tableId = await v.table("Mesa 1");
    const { partyId, tabId } = await seat(v, tableId);
    expect((await liveAt(v, partyId, tableId))!.map((step) => step.stepId)).toEqual([setUp]);

    await openDraft(v, partyId, tabId);

    expect(await liveAt(v, partyId, tableId)).toEqual([]);
  });

  it("each table reads its own zone's department", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await tablesDepartment(v), [seated("Set up")]);
    const terrace = await inTx(v, async (tx) => {
      const department = await createDepartment(tx, v.cfg, { name: "Terrace service" });
      const zone = await createServiceZone(tx, v.cfg, {
        name: "Terrace",
        departmentId: department.id,
      });
      return { departmentId: department.id, zoneId: zone.id };
    });
    const [water] = await setSteps(v, terrace.departmentId, [seated("Water?", 5)]);
    const inside = await v.table("Mesa 1");
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

  it("a table whose zone has no department shows no step", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await tablesDepartment(v), [seated("Set up")]);
    const outside = await inTx(v, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: v.cfg.locationId, name: "Loose" })
        .returning({ id: floorZones.id });
      const [table] = await tx
        .insert(diningTables)
        .values({ locationId: v.cfg.locationId, label: "L1", zoneId: zone!.id })
        .returning({ id: diningTables.id });
      return table!.id;
    });
    const inside = await v.table("Mesa 1");
    const { partyId } = await seat(v, inside);
    await inTx(v, (tx) => tx.insert(partyTables).values({ partyId, tableId: outside }));

    const steps = await stepsOf(v, [partyId]);

    expect(steps.get(inside)!.live.map((step) => step.stepId)).toEqual([setUp]);
    expect(steps.has(outside)).toBe(false);
  });

  it("a new venue's starter steps reach the floor", async () => {
    const v = await setupPartyVenue(suite.db);
    const department = await tablesDepartment(v);
    await inTx(v, (tx) => addStarterServiceSteps(tx, v.cfg, department));
    const [first] = await inTx(v, (tx) =>
      tx
        .select({ id: serviceSteps.id, name: serviceSteps.name })
        .from(serviceSteps)
        .where(eq(serviceSteps.departmentId, department))
        .orderBy(asc(serviceSteps.position))
        .limit(1),
    );
    const tableId = await v.table("Mesa 1");
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

  it("a party at two tables of one department gets the same steps on both", async () => {
    const v = await setupPartyVenue(suite.db);
    const department = await tablesDepartment(v);
    const [setUp] = await setSteps(v, department, [seated("Set up")]);
    const firstTable = await v.table("Mesa 1");
    const secondTable = await v.table("Mesa 2");
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
    const firstTable = await v.table("Mesa 1");
    const secondTable = await v.table("Mesa 2");
    const a = await seat(v, firstTable);
    await setOpenedAt(v, a.partyId, OPENED);
    const b = await seat(v, secondTable);
    const { tabId } = await orderForParty(v, b.partyId, ["Agua"]);
    const servedAt = await serve(v, tabId, "Agua");
    // A paid bill stays with the party merged away.
    await pay(v, tabId, "2.00");
    const ordered = await lastOrderAt(v, b.partyId);
    expect((await liveAt(v, a.partyId, firstTable))!.map((step) => step.stepId)).toEqual([setUp]);

    const into = await commandFor(v, a.partyId);
    const from = await commandFor(v, b.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, a.partyId, secondTable, {
        ...into,
        bills: "merge",
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

  it("reads every fact once, whatever the number of parties", async () => {
    const v = await setupPartyVenue(suite.db);
    const mains = await inTx(v, (tx) =>
      createCourse(tx, v.cfg, { name: "Mains", heldUntilFired: false }),
    );
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
    const first = await busyParty("Mesa 1");
    const one = await statements([first]);
    const three = await statements([first, await busyParty("Mesa 2"), await busyParty("Mesa 3")]);
    const none = await statements([]);

    expect(three.steps.size).toBe(3);
    expect(three.count).toBe(one.count);
    expect(none).toEqual({ count: 0, steps: new Map() });
  });
});
