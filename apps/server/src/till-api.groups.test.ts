import { clearRoutingCell, setRoutingCell } from "@waitron/venue-service";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  orderGroupEvents,
  products,
  serviceCommands,
  ticketItems,
  parties,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCourse, removeCourse, setProductCourse } from "./kitchen.js";
import { createTable } from "./tables.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { addTabRound } from "./working-order.js";
import "./errors.js";
import { splitBill } from "./bill-actions.js";
import { cancelBody } from "./testing/cancel-line.js";

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
  partyId: string;
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

async function revisionOf(partyId: string): Promise<number> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.revision;
}

const dish = (name: string, quantity = "1") => ({ menuItemId: venue.offerFor(name), quantity });

/** Submits groups over the route at the party's current revision; answers the route's answer. */
async function submit(
  partyId: string,
  groups: { lines: ReturnType<typeof dish>[]; release: "fire" | "hold" }[],
  extra: Record<string, unknown> = {},
) {
  return call("POST", `/api/parties/${partyId}/groups`, {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(partyId),
    groups,
    ...extra,
  });
}

interface SubmitAnswer {
  tabId: string;
  revision: number;
  groups: { id: string; state: string; lineIds: string[] }[];
}

/** A seated party holding a fired Caña group and held Tarta and Croquetas groups, in that order. */
async function withGroups() {
  const party = await seated();
  const submitted = await submit(party.partyId, [
    { lines: [dish("Caña")], release: "fire" },
    { lines: [dish("Tarta")], release: "hold" },
    { lines: [dish("Croquetas")], release: "hold" },
  ]);
  expect(submitted.status).toBe(200);
  const [fired, tarta, croquetas] = (submitted.json as unknown as SubmitAnswer).groups;
  return { ...party, fired: fired!, tarta: tarta!, croquetas: croquetas! };
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

async function eventCount(partyId: string): Promise<number> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ id: orderGroupEvents.id })
      .from(orderGroupEvents)
      .where(eq(orderGroupEvents.partyId, partyId)),
  );
  return rows.length;
}

async function commandCount(partyId: string): Promise<number> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ id: serviceCommands.id })
      .from(serviceCommands)
      .where(eq(serviceCommands.scopeId, partyId)),
  );
  return rows.length;
}

/** Everything a refused or replayed command must leave as it was. */
async function snapshot(party: { partyId: string; tabId: string }) {
  return {
    revision: await revisionOf(party.partyId),
    lines: await dishLines(party.tabId),
    events: await eventCount(party.partyId),
    commands: await commandCount(party.partyId),
    groups: (await call("GET", `/api/parties/${party.partyId}/groups`)).json,
  };
}

function refusal(code: string, params?: Record<string, unknown>) {
  return params === undefined ? expect.objectContaining({ code }) : { code, params };
}

describe("POST /api/parties/:id/groups", () => {
  it("puts each group's lines on the party's tab, credited to the session's operator, and answers the tab, revision and groups", async () => {
    const party = await seated();

    const answer = await call("POST", `/api/parties/${party.partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
      // A body naming an operator is not who acts: the session's person is.
      operatorId: venue.adminId,
      groups: [
        { lines: [dish("Caña", "2")], release: "fire" },
        { lines: [dish("Tarta"), dish("Croquetas")], release: "hold" },
      ],
    });

    expect(answer.status).toBe(200);
    const lines = await dishLines(party.tabId);
    expect(answer.json).toEqual({
      tabId: party.tabId,
      revision: party.revision + 1,
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
    const party = await seated();
    const body = {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
      groups: [{ lines: [dish("Pulpo")], release: "hold" }],
    };
    const first = await call("POST", `/api/parties/${party.partyId}/groups`, body);
    const before = await snapshot(party);

    const again = await call("POST", `/api/parties/${party.partyId}/groups`, body);

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await snapshot(party)).toEqual(before);
  });

  it("refuses 409 submission.id_reused for the same submission id with other lines, writing nothing", async () => {
    const party = await seated();
    const submissionId = randomUUID();
    await call("POST", `/api/parties/${party.partyId}/groups`, {
      submissionId,
      expectedPartyRevision: party.revision,
      groups: [{ lines: [dish("Pulpo")], release: "hold" }],
    });
    const before = await snapshot(party);

    const reused = await call("POST", `/api/parties/${party.partyId}/groups`, {
      submissionId,
      expectedPartyRevision: party.revision + 1,
      groups: [{ lines: [dish("Pulpo", "2")], release: "hold" }],
    });

    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(await snapshot(party)).toEqual(before);
  });

  it("puts the lines on the bill of the party billId names, and refuses the same id naming another bill 409 submission.id_reused", async () => {
    const party = await seated();
    await submit(party.partyId, [{ lines: [dish("Caña"), dish("Pulpo")], release: "fire" }]);
    const command = {
      expectedPartyRevision: await revisionOf(party.partyId),
      operatorId: venue.operatorId,
    };
    const { billId: checkId } = await inTx(venue, (tx) =>
      splitBill(tx, venue.cfg, party.tabId, [{ lineNo: 2 }], command),
    );
    const submissionId = randomUUID();
    const body = {
      submissionId,
      expectedPartyRevision: await revisionOf(party.partyId),
      billId: checkId.toUpperCase(),
      groups: [{ lines: [dish("Tarta")], release: "hold" }],
    };

    const named = await call("POST", `/api/parties/${party.partyId}/groups`, body);
    expect(named.status).toBe(200);
    expect((named.json as unknown as SubmitAnswer).tabId).toBe(checkId);
    expect((await dishLines(checkId)).map((line) => line.name)).toEqual(["Pulpo", "Tarta"]);
    const before = await snapshot(party);

    const reused = await call("POST", `/api/parties/${party.partyId}/groups`, {
      ...body,
      billId: party.tabId,
    });

    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(await snapshot(party)).toEqual(before);
    expect((await dishLines(checkId)).map((line) => line.name)).toEqual(["Pulpo", "Tarta"]);
  });

  it.each([null, "bill-1", 7])(
    "refuses the billId %j 400 management.request_invalid, writing nothing",
    async (billId) => {
      const party = await seated();
      const before = await snapshot(party);

      const refused = await submit(party.partyId, [{ lines: [dish("Caña")], release: "fire" }], {
        billId,
      });

      expect(refused.status).toBe(400);
      expect(refused.json).toEqual(refusal("management.request_invalid", { field: "billId" }));
      expect(await snapshot(party)).toEqual(before);
    },
  );

  it("refuses 409 party.out_of_date for a revision another command has moved past, writing nothing", async () => {
    const party = await seated();
    await submit(party.partyId, [{ lines: [dish("Pulpo")], release: "hold" }]);
    const before = await snapshot(party);

    const stale = await call("POST", `/api/parties/${party.partyId}/groups`, {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
      groups: [{ lines: [dish("Tarta")], release: "hold" }],
    });

    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("party.out_of_date", { partyId: party.partyId, revision: party.revision + 1 }),
    );
    expect(await snapshot(party)).toEqual(before);
  });

  it("joins a held group named by joinGroupId, and refuses a fired one 409 group.not_held and an unknown one 404 group.not_found", async () => {
    const party = await withGroups();

    const joined = await submit(party.partyId, [{ lines: [dish("Pulpo")], release: "hold" }], {
      joinGroupId: party.tarta.id,
    });
    const before = await snapshot(party);
    const toFired = await submit(party.partyId, [{ lines: [dish("Pulpo")], release: "hold" }], {
      joinGroupId: party.fired.id,
    });
    const missing = randomUUID();
    const toMissing = await submit(party.partyId, [{ lines: [dish("Pulpo")], release: "hold" }], {
      joinGroupId: missing,
    });

    expect(joined.status).toBe(200);
    expect((joined.json as unknown as SubmitAnswer).groups.map((group) => group.id)).toEqual([
      party.tarta.id,
    ]);
    expect(toFired.status).toBe(409);
    expect(toFired.json).toEqual(refusal("group.not_held", { groupId: party.fired.id }));
    expect(toMissing.status).toBe(404);
    expect(toMissing.json).toEqual(refusal("group.not_found", { groupId: missing }));
    expect(await snapshot(party)).toEqual(before);
  });

  it("refuses 409 party.not_open for a party that does not exist, and for an id that is not one", async () => {
    for (const partyId of [randomUUID(), "not-a-uuid"]) {
      const refused = await call("POST", `/api/parties/${partyId}/groups`, {
        submissionId: randomUUID(),
        expectedPartyRevision: 0,
        groups: [{ lines: [dish("Pulpo")], release: "hold" }],
      });

      expect(refused.status).toBe(409);
      expect(refused.json).toEqual(refusal("party.not_open", { partyId }));
    }
  });

  it.each([
    ["body", null],
    ["body", [1]],
    ["submissionId", { expectedPartyRevision: 0, groups: [] }],
    ["submissionId", { submissionId: "", expectedPartyRevision: 0, groups: [] }],
    ["submissionId", { submissionId: 7, expectedPartyRevision: 0, groups: [] }],
    ["expectedPartyRevision", { submissionId: "s", groups: [] }],
    ["expectedPartyRevision", { submissionId: "s", expectedPartyRevision: "0", groups: [] }],
    ["groups", { submissionId: "s", expectedPartyRevision: 0 }],
    ["groups", { submissionId: "s", expectedPartyRevision: 0, groups: {} }],
    ["groups", { submissionId: "s", expectedPartyRevision: 0, groups: [null] }],
    ["lines", { submissionId: "s", expectedPartyRevision: 0, groups: [{ release: "fire" }] }],
    [
      "lines",
      { submissionId: "s", expectedPartyRevision: 0, groups: [{ lines: [3], release: "fire" }] },
    ],
    ["release", { submissionId: "s", expectedPartyRevision: 0, groups: [{ lines: [] }] }],
    [
      "release",
      { submissionId: "s", expectedPartyRevision: 0, groups: [{ lines: [], release: "now" }] },
    ],
    [
      "joinGroupId",
      {
        submissionId: "s",
        expectedPartyRevision: 0,
        groups: [{ lines: [], release: "hold" }],
        joinGroupId: 4,
      },
    ],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const party = await seated();
    const before = await snapshot(party);

    const refused = await call("POST", `/api/parties/${party.partyId}/groups`, body);

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(party)).toEqual(before);
  });
});

describe("POST /api/parties/:id/groups/:gid/fire", () => {
  it("fires a held group and answers the party's revision", async () => {
    const party = await withGroups();
    const revision = await revisionOf(party.partyId);

    const fired = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${party.tarta.id}/fire`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
        operatorId: venue.adminId,
      },
    );

    expect(fired.status).toBe(200);
    expect(fired.json).toEqual({ revision: revision + 1 });
    const [event] = await inTx(venue, (tx) =>
      tx
        .select({ actorId: orderGroupEvents.actorId })
        .from(orderGroupEvents)
        .where(
          and(eq(orderGroupEvents.groupId, party.tarta.id), eq(orderGroupEvents.kind, "fired")),
        ),
    );
    expect(event).toEqual({ actorId: venue.operatorId });
  });

  it("answers a repeat with the first answer and writes nothing; a new id on the fired group is 409 group.not_held", async () => {
    const party = await withGroups();
    const body = { submissionId: randomUUID(), expectedPartyRevision: party.revision + 1 };
    const path = `/api/parties/${party.partyId}/groups/${party.tarta.id}/fire`;
    const first = await call("POST", path, body);
    const before = await snapshot(party);

    const again = await call("POST", path, body);
    const refired = await call("POST", path, {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
    });

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(refired.status).toBe(409);
    expect(refired.json).toEqual(refusal("group.not_held", { groupId: party.tarta.id }));
    expect(await snapshot(party)).toEqual(before);
  });

  it("refuses 409 submission.id_reused for an id first used on another group, and 409 party.out_of_date for a stale revision", async () => {
    const party = await withGroups();
    const submissionId = randomUUID();
    await call("POST", `/api/parties/${party.partyId}/groups/${party.tarta.id}/fire`, {
      submissionId,
      expectedPartyRevision: await revisionOf(party.partyId),
    });
    const before = await snapshot(party);

    const reused = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${party.croquetas.id}/fire`,
      { submissionId, expectedPartyRevision: await revisionOf(party.partyId) },
    );
    const stale = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${party.croquetas.id}/fire`,
      { submissionId: randomUUID(), expectedPartyRevision: party.revision },
    );

    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("party.out_of_date", {
        partyId: party.partyId,
        revision: await revisionOf(party.partyId),
      }),
    );
    expect(await snapshot(party)).toEqual(before);
  });

  it("refuses 404 group.not_found for an unknown group and for an id that is not one", async () => {
    const party = await withGroups();
    const before = await snapshot(party);

    for (const groupId of [randomUUID(), "not-a-uuid"]) {
      const refused = await call("POST", `/api/parties/${party.partyId}/groups/${groupId}/fire`, {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(party.partyId),
      });

      expect(refused.status).toBe(404);
      expect(refused.json).toEqual(refusal("group.not_found", { groupId }));
    }
    expect(await snapshot(party)).toEqual(before);
  });

  it("refuses 409 party.not_open for a party that does not exist", async () => {
    const partyId = randomUUID();

    const refused = await call("POST", `/api/parties/${partyId}/groups/${randomUUID()}/fire`, {
      submissionId: randomUUID(),
      expectedPartyRevision: 0,
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(refusal("party.not_open", { partyId }));
  });

  it.each([
    ["body", null],
    ["submissionId", { expectedPartyRevision: 0 }],
    ["expectedPartyRevision", { submissionId: "s" }],
    ["expectedPartyRevision", { submissionId: "s", expectedPartyRevision: -1 }],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const party = await withGroups();
    const before = await snapshot(party);

    const refused = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${party.tarta.id}/fire`,
      body,
    );

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(party)).toEqual(before);
  });
});

describe("PUT /api/parties/:id/groups/order", () => {
  it("puts the held groups in the order sent and answers the party's revision", async () => {
    const party = await withGroups();
    const revision = await revisionOf(party.partyId);

    const reordered = await call("PUT", `/api/parties/${party.partyId}/groups/order`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revision,
      heldGroupIds: [party.croquetas.id, party.tarta.id],
    });

    expect(reordered.status).toBe(200);
    expect(reordered.json).toEqual({ revision: revision + 1 });
    const listed = await call("GET", `/api/parties/${party.partyId}/groups`);
    expect(
      (listed.json.groups as { id: string; position: number }[]).map((g) => [g.id, g.position]),
    ).toEqual([
      [party.fired.id, 1],
      [party.croquetas.id, 2],
      [party.tarta.id, 3],
    ]);
  });

  it("answers a repeat with the first answer and writes nothing, and refuses the id with another order 409 submission.id_reused", async () => {
    const party = await withGroups();
    const submissionId = randomUUID();
    const path = `/api/parties/${party.partyId}/groups/order`;
    const body = {
      submissionId,
      expectedPartyRevision: await revisionOf(party.partyId),
      heldGroupIds: [party.croquetas.id, party.tarta.id],
    };
    const first = await call("PUT", path, body);
    const before = await snapshot(party);

    const again = await call("PUT", path, body);
    const reused = await call("PUT", path, {
      ...body,
      heldGroupIds: [party.tarta.id, party.croquetas.id],
    });

    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(await snapshot(party)).toEqual(before);
  });

  it("refuses a stale revision 409 party.out_of_date, a fired group 409 group.not_held and an unknown one 404 group.not_found", async () => {
    const party = await withGroups();
    const before = await snapshot(party);
    const path = `/api/parties/${party.partyId}/groups/order`;
    const current = await revisionOf(party.partyId);
    const missing = randomUUID();

    const stale = await call("PUT", path, {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
      heldGroupIds: [party.croquetas.id, party.tarta.id],
    });
    const fired = await call("PUT", path, {
      submissionId: randomUUID(),
      expectedPartyRevision: current,
      heldGroupIds: [party.fired.id, party.croquetas.id, party.tarta.id],
    });
    const unknown = await call("PUT", path, {
      submissionId: randomUUID(),
      expectedPartyRevision: current,
      heldGroupIds: [missing, party.croquetas.id, party.tarta.id],
    });

    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("party.out_of_date", { partyId: party.partyId, revision: current }),
    );
    expect(fired.status).toBe(409);
    expect(fired.json).toEqual(refusal("group.not_held", { groupId: party.fired.id }));
    expect(unknown.status).toBe(404);
    expect(unknown.json).toEqual(refusal("group.not_found", { groupId: missing }));
    expect(await snapshot(party)).toEqual(before);
  });

  it.each([
    ["body", null],
    ["submissionId", { expectedPartyRevision: 0, heldGroupIds: [] }],
    ["expectedPartyRevision", { submissionId: "s", heldGroupIds: [] }],
    ["heldGroupIds", { submissionId: "s", expectedPartyRevision: 0 }],
    ["heldGroupIds", { submissionId: "s", expectedPartyRevision: 0, heldGroupIds: [1] }],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const party = await withGroups();
    const before = await snapshot(party);

    const refused = await call("PUT", `/api/parties/${party.partyId}/groups/order`, body);

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(party)).toEqual(before);
  });
});

describe("the order and move routes on a party that does not exist", () => {
  it.each([
    ["PUT", "order", { heldGroupIds: [] }],
    ["POST", "move", { moves: [{ lineId: randomUUID(), quantity: "1" }], target: "new" }],
  ] as const)(
    "refuse %s …/groups/%s 409 party.not_open, for an unknown id and for an id that is not one",
    async (method, suffix, body) => {
      for (const partyId of [randomUUID(), "not-a-uuid"]) {
        const refused = await call(method, `/api/parties/${partyId}/groups/${suffix}`, {
          submissionId: randomUUID(),
          expectedPartyRevision: 0,
          ...body,
        });

        expect(refused.status).toBe(409);
        expect(refused.json).toEqual(refusal("party.not_open", { partyId }));
      }
    },
  );
});

describe("POST /api/parties/:id/groups/move", () => {
  it("moves a line into another held group, or into a new one, and answers the party's revision", async () => {
    const party = await withGroups();
    const revision = await revisionOf(party.partyId);
    const [tartaLine] = party.tarta.lineIds;

    const moved = await call("POST", `/api/parties/${party.partyId}/groups/move`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revision,
      moves: [{ lineId: tartaLine, quantity: "1" }],
      target: { groupId: party.croquetas.id },
    });
    const [croquetasLine] = party.croquetas.lineIds;
    const toNew = await call("POST", `/api/parties/${party.partyId}/groups/move`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revision + 1,
      moves: [{ lineId: croquetasLine, quantity: "1" }],
      target: "new",
    });

    expect(moved.status).toBe(200);
    expect(moved.json).toEqual({ revision: revision + 1 });
    expect(toNew.status).toBe(200);
    expect(toNew.json).toEqual({ revision: revision + 2 });
    const listed = (await call("GET", `/api/parties/${party.partyId}/groups`)).json as {
      groups: { id: string; lineIds: string[] }[];
    };
    expect(listed.groups.map((group) => group.lineIds)).toEqual([
      party.fired.lineIds,
      [tartaLine],
      [croquetasLine],
    ]);
    expect(listed.groups[1]!.id).toBe(party.croquetas.id);
  });

  it("answers a repeat with the first answer and writes nothing, and refuses the id with another target 409 submission.id_reused", async () => {
    const party = await withGroups();
    const submissionId = randomUUID();
    const path = `/api/parties/${party.partyId}/groups/move`;
    const body = {
      submissionId,
      expectedPartyRevision: await revisionOf(party.partyId),
      moves: [{ lineId: party.tarta.lineIds[0], quantity: "1" }],
      target: { groupId: party.croquetas.id },
    };
    const first = await call("POST", path, body);
    const before = await snapshot(party);

    const again = await call("POST", path, body);
    const reused = await call("POST", path, { ...body, target: "new" });

    expect(first.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(await snapshot(party)).toEqual(before);
  });

  it("refuses a stale revision 409 party.out_of_date, a fired target 409 group.not_held and an unknown line 404 group.not_found", async () => {
    const party = await withGroups();
    const before = await snapshot(party);
    const path = `/api/parties/${party.partyId}/groups/move`;
    const current = await revisionOf(party.partyId);
    const moves = [{ lineId: party.tarta.lineIds[0], quantity: "1" }];
    const missing = randomUUID();

    const stale = await call("POST", path, {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
      moves,
      target: "new",
    });
    const toFired = await call("POST", path, {
      submissionId: randomUUID(),
      expectedPartyRevision: current,
      moves,
      target: { groupId: party.fired.id },
    });
    const unknownLine = await call("POST", path, {
      submissionId: randomUUID(),
      expectedPartyRevision: current,
      moves: [{ lineId: missing, quantity: "1" }],
      target: "new",
    });

    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("party.out_of_date", { partyId: party.partyId, revision: current }),
    );
    expect(toFired.status).toBe(409);
    expect(toFired.json).toEqual(refusal("group.not_held", { groupId: party.fired.id }));
    expect(unknownLine.status).toBe(404);
    expect(unknownLine.json).toEqual(refusal("group.not_found", { lineId: missing }));
    expect(await snapshot(party)).toEqual(before);
  });

  it.each([
    ["body", null],
    ["submissionId", { expectedPartyRevision: 0, moves: [], target: "new" }],
    ["expectedPartyRevision", { submissionId: "s", moves: [], target: "new" }],
    ["moves", { submissionId: "s", expectedPartyRevision: 0, target: "new" }],
    ["moves", { submissionId: "s", expectedPartyRevision: 0, moves: [7], target: "new" }],
    [
      "moves",
      { submissionId: "s", expectedPartyRevision: 0, moves: [{ lineId: "x" }], target: "new" },
    ],
    [
      "moves",
      {
        submissionId: "s",
        expectedPartyRevision: 0,
        moves: [{ lineId: 1, quantity: "1" }],
        target: "new",
      },
    ],
    ["target", { submissionId: "s", expectedPartyRevision: 0, moves: [] }],
    ["target", { submissionId: "s", expectedPartyRevision: 0, moves: [], target: "old" }],
    ["target", { submissionId: "s", expectedPartyRevision: 0, moves: [], target: { groupId: 2 } }],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const party = await withGroups();
    const before = await snapshot(party);

    const refused = await call("POST", `/api/parties/${party.partyId}/groups/move`, body);

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(party)).toEqual(before);
  });
});

describe("GET /api/parties/:id/groups", () => {
  it("answers the party's revision and its groups in sequence", async () => {
    const party = await withGroups();

    const listed = await call("GET", `/api/parties/${party.partyId}/groups`);

    expect(listed.status).toBe(200);
    const lines = await dishLines(party.tabId);
    expect(listed.json).toEqual({
      revision: await revisionOf(party.partyId),
      groups: [
        {
          id: party.fired.id,
          position: 1,
          state: "fired",
          firedAt: expect.any(String),
          remindAt: null,
          lineIds: [lines[0]!.id],
          summary: "1 × Caña",
        },
        {
          id: party.tarta.id,
          position: 2,
          state: "held",
          firedAt: null,
          remindAt: null,
          lineIds: [lines[1]!.id],
          summary: "1 × Tarta",
        },
        {
          id: party.croquetas.id,
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

  it("refuses 409 party.not_open for a party that does not exist, and for an id that is not one", async () => {
    for (const partyId of [randomUUID(), "not-a-uuid"]) {
      const refused = await call("GET", `/api/parties/${partyId}/groups`);

      expect(refused.status).toBe(409);
      expect(refused.json).toEqual(refusal("party.not_open", { partyId }));
    }
  });
});

describe("GET /api/working-orders/:id/lines", () => {
  it("names the group each line belongs to, and none on a bill with no party", async () => {
    const party = await withGroups();
    const counter = await tabWith(venue, "Paella");

    const tab = await call("GET", `/api/working-orders/${party.tabId}/lines`);
    const noParty = await call("GET", `/api/working-orders/${counter}/lines`);

    expect(tab.status).toBe(200);
    expect(
      (tab.json.lines as { lineNo: number; groupId: string | null }[]).map(
        ({ lineNo, groupId }) => ({ lineNo, groupId }),
      ),
    ).toEqual([
      { lineNo: 1, groupId: party.fired.id },
      { lineNo: 2, groupId: party.tarta.id },
      { lineNo: 3, groupId: party.croquetas.id },
    ]);
    expect(
      (noParty.json.lines as { lineNo: number; groupId: string | null }[]).map(
        ({ lineNo, groupId }) => ({ lineNo, groupId }),
      ),
    ).toEqual([{ lineNo: 1, groupId: null }]);
  });

  it("names each line by the id its group's lineIds and a move speak", async () => {
    const party = await withGroups();

    const tab = await call("GET", `/api/working-orders/${party.tabId}/lines`);

    expect(
      (tab.json.lines as { lineNo: number; id: string }[]).map(({ lineNo, id }) => ({
        lineNo,
        id,
      })),
    ).toEqual([
      { lineNo: 1, id: party.fired.lineIds[0] },
      { lineNo: 2, id: party.tarta.lineIds[0] },
      { lineNo: 3, id: party.croquetas.lineIds[0] },
    ]);
  });
});

describe("the tab routes that release lines, on a party with groups", () => {
  it("refuses 409 group.line_held for a held line sent on its own, writing nothing", async () => {
    const party = await withGroups();
    const lineNo = (
      (await call("GET", `/api/working-orders/${party.tabId}/lines`)).json.lines as {
        lineNo: number;
        groupId: string | null;
      }[]
    ).find((line) => line.groupId === party.croquetas.id)!.lineNo;
    const before = await snapshot(party);

    const refused = await call("POST", `/api/working-orders/${party.tabId}/lines/send`, {
      lineNos: [lineNo],
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(refusal("group.line_held", { tabId: party.tabId, lineNo }));
    expect(await snapshot(party)).toEqual(before);
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
      const party = await withGroups();
      const revision = await revisionOf(party.partyId);

      const fired = await call("POST", `/api/orders/${party.tabId}/courses/${courseId}/fire`);

      expect(fired.status).toBe(200);
      expect(await revisionOf(party.partyId)).toBe(revision + 1);
      const listed = (await call("GET", `/api/parties/${party.partyId}/groups`)).json as {
        groups: { id: string; state: string }[];
      };
      expect(listed.groups.map((group) => [group.id, group.state])).toEqual([
        [party.fired.id, "fired"],
        [party.tarta.id, "fired"],
        [party.croquetas.id, "held"],
      ]);
      const [event] = await inTx(venue, (tx) =>
        tx
          .select({ actorId: orderGroupEvents.actorId, detail: orderGroupEvents.detail })
          .from(orderGroupEvents)
          .where(
            and(eq(orderGroupEvents.groupId, party.tarta.id), eq(orderGroupEvents.kind, "fired")),
          ),
      );
      expect(event).toEqual({
        actorId: venue.operatorId,
        detail: { courseId, workingOrderId: party.tabId },
      });
    } finally {
      // The venue is shared by the whole file.
      await inTx(venue, async (tx) => {
        await setProductCourse(tx, venue.cfg, tarta!.id, tarta!.courseId);
        await removeCourse(tx, venue.cfg, courseId);
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

  it("removes the held group a void empties, naming the operator, and moves the party on", async () => {
    const party = await withGroups();
    const lineNo = (await tabLines(party.tabId)).lines.find(
      (line) => line.groupId === party.croquetas.id,
    )!.lineNo;
    const revision = await revisionOf(party.partyId);

    const voided = await call(
      "POST",
      `/api/working-orders/${party.tabId}/adjustments`,
      await cancelBody(venue.db, party.tabId, lineNo),
    );

    expect(voided.status).toBe(200);
    expect(await eventsOfGroup(party.croquetas.id)).toEqual([
      { kind: "submitted", actorId: venue.operatorId },
      { kind: "removed", actorId: venue.operatorId },
    ]);
    expect(await revisionOf(party.partyId)).toBe(revision + 1);
  });

  it("puts a fired line's raised quantity in a new fired group credited to the operator", async () => {
    const party = await withGroups();
    const tab = await tabLines(party.tabId);
    const cana = tab.lines.find((line) => line.groupId === party.fired.id)!;

    const changed = await call("PUT", `/api/working-orders/${party.tabId}/lines/${cana.lineNo}`, {
      quantity: "2",
      revision: tab.revision,
    });

    expect(changed.status).toBe(200);
    const added = (await dishLines(party.tabId)).at(-1)!;
    expect(added).toMatchObject({ name: "Caña", creditedTo: venue.operatorId });
    expect(added.groupId).not.toBe(party.fired.id);
    expect(await eventsOfGroup(added.groupId!)).toEqual([
      { kind: "submitted", actorId: venue.operatorId },
    ]);
  });

  it("credits a dish a whole-order save adds to the operator, never to one the body names", async () => {
    const party = await withGroups();
    const tab = await tabLines(party.tabId);
    const kept = (await dishLines(party.tabId)).map((line) => ({
      workingOrderLineId: line.id,
      menuItemId: venue.offerFor(line.name),
      quantity: "1",
    }));

    const saved = await call("PUT", `/api/working-orders/${party.tabId}`, {
      lines: [...kept, dish("Pulpo")],
      revision: tab.revision,
      operatorId: venue.adminId,
    });

    expect(saved.status).toBe(200);
    expect((await dishLines(party.tabId)).at(-1)).toMatchObject({
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

/** What a bill-level write would move: the bill's revision, and the card payment's mark on it. */
async function billOf(tabId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({
        revision: workingOrders.revision,
        paymentAttemptAt: workingOrders.paymentAttemptAt,
      })
      .from(workingOrders)
      .where(eq(workingOrders.id, tabId)),
  );
  return row!;
}

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

describe("POST /api/parties/:id/served, /unserved and /groups/:gid/served", () => {
  it("serves a line, takes it back, then serves its group, answering the party's revision each time", async () => {
    const party = await withGroups();
    const lineId = party.fired.lineIds[0]!;
    const revision = await revisionOf(party.partyId);
    const items = [{ lineId, quantity: "1" }];

    const served = await call("POST", `/api/parties/${party.partyId}/served`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revision,
      items,
    });
    expect(served.status).toBe(200);
    expect(served.json).toEqual({ revision: revision + 1 });
    expect(await servedOf(lineId)).toEqual({ servedQuantity: 1000, servedAt: expect.any(String) });

    const unserved = await call("POST", `/api/parties/${party.partyId}/unserved`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revision + 1,
      items,
    });
    expect(unserved.status).toBe(200);
    expect(unserved.json).toEqual({ revision: revision + 2 });
    expect(await servedOf(lineId)).toEqual({ servedQuantity: 0, servedAt: null });

    const whole = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${party.fired.id}/served`,
      { submissionId: randomUUID(), expectedPartyRevision: revision + 2 },
    );
    expect(whole.status).toBe(200);
    expect(whole.json).toEqual({ revision: revision + 3 });
    expect(await servedOf(lineId)).toEqual({ servedQuantity: 1000, servedAt: expect.any(String) });
  });

  it("answers a repeat with the first answer and writes nothing, even at a revision since moved on", async () => {
    const party = await withGroups();
    const lineId = party.fired.lineIds[0]!;
    const body = {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
      items: [{ lineId, quantity: "1" }],
    };
    const first = await call("POST", `/api/parties/${party.partyId}/served`, body);
    const before = { ...(await snapshot(party)), served: await servedOf(lineId) };

    const again = await call("POST", `/api/parties/${party.partyId}/served`, body);

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect({ ...(await snapshot(party)), served: await servedOf(lineId) }).toEqual(before);
  });

  it("answers each refusal with its status, writing nothing", async () => {
    const party = await withGroups();
    const lineId = party.fired.lineIds[0]!;
    const held = party.tarta.lineIds[0]!;
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
    await call("POST", `/api/parties/${party.partyId}/served`, {
      submissionId: used,
      expectedPartyRevision: await revisionOf(party.partyId),
      items: [{ lineId, quantity: "1" }],
    });
    const before = { ...(await snapshot(party)), served: await servedOf(lineId) };
    const revision = await revisionOf(party.partyId);
    const at = (extra: Record<string, unknown>) => ({
      submissionId: randomUUID(),
      expectedPartyRevision: revision,
      ...extra,
    });
    const base = `/api/parties/${party.partyId}`;

    const cases: [string, unknown, number, unknown][] = [
      [
        `${base}/served`,
        at({ items: [{ lineId, quantity: "1" }] }),
        400,
        refusal("tab.serve_quantity_invalid", {
          tabId: party.tabId,
          lineNo: canaLine!.lineNo,
          quantity: "1",
        }),
      ],
      [
        `${base}/unserved`,
        at({ items: [{ lineId, quantity: "2" }] }),
        400,
        refusal("tab.serve_quantity_invalid", {
          tabId: party.tabId,
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
        `${base}/groups/${party.tarta.id}/served`,
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
        { submissionId: randomUUID(), expectedPartyRevision: revision - 1, items: [] },
        409,
        refusal("party.out_of_date", { partyId: party.partyId, revision }),
      ],
      [
        `${base}/unserved`,
        { submissionId: used, expectedPartyRevision: revision, items: [{ lineId, quantity: "1" }] },
        409,
        refusal("submission.id_reused", { submissionId: used }),
      ],
      [
        `${base}/served`,
        { expectedPartyRevision: revision, items: [] },
        400,
        refusal("management.request_invalid", { field: "submissionId" }),
      ],
      [
        `${base}/groups/${party.fired.id}/served`,
        { submissionId: randomUUID() },
        400,
        refusal("management.request_invalid", { field: "expectedPartyRevision" }),
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
    expect({ ...(await snapshot(party)), served: await servedOf(lineId) }).toEqual(before);
  });
});

describe("POST /api/parties/:id/served refusals that need their own setup", () => {
  it("refuses 409 group.line_held for a held line outside any group that needs no kitchen", async () => {
    const party = await seated();
    const [pulpo] = await inTx(venue, (tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.name, "Pulpo")),
    );
    const pulpoCell = { row: { kind: "product" as const, productId: pulpo!.id }, zoneId: null };
    await inTx(venue, (tx) => setRoutingCell(tx, venue.cfg, pulpoCell, { kind: "no_preparation" }));
    try {
      await inTx(venue, (tx) =>
        addTabRound(tx, venue.cfg, party.tabId, [{ ...dish("Pulpo"), hold: true }]),
      );
    } finally {
      await inTx(venue, (tx) => clearRoutingCell(tx, venue.cfg, pulpoCell));
    }
    const [line] = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    const beforeServe = await snapshot(party);

    const refused = await call("POST", `/api/parties/${party.partyId}/served`, {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
      items: [{ lineId: line!.id, quantity: "1" }],
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(
      refusal("group.line_held", { tabId: party.tabId, lineNo: line!.lineNo }),
    );
    expect(await snapshot(party)).toEqual(beforeServe);
  });

  it("refuses 404 group.not_found for another party's group", async () => {
    const party = await withGroups();
    const other = await withGroups();
    const before = await snapshot(party);

    const refused = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${other.fired.id}/served`,
      { submissionId: randomUUID(), expectedPartyRevision: await revisionOf(party.partyId) },
    );

    expect(refused.status).toBe(404);
    expect(refused.json).toEqual(refusal("group.not_found", { groupId: other.fired.id }));
    expect(await snapshot(party)).toEqual(before);
  });
});

describe("the served routes while a card payment runs on the bill", () => {
  it("takes each served route while a card payment runs on the bill, moving the party's revision and never the bill's", async () => {
    const party = await seated();
    const submitted = await submit(party.partyId, [
      { lines: [dish("Caña", "2")], release: "fire" },
    ]);
    const fired = (submitted.json as unknown as SubmitAnswer).groups[0]!;
    const lineId = fired.lineIds[0]!;
    // Taken before the setup serve, so a stray write every served mark makes alike still shows.
    const before = await snapshot(party);
    // One of the two served, so a serve, an undo and the group's serve are each valid.
    await call("POST", `/api/parties/${party.partyId}/served`, {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
      items: [{ lineId, quantity: "1" }],
    });
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ paymentAttemptAt: new Date().toISOString() })
        .where(eq(workingOrders.id, party.tabId)),
    );
    try {
      const bill = await billOf(party.tabId);
      const base = `/api/parties/${party.partyId}`;
      for (const [path, extra, servedAfter] of [
        [`${base}/served`, { items: [{ lineId, quantity: "1" }] }, true],
        [`${base}/unserved`, { items: [{ lineId, quantity: "1" }] }, false],
        [`${base}/groups/${fired.id}/served`, {}, true],
      ] as const) {
        const revision = await revisionOf(party.partyId);
        const taken = await call("POST", path, {
          submissionId: randomUUID(),
          expectedPartyRevision: revision,
          ...extra,
        });
        expect([path, taken.status, taken.json]).toEqual([path, 200, { revision: revision + 1 }]);
        expect([path, (await servedOf(lineId)).servedAt !== null]).toEqual([path, servedAfter]);
      }
      expect(await billOf(party.tabId)).toEqual(bill);
      // The setup serve and the three routes each record a command and bump the party, whose
      // revision the groups answer carries.
      expect({ ...(await snapshot(party)), served: await servedOf(lineId) }).toEqual({
        ...before,
        revision: before.revision + 4,
        commands: before.commands + 4,
        groups: { ...before.groups, revision: before.revision + 4 },
        served: { servedQuantity: 2000, servedAt: expect.any(String) },
      });
    } finally {
      await inTx(venue, (tx) =>
        tx
          .update(workingOrders)
          .set({ paymentAttemptAt: null })
          .where(eq(workingOrders.id, party.tabId)),
      );
    }
  });

  it("takes a served mark while a card is at the reader for the bill, and the card then completes on it", async () => {
    const party = await seated();
    const submitted = await submit(party.partyId, [
      { lines: [dish("Caña", "2")], release: "fire" },
    ]);
    const fired = (submitted.json as unknown as SubmitAnswer).groups[0]!;
    const release = venue.card.holdNextCollect();
    const calls = venue.card.collectCalls.length;
    const paying = call("POST", `/api/working-orders/${party.tabId}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "3.00",
      method: "card",
      entry: "reader",
      applied: "3.00",
      tip: "0.00",
    });
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));

    const served = await call("POST", `/api/parties/${party.partyId}/groups/${fired.id}/served`, {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
    });
    release();
    const paid = await paying;

    expect(served.status).toBe(200);
    expect((await servedOf(fired.lineIds[0]!)).servedAt).not.toBeNull();
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({
      outcome: "received",
      payment: { state: "received", applied: "3.00" },
      balance: { received: "3.00", reserved: "0.00", outstanding: "3.00" },
    });
  });
});

describe("the group routes without a session", () => {
  it("refuse every route 401 session.required, writing nothing", async () => {
    const party = await withGroups();
    const before = await snapshot(party);
    const body = {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
    };
    const base = `/api/parties/${party.partyId}/groups`;

    const answers = [
      await send(venue.app, "", "GET", base),
      await send(venue.app, "", "POST", base, {
        ...body,
        groups: [{ lines: [dish("Pulpo")], release: "hold" }],
      }),
      await send(venue.app, "", "POST", `${base}/${party.tarta.id}/fire`, body),
      await send(venue.app, "", "PUT", `${base}/order`, {
        ...body,
        heldGroupIds: [party.croquetas.id, party.tarta.id],
      }),
      await send(venue.app, "", "POST", `${base}/move`, {
        ...body,
        moves: [{ lineId: party.tarta.lineIds[0], quantity: "1" }],
        target: "new",
      }),
    ];

    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(answer.json).toMatchObject({ code: "session.required" });
    }
    expect(await snapshot(party)).toEqual(before);
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

async function passSnapshot(party: { partyId: string; tabId: string }, groupId: string) {
  return { ...(await snapshot(party)), tickets: await groupTickets(groupId) };
}

describe.each(["ready", "away"] as const)("POST /api/parties/:id/groups/:gid/%s", (step) => {
  const path = (partyId: string, groupId: string) =>
    `/api/parties/${partyId}/groups/${groupId}/${step}`;

  it("answers a repeat with the first answer and writes nothing", async () => {
    const party = await withGroups();
    const body = { submissionId: randomUUID(), expectedPartyRevision: party.revision + 1 };
    const first = await call("POST", path(party.partyId, party.fired.id), body);
    const before = await passSnapshot(party, party.fired.id);

    const again = await call("POST", path(party.partyId, party.fired.id), body);

    expect(first.status).toBe(200);
    expect(first.json).toEqual({ revision: party.revision + 2 });
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await passSnapshot(party, party.fired.id)).toEqual(before);
  });

  it("refuses 409 submission.id_reused for an id first used on another group, and 409 party.out_of_date for a stale revision", async () => {
    const party = await withGroups();
    const submissionId = randomUUID();
    await call("POST", path(party.partyId, party.fired.id), {
      submissionId,
      expectedPartyRevision: await revisionOf(party.partyId),
    });
    const before = await passSnapshot(party, party.fired.id);

    const reused = await call("POST", path(party.partyId, party.tarta.id), {
      submissionId,
      expectedPartyRevision: await revisionOf(party.partyId),
    });
    const stale = await call("POST", path(party.partyId, party.fired.id), {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
    });

    expect(reused.status).toBe(409);
    expect(reused.json).toEqual(refusal("submission.id_reused", { submissionId }));
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual(
      refusal("party.out_of_date", {
        partyId: party.partyId,
        revision: await revisionOf(party.partyId),
      }),
    );
    expect(await passSnapshot(party, party.fired.id)).toEqual(before);
  });

  it("refuses 404 group.not_found for an unknown group and for an id that is not one", async () => {
    const party = await withGroups();
    const before = await snapshot(party);

    for (const groupId of [randomUUID(), "not-a-uuid"]) {
      const refused = await call("POST", path(party.partyId, groupId), {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(party.partyId),
      });

      expect(refused.status).toBe(404);
      expect(refused.json).toEqual(refusal("group.not_found", { groupId }));
    }
    expect(await snapshot(party)).toEqual(before);
  });

  it("refuses 409 party.not_open for a party that does not exist", async () => {
    const partyId = randomUUID();

    const refused = await call("POST", path(partyId, randomUUID()), {
      submissionId: randomUUID(),
      expectedPartyRevision: 0,
    });

    expect(refused.status).toBe(409);
    expect(refused.json).toEqual(refusal("party.not_open", { partyId }));
  });

  it.each([
    ["body", null],
    ["submissionId", { expectedPartyRevision: 0 }],
    ["expectedPartyRevision", { submissionId: "s" }],
  ] as const)("refuses 400 management.request_invalid naming %s for %j", async (field, body) => {
    const party = await withGroups();
    const before = await snapshot(party);

    const refused = await call("POST", path(party.partyId, party.fired.id), body);

    expect(refused.status).toBe(400);
    expect(refused.json).toEqual(refusal("management.request_invalid", { field }));
    expect(await snapshot(party)).toEqual(before);
  });

  it("refuses 401 session.required without a session, writing nothing", async () => {
    const party = await withGroups();
    const before = await passSnapshot(party, party.fired.id);

    const refused = await send(venue.app, "", "POST", path(party.partyId, party.fired.id), {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
    });

    expect(refused.status).toBe(401);
    expect(refused.json).toMatchObject({ code: "session.required" });
    expect(await passSnapshot(party, party.fired.id)).toEqual(before);
  });
});

describe("the pass routes, one after the other", () => {
  it("bumps the fired Caña ready, then sends it away, each answering the party's revision", async () => {
    const party = await withGroups();
    const before = await groupTickets(party.fired.id);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((item) => item.state === "queued" && item.firedAt !== null)).toBe(true);

    const readied = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${party.fired.id}/ready`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision + 1,
      },
    );

    expect(readied.status).toBe(200);
    expect(readied.json).toEqual({ revision: party.revision + 2 });
    expect((await groupTickets(party.fired.id)).map((item) => [item.state, item.awayAt])).toEqual(
      before.map(() => ["ready", null]),
    );
    const listed = (await call("GET", `/api/parties/${party.partyId}/groups`)).json as unknown as {
      groups: { id: string; ready?: boolean }[];
    };
    expect(listed.groups.map((group) => group.ready ?? false)).toEqual([true, false, false]);

    const sent = await call("POST", `/api/parties/${party.partyId}/groups/${party.fired.id}/away`, {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision + 2,
    });

    expect(sent.status).toBe(200);
    expect(sent.json).toEqual({ revision: party.revision + 3 });
    expect((await groupTickets(party.fired.id)).every((item) => item.awayAt !== null)).toBe(true);
  });
});

/** The held or fired groups' reminders, as the groups read shows them. */
async function remindAts(partyId: string) {
  const listed = (await call("GET", `/api/parties/${partyId}/groups`)).json as unknown as {
    groups: { id: string; remindAt: string | null }[];
  };
  return Object.fromEntries(listed.groups.map((group) => [group.id, group.remindAt]));
}

describe("POST /api/parties/:id/groups/:gid/snooze and GET /api/parties/:id/current-orders", () => {
  it("snoozes the group waiting by whole minutes, answering the party's revision, and Current orders shows the reminder once the work ahead is served", async () => {
    const party = await withGroups();
    const revision = await revisionOf(party.partyId);
    const from = Date.now();

    const snoozed = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${party.tarta.id}/snooze`,
      { submissionId: randomUUID(), expectedPartyRevision: revision, minutes: 5 },
    );

    expect(snoozed.status).toBe(200);
    expect(snoozed.json).toEqual({ revision: revision + 1 });
    const remindAt = (await remindAts(party.partyId))[party.tarta.id]!;
    const ahead = Date.parse(remindAt) - from;
    expect(ahead).toBeGreaterThanOrEqual(5 * 60_000);
    expect(ahead).toBeLessThanOrEqual(5 * 60_000 + (Date.now() - from));

    const waiting = await call("GET", `/api/parties/${party.partyId}/current-orders`);
    expect(waiting.status).toBe(200);
    expect(waiting.json).toMatchObject({
      revision: revision + 1,
      reminder: { groupId: party.tarta.id, dueAt: null },
      groups: [
        { id: party.fired.id, state: "fired", sentAt: expect.any(String), sentBy: "Ana" },
        { id: party.tarta.id, state: "held", remindAt, sentAt: expect.any(String), sentBy: "Ana" },
        {
          id: party.croquetas.id,
          state: "held",
          remindAt: null,
          sentAt: expect.any(String),
          sentBy: "Ana",
        },
      ],
      ungrouped: [],
    });

    const served = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${party.fired.id}/served`,
      { submissionId: randomUUID(), expectedPartyRevision: revision + 1 },
    );
    expect(served.status).toBe(200);
    const due = await call("GET", `/api/parties/${party.partyId}/current-orders`);
    expect(due.json).toMatchObject({
      revision: revision + 2,
      reminder: { groupId: party.tarta.id, dueAt: remindAt },
    });
  });

  it("answers each snooze refusal with its status, writing nothing", async () => {
    const party = await withGroups();
    const used = randomUUID();
    await call("POST", `/api/parties/${party.partyId}/groups/${party.tarta.id}/snooze`, {
      submissionId: used,
      expectedPartyRevision: await revisionOf(party.partyId),
      minutes: 5,
    });
    const before = { ...(await snapshot(party)), remindAts: await remindAts(party.partyId) };
    const revision = await revisionOf(party.partyId);
    const at = (extra: Record<string, unknown>) => ({
      submissionId: randomUUID(),
      expectedPartyRevision: revision,
      ...extra,
    });
    const base = `/api/parties/${party.partyId}/groups`;
    const tarta = `${base}/${party.tarta.id}/snooze`;
    const unknown = randomUUID();
    const minutesInvalid = refusal("management.request_invalid", { field: "minutes" });

    const cases: [string, unknown, number, unknown][] = [
      [
        `${base}/not-a-uuid/snooze`,
        at({ minutes: 5 }),
        404,
        refusal("group.not_found", { groupId: "not-a-uuid" }),
      ],
      [
        `${base}/${unknown}/snooze`,
        at({ minutes: 5 }),
        404,
        refusal("group.not_found", { groupId: unknown }),
      ],
      [
        `${base}/${party.fired.id}/snooze`,
        at({ minutes: 5 }),
        409,
        refusal("group.not_held", { groupId: party.fired.id }),
      ],
      [
        `${base}/${party.croquetas.id}/snooze`,
        at({ minutes: 5 }),
        409,
        refusal("group.not_waiting", { groupId: party.croquetas.id }),
      ],
      [tarta, at({ minutes: 0 }), 400, minutesInvalid],
      [tarta, at({ minutes: 121 }), 400, minutesInvalid],
      [tarta, at({ minutes: 2.5 }), 400, minutesInvalid],
      [tarta, at({ minutes: "5" }), 400, minutesInvalid],
      [tarta, at({ minutes: null }), 400, minutesInvalid],
      [tarta, at({}), 400, minutesInvalid],
      [
        tarta,
        { submissionId: randomUUID(), expectedPartyRevision: revision - 1, minutes: 5 },
        409,
        refusal("party.out_of_date", { partyId: party.partyId, revision }),
      ],
      [
        tarta,
        { submissionId: used, expectedPartyRevision: revision, minutes: 10 },
        409,
        refusal("submission.id_reused", { submissionId: used }),
      ],
      [
        tarta,
        { expectedPartyRevision: revision, minutes: 5 },
        400,
        refusal("management.request_invalid", { field: "submissionId" }),
      ],
      [
        tarta,
        { submissionId: randomUUID(), minutes: 5 },
        400,
        refusal("management.request_invalid", { field: "expectedPartyRevision" }),
      ],
      [
        `/api/parties/not-a-party/groups/${party.tarta.id}/snooze`,
        at({ minutes: 5 }),
        409,
        refusal("party.not_open", { partyId: "not-a-party" }),
      ],
    ];
    for (const [path, body, status, error] of cases) {
      const answer = await call("POST", path, body);
      expect([path, body, answer.status, answer.json]).toEqual([path, body, status, error]);
    }
    expect({ ...(await snapshot(party)), remindAts: await remindAts(party.partyId) }).toEqual(
      before,
    );
  });

  it("refuses 409 party.not_open for Current orders of a party that does not exist, and of an id that is not one", async () => {
    const unknown = randomUUID();

    const absent = await call("GET", `/api/parties/${unknown}/current-orders`);
    const malformed = await call("GET", `/api/parties/not-a-party/current-orders`);

    expect(absent.status).toBe(409);
    expect(absent.json).toEqual(refusal("party.not_open", { partyId: unknown }));
    expect(malformed.status).toBe(409);
    expect(malformed.json).toEqual(refusal("party.not_open", { partyId: "not-a-party" }));
  });

  it("refuses both routes 401 session.required without a session, writing nothing", async () => {
    const party = await withGroups();
    const before = { ...(await snapshot(party)), remindAts: await remindAts(party.partyId) };

    const answers = [
      await send(venue.app, "", "GET", `/api/parties/${party.partyId}/current-orders`),
      await send(
        venue.app,
        "",
        "POST",
        `/api/parties/${party.partyId}/groups/${party.tarta.id}/snooze`,
        {
          submissionId: randomUUID(),
          expectedPartyRevision: await revisionOf(party.partyId),
          minutes: 5,
        },
      ),
    ];

    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(answer.json).toMatchObject({ code: "session.required" });
    }
    expect({ ...(await snapshot(party)), remindAts: await remindAts(party.partyId) }).toEqual(
      before,
    );
  });
});

describe("POST /api/parties/:id/groups/:gid/unsnooze", () => {
  it("clears the waiting group's snooze, answering the party's revision", async () => {
    const party = await withGroups();
    await call("POST", `/api/parties/${party.partyId}/groups/${party.tarta.id}/snooze`, {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
      minutes: 5,
    });
    expect((await remindAts(party.partyId))[party.tarta.id]).not.toBeNull();
    const revision = await revisionOf(party.partyId);

    const cleared = await call(
      "POST",
      `/api/parties/${party.partyId}/groups/${party.tarta.id}/unsnooze`,
      { submissionId: randomUUID(), expectedPartyRevision: revision },
    );

    expect(cleared.status).toBe(200);
    expect(cleared.json).toEqual({ revision: revision + 1 });
    expect((await remindAts(party.partyId))[party.tarta.id]).toBeNull();
  });

  it("answers each unsnooze refusal with its status, writing nothing", async () => {
    const party = await withGroups();
    const used = randomUUID();
    await call("POST", `/api/parties/${party.partyId}/groups/${party.tarta.id}/unsnooze`, {
      submissionId: used,
      expectedPartyRevision: await revisionOf(party.partyId),
    });
    await call("POST", `/api/parties/${party.partyId}/groups/${party.tarta.id}/snooze`, {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(party.partyId),
      minutes: 5,
    });
    const before = { ...(await snapshot(party)), remindAts: await remindAts(party.partyId) };
    const revision = await revisionOf(party.partyId);
    const at = () => ({ submissionId: randomUUID(), expectedPartyRevision: revision });
    const base = `/api/parties/${party.partyId}/groups`;
    const tarta = `${base}/${party.tarta.id}/unsnooze`;
    const unknown = randomUUID();

    const cases: [string, unknown, number, unknown][] = [
      [
        `${base}/not-a-uuid/unsnooze`,
        at(),
        404,
        refusal("group.not_found", { groupId: "not-a-uuid" }),
      ],
      [`${base}/${unknown}/unsnooze`, at(), 404, refusal("group.not_found", { groupId: unknown })],
      [
        `${base}/${party.fired.id}/unsnooze`,
        at(),
        409,
        refusal("group.not_held", { groupId: party.fired.id }),
      ],
      [
        `${base}/${party.croquetas.id}/unsnooze`,
        at(),
        409,
        refusal("group.not_waiting", { groupId: party.croquetas.id }),
      ],
      [
        tarta,
        { submissionId: randomUUID(), expectedPartyRevision: revision - 1 },
        409,
        refusal("party.out_of_date", { partyId: party.partyId, revision }),
      ],
      [
        `${base}/${party.croquetas.id}/unsnooze`,
        { submissionId: used, expectedPartyRevision: revision },
        409,
        refusal("submission.id_reused", { submissionId: used }),
      ],
      [
        tarta,
        { expectedPartyRevision: revision },
        400,
        refusal("management.request_invalid", { field: "submissionId" }),
      ],
      [
        tarta,
        { submissionId: randomUUID() },
        400,
        refusal("management.request_invalid", { field: "expectedPartyRevision" }),
      ],
      [
        `/api/parties/not-a-party/groups/${party.tarta.id}/unsnooze`,
        at(),
        409,
        refusal("party.not_open", { partyId: "not-a-party" }),
      ],
    ];
    for (const [path, body, status, error] of cases) {
      const answer = await call("POST", path, body);
      expect([path, body, answer.status, answer.json]).toEqual([path, body, status, error]);
    }
    expect({ ...(await snapshot(party)), remindAts: await remindAts(party.partyId) }).toEqual(
      before,
    );
  });

  it("refuses 401 session.required without a session, writing nothing", async () => {
    const party = await withGroups();
    const before = { ...(await snapshot(party)), remindAts: await remindAts(party.partyId) };

    const answer = await send(
      venue.app,
      "",
      "POST",
      `/api/parties/${party.partyId}/groups/${party.tarta.id}/unsnooze`,
      { submissionId: randomUUID(), expectedPartyRevision: await revisionOf(party.partyId) },
    );

    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "session.required" });
    expect({ ...(await snapshot(party)), remindAts: await remindAts(party.partyId) }).toEqual(
      before,
    );
  });
});
