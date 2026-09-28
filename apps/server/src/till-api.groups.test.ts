import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  orderGroupEvents,
  products,
  serviceCommands,
  ticketItems,
  visits,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCourse, deactivateCourse, setProductCourse } from "./kitchen.js";
import { createTable } from "./tables.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { addTabRound } from "./working-order.js";
import "./errors.js";

// The HTTP layer of the order-group routes: body parsing, the operator taken from the session, the
// status each refusal maps to, and the answer's shape. What the commands do is pinned in
// `order-groups.test.ts`.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

interface Seated {
  visitId: string;
  tabId: string;
  revision: number;
}

async function seated(): Promise<Seated> {
  const { id: tableId } = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, { label: `G-${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  const seat = await send(venue.app, venue.cookie, "POST", `/api/tables/${tableId}/seat`, {});
  expect(seat.status).toBe(200);
  return seat.json as unknown as Seated;
}

function call(method: string, path: string, body?: unknown) {
  return send(venue.app, venue.cookie, method, path, body);
}

async function revisionOf(visitId: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ revision: visits.revision }).from(visits).where(eq(visits.id, visitId)),
  );
  return row!.revision;
}

const dish = (name: string, quantity = "1") => ({ menuItemId: venue.offerFor(name), quantity });

/** Submits groups over the route at the visit's current revision; answers the route's answer. */
async function submit(
  visitId: string,
  groups: { lines: ReturnType<typeof dish>[]; release: "fire" | "hold" }[],
  extra: Record<string, unknown> = {},
) {
  return call("POST", `/api/visits/${visitId}/groups`, {
    submissionId: randomUUID(),
    expectedVisitRevision: await revisionOf(visitId),
    groups,
    ...extra,
  });
}

interface SubmitAnswer {
  tabId: string;
  revision: number;
  groups: { id: string; state: string; lineIds: string[] }[];
}

/** A seated visit holding a fired Caña group and held Tarta and Croquetas groups, in that order. */
async function withGroups() {
  const visit = await seated();
  const submitted = await submit(visit.visitId, [
    { lines: [dish("Caña")], release: "fire" },
    { lines: [dish("Tarta")], release: "hold" },
    { lines: [dish("Croquetas")], release: "hold" },
  ]);
  expect(submitted.status).toBe(200);
  const [fired, tarta, croquetas] = (submitted.json as unknown as SubmitAnswer).groups;
  return { ...visit, fired: fired!, tarta: tarta!, croquetas: croquetas! };
}

async function dishLines(tabId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        id: workingOrderLines.id,
        name: workingOrderLines.name,
        groupId: workingOrderLines.groupId,
        creditedTo: workingOrderLines.creditedTo,
      })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, tabId), isNull(workingOrderLines.parentLineId)),
      )
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

async function eventCount(visitId: string): Promise<number> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ id: orderGroupEvents.id })
      .from(orderGroupEvents)
      .where(eq(orderGroupEvents.visitId, visitId)),
  );
  return rows.length;
}

async function commandCount(visitId: string): Promise<number> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ id: serviceCommands.id })
      .from(serviceCommands)
      .where(eq(serviceCommands.scopeId, visitId)),
  );
  return rows.length;
}

/** Everything a refused or replayed command must leave as it was. */
async function snapshot(visit: { visitId: string; tabId: string }) {
  return {
    revision: await revisionOf(visit.visitId),
    lines: await dishLines(visit.tabId),
    events: await eventCount(visit.visitId),
    commands: await commandCount(visit.visitId),
    groups: (await call("GET", `/api/visits/${visit.visitId}/groups`)).json,
  };
}

function refusal(code: string, params?: Record<string, unknown>) {
  return params === undefined ? expect.objectContaining({ code }) : { code, params };
}

describe("POST /api/visits/:id/groups", () => {
  it("puts each group's lines on the visit's tab, credited to the session's operator, and answers the tab, revision and groups", async () => {
    const visit = await seated();

    const answer = await call("POST", `/api/visits/${visit.visitId}/groups`, {
      submissionId: randomUUID(),
      expectedVisitRevision: visit.revision,
      // A body naming an operator is not who acts: the session's person is.
      operatorId: venue.adminId,
      groups: [
        { lines: [dish("Caña", "2")], release: "fire" },
        { lines: [dish("Tarta"), dish("Croquetas")], release: "hold" },
      ],
    });

    expect(answer.status).toBe(200);
    const lines = await dishLines(visit.tabId);
    expect(answer.json).toEqual({
      tabId: visit.tabId,
      revision: visit.revision + 1,
      groups: [
        {
          id: lines[0]!.groupId,
          position: 1,
          state: "fired",
          firedAt: expect.any(String),
          remindAt: null,
          lineIds: [lines[0]!.id],
          summary: "2 × Caña",
        },
        {
          id: lines[1]!.groupId,
          position: 2,
          state: "held",
          firedAt: null,
          remindAt: null,
          lineIds: [lines[1]!.id, lines[2]!.id],
          summary: "1 × Tarta, 1 × Croquetas",
        },
      ],
    });
    expect(lines.map((line) => line.creditedTo)).toEqual([
      venue.operatorId,
      venue.operatorId,
      venue.operatorId,
    ]);
  });

  it("answers a repeat of the same submission with the first answer and writes nothing, though its revision is now stale", async () => {
    const visit = await seated();
    const body = {
      submissionId: randomUUID(),
      expectedVisitRevision: visit.revision,
      groups: [{ lines: [dish("Pulpo")], release: "hold" }],
    };
    const first = await call("POST", `/api/visits/${visit.visitId}/groups`, body);
    const before = await snapshot(visit);

    const again = await call("POST", `/api/visits/${visit.visitId}/groups`, body);

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses 409 submission.id_reused for the same submission id with other lines, writing nothing", async () => {
    const visit = await seated();
    const submissionId = randomUUID();
    await call("POST", `/api/visits/${visit.visitId}/groups`, {
      submissionId,
      expectedVisitRevision: visit.revision,
      groups: [{ lines: [dish("Pulpo")], release: "hold" }],
    });
    const before = await snapshot(visit);

    const reused = await call("POST", `/api/visits/${visit.visitId}/groups`, {
      submissionId,
      expectedVisitRevision: visit.revision + 1,
      groups: [{ lines: [dish("Pulpo", "2")], release: "hold" }],
    });

    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses 409 visit.out_of_date for a revision another command has moved past, writing nothing", async () => {
    const visit = await seated();
    await submit(visit.visitId, [{ lines: [dish("Pulpo")], release: "hold" }]);
    const before = await snapshot(visit);

    const stale = await call("POST", `/api/visits/${visit.visitId}/groups`, {
      submissionId: randomUUID(),
      expectedVisitRevision: visit.revision,
      groups: [{ lines: [dish("Tarta")], release: "hold" }],
    });

    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("visit.out_of_date", { visitId: visit.visitId, revision: visit.revision + 1 }),
    );
    expect(await snapshot(visit)).toEqual(before);
  });

  it("joins a held group named by joinGroupId, and refuses a fired one 409 group.not_held and an unknown one 404 group.not_found", async () => {
    const visit = await withGroups();

    const joined = await submit(visit.visitId, [{ lines: [dish("Pulpo")], release: "hold" }], {
      joinGroupId: visit.tarta.id,
    });
    const before = await snapshot(visit);
    const toFired = await submit(visit.visitId, [{ lines: [dish("Pulpo")], release: "hold" }], {
      joinGroupId: visit.fired.id,
    });
    const missing = randomUUID();
    const toMissing = await submit(visit.visitId, [{ lines: [dish("Pulpo")], release: "hold" }], {
      joinGroupId: missing,
    });

    expect(joined.status).toBe(200);
    expect((joined.json as unknown as SubmitAnswer).groups.map((group) => group.id)).toEqual([
      visit.tarta.id,
    ]);
    expect(toFired.status).toBe(409);
    expect(toFired.json).toEqual(refusal("group.not_held", { groupId: visit.fired.id }));
    expect(toMissing.status).toBe(404);
    expect(toMissing.json).toEqual(refusal("group.not_found", { groupId: missing }));
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses 409 visit.not_open for a visit that does not exist, and for an id that is not one", async () => {
    for (const visitId of [randomUUID(), "not-a-uuid"]) {
      const refused = await call("POST", `/api/visits/${visitId}/groups`, {
        submissionId: randomUUID(),
        expectedVisitRevision: 0,
        groups: [{ lines: [dish("Pulpo")], release: "hold" }],
      });

      expect(refused.status).toBe(409);
      expect(refused.json).toEqual(refusal("visit.not_open", { visitId }));
    }
  });

  it.each([
    ["body", null],
    ["body", [1]],
    ["submissionId", { expectedVisitRevision: 0, groups: [] }],
    ["submissionId", { submissionId: "", expectedVisitRevision: 0, groups: [] }],
    ["submissionId", { submissionId: 7, expectedVisitRevision: 0, groups: [] }],
    ["expectedVisitRevision", { submissionId: "s", groups: [] }],
    ["expectedVisitRevision", { submissionId: "s", expectedVisitRevision: "0", groups: [] }],
    ["groups", { submissionId: "s", expectedVisitRevision: 0 }],
    ["groups", { submissionId: "s", expectedVisitRevision: 0, groups: {} }],
    ["groups", { submissionId: "s", expectedVisitRevision: 0, groups: [null] }],
    ["lines", { submissionId: "s", expectedVisitRevision: 0, groups: [{ release: "fire" }] }],
    [
      "lines",
      { submissionId: "s", expectedVisitRevision: 0, groups: [{ lines: [3], release: "fire" }] },
    ],
    ["release", { submissionId: "s", expectedVisitRevision: 0, groups: [{ lines: [] }] }],
    [
      "release",
      { submissionId: "s", expectedVisitRevision: 0, groups: [{ lines: [], release: "now" }] },
    ],
    [
      "joinGroupId",
      {
        submissionId: "s",
        expectedVisitRevision: 0,
        groups: [{ lines: [], release: "hold" }],
        joinGroupId: 4,
      },
    ],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const visit = await seated();
    const before = await snapshot(visit);

    const refused = await call("POST", `/api/visits/${visit.visitId}/groups`, body);

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(visit)).toEqual(before);
  });
});

describe("POST /api/visits/:id/groups/:gid/fire", () => {
  it("fires a held group and answers the visit's revision", async () => {
    const visit = await withGroups();
    const revision = await revisionOf(visit.visitId);

    const fired = await call("POST", `/api/visits/${visit.visitId}/groups/${visit.tarta.id}/fire`, {
      submissionId: randomUUID(),
      expectedVisitRevision: revision,
      operatorId: venue.adminId,
    });

    expect(fired.status).toBe(200);
    expect(fired.json).toEqual({ revision: revision + 1 });
    const [event] = await inTx(venue, (tx) =>
      tx
        .select({ actorId: orderGroupEvents.actorId })
        .from(orderGroupEvents)
        .where(
          and(eq(orderGroupEvents.groupId, visit.tarta.id), eq(orderGroupEvents.kind, "fired")),
        ),
    );
    expect(event).toEqual({ actorId: venue.operatorId });
  });

  it("answers a repeat with the first answer and writes nothing; a new id on the fired group is 409 group.not_held", async () => {
    const visit = await withGroups();
    const body = { submissionId: randomUUID(), expectedVisitRevision: visit.revision + 1 };
    const path = `/api/visits/${visit.visitId}/groups/${visit.tarta.id}/fire`;
    const first = await call("POST", path, body);
    const before = await snapshot(visit);

    const again = await call("POST", path, body);
    const refired = await call("POST", path, {
      submissionId: randomUUID(),
      expectedVisitRevision: await revisionOf(visit.visitId),
    });

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(refired.status).toBe(409);
    expect(refired.json).toEqual(refusal("group.not_held", { groupId: visit.tarta.id }));
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses 409 submission.id_reused for an id first used on another group, and 409 visit.out_of_date for a stale revision", async () => {
    const visit = await withGroups();
    const submissionId = randomUUID();
    await call("POST", `/api/visits/${visit.visitId}/groups/${visit.tarta.id}/fire`, {
      submissionId,
      expectedVisitRevision: await revisionOf(visit.visitId),
    });
    const before = await snapshot(visit);

    const reused = await call(
      "POST",
      `/api/visits/${visit.visitId}/groups/${visit.croquetas.id}/fire`,
      { submissionId, expectedVisitRevision: await revisionOf(visit.visitId) },
    );
    const stale = await call(
      "POST",
      `/api/visits/${visit.visitId}/groups/${visit.croquetas.id}/fire`,
      { submissionId: randomUUID(), expectedVisitRevision: visit.revision },
    );

    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("visit.out_of_date", {
        visitId: visit.visitId,
        revision: await revisionOf(visit.visitId),
      }),
    );
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses 404 group.not_found for an unknown group and for an id that is not one", async () => {
    const visit = await withGroups();
    const before = await snapshot(visit);

    for (const groupId of [randomUUID(), "not-a-uuid"]) {
      const refused = await call("POST", `/api/visits/${visit.visitId}/groups/${groupId}/fire`, {
        submissionId: randomUUID(),
        expectedVisitRevision: await revisionOf(visit.visitId),
      });

      expect(refused.status).toBe(404);
      expect(refused.json).toEqual(refusal("group.not_found", { groupId }));
    }
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses 409 visit.not_open for a visit that does not exist", async () => {
    const visitId = randomUUID();

    const refused = await call("POST", `/api/visits/${visitId}/groups/${randomUUID()}/fire`, {
      submissionId: randomUUID(),
      expectedVisitRevision: 0,
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(refusal("visit.not_open", { visitId }));
  });

  it.each([
    ["body", null],
    ["submissionId", { expectedVisitRevision: 0 }],
    ["expectedVisitRevision", { submissionId: "s" }],
    ["expectedVisitRevision", { submissionId: "s", expectedVisitRevision: -1 }],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const visit = await withGroups();
    const before = await snapshot(visit);

    const refused = await call(
      "POST",
      `/api/visits/${visit.visitId}/groups/${visit.tarta.id}/fire`,
      body,
    );

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(visit)).toEqual(before);
  });
});

describe("PUT /api/visits/:id/groups/order", () => {
  it("puts the held groups in the order sent and answers the visit's revision", async () => {
    const visit = await withGroups();
    const revision = await revisionOf(visit.visitId);

    const reordered = await call("PUT", `/api/visits/${visit.visitId}/groups/order`, {
      submissionId: randomUUID(),
      expectedVisitRevision: revision,
      heldGroupIds: [visit.croquetas.id, visit.tarta.id],
    });

    expect(reordered.status).toBe(200);
    expect(reordered.json).toEqual({ revision: revision + 1 });
    const listed = await call("GET", `/api/visits/${visit.visitId}/groups`);
    expect(
      (listed.json.groups as { id: string; position: number }[]).map((g) => [g.id, g.position]),
    ).toEqual([
      [visit.fired.id, 1],
      [visit.croquetas.id, 2],
      [visit.tarta.id, 3],
    ]);
  });

  it("answers a repeat with the first answer and writes nothing, and refuses the id with another order 409 submission.id_reused", async () => {
    const visit = await withGroups();
    const submissionId = randomUUID();
    const path = `/api/visits/${visit.visitId}/groups/order`;
    const body = {
      submissionId,
      expectedVisitRevision: await revisionOf(visit.visitId),
      heldGroupIds: [visit.croquetas.id, visit.tarta.id],
    };
    const first = await call("PUT", path, body);
    const before = await snapshot(visit);

    const again = await call("PUT", path, body);
    const reused = await call("PUT", path, {
      ...body,
      heldGroupIds: [visit.tarta.id, visit.croquetas.id],
    });

    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses a stale revision 409 visit.out_of_date, a fired group 409 group.not_held and an unknown one 404 group.not_found", async () => {
    const visit = await withGroups();
    const before = await snapshot(visit);
    const path = `/api/visits/${visit.visitId}/groups/order`;
    const current = await revisionOf(visit.visitId);
    const missing = randomUUID();

    const stale = await call("PUT", path, {
      submissionId: randomUUID(),
      expectedVisitRevision: visit.revision,
      heldGroupIds: [visit.croquetas.id, visit.tarta.id],
    });
    const fired = await call("PUT", path, {
      submissionId: randomUUID(),
      expectedVisitRevision: current,
      heldGroupIds: [visit.fired.id, visit.croquetas.id, visit.tarta.id],
    });
    const unknown = await call("PUT", path, {
      submissionId: randomUUID(),
      expectedVisitRevision: current,
      heldGroupIds: [missing, visit.croquetas.id, visit.tarta.id],
    });

    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("visit.out_of_date", { visitId: visit.visitId, revision: current }),
    );
    expect(fired.status).toBe(409);
    expect(fired.json).toEqual(refusal("group.not_held", { groupId: visit.fired.id }));
    expect(unknown.status).toBe(404);
    expect(unknown.json).toEqual(refusal("group.not_found", { groupId: missing }));
    expect(await snapshot(visit)).toEqual(before);
  });

  it.each([
    ["body", null],
    ["submissionId", { expectedVisitRevision: 0, heldGroupIds: [] }],
    ["expectedVisitRevision", { submissionId: "s", heldGroupIds: [] }],
    ["heldGroupIds", { submissionId: "s", expectedVisitRevision: 0 }],
    ["heldGroupIds", { submissionId: "s", expectedVisitRevision: 0, heldGroupIds: [1] }],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const visit = await withGroups();
    const before = await snapshot(visit);

    const refused = await call("PUT", `/api/visits/${visit.visitId}/groups/order`, body);

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(visit)).toEqual(before);
  });
});

describe("the order and move routes on a visit that does not exist", () => {
  it.each([
    ["PUT", "order", { heldGroupIds: [] }],
    ["POST", "move", { moves: [{ lineId: randomUUID(), quantity: "1" }], target: "new" }],
  ] as const)(
    "refuse %s …/groups/%s 409 visit.not_open, for an unknown id and for an id that is not one",
    async (method, suffix, body) => {
      for (const visitId of [randomUUID(), "not-a-uuid"]) {
        const refused = await call(method, `/api/visits/${visitId}/groups/${suffix}`, {
          submissionId: randomUUID(),
          expectedVisitRevision: 0,
          ...body,
        });

        expect(refused.status).toBe(409);
        expect(refused.json).toEqual(refusal("visit.not_open", { visitId }));
      }
    },
  );
});

describe("POST /api/visits/:id/groups/move", () => {
  it("moves a line into another held group, or into a new one, and answers the visit's revision", async () => {
    const visit = await withGroups();
    const revision = await revisionOf(visit.visitId);
    const [tartaLine] = visit.tarta.lineIds;

    const moved = await call("POST", `/api/visits/${visit.visitId}/groups/move`, {
      submissionId: randomUUID(),
      expectedVisitRevision: revision,
      moves: [{ lineId: tartaLine, quantity: "1" }],
      target: { groupId: visit.croquetas.id },
    });
    const [croquetasLine] = visit.croquetas.lineIds;
    const toNew = await call("POST", `/api/visits/${visit.visitId}/groups/move`, {
      submissionId: randomUUID(),
      expectedVisitRevision: revision + 1,
      moves: [{ lineId: croquetasLine, quantity: "1" }],
      target: "new",
    });

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ revision: revision + 1 });
    expect(toNew.status).toBe(200);
    expect(toNew.json).toEqual({ revision: revision + 2 });
    const listed = (await call("GET", `/api/visits/${visit.visitId}/groups`)).json as {
      groups: { id: string; lineIds: string[] }[];
    };
    expect(listed.groups.map((group) => group.lineIds)).toEqual([
      visit.fired.lineIds,
      [tartaLine],
      [croquetasLine],
    ]);
    expect(listed.groups[1]!.id).toBe(visit.croquetas.id);
  });

  it("answers a repeat with the first answer and writes nothing, and refuses the id with another target 409 submission.id_reused", async () => {
    const visit = await withGroups();
    const submissionId = randomUUID();
    const path = `/api/visits/${visit.visitId}/groups/move`;
    const body = {
      submissionId,
      expectedVisitRevision: await revisionOf(visit.visitId),
      moves: [{ lineId: visit.tarta.lineIds[0], quantity: "1" }],
      target: { groupId: visit.croquetas.id },
    };
    const first = await call("POST", path, body);
    const before = await snapshot(visit);

    const again = await call("POST", path, body);
    const reused = await call("POST", path, { ...body, target: "new" });

    expect(first.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses a stale revision 409 visit.out_of_date, a fired target 409 group.not_held and an unknown line 404 group.not_found", async () => {
    const visit = await withGroups();
    const before = await snapshot(visit);
    const path = `/api/visits/${visit.visitId}/groups/move`;
    const current = await revisionOf(visit.visitId);
    const moves = [{ lineId: visit.tarta.lineIds[0], quantity: "1" }];
    const missing = randomUUID();

    const stale = await call("POST", path, {
      submissionId: randomUUID(),
      expectedVisitRevision: visit.revision,
      moves,
      target: "new",
    });
    const toFired = await call("POST", path, {
      submissionId: randomUUID(),
      expectedVisitRevision: current,
      moves,
      target: { groupId: visit.fired.id },
    });
    const unknownLine = await call("POST", path, {
      submissionId: randomUUID(),
      expectedVisitRevision: current,
      moves: [{ lineId: missing, quantity: "1" }],
      target: "new",
    });

    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("visit.out_of_date", { visitId: visit.visitId, revision: current }),
    );
    expect(toFired.status).toBe(409);
    expect(toFired.json).toEqual(refusal("group.not_held", { groupId: visit.fired.id }));
    expect(unknownLine.status).toBe(404);
    expect(unknownLine.json).toEqual(refusal("group.not_found", { lineId: missing }));
    expect(await snapshot(visit)).toEqual(before);
  });

  it.each([
    ["body", null],
    ["submissionId", { expectedVisitRevision: 0, moves: [], target: "new" }],
    ["expectedVisitRevision", { submissionId: "s", moves: [], target: "new" }],
    ["moves", { submissionId: "s", expectedVisitRevision: 0, target: "new" }],
    ["moves", { submissionId: "s", expectedVisitRevision: 0, moves: [7], target: "new" }],
    [
      "moves",
      { submissionId: "s", expectedVisitRevision: 0, moves: [{ lineId: "x" }], target: "new" },
    ],
    [
      "moves",
      {
        submissionId: "s",
        expectedVisitRevision: 0,
        moves: [{ lineId: 1, quantity: "1" }],
        target: "new",
      },
    ],
    ["target", { submissionId: "s", expectedVisitRevision: 0, moves: [] }],
    ["target", { submissionId: "s", expectedVisitRevision: 0, moves: [], target: "old" }],
    ["target", { submissionId: "s", expectedVisitRevision: 0, moves: [], target: { groupId: 2 } }],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const visit = await withGroups();
    const before = await snapshot(visit);

    const refused = await call("POST", `/api/visits/${visit.visitId}/groups/move`, body);

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(visit)).toEqual(before);
  });
});

describe("GET /api/visits/:id/groups", () => {
  it("answers the visit's revision and its groups in sequence", async () => {
    const visit = await withGroups();

    const listed = await call("GET", `/api/visits/${visit.visitId}/groups`);

    expect(listed.status).toBe(200);
    const lines = await dishLines(visit.tabId);
    expect(listed.json).toEqual({
      revision: await revisionOf(visit.visitId),
      groups: [
        {
          id: visit.fired.id,
          position: 1,
          state: "fired",
          firedAt: expect.any(String),
          remindAt: null,
          lineIds: [lines[0]!.id],
          summary: "1 × Caña",
        },
        {
          id: visit.tarta.id,
          position: 2,
          state: "held",
          firedAt: null,
          remindAt: null,
          lineIds: [lines[1]!.id],
          summary: "1 × Tarta",
        },
        {
          id: visit.croquetas.id,
          position: 3,
          state: "held",
          firedAt: null,
          remindAt: null,
          lineIds: [lines[2]!.id],
          summary: "1 × Croquetas",
        },
      ],
    });
  });

  it("refuses 409 visit.not_open for a visit that does not exist, and for an id that is not one", async () => {
    for (const visitId of [randomUUID(), "not-a-uuid"]) {
      const refused = await call("GET", `/api/visits/${visitId}/groups`);

      expect(refused.status).toBe(409);
      expect(refused.json).toEqual(refusal("visit.not_open", { visitId }));
    }
  });
});

describe("GET /api/working-orders/:id/lines", () => {
  it("names the group each line belongs to, and none on a bill with no visit", async () => {
    const visit = await withGroups();
    const counter = await tabWith(venue, "Paella");

    const tab = await call("GET", `/api/working-orders/${visit.tabId}/lines`);
    const noVisit = await call("GET", `/api/working-orders/${counter}/lines`);

    expect(tab.status).toBe(200);
    expect(
      (tab.json.lines as { lineNo: number; groupId: string | null }[]).map(
        ({ lineNo, groupId }) => ({ lineNo, groupId }),
      ),
    ).toEqual([
      { lineNo: 1, groupId: visit.fired.id },
      { lineNo: 2, groupId: visit.tarta.id },
      { lineNo: 3, groupId: visit.croquetas.id },
    ]);
    expect(
      (noVisit.json.lines as { lineNo: number; groupId: string | null }[]).map(
        ({ lineNo, groupId }) => ({ lineNo, groupId }),
      ),
    ).toEqual([{ lineNo: 1, groupId: null }]);
  });

  it("names each line by the id its group's lineIds and a move speak", async () => {
    const visit = await withGroups();

    const tab = await call("GET", `/api/working-orders/${visit.tabId}/lines`);

    expect(
      (tab.json.lines as { lineNo: number; id: string }[]).map(({ lineNo, id }) => ({
        lineNo,
        id,
      })),
    ).toEqual([
      { lineNo: 1, id: visit.fired.lineIds[0] },
      { lineNo: 2, id: visit.tarta.lineIds[0] },
      { lineNo: 3, id: visit.croquetas.lineIds[0] },
    ]);
  });
});

describe("the tab routes that move or release lines, on a visit with groups", () => {
  it("refuses 409 group.held_leaves_visit for a held line transferred to another party's tab, writing nothing", async () => {
    const visit = await withGroups();
    const other = await seated();
    const lineNo = (
      (await call("GET", `/api/working-orders/${visit.tabId}/lines`)).json.lines as {
        lineNo: number;
        groupId: string | null;
      }[]
    ).find((line) => line.groupId === visit.tarta.id)!.lineNo;
    const before = [await snapshot(visit), await snapshot(other)];

    const refused = await call("POST", `/api/tabs/${visit.tabId}/transfer`, {
      toTabId: other.tabId,
      transfers: [{ lineNo }],
      expectedVisitRevision: await revisionOf(other.visitId),
      expectedSourceVisitRevision: await revisionOf(visit.visitId),
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(
      refusal("group.held_leaves_visit", { tabId: visit.tabId, lineNo }),
    );
    expect([await snapshot(visit), await snapshot(other)]).toEqual(before);
  });

  it("refuses 409 group.line_held for a held line sent on its own, writing nothing", async () => {
    const visit = await withGroups();
    const lineNo = (
      (await call("GET", `/api/working-orders/${visit.tabId}/lines`)).json.lines as {
        lineNo: number;
        groupId: string | null;
      }[]
    ).find((line) => line.groupId === visit.croquetas.id)!.lineNo;
    const before = await snapshot(visit);

    const refused = await call("POST", `/api/working-orders/${visit.tabId}/lines/send`, {
      lineNos: [lineNo],
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(refusal("group.line_held", { tabId: visit.tabId, lineNo }));
    expect(await snapshot(visit)).toEqual(before);
  });

  it("fires the held group holding a course's dish through the course Fire route, as the signed-in operator", async () => {
    const [tarta] = await inTx(venue, (tx) =>
      tx
        .select({ id: products.id, courseId: products.courseId })
        .from(products)
        .where(eq(products.name, "Tarta")),
    );
    const courseId = await inTx(venue, async (tx) => {
      const course = await createCourse(tx, venue.cfg, {
        name: `Postres-${randomUUID().slice(0, 6)}`,
        displayOrder: 9,
      });
      await setProductCourse(tx, venue.cfg, tarta!.id, course.id);
      return course.id;
    });
    try {
      const visit = await withGroups();
      const revision = await revisionOf(visit.visitId);

      const fired = await call("POST", `/api/orders/${visit.tabId}/courses/${courseId}/fire`);

      expect(fired.status).toBe(200);
      expect(await revisionOf(visit.visitId)).toBe(revision + 1);
      const listed = (await call("GET", `/api/visits/${visit.visitId}/groups`)).json as {
        groups: { id: string; state: string }[];
      };
      expect(listed.groups.map((group) => [group.id, group.state])).toEqual([
        [visit.fired.id, "fired"],
        [visit.tarta.id, "fired"],
        [visit.croquetas.id, "held"],
      ]);
      const [event] = await inTx(venue, (tx) =>
        tx
          .select({ actorId: orderGroupEvents.actorId, detail: orderGroupEvents.detail })
          .from(orderGroupEvents)
          .where(
            and(eq(orderGroupEvents.groupId, visit.tarta.id), eq(orderGroupEvents.kind, "fired")),
          ),
      );
      expect(event).toEqual({
        actorId: venue.operatorId,
        detail: { courseId, workingOrderId: visit.tabId },
      });
    } finally {
      // The venue is shared by the whole file.
      await inTx(venue, async (tx) => {
        await setProductCourse(tx, venue.cfg, tarta!.id, tarta!.courseId);
        await deactivateCourse(tx, venue.cfg, courseId);
      });
    }
  });
});

describe("the line-editing routes act as the session's operator", () => {
  async function tabLines(tabId: string) {
    const answer = await call("GET", `/api/working-orders/${tabId}/lines`);
    return answer.json as unknown as {
      revision: number;
      lines: { id: string; lineNo: number; groupId: string | null }[];
    };
  }

  async function eventsOfGroup(groupId: string) {
    return inTx(venue, (tx) =>
      tx
        .select({ kind: orderGroupEvents.kind, actorId: orderGroupEvents.actorId })
        .from(orderGroupEvents)
        .where(eq(orderGroupEvents.groupId, groupId))
        .orderBy(asc(orderGroupEvents.createdAt)),
    );
  }

  it("removes the held group a void empties, naming the operator, and moves the visit on", async () => {
    const visit = await withGroups();
    const lineNo = (await tabLines(visit.tabId)).lines.find(
      (line) => line.groupId === visit.croquetas.id,
    )!.lineNo;
    const revision = await revisionOf(visit.visitId);

    const voided = await call("DELETE", `/api/working-orders/${visit.tabId}/lines/${lineNo}`);

    expect(voided.status).toBe(200);
    expect(await eventsOfGroup(visit.croquetas.id)).toEqual([
      { kind: "submitted", actorId: venue.operatorId },
      { kind: "removed", actorId: venue.operatorId },
    ]);
    expect(await revisionOf(visit.visitId)).toBe(revision + 1);
  });

  it("puts a fired line's raised quantity in a new fired group credited to the operator", async () => {
    const visit = await withGroups();
    const tab = await tabLines(visit.tabId);
    const cana = tab.lines.find((line) => line.groupId === visit.fired.id)!;

    const changed = await call("PUT", `/api/working-orders/${visit.tabId}/lines/${cana.lineNo}`, {
      quantity: "2",
      revision: tab.revision,
    });

    expect(changed.status).toBe(200);
    const added = (await dishLines(visit.tabId)).at(-1)!;
    expect(added).toMatchObject({ name: "Caña", creditedTo: venue.operatorId });
    expect(added.groupId).not.toBe(visit.fired.id);
    expect(await eventsOfGroup(added.groupId!)).toEqual([
      { kind: "submitted", actorId: venue.operatorId },
    ]);
  });

  it("credits a dish a whole-order save adds to the operator, never to one the body names", async () => {
    const visit = await withGroups();
    const tab = await tabLines(visit.tabId);
    const kept = (await dishLines(visit.tabId)).map((line) => ({
      workingOrderLineId: line.id,
      menuItemId: venue.offerFor(line.name),
      quantity: "1",
    }));

    const saved = await call("PUT", `/api/working-orders/${visit.tabId}`, {
      lines: [...kept, dish("Pulpo")],
      revision: tab.revision,
      operatorId: venue.adminId,
    });

    expect(saved.status).toBe(200);
    expect((await dishLines(visit.tabId)).at(-1)).toMatchObject({
      name: "Pulpo",
      creditedTo: venue.operatorId,
    });
  });

  it("credits a parked order's lines to the operator, never to one the body names", async () => {
    const id = randomUUID();

    const parked = await call("POST", "/api/working-orders", {
      id,
      lines: [dish("Tarta")],
      zoneId: venue.zoneId,
      operatorId: venue.adminId,
    });

    expect(parked.status).toBe(200);
    expect(await dishLines(id)).toMatchObject([
      { name: "Tarta", groupId: null, creditedTo: venue.operatorId },
    ]);
  });
});

/** How much of a line is served, and whether all of it. */
async function servedOf(lineId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({
        servedQuantity: workingOrderLines.servedQuantity,
        servedAt: workingOrderLines.servedAt,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, lineId)),
  );
  return row!;
}

describe("POST /api/visits/:id/served, /unserved and /groups/:gid/served", () => {
  it("serves a line, takes it back, then serves its group, answering the visit's revision each time", async () => {
    const visit = await withGroups();
    const lineId = visit.fired.lineIds[0]!;
    const revision = await revisionOf(visit.visitId);
    const items = [{ lineId, quantity: "1" }];

    const served = await call("POST", `/api/visits/${visit.visitId}/served`, {
      submissionId: randomUUID(),
      expectedVisitRevision: revision,
      items,
    });
    expect(served.status).toBe(200);
    expect(served.json).toEqual({ revision: revision + 1 });
    expect(await servedOf(lineId)).toEqual({ servedQuantity: 1000, servedAt: expect.any(String) });

    const unserved = await call("POST", `/api/visits/${visit.visitId}/unserved`, {
      submissionId: randomUUID(),
      expectedVisitRevision: revision + 1,
      items,
    });
    expect(unserved.status).toBe(200);
    expect(unserved.json).toEqual({ revision: revision + 2 });
    expect(await servedOf(lineId)).toEqual({ servedQuantity: 0, servedAt: null });

    const whole = await call(
      "POST",
      `/api/visits/${visit.visitId}/groups/${visit.fired.id}/served`,
      { submissionId: randomUUID(), expectedVisitRevision: revision + 2 },
    );
    expect(whole.status).toBe(200);
    expect(whole.json).toEqual({ revision: revision + 3 });
    expect(await servedOf(lineId)).toEqual({ servedQuantity: 1000, servedAt: expect.any(String) });
  });

  it("answers a repeat with the first answer and writes nothing, even at a revision since moved on", async () => {
    const visit = await withGroups();
    const lineId = visit.fired.lineIds[0]!;
    const body = {
      submissionId: randomUUID(),
      expectedVisitRevision: await revisionOf(visit.visitId),
      items: [{ lineId, quantity: "1" }],
    };
    const first = await call("POST", `/api/visits/${visit.visitId}/served`, body);
    const before = { ...(await snapshot(visit)), served: await servedOf(lineId) };

    const again = await call("POST", `/api/visits/${visit.visitId}/served`, body);

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect({ ...(await snapshot(visit)), served: await servedOf(lineId) }).toEqual(before);
  });

  it("answers each refusal with its status, writing nothing", async () => {
    const visit = await withGroups();
    const lineId = visit.fired.lineIds[0]!;
    const held = visit.tarta.lineIds[0]!;
    const [tartaLine] = await inTx(venue, (tx) =>
      tx
        .select({ lineNo: workingOrderLines.lineNo, tabId: workingOrderLines.workingOrderId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, held)),
    );
    const [canaLine] = await inTx(venue, (tx) =>
      tx
        .select({ lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, lineId)),
    );
    const used = randomUUID();
    await call("POST", `/api/visits/${visit.visitId}/served`, {
      submissionId: used,
      expectedVisitRevision: await revisionOf(visit.visitId),
      items: [{ lineId, quantity: "1" }],
    });
    const before = { ...(await snapshot(visit)), served: await servedOf(lineId) };
    const revision = await revisionOf(visit.visitId);
    const at = (extra: Record<string, unknown>) => ({
      submissionId: randomUUID(),
      expectedVisitRevision: revision,
      ...extra,
    });
    const base = `/api/visits/${visit.visitId}`;

    const cases: [string, unknown, number, unknown][] = [
      [
        `${base}/served`,
        at({ items: [{ lineId, quantity: "1" }] }),
        400,
        refusal("tab.serve_quantity_invalid", {
          tabId: visit.tabId,
          lineNo: canaLine!.lineNo,
          quantity: "1",
        }),
      ],
      [
        `${base}/unserved`,
        at({ items: [{ lineId, quantity: "2" }] }),
        400,
        refusal("tab.serve_quantity_invalid", {
          tabId: visit.tabId,
          lineNo: canaLine!.lineNo,
          quantity: "2",
        }),
      ],
      [
        `${base}/served`,
        at({ items: [{ lineId: held, quantity: "1" }] }),
        409,
        refusal("group.line_held", { tabId: tartaLine!.tabId, lineNo: tartaLine!.lineNo }),
      ],
      [
        `${base}/groups/${visit.tarta.id}/served`,
        at({}),
        409,
        refusal("group.line_held", { tabId: tartaLine!.tabId, lineNo: tartaLine!.lineNo }),
      ],
      [
        `${base}/served`,
        at({ items: [{ lineId: randomUUID(), quantity: "1" }] }),
        404,
        refusal("group.not_found"),
      ],
      [
        `${base}/groups/not-a-uuid/served`,
        at({}),
        404,
        refusal("group.not_found", { groupId: "not-a-uuid" }),
      ],
      [
        `${base}/served`,
        { submissionId: randomUUID(), expectedVisitRevision: revision - 1, items: [] },
        409,
        refusal("visit.out_of_date", { visitId: visit.visitId, revision }),
      ],
      [
        `${base}/unserved`,
        { submissionId: used, expectedVisitRevision: revision, items: [{ lineId, quantity: "1" }] },
        409,
        refusal("submission.id_reused", { submissionId: used }),
      ],
      [
        `${base}/served`,
        { expectedVisitRevision: revision, items: [] },
        400,
        refusal("management.request_invalid", { field: "submissionId" }),
      ],
      [
        `${base}/groups/${visit.fired.id}/served`,
        { submissionId: randomUUID() },
        400,
        refusal("management.request_invalid", { field: "expectedVisitRevision" }),
      ],
      [
        `${base}/served`,
        at({ items: {} }),
        400,
        refusal("management.request_invalid", { field: "items" }),
      ],
      [
        `${base}/served`,
        at({ items: [] }),
        400,
        refusal("management.request_invalid", { field: "items" }),
      ],
    ];
    for (const [path, body, status, error] of cases) {
      const answer = await call("POST", path, body);
      expect([path, answer.status, answer.json]).toEqual([path, status, error]);
    }
    expect({ ...(await snapshot(visit)), served: await servedOf(lineId) }).toEqual(before);
  });
});

describe("POST /api/visits/:id/served refusals that need their own setup", () => {
  it("refuses 409 group.line_held for a held line outside any group that needs no kitchen", async () => {
    const visit = await seated();
    const [pulpo] = await inTx(venue, (tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.name, "Pulpo")),
    );
    const route = sql`from preparation_routes where product_id = ${pulpo!.id} and zone_id is null`;
    const [before] = (
      await inTx(venue, async (tx) =>
        tx.execute<{ station_id: string | null; no_preparation: number }>(
          sql`select station_id, no_preparation ${route}`,
        ),
      )
    ).rows;
    // The suite shares one venue, so the Pulpo's route is put back whatever happens.
    try {
      await inTx(venue, async (tx) =>
        tx.run(sql`update preparation_routes set station_id = null, no_preparation = 1
                   where product_id = ${pulpo!.id} and zone_id is null`),
      );
      await inTx(venue, (tx) =>
        addTabRound(tx, venue.cfg, visit.tabId, [{ ...dish("Pulpo"), hold: true }]),
      );
    } finally {
      await inTx(venue, async (tx) =>
        tx.run(sql`update preparation_routes
                   set station_id = ${before!.station_id}, no_preparation = ${before!.no_preparation}
                   where product_id = ${pulpo!.id} and zone_id is null`),
      );
    }
    const [line] = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, visit.tabId)),
    );
    const beforeServe = await snapshot(visit);

    const refused = await call("POST", `/api/visits/${visit.visitId}/served`, {
      submissionId: randomUUID(),
      expectedVisitRevision: await revisionOf(visit.visitId),
      items: [{ lineId: line!.id, quantity: "1" }],
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(
      refusal("group.line_held", { tabId: visit.tabId, lineNo: line!.lineNo }),
    );
    expect(await snapshot(visit)).toEqual(beforeServe);
  });

  it("refuses 409 order.payment_in_flight on each served route while a card payment runs on the bill", async () => {
    const visit = await seated();
    const submitted = await submit(visit.visitId, [
      { lines: [dish("Caña", "2")], release: "fire" },
    ]);
    const fired = (submitted.json as unknown as SubmitAnswer).groups[0]!;
    const lineId = fired.lineIds[0]!;
    // One of the two served, so a serve, an undo and the group's serve are each valid but for the
    // payment.
    await call("POST", `/api/visits/${visit.visitId}/served`, {
      submissionId: randomUUID(),
      expectedVisitRevision: await revisionOf(visit.visitId),
      items: [{ lineId, quantity: "1" }],
    });
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ paymentAttemptAt: new Date().toISOString() })
        .where(eq(workingOrders.id, visit.tabId)),
    );
    try {
      const before = { ...(await snapshot(visit)), served: await servedOf(lineId) };
      const base = `/api/visits/${visit.visitId}`;
      for (const [path, extra] of [
        [`${base}/served`, { items: [{ lineId, quantity: "1" }] }],
        [`${base}/unserved`, { items: [{ lineId, quantity: "1" }] }],
        [`${base}/groups/${fired.id}/served`, {}],
      ] as const) {
        const refused = await call("POST", path, {
          submissionId: randomUUID(),
          expectedVisitRevision: await revisionOf(visit.visitId),
          ...extra,
        });
        expect([path, refused.status, refused.json]).toEqual([
          path,
          409,
          refusal("order.payment_in_flight", { workingOrderId: visit.tabId }),
        ]);
      }
      expect({ ...(await snapshot(visit)), served: await servedOf(lineId) }).toEqual(before);
    } finally {
      await inTx(venue, (tx) =>
        tx
          .update(workingOrders)
          .set({ paymentAttemptAt: null })
          .where(eq(workingOrders.id, visit.tabId)),
      );
    }
  });

  it("refuses 404 group.not_found for another party's group", async () => {
    const visit = await withGroups();
    const other = await withGroups();
    const before = await snapshot(visit);

    const refused = await call(
      "POST",
      `/api/visits/${visit.visitId}/groups/${other.fired.id}/served`,
      { submissionId: randomUUID(), expectedVisitRevision: await revisionOf(visit.visitId) },
    );

    expect(refused.status).toBe(404);
    expect(refused.json).toEqual(refusal("group.not_found", { groupId: other.fired.id }));
    expect(await snapshot(visit)).toEqual(before);
  });
});

describe("the group routes without a session", () => {
  it("refuse every route 401 session.required, writing nothing", async () => {
    const visit = await withGroups();
    const before = await snapshot(visit);
    const body = {
      submissionId: randomUUID(),
      expectedVisitRevision: await revisionOf(visit.visitId),
    };
    const base = `/api/visits/${visit.visitId}/groups`;

    const answers = [
      await send(venue.app, "", "GET", base),
      await send(venue.app, "", "POST", base, {
        ...body,
        groups: [{ lines: [dish("Pulpo")], release: "hold" }],
      }),
      await send(venue.app, "", "POST", `${base}/${visit.tarta.id}/fire`, body),
      await send(venue.app, "", "PUT", `${base}/order`, {
        ...body,
        heldGroupIds: [visit.croquetas.id, visit.tarta.id],
      }),
      await send(venue.app, "", "POST", `${base}/move`, {
        ...body,
        moves: [{ lineId: visit.tarta.lineIds[0], quantity: "1" }],
        target: "new",
      }),
    ];

    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(answer.json).toMatchObject({ code: "session.required" });
    }
    expect(await snapshot(visit)).toEqual(before);
  });
});

/** The kitchen's items for a group's dishes. */
async function groupTickets(groupId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        state: ticketItems.state,
        firedAt: ticketItems.firedAt,
        awayAt: ticketItems.awayAt,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.groupId, groupId))
      .orderBy(ticketItems.id),
  );
}

async function passSnapshot(visit: { visitId: string; tabId: string }, groupId: string) {
  return { ...(await snapshot(visit)), tickets: await groupTickets(groupId) };
}

describe.each(["ready", "away"] as const)("POST /api/visits/:id/groups/:gid/%s", (step) => {
  const path = (visitId: string, groupId: string) =>
    `/api/visits/${visitId}/groups/${groupId}/${step}`;

  it("answers a repeat with the first answer and writes nothing", async () => {
    const visit = await withGroups();
    const body = { submissionId: randomUUID(), expectedVisitRevision: visit.revision + 1 };
    const first = await call("POST", path(visit.visitId, visit.fired.id), body);
    const before = await passSnapshot(visit, visit.fired.id);

    const again = await call("POST", path(visit.visitId, visit.fired.id), body);

    expect(first.status).toBe(200);
    expect(first.json).toEqual({ revision: visit.revision + 2 });
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await passSnapshot(visit, visit.fired.id)).toEqual(before);
  });

  it("refuses 409 submission.id_reused for an id first used on another group, and 409 visit.out_of_date for a stale revision", async () => {
    const visit = await withGroups();
    const submissionId = randomUUID();
    await call("POST", path(visit.visitId, visit.fired.id), {
      submissionId,
      expectedVisitRevision: await revisionOf(visit.visitId),
    });
    const before = await passSnapshot(visit, visit.fired.id);

    const reused = await call("POST", path(visit.visitId, visit.tarta.id), {
      submissionId,
      expectedVisitRevision: await revisionOf(visit.visitId),
    });
    const stale = await call("POST", path(visit.visitId, visit.fired.id), {
      submissionId: randomUUID(),
      expectedVisitRevision: visit.revision,
    });

    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("visit.out_of_date", {
        visitId: visit.visitId,
        revision: await revisionOf(visit.visitId),
      }),
    );
    expect(await passSnapshot(visit, visit.fired.id)).toEqual(before);
  });

  it("refuses 404 group.not_found for an unknown group and for an id that is not one", async () => {
    const visit = await withGroups();
    const before = await snapshot(visit);

    for (const groupId of [randomUUID(), "not-a-uuid"]) {
      const refused = await call("POST", path(visit.visitId, groupId), {
        submissionId: randomUUID(),
        expectedVisitRevision: await revisionOf(visit.visitId),
      });

      expect(refused.status).toBe(404);
      expect(refused.json).toEqual(refusal("group.not_found", { groupId }));
    }
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses 409 visit.not_open for a visit that does not exist", async () => {
    const visitId = randomUUID();

    const refused = await call("POST", path(visitId, randomUUID()), {
      submissionId: randomUUID(),
      expectedVisitRevision: 0,
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(refusal("visit.not_open", { visitId }));
  });

  it.each([
    ["body", null],
    ["submissionId", { expectedVisitRevision: 0 }],
    ["expectedVisitRevision", { submissionId: "s" }],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const visit = await withGroups();
    const before = await snapshot(visit);

    const refused = await call("POST", path(visit.visitId, visit.fired.id), body);

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(visit)).toEqual(before);
  });

  it("refuses 401 session.required without a session, writing nothing", async () => {
    const visit = await withGroups();
    const before = await passSnapshot(visit, visit.fired.id);

    const refused = await send(venue.app, "", "POST", path(visit.visitId, visit.fired.id), {
      submissionId: randomUUID(),
      expectedVisitRevision: await revisionOf(visit.visitId),
    });

    expect(refused.status).toBe(401);
    expect(refused.json).toMatchObject({ code: "session.required" });
    expect(await passSnapshot(visit, visit.fired.id)).toEqual(before);
  });
});

describe("the pass routes, one after the other", () => {
  it("bumps the fired Caña ready, then sends it away, each answering the visit's revision", async () => {
    const visit = await withGroups();
    const before = await groupTickets(visit.fired.id);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((item) => item.state === "queued" && item.firedAt !== null)).toBe(true);

    const readied = await call(
      "POST",
      `/api/visits/${visit.visitId}/groups/${visit.fired.id}/ready`,
      {
        submissionId: randomUUID(),
        expectedVisitRevision: visit.revision + 1,
      },
    );

    expect(readied.status).toBe(200);
    expect(readied.json).toEqual({ revision: visit.revision + 2 });
    expect((await groupTickets(visit.fired.id)).map((item) => [item.state, item.awayAt])).toEqual(
      before.map(() => ["ready", null]),
    );
    const listed = (await call("GET", `/api/visits/${visit.visitId}/groups`)).json as unknown as {
      groups: { id: string; ready?: boolean }[];
    };
    expect(listed.groups.map((group) => group.ready ?? false)).toEqual([true, false, false]);

    const sent = await call("POST", `/api/visits/${visit.visitId}/groups/${visit.fired.id}/away`, {
      submissionId: randomUUID(),
      expectedVisitRevision: visit.revision + 2,
    });

    expect(sent.status).toBe(200);
    expect(sent.json).toEqual({ revision: visit.revision + 3 });
    expect((await groupTickets(visit.fired.id)).every((item) => item.awayAt !== null)).toBe(true);
  });
});
