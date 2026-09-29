import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { workingOrders } from "@waitron/db";
import { takeBillPayment } from "./bill-payments.js";
import { seatTable } from "./parties.js";
import { createTable } from "./tables.js";
import {
  inTx,
  provisionBillVenue,
  registroCount,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { addTabRound, splitOffCheck } from "./working-order.js";
import "./errors.js";

// The HTTP surface of split, merge and transfer between a party's bills (table actions plan,
// Task 5): the session guard, the id and body screens, the answers and the status of each code.
// The verbs themselves are tested in `party-bill-actions.test.ts`.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

const NOT_A_UUID = "not-a-uuid";

/** A party at a fresh table whose main bill holds one of each dish named, in order. */
async function seated(...names: string[]): Promise<{ partyId: string; tabId: string }> {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `Mesa ${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { partyId, tabId } = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      guestCount: null,
      operatorId: venue.operatorId,
    });
    await addTabRound(
      tx,
      venue.cfg,
      tabId,
      names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    );
    return { partyId, tabId };
  });
}

async function revisionOf(partyId: string): Promise<number> {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

/** A party with a main bill (Paella) and a second bill (Caña) split off it. */
async function twoBills(): Promise<{ partyId: string; main: string; second: string }> {
  const { partyId, tabId } = await seated("Paella", "Caña");
  const expectedPartyRevision = await revisionOf(partyId);
  const { checkId } = await inTx(venue, (tx) =>
    splitOffCheck(tx, venue.cfg, tabId, [{ lineNo: 2 }], {
      expectedPartyRevision,
      operatorId: venue.operatorId,
    }),
  );
  return { partyId, main: tabId, second: checkId };
}

function post(path: string, body: unknown, cookie = venue.cookie) {
  return send(venue.app, cookie, "POST", path, body);
}

const ROUTES = ["split", "merge", "transfer"] as const;
type Route = (typeof ROUTES)[number];

/** A well-formed body for the route, between the two bills. */
function bodyFor(route: Route, other: string, extra: Record<string, unknown> = {}) {
  if (route === "split") return { transfers: [{ lineNo: 1 }], ...extra };
  if (route === "merge") return { fromBillId: other, ...extra };
  return { toBillId: other, transfers: [{ lineNo: 1 }], ...extra };
}

describe("the bill action routes", () => {
  it.each(ROUTES)("%s: 401 without a session", async (route) => {
    const { main, second } = await twoBills();

    const answer = await post(`/api/bills/${main}/${route}`, bodyFor(route, second), "");

    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "session.required" });
  });

  it.each(ROUTES)("%s: a malformed bill id is 409 tab.not_open", async (route) => {
    const { second } = await twoBills();

    const answer = await post(`/api/bills/${NOT_A_UUID}/${route}`, bodyFor(route, second));

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "tab.not_open", params: { tabId: NOT_A_UUID } });
  });

  it.each(["merge", "transfer"] as const)(
    "%s: a malformed other bill id is 409 tab.not_open",
    async (route) => {
      const { partyId, main } = await twoBills();
      const expectedPartyRevision = await revisionOf(partyId);

      const answer = await post(
        `/api/bills/${main}/${route}`,
        bodyFor(route, NOT_A_UUID, { expectedPartyRevision }),
      );

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code: "tab.not_open", params: { tabId: NOT_A_UUID } });
    },
  );

  it.each(ROUTES)(
    "%s: a party's bill sent without its revision is 400 management.request_invalid, changing nothing",
    async (route) => {
      const { partyId, main, second } = await twoBills();
      const revision = await revisionOf(partyId);

      const answer = await post(`/api/bills/${main}/${route}`, bodyFor(route, second));

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "expectedPartyRevision" },
      });
      expect(await revisionOf(partyId)).toBe(revision);
      expect(await statusOf(venue, second)).toBe("open");
    },
  );

  it.each(ROUTES)(
    "%s: a partyId that is not a UUID is 400 management.request_invalid",
    async (route) => {
      const { partyId, main, second } = await twoBills();
      const expectedPartyRevision = await revisionOf(partyId);

      const answer = await post(
        `/api/bills/${main}/${route}`,
        bodyFor(route, second, { expectedPartyRevision, partyId: NOT_A_UUID }),
      );

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "partyId" },
      });
    },
  );

  it.each(["split", "transfer"] as const)(
    "%s: transfers that are not a list are 400 management.request_invalid",
    async (route) => {
      const { partyId, main, second } = await twoBills();
      const expectedPartyRevision = await revisionOf(partyId);

      const answer = await post(
        `/api/bills/${main}/${route}`,
        bodyFor(route, second, { expectedPartyRevision, transfers: { lineNo: 1 } }),
      );

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "transfers" },
      });
    },
  );

  it.each(["split", "transfer"] as const)(
    "%s: an empty transfers list is 400 sale.empty_basket, changing nothing",
    async (route) => {
      const { partyId, main, second } = await twoBills();
      const expectedPartyRevision = await revisionOf(partyId);

      const answer = await post(
        `/api/bills/${main}/${route}`,
        bodyFor(route, second, { expectedPartyRevision, partyId, transfers: [] }),
      );

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({ code: "sale.empty_basket" });
      expect(await revisionOf(partyId)).toBe(expectedPartyRevision);
      expect([await statusOf(venue, main), await statusOf(venue, second)]).toEqual([
        "open",
        "open",
      ]);
    },
  );

  const MALFORMED_ENTRIES = [
    ["split", null],
    ["transfer", null],
    ["split", [{ lineNo: 1 }]],
    ["transfer", { lineNo: true }],
    ["split", { lineNo: "1" }],
    ["transfer", { quantity: "1" }],
  ] as const;

  it.each(MALFORMED_ENTRIES)(
    "%s: a transfer entry %j is 400 management.request_invalid, changing nothing",
    async (route, entry) => {
      const { partyId, main, second } = await twoBills();
      const expectedPartyRevision = await revisionOf(partyId);

      const answer = await post(
        `/api/bills/${main}/${route}`,
        bodyFor(route, second, { expectedPartyRevision, transfers: [entry] }),
      );

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "transfers" },
      });
      expect(await revisionOf(partyId)).toBe(expectedPartyRevision);
    },
  );

  it.each([
    ["merge", "fromBillId"],
    ["transfer", "toBillId"],
  ] as const)(
    "%s: a body without %s is 400 management.request_invalid, changing nothing",
    async (route, field) => {
      const { partyId, main, second } = await twoBills();
      const expectedPartyRevision = await revisionOf(partyId);
      const body: Record<string, unknown> = bodyFor(route, second, { expectedPartyRevision });
      delete body[field];

      const answer = await post(`/api/bills/${main}/${route}`, body);

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({ code: "management.request_invalid", params: { field } });
      expect(await revisionOf(partyId)).toBe(expectedPartyRevision);
    },
  );

  it.each(ROUTES)(
    "%s: a body that is not an object is 400 management.request_invalid",
    async (route) => {
      const { main } = await twoBills();

      const answer = await post(`/api/bills/${main}/${route}`, null);

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "body" },
      });
    },
  );

  it("split answers the new bill's id", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    const expectedPartyRevision = await revisionOf(partyId);

    const answer = await post(`/api/bills/${tabId}/split`, {
      transfers: [{ lineNo: 2 }],
      expectedPartyRevision,
      partyId,
    });

    expect(answer.status).toBe(200);
    const billId = answer.json.billId as string;
    expect(Object.keys(answer.json)).toEqual(["billId"]);
    expect(await statusOf(venue, billId)).toBe("open");
    expect(await revisionOf(partyId)).toBe(expectedPartyRevision + 1);
  });

  it("merge and transfer answer 204", async () => {
    const { partyId, main, second } = await twoBills();

    const transferred = await post(`/api/bills/${main}/transfer`, {
      toBillId: second,
      transfers: [{ lineNo: 1 }],
      expectedPartyRevision: await revisionOf(partyId),
    });
    const merged = await post(`/api/bills/${main}/merge`, {
      fromBillId: second,
      expectedPartyRevision: await revisionOf(partyId),
    });

    expect([transferred.status, merged.status]).toEqual([204, 204]);
    expect(await statusOf(venue, second)).toBe("abandoned");
  });

  it("a presented bill is 409 bill.presented", async () => {
    const { partyId, second } = await twoBills();
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, second)),
    );

    const answer = await post(`/api/bills/${second}/split`, {
      transfers: [{ lineNo: 1 }],
      expectedPartyRevision: await revisionOf(partyId),
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "bill.presented",
      params: { workingOrderId: second },
    });
  });

  it("a paid bill is 409 bill.paid", async () => {
    const { partyId, main, second } = await twoBills();
    await takeBillPayment(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      second,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: 1 }],
        method: "cash",
        tendered: "3.00",
        applied: "3.00",
        tip: "0.00",
      },
      venue.operatorId,
    );
    expect(await statusOf(venue, second)).toBe("settled");

    const answer = await post(`/api/bills/${main}/merge`, {
      fromBillId: second,
      expectedPartyRevision: await revisionOf(partyId),
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "bill.paid", params: { workingOrderId: second } });
  });

  it("another party's bill is 409 bill.other_party", async () => {
    const a = await twoBills();
    const b = await twoBills();

    const answer = await post(`/api/bills/${a.main}/transfer`, {
      toBillId: b.main,
      transfers: [{ lineNo: 1 }],
      expectedPartyRevision: await revisionOf(a.partyId),
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "bill.other_party",
      params: { workingOrderId: b.main },
    });
  });

  it("a stale revision is 409 party.out_of_date", async () => {
    const { partyId, main, second } = await twoBills();

    const answer = await post(`/api/bills/${main}/merge`, {
      fromBillId: second,
      expectedPartyRevision: (await revisionOf(partyId)) - 1,
    });

    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "party.out_of_date" });
  });

  it("a split that leaves the source fully paid issues its invoice", async () => {
    const { partyId, tabId } = await seated("Paella", "Caña");
    await takeBillPayment(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      tabId,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: 1 }],
        method: "cash",
        tendered: "35.00",
        applied: "35.00",
        tip: "0.00",
      },
      venue.operatorId,
    );
    expect(registroCount(venue, tabId)).toBe(0);

    const answer = await post(`/api/bills/${tabId}/split`, {
      transfers: [{ lineNo: 2 }],
      expectedPartyRevision: await revisionOf(partyId),
    });

    expect(answer.status).toBe(200);
    expect(registroCount(venue, tabId)).toBe(1);
    expect(await statusOf(venue, tabId)).toBe("settled");
    expect(registroCount(venue, answer.json.billId as string)).toBe(0);
  });
});
