import { oneBill, observedTableActionBody } from "./testing/table-action-fixture.js";
import { observedMoveBillBody } from "./testing/move-bill-fixture.js";
import { observedBillActionBody } from "./testing/bill-action-fixture.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { devices, withTransaction, workingOrders } from "@waitron/db";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";
import { readBillEditState } from "./bill-editing.js";
import { createTable } from "./testing/live-table.js";
import { numbersOf } from "./testing/bill-identities.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { tableSnapshot } from "./testing/table-snapshot.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { mountTillApi } from "./till-api.js";
import { decimal } from "@waitron/shared";

// The routes of Move guests, Join tables and Split a table (table actions plan, Task 8). The
// actions themselves are tested in `party-table-actions.test.ts`.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

async function post(path: string, body: unknown, cookie = venue.cookie) {
  return send(
    venue.app,
    cookie,
    "POST",
    path,
    await observedTableActionBody(venue.db, path, await observedMoveBillBody(venue.db, path, body)),
  );
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function tablesOf(partyId: string): string[] {
  return venue.db
    .all<{ table_id: string }>(
      sql`select table_id from party_tables where party_id = ${partyId} and left_at is null
          order by joined_at, id`,
    )
    .map((row) => row.table_id);
}

function lineIdsOf(billId: string): string[] {
  return venue.db
    .all<{ id: string }>(
      sql`select id from working_order_lines where working_order_id = ${billId} order by line_no`,
    )
    .map((row) => row.id);
}

async function freeTable(): Promise<string> {
  const { id } = await withTransaction(venue.db, (tx) =>
    createTable(tx, venue.cfg, { label: `Mesa ${randomUUID().slice(0, 8)}`, zoneId: venue.zoneId }),
  );
  return id;
}

async function floorGuests(tableId: string): Promise<number | null> {
  const state = await send(venue.app, venue.cookie, "GET", "/api/tables/state");
  expect(state.status).toBe(200);
  const tables = state.json as unknown as {
    id: string;
    party: { guestCount: number | null } | null;
  }[];
  return tables.find((t) => t.id === tableId)!.party!.guestCount;
}

async function annaAtTwo() {
  const anna = await seatedWith(venue, "Tarta", "Octopus");
  const second = await freeTable();
  const joined = await post(`/api/parties/${anna.partyId}/join`, {
    tableId: second,
    expectedPartyRevision: revisionOf(anna.partyId),
  });
  expect(joined.status).toBe(200);
  const split = await post(
    `/api/bills/${anna.tabId}/move-dishes`,
    await observedBillActionBody(venue.db, `/api/bills/${anna.tabId}/move-dishes`, {
      lineIds: [lineIdsOf(anna.tabId)[1]],
      toBillId: null,
      expectedPartyRevision: revisionOf(anna.partyId),
    }),
  );
  expect(split.status).toBe(200);
  return { anna, second, billId: split.json.billId as string };
}

describe("the table action routes", () => {
  it("move guests to a free table, answering the party and its bills", async () => {
    const anna = await seatedWith(venue, "Tarta");
    const to = await freeTable();

    const answer = await post(`/api/parties/${anna.partyId.toUpperCase()}/move`, {
      toTableId: to.toUpperCase(),
      expectedPartyRevision: anna.revision,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: anna.partyId, billIds: [anna.tabId] });
    expect(tablesOf(anna.partyId)).toEqual([to]);
  });

  it("move guests to another party's table keeps every bill, for each of two moves sending the same request", async () => {
    const anna = await seatedWith(venue, "Tarta");
    const lewis = await seatedWith(venue, "Caña");
    const bea = await seatedWith(venue, "Octopus");
    const cris = await seatedWith(venue, "Caña");

    const merged = await post(`/api/parties/${anna.partyId}/move`, {
      toTableId: lewis.tableId,
      expectedPartyRevision: anna.revision,
      otherPartyId: lewis.partyId,
      expectedOtherPartyRevision: lewis.revision,
    });
    const separate = await post(`/api/parties/${bea.partyId}/move`, {
      toTableId: cris.tableId,
      expectedPartyRevision: bea.revision,
      otherPartyId: cris.partyId,
      expectedOtherPartyRevision: cris.revision,
    });

    expect(merged.status).toBe(200);
    expect(merged.json).toEqual({ partyId: lewis.partyId, billIds: [lewis.tabId, anna.tabId] });
    expect(await statusOf(venue, anna.tabId)).toBe("open");
    expect(await statusOf(venue, lewis.tabId)).toBe("open");
    expect(separate.status).toBe(200);
    expect(separate.json).toEqual({ partyId: cris.partyId, billIds: [cris.tabId, bea.tabId] });
    expect(await statusOf(venue, bea.tabId)).toBe("open");
  });

  it("join tables, answering the party that holds them all", async () => {
    const anna = await seatedWith(venue, "Tarta");
    const lewis = await seatedWith(venue, "Caña");

    const answer = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: lewis.tableId,
      expectedPartyRevision: anna.revision,
      otherPartyId: lewis.partyId,
      expectedOtherPartyRevision: lewis.revision,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: anna.partyId, billIds: [anna.tabId, lewis.tabId] });
    expect(tablesOf(anna.partyId).sort()).toEqual([anna.tableId, lewis.tableId].sort());
  });

  it("split a table, answering the new party and the bill it took", async () => {
    const { anna, second, billId } = await annaAtTwo();

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second.toUpperCase(),
      selection: oneBill(billId.toUpperCase()),
      expectedPartyRevision: revisionOf(anna.partyId),
    });

    expect(answer.status).toBe(200);
    expect(Object.keys(answer.json).sort()).toEqual(["billIds", "partyId"]);
    expect(answer.json.billIds).toEqual([billId]);
    expect(tablesOf(answer.json.partyId as string)).toEqual([second]);
    expect(tablesOf(anna.partyId)).toEqual([anna.tableId]);
  });

  it("A803 waiting copy: split a table taking a bill holding a held dish, which the new party's Current orders lists in a held group", async () => {
    const anna = await seatedWith(venue);
    const placed = await post(`/api/parties/${anna.partyId}/groups`, {
      expectedEdit: await withTransaction(venue.db, (tx) => readBillEditState(tx, anna.tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(anna.partyId),
      groups: [
        { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "fire" },
        { lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }], release: "hold" },
      ],
    });
    expect(placed.status).toBe(200);
    const [cake] = venue.db.all<{ id: string }>(
      sql`select id from working_order_lines where working_order_id = ${anna.tabId} and name = 'Tarta'`,
    );
    const second = await freeTable();
    const joined = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: second,
      expectedPartyRevision: revisionOf(anna.partyId),
    });
    expect(joined.status).toBe(200);

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(anna.tabId),
      expectedPartyRevision: revisionOf(anna.partyId),
    });

    expect(answer.status).toBe(200);
    expect(answer.json.billIds).toEqual([anna.tabId]);
    const partyId = answer.json.partyId as string;
    const read = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/parties/${partyId}/current-orders`,
    );
    expect(read.status).toBe(200);
    const groups = read.json.groups as { state: string; rows: { lineId: string }[] }[];
    expect(
      groups.filter((group) => group.rows.some((row) => row.lineId === cake!.id)),
    ).toMatchObject([{ state: "held" }]);
  });

  it("split a table choosing no bill, answering the new empty bill", async () => {
    const { anna, second } = await annaAtTwo();

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(null),
      expectedPartyRevision: revisionOf(anna.partyId),
    });

    expect(answer.status).toBe(200);
    expect(answer.json.billIds).toEqual([expect.any(String)]);
    expect(await statusOf(venue, (answer.json.billIds as string[])[0]!)).toBe("open");
  });

  for (const path of ["move", "join", "split-table"]) {
    it(`answers ${path} without a session with 401`, async () => {
      const anna = await seatedWith(venue);

      const answer = await send(venue.app, "", "POST", `/api/parties/${anna.partyId}/${path}`, {
        toTableId: randomUUID(),
        tableId: randomUUID(),
        selection: oneBill(null),
        expectedPartyRevision: anna.revision,
      });

      expect(answer.status).toBe(401);
      expect(answer.json).toMatchObject({ code: "session.required" });
      expect(revisionOf(anna.partyId)).toBe(anna.revision);
    });

    it(`answers ${path} on a malformed party id with 409 party.not_open`, async () => {
      const answer = await post(`/api/parties/not-a-uuid/${path}`, {
        toTableId: randomUUID(),
        tableId: randomUUID(),
        selection: oneBill(null),
        expectedPartyRevision: 0,
      });

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({
        code: "party.not_open",
        params: { partyId: "not-a-uuid" },
      });
    });

    it.each([[undefined], [-1], ["3"]])(
      `answers ${path} with the party revision %j with 400 management.request_invalid`,
      async (revision) => {
        const anna = await seatedWith(venue);

        const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
          toTableId: randomUUID(),
          tableId: randomUUID(),
          selection: oneBill(null),
          ...(revision === undefined ? {} : { expectedPartyRevision: revision }),
        });

        expect(answer.status).toBe(400);
        expect(answer.json).toMatchObject({
          code: "management.request_invalid",
          params: { field: "expectedPartyRevision" },
        });
        expect(revisionOf(anna.partyId)).toBe(anna.revision);
      },
    );
  }

  for (const [path, field] of [
    ["move", "toTableId"],
    ["join", "tableId"],
  ] as const) {
    it.each([["merge"], ["separate"], ["together"], [null], [1]])(
      `A803 no merge flag: ${path} with a bills key of any value, including an invalid one, ignores it (%j)`,
      async (bills) => {
        const anna = await seatedWith(venue, "Tarta");
        const lewis = await seatedWith(venue, "Caña");

        const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
          [field]: lewis.tableId,
          bills,
          expectedPartyRevision: anna.revision,
          otherPartyId: lewis.partyId,
          expectedOtherPartyRevision: lewis.revision,
        });

        const holder = path === "move" ? lewis : anna;
        const other = path === "move" ? anna : lewis;
        expect(answer.status).toBe(200);
        expect(answer.json).toEqual({
          partyId: holder.partyId,
          billIds: [holder.tabId, other.tabId],
        });
        expect(await statusOf(venue, anna.tabId)).toBe("open");
        expect(await statusOf(venue, lewis.tabId)).toBe("open");
      },
    );

    it(`answers ${path} with a malformed other party revision with 400`, async () => {
      const anna = await seatedWith(venue);

      const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
        [field]: await freeTable(),
        expectedPartyRevision: anna.revision,
        expectedOtherPartyRevision: "3",
      });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "expectedOtherPartyRevision" },
      });
    });

    it.each([["not-a-uuid"], [7]])(
      `answers ${path} with the other party id %j with 400 management.request_invalid`,
      async (otherPartyId) => {
        const anna = await seatedWith(venue);
        const to = await freeTable();

        const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
          [field]: to,
          expectedPartyRevision: anna.revision,
          otherPartyId,
        });

        expect(answer.status).toBe(400);
        expect(answer.json).toMatchObject({
          code: "management.request_invalid",
          params: { field: "otherPartyId" },
        });
        expect(revisionOf(anna.partyId)).toBe(anna.revision);
        expect(tablesOf(anna.partyId)).toEqual([anna.tableId]);
      },
    );

    it(`takes ${path} sent with the target read free (otherPartyId null) to a table still free`, async () => {
      const anna = await seatedWith(venue);
      const to = await freeTable();

      const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
        [field]: to,
        expectedPartyRevision: anna.revision,
        otherPartyId: null,
      });

      expect(answer.status).toBe(200);
      expect(tablesOf(anna.partyId)).toContain(to);
    });

    it(`answers ${path} sent with the target read free to a table a party now holds with 409 party.out_of_date, changing nothing`, async () => {
      const anna = await seatedWith(venue);
      const lewis = await seatedWith(venue);

      const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
        [field]: lewis.tableId,
        expectedPartyRevision: anna.revision,
        otherPartyId: null,
      });

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: lewis.partyId, revision: lewis.revision },
      });
      expect(revisionOf(anna.partyId)).toBe(anna.revision);
      expect(revisionOf(lewis.partyId)).toBe(lewis.revision);
      expect(tablesOf(anna.partyId)).toEqual([anna.tableId]);
      expect(tablesOf(lewis.partyId)).toEqual([lewis.tableId]);
    });

    it(`answers ${path} sent with the target read free to the party's own only table with 409 table.already_in_party, changing nothing`, async () => {
      const anna = await seatedWith(venue);

      const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
        [field]: anna.tableId,
        expectedPartyRevision: anna.revision,
        otherPartyId: null,
      });

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({
        code: "table.already_in_party",
        params: { tableId: anna.tableId },
      });
      expect(revisionOf(anna.partyId)).toBe(anna.revision);
      expect(tablesOf(anna.partyId)).toEqual([anna.tableId]);
    });

    it(`answers ${path} sent with the target read free and another party's revision with 400, changing nothing`, async () => {
      const anna = await seatedWith(venue);
      const to = await freeTable();

      const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
        [field]: to,
        expectedPartyRevision: anna.revision,
        otherPartyId: null,
        expectedOtherPartyRevision: 3,
      });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "otherPartyId" },
      });
      expect(revisionOf(anna.partyId)).toBe(anna.revision);
      expect(tablesOf(anna.partyId)).toEqual([anna.tableId]);
    });

    it(`answers ${path} with the other party's revision but not its id with 400`, async () => {
      const anna = await seatedWith(venue);
      const lewis = await seatedWith(venue);

      const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
        [field]: lewis.tableId,
        expectedPartyRevision: anna.revision,
        expectedOtherPartyRevision: lewis.revision,
      });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "otherPartyId" },
      });
      expect(revisionOf(anna.partyId)).toBe(anna.revision);
      expect(revisionOf(lewis.partyId)).toBe(lewis.revision);
      expect(tablesOf(lewis.partyId)).toEqual([lewis.tableId]);
    });

    it(`answers ${path} naming the other party in upper case as it names it in lower`, async () => {
      const anna = await seatedWith(venue);
      const lewis = await seatedWith(venue);

      const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
        [field]: lewis.tableId,
        expectedPartyRevision: anna.revision,
        otherPartyId: lewis.partyId.toUpperCase(),
        expectedOtherPartyRevision: lewis.revision,
      });

      expect(answer.status).toBe(200);
    });

    it(`answers ${path} to a table the party it read there has left with 409 party.out_of_date`, async () => {
      const anna = await seatedWith(venue);
      const lewis = await seatedWith(venue);
      const read = { otherPartyId: lewis.partyId, expectedOtherPartyRevision: lewis.revision };
      const left = await post(`/api/parties/${lewis.partyId}/move`, {
        toTableId: await freeTable(),
        expectedPartyRevision: lewis.revision,
      });
      expect(left.status).toBe(200);

      const answer = await post(`/api/parties/${anna.partyId}/${path}`, {
        [field]: lewis.tableId,
        expectedPartyRevision: anna.revision,
        ...read,
      });

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: lewis.partyId, revision: revisionOf(lewis.partyId) },
      });
      expect(revisionOf(anna.partyId)).toBe(anna.revision);
      expect(tablesOf(anna.partyId)).toEqual([anna.tableId]);
    });

    it(`answers ${path} with no table with 400, and a malformed one with 404 table.not_found`, async () => {
      const anna = await seatedWith(venue);

      const missing = await post(`/api/parties/${anna.partyId}/${path}`, {
        expectedPartyRevision: anna.revision,
      });
      const malformed = await post(`/api/parties/${anna.partyId}/${path}`, {
        [field]: "not-a-uuid",
        expectedPartyRevision: anna.revision,
      });

      expect(missing.status).toBe(400);
      expect(missing.json).toMatchObject({
        code: "management.request_invalid",
        params: { field },
      });
      expect(malformed.status).toBe(404);
      expect(malformed.json).toMatchObject({
        code: "table.not_found",
        params: { tableId: "not-a-uuid" },
      });
      expect(revisionOf(anna.partyId)).toBe(anna.revision);
    });
  }

  it("move guests sent with the target read free to one of the party's own tables leaves it at that table alone", async () => {
    const { anna, second, billId } = await annaAtTwo();

    const answer = await post(`/api/parties/${anna.partyId}/move`, {
      toTableId: second,
      expectedPartyRevision: revisionOf(anna.partyId),
      otherPartyId: null,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: anna.partyId, billIds: [anna.tabId, billId] });
    expect(tablesOf(anna.partyId)).toEqual([second]);
  });

  it("answers split-table with a malformed table with 409 table.not_joined, and a malformed or missing bill", async () => {
    const { anna, second } = await annaAtTwo();
    const revision = revisionOf(anna.partyId);

    const table = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: "not-a-uuid",
      selection: oneBill(null),
      expectedPartyRevision: revision,
    });
    const noTable = await post(`/api/parties/${anna.partyId}/split-table`, {
      selection: oneBill(null),
      expectedPartyRevision: revision,
    });
    const bill = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill("not-a-uuid"),
      expectedPartyRevision: revision,
    });
    const noBill = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      expectedPartyRevision: revision,
    });

    expect(table.status).toBe(409);
    expect(table.json).toMatchObject({
      code: "table.not_joined",
      params: { tableId: "not-a-uuid", partyId: anna.partyId },
    });
    expect(noTable.status).toBe(400);
    expect(noTable.json).toMatchObject({ params: { field: "tableId" } });
    expect(bill.status).toBe(400);
    expect(bill.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "selection" },
    });
    expect(noBill.status).toBe(400);
    expect(noBill.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "selection" },
    });
    expect(revisionOf(anna.partyId)).toBe(revision);
  });

  it("answers each refusal of the actions with 409, changing no revision", async () => {
    const { anna, second, billId } = await annaAtTwo();
    const lewis = await seatedWith(venue, "Caña");
    const alone = await seatedWith(venue);
    const revision = revisionOf(anna.partyId);
    const splitOf = (partyId: string, tableId: string, bill: string | null, rev = revision) =>
      post(`/api/parties/${partyId}/split-table`, {
        tableId,
        selection: oneBill(bill),
        expectedPartyRevision: rev,
      });

    const answers = [
      [
        await post(`/api/parties/${anna.partyId}/join`, {
          tableId: second,
          expectedPartyRevision: revision,
        }),
        "table.already_in_party",
      ],
      [
        await post(`/api/parties/${alone.partyId}/move`, {
          toTableId: alone.tableId,
          expectedPartyRevision: alone.revision,
        }),
        "table.already_in_party",
      ],
      [await splitOf(anna.partyId, second, lewis.tabId), "bill.other_party"],
      [await splitOf(anna.partyId, lewis.tableId, billId), "table.not_joined"],
      [await splitOf(alone.partyId, alone.tableId, null, alone.revision), "table.not_shared"],
      [await splitOf(anna.partyId, second, billId, revision - 1), "party.out_of_date"],
    ] as const;

    for (const [answer, code] of answers) {
      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code });
    }
    expect(revisionOf(anna.partyId)).toBe(revision);
    expect(revisionOf(alone.partyId)).toBe(alone.revision);
    expect(revisionOf(lewis.partyId)).toBe(lewis.revision);

    const first = await splitOf(anna.partyId, second, anna.tabId);
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ partyId: expect.any(String), billIds: [anna.tabId] });
    expect(revisionOf(anna.partyId)).toBe(revision + 1);
  });
});

describe("A803 action results:", () => {
  function shownBillsOf(partyId: string): { id: string; status: string; lines: number }[] {
    return venue.db.all<{ id: string; status: string; lines: number }>(
      sql`select w.id, w.status,
            (select count(*) from working_order_lines l where l.working_order_id = w.id) as lines
          from working_orders w where w.party_id = ${partyId} and w.status <> 'abandoned'
          order by w.id`,
    );
  }

  it("Move guests to a free table answers the party's bills in number order", async () => {
    // Bill ids are random, so seat again until Bill 1's id sorts after Bill 2's: only then does
    // number order differ from id order.
    let arranged = await annaAtTwo();
    for (let tries = 1; tries < 20 && arranged.anna.tabId < arranged.billId; tries++) {
      arranged = await annaAtTwo();
    }
    const { anna, billId } = arranged;
    expect(anna.tabId > billId).toBe(true);
    expect((await numbersOf(venue, anna.partyId)).map(([id, n]) => [id, n])).toEqual([
      [anna.tabId, 1],
      [billId, 2],
    ]);
    const to = await freeTable();

    const answer = await post(`/api/parties/${anna.partyId}/move`, {
      toTableId: to,
      expectedPartyRevision: revisionOf(anna.partyId),
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: anna.partyId, billIds: [anna.tabId, billId] });
  });

  it("Join a free table answers the party's bills in number order", async () => {
    const { anna, billId } = await annaAtTwo();
    const to = await freeTable();

    const answer = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: to,
      expectedPartyRevision: revisionOf(anna.partyId),
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: anna.partyId, billIds: [anna.tabId, billId] });
  });

  it("Move guests onto a seated table answers the receiving party's bills, its own first", async () => {
    const anna = await seatedWith(venue, "Tarta");
    const lewis = await seatedWith(venue, "Caña");

    const answer = await post(`/api/parties/${anna.partyId}/move`, {
      toTableId: lewis.tableId,
      expectedPartyRevision: anna.revision,
      otherPartyId: lewis.partyId,
      expectedOtherPartyRevision: lewis.revision,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: lewis.partyId, billIds: [lewis.tabId, anna.tabId] });
    expect(await numbersOf(venue, lewis.partyId)).toEqual([
      [lewis.tabId, 1, null],
      [anna.tabId, 2, null],
    ]);
  });

  it("Join a seated table answers the joining party's bills, its own first", async () => {
    const anna = await seatedWith(venue, "Tarta");
    const lewis = await seatedWith(venue, "Caña");

    const answer = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: lewis.tableId,
      expectedPartyRevision: anna.revision,
      otherPartyId: lewis.partyId,
      expectedOtherPartyRevision: lewis.revision,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: anna.partyId, billIds: [anna.tabId, lewis.tabId] });
    expect(await numbersOf(venue, anna.partyId)).toEqual([
      [anna.tabId, 1, null],
      [lewis.tabId, 2, null],
    ]);
  });

  it("split a table giving away the party's first bill answers that bill, which is Bill 1 at the new party, and the staying party keeps its others", async () => {
    const { anna, second, billId } = await annaAtTwo();

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(anna.tabId),
      expectedPartyRevision: revisionOf(anna.partyId),
    });

    expect(answer.status).toBe(200);
    const newParty = answer.json.partyId as string;
    expect(answer.json).toEqual({ partyId: newParty, billIds: [anna.tabId] });
    expect(newParty).not.toBe(anna.partyId);
    expect(tablesOf(newParty)).toEqual([second]);
    expect(await numbersOf(venue, newParty)).toEqual([[anna.tabId, 1, null]]);
    expect(await numbersOf(venue, anna.partyId)).toEqual([[billId, 2, null]]);
    expect(shownBillsOf(anna.partyId)).toEqual([{ id: billId, status: "open", lines: 1 }]);
  });

  it("split with no bill answers one new empty bill, and the staying party is unchanged", async () => {
    const { anna, second } = await annaAtTwo();
    const stayingBefore = await numbersOf(venue, anna.partyId);
    const revision = revisionOf(anna.partyId);

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(null),
      expectedPartyRevision: revision,
    });

    expect(answer.status).toBe(200);
    const newParty = answer.json.partyId as string;
    const newBill = (answer.json.billIds as string[])[0]!;
    expect(answer.json).toEqual({ partyId: newParty, billIds: [expect.any(String)] });
    expect(shownBillsOf(newParty)).toEqual([{ id: newBill, status: "open", lines: 0 }]);
    expect(await numbersOf(venue, newParty)).toEqual([[newBill, 1, null]]);
    expect(await numbersOf(venue, anna.partyId)).toEqual(stayingBefore);
    expect(revisionOf(anna.partyId)).toBe(revision + 1);
  });

  it("split taking the staying party's only unpaid bill, with no other bill left, leaves the staying party one new empty bill", async () => {
    const anna = await seatedWith(venue, "Tarta");
    const second = await freeTable();
    const joined = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: second,
      expectedPartyRevision: anna.revision,
    });
    expect(joined.status).toBe(200);
    const revision = revisionOf(anna.partyId);

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(anna.tabId),
      expectedPartyRevision: revision,
    });

    expect(answer.status).toBe(200);
    const newParty = answer.json.partyId as string;
    expect(answer.json).toEqual({ partyId: newParty, billIds: [anna.tabId] });
    expect(shownBillsOf(newParty)).toEqual([{ id: anna.tabId, status: "open", lines: 1 }]);
    const staying = shownBillsOf(anna.partyId);
    expect(staying).toEqual([{ id: expect.any(String), status: "open", lines: 0 }]);
    expect(staying[0]!.id).not.toBe(anna.tabId);
    expect(await numbersOf(venue, anna.partyId)).toEqual([[staying[0]!.id, 2, null]]);
    expect(revisionOf(anna.partyId)).toBe(revision + 1);
    expect(revisionOf(newParty)).toBe(0);
  });

  it("joining after moving the last bill answers its replacement without adding another", async () => {
    const anna = await seatedWith(venue, "Tarta");
    const counter = await post(`/api/bills/${anna.tabId}/move`, {
      to: { counter: { zoneId: null } },
      partyId: anna.partyId,
      expectedPartyRevision: anna.revision,
    });
    expect(counter.status).toBe(200);
    const replacement = shownBillsOf(anna.partyId);
    expect(replacement).toEqual([{ id: expect.any(String), status: "open", lines: 0 }]);
    expect(replacement[0]!.id).not.toBe(anna.tabId);
    const revision = revisionOf(anna.partyId);

    const answer = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: await freeTable(),
      expectedPartyRevision: revision,
    });

    expect(answer.status).toBe(200);
    const bills = shownBillsOf(anna.partyId);
    expect(bills).toEqual(replacement);
    expect(answer.json).toEqual({ partyId: anna.partyId, billIds: [bills[0]!.id] });
    expect(revisionOf(anna.partyId)).toBe(revision + 1);
  });

  it("the party's revision moves once per action, also when a bill was inserted", async () => {
    const moving = await seatedWith(venue, "Tarta");
    const moved = await post(`/api/parties/${moving.partyId}/move`, {
      toTableId: await freeTable(),
      expectedPartyRevision: moving.revision,
    });
    const { anna, second } = await annaAtTwo();
    const revision = revisionOf(anna.partyId);
    const split = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(null),
      expectedPartyRevision: revision,
    });
    const empty = await seatedWith(venue, "Tarta");
    const toCounter = await post(`/api/bills/${empty.tabId}/move`, {
      to: { counter: { zoneId: null } },
      partyId: empty.partyId,
      expectedPartyRevision: empty.revision,
    });
    expect(toCounter.status).toBe(200);
    const emptyRevision = revisionOf(empty.partyId);
    const emptyMoved = await post(`/api/parties/${empty.partyId}/move`, {
      toTableId: await freeTable(),
      expectedPartyRevision: emptyRevision,
    });

    expect(moved.status).toBe(200);
    expect(revisionOf(moving.partyId)).toBe(moving.revision + 1);
    expect(split.status).toBe(200);
    expect(revisionOf(anna.partyId)).toBe(revision + 1);
    expect(revisionOf(split.json.partyId as string)).toBe(0);
    expect(emptyMoved.status).toBe(200);
    expect(shownBillsOf(empty.partyId)).toHaveLength(1);
    expect(revisionOf(empty.partyId)).toBe(emptyRevision + 1);
  });

  it("no answer carries mainBillId", async () => {
    const { anna, second, billId } = await annaAtTwo();
    const lewis = await seatedWith(venue, "Caña");
    const bea = await seatedWith(venue, "Octopus");

    const answers = [
      await post(`/api/parties/${anna.partyId}/split-table`, {
        tableId: second,
        selection: oneBill(billId),
        expectedPartyRevision: revisionOf(anna.partyId),
      }),
      await post(`/api/parties/${anna.partyId}/join`, {
        tableId: await freeTable(),
        expectedPartyRevision: revisionOf(anna.partyId),
      }),
      await post(`/api/parties/${lewis.partyId}/move`, {
        toTableId: bea.tableId,
        expectedPartyRevision: lewis.revision,
        otherPartyId: bea.partyId,
        expectedOtherPartyRevision: bea.revision,
      }),
    ];

    for (const answer of answers) {
      expect(answer.status).toBe(200);
      expect(answer.json).not.toHaveProperty("mainBillId");
      expect(answer.json).not.toHaveProperty("merged");
    }
  });
});

describe("Split a table's guest counts", () => {
  async function annaOfFive() {
    const at = await annaAtTwo();
    const counted = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/parties/${at.anna.partyId}/guests`,
      {
        guestCount: 5,
        expectedPartyRevision: revisionOf(at.anna.partyId),
      },
    );
    expect(counted.status).toBe(200);
    return at;
  }

  function guestsOf(partyId: string): number | null {
    const [row] = venue.db.all<{ guest_count: number | null }>(
      sql`select guest_count from parties where id = ${partyId}`,
    );
    return row!.guest_count;
  }

  it("gives each side the count the waiter sent", async () => {
    const { anna, second } = await annaOfFive();

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(null),
      expectedPartyRevision: revisionOf(anna.partyId),
      guestCounts: { staying: 3, leaving: 2 },
    });

    expect(answer.status).toBe(200);
    expect(await floorGuests(anna.tableId)).toBe(3);
    expect(await floorGuests(second)).toBe(2);
  });

  it("leaves both sides unknown when both counts are null", async () => {
    const { anna, second } = await annaOfFive();

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(null),
      expectedPartyRevision: revisionOf(anna.partyId),
      guestCounts: { staying: null, leaving: null },
    });

    expect(answer.status).toBe(200);
    expect(await floorGuests(anna.tableId)).toBeNull();
    expect(await floorGuests(second)).toBeNull();
  });

  it("without guests, the staying party keeps its count and the new party has none", async () => {
    const { anna, second } = await annaOfFive();

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(null),
      expectedPartyRevision: revisionOf(anna.partyId),
    });

    expect(answer.status).toBe(200);
    expect(await floorGuests(anna.tableId)).toBe(5);
    expect(await floorGuests(second)).toBeNull();
  });

  it("ignores the old guests key: the staying party keeps its count and the new party has none", async () => {
    const { anna, second } = await annaOfFive();

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(null),
      expectedPartyRevision: revisionOf(anna.partyId),
      guests: { staying: 0, leaving: 2 },
    });

    expect(answer.status).toBe(200);
    expect(await floorGuests(anna.tableId)).toBe(5);
    expect(await floorGuests(second)).toBeNull();
  });

  it.each([
    [{ staying: 0, leaving: 2 }, "guestCounts.staying"],
    [{ staying: 1000, leaving: 2 }, "guestCounts.staying"],
    [{ staying: 2.5, leaving: 2 }, "guestCounts.staying"],
    [{ staying: "2", leaving: 2 }, "guestCounts.staying"],
    [{ leaving: 2 }, "guestCounts.staying"],
    [{ staying: 3, leaving: 0 }, "guestCounts.leaving"],
    [{ staying: 3, leaving: 1000 }, "guestCounts.leaving"],
    [{ staying: 3, leaving: 2.5 }, "guestCounts.leaving"],
    [{ staying: 3, leaving: "2" }, "guestCounts.leaving"],
    [{ staying: 3 }, "guestCounts.leaving"],
    [null, "guestCounts"],
    [5, "guestCounts"],
    [[3, 2], "guestCounts"],
  ])("refuses guests %j as a bad %s, changing nothing", async (guests, field) => {
    const { anna, second } = await annaOfFive();
    const revision = revisionOf(anna.partyId);

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      tableId: second,
      selection: oneBill(null),
      expectedPartyRevision: revision,
      guestCounts: guests,
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "management.request_invalid", params: { field } });
    expect(tablesOf(anna.partyId).sort()).toEqual([anna.tableId, second].sort());
    expect(revisionOf(anna.partyId)).toBe(revision);
    expect(guestsOf(anna.partyId)).toBe(5);
  });

  it("leaves the count as it was when the split is refused after its revision check", async () => {
    const { anna, second } = await annaOfFive();
    const lewis = await seatedWith(venue, "Caña");
    const alone = await seatedWith(venue);
    const counted = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/parties/${alone.partyId}/guests`,
      { guestCount: 5, expectedPartyRevision: alone.revision },
    );
    expect(counted.status).toBe(200);
    const splitOf = (partyId: string, tableId: string, billId: string | null) =>
      post(`/api/parties/${partyId}/split-table`, {
        tableId,
        selection: oneBill(billId),
        expectedPartyRevision: revisionOf(partyId),
        guestCounts: { staying: 1, leaving: 1 },
      });

    const answers = [
      [await splitOf(alone.partyId, alone.tableId, null), "table.not_shared"],
      [await splitOf(anna.partyId, lewis.tableId, null), "table.not_joined"],
      [await splitOf(anna.partyId, second, lewis.tabId), "bill.other_party"],
    ] as const;

    for (const [answer, code] of answers) {
      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code });
    }
    expect(guestsOf(alone.partyId)).toBe(5);
    expect(guestsOf(anna.partyId)).toBe(5);

    const first = await splitOf(anna.partyId, second, anna.tabId);
    expect(first.status).toBe(200);
    expect(guestsOf(anna.partyId)).toBe(1);
    expect(guestsOf(first.json.partyId as string)).toBe(1);
  });
});

describe("Join tables' guest counts", () => {
  async function seatedCounting(guestCount: number) {
    const seated = await seatedWith(venue, "Caña");
    const counted = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/parties/${seated.partyId}/guests`,
      { guestCount, expectedPartyRevision: revisionOf(seated.partyId) },
    );
    expect(counted.status).toBe(200);
    return seated;
  }

  it("shows the two parties' counts added together on the table that holds them both", async () => {
    const anna = await seatedCounting(2);
    const lewis = await seatedCounting(3);

    const answer = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: lewis.tableId,
      expectedPartyRevision: revisionOf(anna.partyId),
      otherPartyId: lewis.partyId,
      expectedOtherPartyRevision: revisionOf(lewis.partyId),
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ partyId: anna.partyId });
    expect(await floorGuests(anna.tableId)).toBe(5);
    expect(await floorGuests(lewis.tableId)).toBe(5);
  });
});

describe("A803 split: the route", () => {
  async function annaWith(...names: string[]) {
    const anna = await seatedWith(venue, ...names, "Octopus");
    const second = await freeTable();
    const joined = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: second,
      expectedPartyRevision: revisionOf(anna.partyId),
    });
    expect(joined.status).toBe(200);
    const split = await post(
      `/api/bills/${anna.tabId}/move-dishes`,
      await observedBillActionBody(venue.db, `/api/bills/${anna.tabId}/move-dishes`, {
        lineIds: [lineIdsOf(anna.tabId)[names.length]],
        toBillId: null,
        expectedPartyRevision: revisionOf(anna.partyId),
      }),
    );
    expect(split.status).toBe(200);
    return { anna, second, octopusBill: split.json.billId as string };
  }

  function pay(billId: string, body: Record<string, unknown>) {
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
      submissionId: randomUUID(),
      tip: "0.00",
      method: "cash",
      ...body,
    });
  }

  function splitting(partyId: string, tableId: string, selection: unknown) {
    return {
      tableId,
      selection,
      expectedPartyRevision: revisionOf(partyId),
    };
  }

  it("a selection answers the new party and its bills, whole first and the new bill last, and no source", async () => {
    const { anna, second, octopusBill } = await annaWith("Tarta", "Caña");
    const [, beer] = lineIdsOf(anna.tabId);

    const answer = await post(
      `/api/parties/${anna.partyId}/split-table`,
      splitting(anna.partyId, second, {
        wholeBillIds: [octopusBill],
        loose: [{ billId: anna.tabId, lineIds: [beer] }],
      }),
    );

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const billIds = answer.json.billIds as string[];
    expect(answer.json).toEqual({ partyId: answer.json.partyId, billIds });
    expect(billIds).toHaveLength(2);
    expect(billIds[0]).toBe(octopusBill);
    expect(lineIdsOf(billIds[1]!)).toEqual([beer]);
    expect(lineIdsOf(anna.tabId)).toHaveLength(1);
    expect(tablesOf(answer.json.partyId as string)).toEqual([second]);
    expect(tablesOf(anna.partyId)).toEqual([anna.tableId]);
  });

  it("upper-case ids name the same bills and dishes, and are answered lower-cased", async () => {
    const { anna, second, octopusBill } = await annaWith("Tarta", "Caña");
    const [, beer] = lineIdsOf(anna.tabId);

    const answer = await post(
      `/api/parties/${anna.partyId.toUpperCase()}/split-table`,
      splitting(anna.partyId, second.toUpperCase(), {
        wholeBillIds: [octopusBill.toUpperCase()],
        loose: [{ billId: anna.tabId.toUpperCase(), lineIds: [beer!.toUpperCase()] }],
      }),
    );

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const billIds = answer.json.billIds as string[];
    expect(billIds[0]).toBe(octopusBill);
    expect(lineIdsOf(billIds[1]!)).toEqual([beer]);
  });

  it("an empty selection opens a new empty bill at the leaving table", async () => {
    const { anna, second } = await annaWith("Tarta", "Caña");

    const answer = await post(
      `/api/parties/${anna.partyId}/split-table`,
      splitting(anna.partyId, second, { wholeBillIds: [], loose: [] }),
    );

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const billIds = answer.json.billIds as string[];
    expect(billIds).toHaveLength(1);
    expect(lineIdsOf(billIds[0]!)).toEqual([]);
  });

  it("an empty selection after moving the last bill keeps its replacement and gives the leaving table one empty bill", async () => {
    const anna = await seatedWith(venue, "Tarta");
    const second = await freeTable();
    const joined = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: second,
      expectedPartyRevision: revisionOf(anna.partyId),
    });
    expect(joined.status).toBe(200);
    const moved = await post(`/api/bills/${anna.tabId}/move`, {
      to: { counter: { zoneId: null } },
      partyId: anna.partyId,
      expectedPartyRevision: revisionOf(anna.partyId),
    });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    const billsOf = async (partyId: string) => {
      const read = await send(venue.app, venue.cookie, "GET", `/api/parties/${partyId}/bills`);
      expect(read.status).toBe(200);
      return read.json as unknown as { workingOrderId: string; outstanding: string }[];
    };
    const replacement = await billsOf(anna.partyId);
    expect(replacement).toHaveLength(1);
    expect(replacement[0]!.workingOrderId).not.toBe(anna.tabId);
    expect(replacement[0]!.outstanding).toBe("0.00");

    const answer = await post(
      `/api/parties/${anna.partyId}/split-table`,
      splitting(anna.partyId, second, { wholeBillIds: [], loose: [] }),
    );

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await billsOf(anna.partyId)).toEqual(replacement);
    const taken = await billsOf(answer.json.partyId as string);
    expect(taken.map((bill) => bill.workingOrderId)).toEqual(answer.json.billIds);
    expect(taken.map((bill) => bill.outstanding)).toEqual(["0.00"]);
    expect(tablesOf(answer.json.partyId as string)).toEqual([second]);
    expect(tablesOf(anna.partyId)).toEqual([anna.tableId]);
  });

  it.each<[string, (billId: string, lineId: string) => unknown]>([
    ["null", () => null],
    ["a number", () => 5],
    ["a list", () => []],
    ["no wholeBillIds", () => ({ loose: [] })],
    ["wholeBillIds not a list", () => ({ wholeBillIds: 5, loose: [] })],
    ["no loose", () => ({ wholeBillIds: [] })],
    ["loose not a list", () => ({ wholeBillIds: [], loose: {} })],
    ["a whole id not a UUID", () => ({ wholeBillIds: ["not-a-uuid"], loose: [] })],
    ["a whole id not a string", () => ({ wholeBillIds: [7], loose: [] })],
    ["a loose entry not an object", () => ({ wholeBillIds: [], loose: ["x"] })],
    ["a loose entry null", () => ({ wholeBillIds: [], loose: [null] })],
    [
      "a loose entry with no billId",
      (_, lineId) => ({ wholeBillIds: [], loose: [{ lineIds: [lineId] }] }),
    ],
    [
      "a loose billId not a UUID",
      (_, lineId) => ({ wholeBillIds: [], loose: [{ billId: "nope", lineIds: [lineId] }] }),
    ],
    ["a loose entry with no lineIds", (billId) => ({ wholeBillIds: [], loose: [{ billId }] })],
    [
      "a line id not a UUID",
      (billId) => ({ wholeBillIds: [], loose: [{ billId, lineIds: ["nope"] }] }),
    ],
    [
      "a loose entry with no lines",
      (billId) => ({ wholeBillIds: [], loose: [{ billId, lineIds: [] }] }),
    ],
    [
      "one bill both whole and loose",
      (billId, lineId) => ({
        wholeBillIds: [billId],
        loose: [{ billId, lineIds: [lineId] }],
      }),
    ],
    ["a whole id twice", (billId) => ({ wholeBillIds: [billId, billId], loose: [] })],
  ])("%s is refused management.request_invalid on selection, changing nothing", async (_, make) => {
    const { anna, second } = await annaWith("Tarta", "Caña");
    const [cake] = lineIdsOf(anna.tabId);
    const revision = revisionOf(anna.partyId);

    const answer = await post(
      `/api/parties/${anna.partyId}/split-table`,
      splitting(anna.partyId, second, make(anna.tabId, cake!)),
    );

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "selection" },
    });
    expect(revisionOf(anna.partyId)).toBe(revision);
    expect(tablesOf(anna.partyId)).toContain(second);
  });

  it.each([
    ["a bill id", (bill: string) => bill],
    ["null", () => null],
  ])("a body with %s as billId and no selection refuses, moving nothing", async (_, billOf) => {
    const { anna, second, octopusBill } = await annaWith("Tarta");
    const revision = revisionOf(anna.partyId);

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      expectedEdits: [],
      tableId: second,
      billId: billOf(octopusBill),
      expectedPartyRevision: revision,
    });

    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "selection" },
    });
    expect(revisionOf(anna.partyId)).toBe(revision);
    expect(tablesOf(anna.partyId).sort()).toEqual([anna.tableId, second].sort());
  });

  it("a body naming both goes by its selection", async () => {
    const { anna, second, octopusBill } = await annaWith("Tarta");

    const answer = await post(`/api/parties/${anna.partyId}/split-table`, {
      expectedEdits: [],
      tableId: second,
      billId: octopusBill,
      selection: { wholeBillIds: [], loose: [] },
      expectedPartyRevision: revisionOf(anna.partyId),
    });

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const billIds = answer.json.billIds as string[];
    expect(billIds).not.toContain(octopusBill);
    expect(lineIdsOf(billIds[0]!)).toEqual([]);
  });

  describe("a loose refusal answers its code's status, moving nothing", () => {
    async function refusal(
      anna: { partyId: string; tabId: string },
      second: string,
      lineId: string,
      app = venue.app,
    ) {
      const revision = revisionOf(anna.partyId);
      const lines = lineIdsOf(anna.tabId);
      const body = await observedTableActionBody(
        venue.db,
        `/api/parties/${anna.partyId}/split-table`,
        splitting(anna.partyId, second, {
          wholeBillIds: [],
          loose: [{ billId: anna.tabId, lineIds: [lineId] }],
        }),
      );
      const answer = await send(
        app,
        venue.cookie,
        "POST",
        `/api/parties/${anna.partyId}/split-table`,
        body,
      );
      expect(revisionOf(anna.partyId)).toBe(revision);
      expect(lineIdsOf(anna.tabId)).toEqual(lines);
      expect(tablesOf(anna.partyId)).toContain(second);
      return answer;
    }

    it("a dish the bill does not hold: 404 tab.line_not_found", async () => {
      const { anna, second } = await annaWith("Tarta", "Caña");

      const answer = await refusal(anna, second, randomUUID());

      expect(answer.status).toBe(404);
      expect(answer.json).toMatchObject({ code: "tab.line_not_found" });
    });

    it("a paid dish: 409 bill.line_paid", async () => {
      const { anna, second } = await annaWith("Tarta", "Caña");
      const paid = await pay(anna.tabId, {
        kind: "items",
        lines: [{ lineNo: 1 }],
        tendered: "18.00",
        applied: "18.00",
      });
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);

      const answer = await refusal(anna, second, lineIdsOf(anna.tabId)[0]!);

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code: "bill.line_paid" });
    });

    it("a pick leaving less than was received: 409 bill.received_exceeds_total", async () => {
      const { anna, second } = await annaWith("Tarta", "Caña");
      const paid = await pay(anna.tabId, {
        kind: "contribution",
        amount: "18.00",
        tendered: "18.00",
        applied: "18.00",
      });
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);

      const answer = await refusal(anna, second, lineIdsOf(anna.tabId)[0]!);

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code: "bill.received_exceeds_total" });
    });

    it("an extra's id: 400 tab.transfer_modifier_line", async () => {
      const { anna, second } = await annaWith("Tarta", "Caña");
      const [cake, beer] = lineIdsOf(anna.tabId);
      venue.db.run(sql`update working_order_lines set parent_line_id = ${cake} where id = ${beer}`);

      const answer = await refusal(anna, second, beer!);

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({ code: "tab.transfer_modifier_line" });
    });

    it("a new bill over the simplified-invoice limit: 409 sale.total_exceeds_simplified_limit", async () => {
      const { anna, second } = await annaWith("Tarta", "Caña");
      const app = new Hono();
      mountTillApi(
        app,
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
          cfg: { ...venue.cfg, simplifiedInvoiceLimit: decimal("10.00") },
          secureCookies: false,
          venueLocale: venue.cfg.locale,
        },
        () => {},
      );

      const answer = await refusal(anna, second, lineIdsOf(anna.tabId)[0]!, app);

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code: "sale.total_exceeds_simplified_limit" });
    });

    it("another person's unsent dishes on the source: 409 draft.taken_over with the conflicts", async () => {
      const { anna, second } = await annaWith("Tarta", "Caña");
      await withTransaction(venue.db, (tx) =>
        saveDraftForTest(tx, venue.cfg, anna.partyId, venue.adminId, {
          billId: anna.tabId,
          draftId: null,
          revision: 0,
          lines: [
            {
              menuItemId: venue.offerFor("Paella"),
              variantId: null,
              menuVersionId: null,
              quantity: "1",
              options: [],
              extras: [],
              note: null,
              courseId: null,
              noMerge: false,
              slot: 1,
              joinGroupId: null,
              afterGroupId: null,
            },
          ],
        }),
      );

      const answer = await refusal(anna, second, lineIdsOf(anna.tabId)[0]!);

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({
        code: "draft.taken_over",
        params: { billId: anna.tabId, ownerId: venue.adminId, conflicts: [{ billId: anna.tabId }] },
      });
    });
  });
});

describe("A803 race replay: through the route", () => {
  async function annaAtThree() {
    const { anna, second, billId } = await annaAtTwo();
    const third = await freeTable();
    const joined = await post(`/api/parties/${anna.partyId}/join`, {
      tableId: third,
      expectedPartyRevision: revisionOf(anna.partyId),
    });
    expect(joined.status).toBe(200);
    return { anna, second, third, billId };
  }

  function counts() {
    return venue.db.all<{ parties: number; bills: number; notices: number; events: number }>(sql`
      select
        (select count(*) from parties) as parties,
        (select count(*) from working_orders) as bills,
        (select count(*) from kitchen_notices) as notices,
        (select count(*) from order_group_events) as events`)[0]!;
  }

  function partyRow(partyId: string) {
    return venue.db.all<{ revision: number }>(sql`select * from parties where id = ${partyId}`)[0]!;
  }

  /** Leaves out `devices`: a request stamps its till's `last_seen_at` when due, so two runs can differ. */
  function rowsExceptSightings() {
    return tableSnapshot(venue.db, ["devices"]);
  }

  /**
   * Per table, how many rows a span added and which columns of how many rows it changed. A count of
   * rows and a set of columns, because two runs write different ids and times.
   */
  function rowChanges(before: Record<string, unknown[]>, after: Record<string, unknown[]>) {
    const changes: Record<string, { added: number; changed: number; columns: string[] }> = {};
    for (const [table, rows] of Object.entries(after)) {
      const columns = new Set<string>();
      let changed = 0;
      rows.slice(0, before[table]!.length).forEach((row, at) => {
        const was = before[table]![at] as Record<string, unknown>;
        const differing = Object.entries(row as object).filter(([key, v]) => v !== was[key]);
        if (differing.length > 0) changed += 1;
        for (const [key] of differing) columns.add(key);
      });
      const added = rows.length - before[table]!.length;
      if (added !== 0 || changed > 0) {
        changes[table] = { added, changed, columns: [...columns].sort() };
      }
    }
    return changes;
  }

  async function splitBodies(at: Awaited<ReturnType<typeof annaAtThree>>) {
    const path = `/api/parties/${at.anna.partyId}/split-table`;
    return {
      whole: await observedTableActionBody(venue.db, path, {
        tableId: at.second,
        selection: { wholeBillIds: [at.billId], loose: [] },
        expectedPartyRevision: revisionOf(at.anna.partyId),
      }),
      loose: await observedTableActionBody(venue.db, path, {
        tableId: at.third,
        selection: {
          wholeBillIds: [],
          loose: [{ billId: at.billId, lineIds: [lineOf(at.billId)] }],
        },
        expectedPartyRevision: revisionOf(at.anna.partyId),
      }),
    };
  }

  function lineOf(billId: string) {
    return venue.db.all<{ id: string }>(
      sql`select id from working_order_lines where working_order_id = ${billId} order by line_no`,
    )[0]!.id;
  }

  function billsOf(partyId: string) {
    return venue.db
      .all<{ id: string }>(sql`select id from working_orders where party_id = ${partyId}`)
      .map((row) => row.id);
  }

  it("A803 race replay: a lost reply's resend of a successful split is refused, and no second party, bill or notice exists", async () => {
    const { anna, second, billId } = await annaAtTwo();
    const path = `/api/parties/${anna.partyId}/split-table`;
    const body = await observedTableActionBody(venue.db, path, {
      tableId: second,
      selection: { wholeBillIds: [billId], loose: [] },
      expectedPartyRevision: revisionOf(anna.partyId),
    });
    const before = counts();

    const first = await send(venue.app, venue.cookie, "POST", path, body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const after = counts();
    expect(after.parties).toBe(before.parties + 1);
    expect(after.notices).toBeGreaterThan(before.notices);
    const revision = revisionOf(anna.partyId);
    const rowsAfterFirst = await rowsExceptSightings();

    const resend = await send(venue.app, venue.cookie, "POST", path, body);

    expect(resend.status).toBe(409);
    expect(resend.json).toMatchObject({ code: "party.out_of_date" });
    expect(counts()).toEqual(after);
    expect(revisionOf(anna.partyId)).toBe(revision);
    expect(await rowsExceptSightings()).toEqual(rowsAfterFirst);
    expect(tablesOf(first.json.partyId as string)).toEqual([second]);
    expect(billsOf(first.json.partyId as string)).toEqual([billId]);
  });

  for (const first of ["whole", "loose"] as const) {
    it(`A803 race replay: two tills on one party, one picking Bill 2 whole and the other Bill 2's dish loose: one commits (${first} sent first)`, async () => {
      const { anna, second, third, billId } = await annaAtThree();
      const dish = lineOf(billId);
      const path = `/api/parties/${anna.partyId}/split-table`;
      const bodies = await splitBodies({ anna, second, third, billId });
      const sent =
        first === "whole" ? (["whole", "loose"] as const) : (["loose", "whole"] as const);
      const before = counts();
      const partyBefore = partyRow(anna.partyId);
      const rowsBefore = await rowsExceptSightings();

      const answers = await Promise.all([
        send(venue.app, venue.cookie, "POST", path, bodies[sent[0]]),
        send(venue.app, venue.cookie2, "POST", path, bodies[sent[1]]),
      ]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      const wonAt = answers.findIndex((answer) => answer.status === 200);
      expect(answers[1 - wonAt]!.json).toMatchObject({ code: "party.out_of_date" });
      const winner = sent[wonAt]!;
      expect(counts()).toEqual({
        parties: before.parties + 1,
        bills: before.bills + (winner === "loose" ? 1 : 0),
        notices: before.notices + 1,
        events: before.events + 1,
      });
      expect(partyRow(anna.partyId)).toEqual({
        ...partyBefore,
        revision: partyBefore.revision + 1,
      });
      // Against the same split sent alone: a read at the first answer misses a refused request's
      // write that lands before that answer.
      const raced = rowChanges(rowsBefore, await rowsExceptSightings());
      const alone = await annaAtThree();
      const aloneBodies = await splitBodies(alone);
      const rowsBeforeAlone = await rowsExceptSightings();
      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${alone.anna.partyId}/split-table`,
        aloneBodies[winner],
      );
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect(raced).toEqual(rowChanges(rowsBeforeAlone, await rowsExceptSightings()));
      const tableOf = { whole: second, loose: third };
      const newParty = answers[wonAt]!.json.partyId as string;
      expect(tablesOf(newParty)).toEqual([tableOf[winner]]);
      expect(tablesOf(anna.partyId)).toEqual([
        anna.tableId,
        tableOf[winner === "whole" ? "loose" : "whole"],
      ]);
      const onNewParty = venue.db.all<{ id: string }>(sql`
        select l.id from working_order_lines l
        join working_orders o on o.id = l.working_order_id
        where o.party_id = ${newParty}`);
      expect(onNewParty).toEqual([{ id: dish }]);
    });
  }
});

describe("A803 split: the panel's read", () => {
  async function read(partyId: string) {
    return send(venue.app, venue.cookie, "GET", `/api/parties/${partyId}/split-sources`);
  }

  async function splitOff(billId: string, partyId: string, lineNo: number): Promise<string> {
    const path = `/api/bills/${billId}/move-dishes`;
    const split = await post(
      path,
      await observedBillActionBody(venue.db, path, {
        lineIds: venue.db
          .all<{ id: string }>(
            sql`select id from working_order_lines
                where working_order_id = ${billId} and line_no = ${lineNo}`,
          )
          .map((row) => row.id),
        toBillId: null,
        expectedPartyRevision: revisionOf(partyId),
      }),
    );
    expect(split.status, JSON.stringify(split.json)).toBe(200);
    return split.json.billId as string;
  }

  function payItems(billId: string, lineNo: number, amount: string) {
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
      submissionId: randomUUID(),
      tip: "0.00",
      method: "cash",
      kind: "items",
      lines: [{ lineNo }],
      tendered: amount,
      applied: amount,
    });
  }

  async function presentByHand(billId: string) {
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, billId)),
    );
  }

  async function lewisWithAnnaFamilyBill(...dishes: string[]) {
    const anna = await seatedWith(venue, "Caña");
    const paid = await payItems(anna.tabId, 1, "3.00");
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const lewis = await seatedWith(venue, ...dishes);
    const joined = await post(`/api/parties/${lewis.partyId}/join`, {
      tableId: anna.tableId,
      otherPartyId: anna.partyId,
      expectedOtherPartyRevision: revisionOf(anna.partyId),
      expectedPartyRevision: revisionOf(lewis.partyId),
    });
    expect(joined.status, JSON.stringify(joined.json)).toBe(200);
    return { familyParty: anna.partyId, lewis };
  }

  it("answers the party's open and presented bills in number order, each with the dishes and balance of its own reads", async () => {
    const { familyParty, lewis } = await lewisWithAnnaFamilyBill(
      "Tarta",
      "Caña",
      "Octopus",
      "Caña",
      "Caña",
      "Octopus",
      "Caña",
    );
    const partPaid = lewis.tabId;
    const family = await splitOff(partPaid, lewis.partyId, 7);
    const open = await splitOff(partPaid, lewis.partyId, 6);
    const settled = await splitOff(partPaid, lewis.partyId, 5);
    const abandoned = await splitOff(partPaid, lewis.partyId, 4);
    const presented = await splitOff(partPaid, lewis.partyId, 3);

    const mergePath = `/api/bills/${partPaid}/merge`;
    const merged = await post(
      mergePath,
      await observedBillActionBody(venue.db, mergePath, {
        fromBillId: abandoned,
        expectedPartyRevision: revisionOf(lewis.partyId),
      }),
    );
    expect(merged.status, JSON.stringify(merged.json)).toBe(204);
    expect(await statusOf(venue, abandoned)).toBe("abandoned");

    const paidAll = await payItems(settled, 1, "3.00");
    expect(paidAll.status, JSON.stringify(paidAll.json)).toBe(200);
    expect(await statusOf(venue, settled)).toBe("settled");

    const paidOne = await payItems(partPaid, 1, "18.00");
    expect(paidOne.status, JSON.stringify(paidOne.json)).toBe(200);

    const linesOf = async (billId: string) => {
      const answer = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/working-orders/${billId}/lines`,
      );
      expect(answer.status).toBe(200);
      return answer.json.lines;
    };
    const presentedLines = await linesOf(presented);
    expect(presentedLines).toHaveLength(1);
    await presentByHand(presented);
    // Anna's own bill is settled, which the status filter alone drops, so an open one is put on her
    // party by hand for only the party filter to keep out.
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ partyId: familyParty }).where(eq(workingOrders.id, family)),
    );

    const balanceOf = async (billId: string) => {
      const answer = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/working-orders/${billId}/payments`,
      );
      expect(answer.status).toBe(200);
      return answer.json;
    };

    const inNumberOrder = (await numbersOf(venue, lewis.partyId))
      .map(([id]) => id)
      .filter((id) => [partPaid, presented, open].includes(id));
    expect(new Set(inNumberOrder)).toEqual(new Set([partPaid, presented, open]));

    const answer = await read(lewis.partyId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const expected: Record<string, unknown> = {
      [partPaid]: {
        billId: partPaid,
        lines: await linesOf(partPaid),
        balance: await balanceOf(partPaid),
      },
      [presented]: {
        billId: presented,
        lines: presentedLines,
        balance: await balanceOf(presented),
      },
      [open]: { billId: open, lines: await linesOf(open), balance: await balanceOf(open) },
    };
    expect(answer.json).toEqual({
      partyRevision: revisionOf(lewis.partyId),
      bills: inNumberOrder.map((id) => expected[id]),
    });

    const bills = answer.json.bills as {
      billId: string;
      balance: { status: string; paidLines: { lineNo: number; paidQuantity: string }[] };
    }[];
    const paidRow = bills.find((bill) => bill.billId === partPaid)!;
    expect(paidRow.balance.paidLines).toMatchObject([{ lineNo: 1, paidQuantity: "1.000" }]);
    expect(bills.find((bill) => bill.billId === presented)!.balance.status).toBe("placed");

    expect((await read(lewis.partyId.toUpperCase())).json).toEqual(answer.json);
  });

  it("lists a bill moved onto the table by its number, below a bill opened after it", async () => {
    const anna = await seatedWith(venue, "Caña");
    const lewis = await seatedWith(venue, "Octopus");
    const moved = await post(`/api/bills/${anna.tabId}/move`, {
      partyId: anna.partyId,
      expectedPartyRevision: revisionOf(anna.partyId),
      to: { tableId: lewis.tableId },
      otherPartyId: lewis.partyId,
      expectedOtherPartyRevision: revisionOf(lewis.partyId),
    });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect((await numbersOf(venue, lewis.partyId)).map(([id, n]) => [id, n])).toEqual([
      [lewis.tabId, 1],
      [anna.tabId, 2],
    ]);

    const answer = await read(lewis.partyId);

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const bills = answer.json.bills as { billId: string }[];
    expect(bills.map((bill) => bill.billId)).toEqual([lewis.tabId, anna.tabId]);
  });

  it("refuses 409 party.not_open for an id that is no UUID", async () => {
    const refused = await read("not-a-uuid");

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: "party.not_open",
      params: { partyId: "not-a-uuid" },
    });
  });

  it("A803 waiting mark: Split a table's rows and Move dishes' rows both say a held dish waits, and neither once its group is fired", async () => {
    const anna = await seatedWith(venue);
    const placed = await post(`/api/parties/${anna.partyId}/groups`, {
      expectedEdit: await withTransaction(venue.db, (tx) => readBillEditState(tx, anna.tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(anna.partyId),
      groups: [
        { lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "fire" },
        { lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }], release: "hold" },
      ],
    });
    expect(placed.status, JSON.stringify(placed.json)).toBe(200);
    const [cake] = venue.db.all<{ groupId: string }>(
      sql`select group_id as groupId from working_order_lines where working_order_id = ${anna.tabId} and name = 'Tarta'`,
    );
    const marks = async () => {
      const sources = await read(anna.partyId);
      const bill = await send(
        venue.app,
        venue.cookie,
        "GET",
        `/api/working-orders/${anna.tabId}/lines`,
      );
      expect(sources.status, JSON.stringify(sources.json)).toBe(200);
      expect(bill.status, JSON.stringify(bill.json)).toBe(200);
      const answered = sources.json as { bills: { lines: Record<string, unknown>[] }[] };
      const of = (lines: Record<string, unknown>[]) =>
        lines.map((line) => [line.name, line.waitsInHeldGroup]);
      return {
        sources: of(answered.bills[0]!.lines),
        bill: of((bill.json as { lines: Record<string, unknown>[] }).lines),
      };
    };
    const waiting = [
      ["Caña", undefined],
      ["Tarta", true],
    ];
    expect(await marks()).toEqual({ sources: waiting, bill: waiting });

    const fired = await post(`/api/parties/${anna.partyId}/groups/${cake!.groupId}/fire`, {
      submissionId: randomUUID(),
      expectedPartyRevision: revisionOf(anna.partyId),
    });
    expect(fired.status, JSON.stringify(fired.json)).toBe(200);

    const none = [
      ["Caña", undefined],
      ["Tarta", undefined],
    ];
    expect(await marks()).toEqual({ sources: none, bill: none });
  });

  it("answers no bills for a UUID that names no party, as the drafts read answers empty", async () => {
    const answer = await read(randomUUID());

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toEqual({ partyRevision: 0, bills: [] });
  });

  it("a split sent at the revision answered for a UUID that names no party is refused", async () => {
    const partyId = randomUUID();
    const { partyRevision } = (await read(partyId)).json as { partyRevision: number };

    const refused = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${partyId}/split-table`,
      {
        tableId: await freeTable(),
        selection: { wholeBillIds: [], loose: [] },
        expectedPartyRevision: partyRevision,
        expectedEdits: [],
      },
    );

    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json).toMatchObject({ code: "party.not_open" });
  });

  describe("the revision it answers with its rows", () => {
    async function twoBillsOnTwoTables() {
      const anna = await seatedWith(venue, "Tarta", "Octopus");
      const second = await freeTable();
      const joined = await post(`/api/parties/${anna.partyId}/join`, {
        tableId: second,
        expectedPartyRevision: revisionOf(anna.partyId),
      });
      expect(joined.status, JSON.stringify(joined.json)).toBe(200);
      const octopusBill = await splitOff(anna.tabId, anna.partyId, 2);
      const [cake] = venue.db.all<{ id: string }>(
        sql`select id from working_order_lines where working_order_id = ${anna.tabId}`,
      );
      return { anna, second, octopusBill, cake: cake!.id };
    }

    function moveDish(from: string, to: string, partyId: string, lineId: string) {
      const path = `/api/bills/${from}/move-dishes`;
      return observedBillActionBody(venue.db, path, {
        expectedPartyRevision: revisionOf(partyId),
        lineIds: [lineId],
        toBillId: to,
      }).then((body) => send(venue.app, venue.cookie, "POST", path, body));
    }

    type Rows = { partyRevision: number; bills: { billId: string; lines: { id: string }[] }[] };
    const dishesOn = (rows: Rows, billId: string) =>
      rows.bills.find((bill) => bill.billId === billId)!.lines.length;

    it("is the party's", async () => {
      const { anna } = await twoBillsOnTwoTables();

      const rows = (await read(anna.partyId)).json as Rows;

      expect(rows.partyRevision).toBe(revisionOf(anna.partyId));
    });

    it("a press at it after another till moved a dish is refused 409; the next read shows the dish, and a press at that read's revision takes it", async () => {
      const { anna, second, octopusBill, cake } = await twoBillsOnTwoTables();
      const shown = (await read(anna.partyId)).json as Rows;
      expect(dishesOn(shown, octopusBill)).toBe(1);
      const moved = await moveDish(anna.tabId, octopusBill, anna.partyId, cake);
      expect(moved.status, JSON.stringify(moved.json)).toBe(200);
      const path = `/api/parties/${anna.partyId}/split-table`;
      const press = async (rows: Rows) =>
        send(
          venue.app,
          venue.cookie,
          "POST",
          path,
          await observedTableActionBody(venue.db, path, {
            tableId: second,
            selection: { wholeBillIds: [octopusBill], loose: [] },
            expectedPartyRevision: rows.partyRevision,
          }),
        );

      const stale = await press(shown);
      expect(stale.status, JSON.stringify(stale.json)).toBe(409);
      expect(stale.json).toMatchObject({ code: "party.out_of_date" });

      const fresh = (await read(anna.partyId)).json as Rows;
      expect(fresh.partyRevision).toBeGreaterThan(shown.partyRevision);
      expect(dishesOn(fresh, octopusBill)).toBe(2);

      const accepted = await press(fresh);
      expect(accepted.status, JSON.stringify(accepted.json)).toBe(200);
      const [{ dishes }] = venue.db.all<{ dishes: number }>(
        sql`select count(*) as dishes from working_order_lines where working_order_id = ${octopusBill}`,
      ) as [{ dishes: number }];
      expect(dishes).toBe(2);
      const onNewParty = venue.db.all<{ id: string }>(
        sql`select id from working_orders where party_id = ${accepted.json.partyId as string}`,
      );
      expect(onNewParty).toEqual([{ id: octopusBill }]);
    });

    it("a press that knows no edit state names an untouched bill's: taken on one, and refused on an edited one with the state, which the next press names", async () => {
      const untouched = await twoBillsOnTwoTables();
      const blank = (billId: string) => ({
        billId,
        editorVersion: 0,
        draftId: null,
        draftRevision: null,
      });
      const pressNaming = (partyId: string, tableId: string, billId: string, edit: unknown) =>
        send(venue.app, venue.cookie, "POST", `/api/parties/${partyId}/split-table`, {
          tableId,
          selection: { wholeBillIds: [billId], loose: [] },
          expectedPartyRevision: revisionOf(partyId),
          expectedEdits: [edit],
          guestCounts: { staying: null, leaving: null },
        });
      const taken = await pressNaming(
        untouched.anna.partyId,
        untouched.second,
        untouched.octopusBill,
        blank(untouched.octopusBill),
      );
      expect(taken.status, JSON.stringify(taken.json)).toBe(200);

      const { anna, second, octopusBill } = await twoBillsOnTwoTables();
      const savedDraft = await send(
        venue.app,
        venue.cookie,
        "PUT",
        `/api/parties/${anna.partyId}/drafts`,
        {
          billId: octopusBill,
          draftId: null,
          revision: 0,
          expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, octopusBill)),
          lines: [{ menuItemId: venue.offerFor("Octopus"), quantity: "1" }],
        },
      );
      expect(savedDraft.status, JSON.stringify(savedDraft.json)).toBe(200);

      const refused = await pressNaming(anna.partyId, second, octopusBill, blank(octopusBill));
      expect(refused.status, JSON.stringify(refused.json)).toBe(409);
      expect(refused.json).toMatchObject({
        code: "draft.out_of_date",
        params: { billId: octopusBill },
      });
      const { edit } = refused.json.params as { edit: Record<string, unknown> };
      expect(edit).toMatchObject({ billId: octopusBill });
      expect(edit.editorVersion).not.toBe(0);

      const retried = await pressNaming(anna.partyId, second, octopusBill, {
        billId: edit.billId,
        editorVersion: edit.editorVersion,
        draftId: edit.draftId,
        draftRevision: edit.draftRevision,
      });
      expect(retried.status, JSON.stringify(retried.json)).toBe(200);
    });

    it("a press that knows no edit state, on a whole bill another person's unsent dish holds: refused draft.out_of_date, and told who holds it", async () => {
      const { anna, second, octopusBill } = await twoBillsOnTwoTables();
      await withTransaction(venue.db, (tx) =>
        saveDraftForTest(tx, venue.cfg, anna.partyId, venue.adminId, {
          billId: octopusBill,
          draftId: null,
          revision: 0,
          lines: [
            {
              menuItemId: venue.offerFor("Tarta"),
              variantId: null,
              menuVersionId: null,
              quantity: "1",
              options: [],
              extras: [],
              note: null,
              courseId: null,
              noMerge: false,
              slot: 1,
              joinGroupId: null,
              afterGroupId: null,
            },
          ],
        }),
      );

      const refused = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${anna.partyId}/split-table`,
        {
          tableId: second,
          selection: { wholeBillIds: [octopusBill], loose: [] },
          expectedPartyRevision: revisionOf(anna.partyId),
          expectedEdits: [
            { billId: octopusBill, editorVersion: 0, draftId: null, draftRevision: null },
          ],
          guestCounts: { staying: null, leaving: null },
        },
      );

      expect(refused.status, JSON.stringify(refused.json)).toBe(409);
      expect(refused.json).toMatchObject({
        code: "draft.out_of_date",
        params: {
          billId: octopusBill,
          edit: { billId: octopusBill, editorId: venue.adminId, editorName: "Administrator" },
        },
      });
      const { edit } = refused.json.params as { edit: Record<string, unknown> };
      expect(edit.editorVersion).not.toBe(0);
      expect(edit.draftId).toEqual(expect.any(String));
    });

    it("an order sent on a bill moves it too, so rows from before are refused whatever edit state the press carries", async () => {
      const { anna, second, octopusBill } = await twoBillsOnTwoTables();
      const savedDraft = await send(
        venue.app,
        venue.cookie,
        "PUT",
        `/api/parties/${anna.partyId}/drafts`,
        {
          billId: octopusBill,
          draftId: null,
          revision: 0,
          expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, octopusBill)),
          lines: [{ menuItemId: venue.offerFor("Octopus"), quantity: "1" }],
        },
      );
      expect(savedDraft.status, JSON.stringify(savedDraft.json)).toBe(200);
      const draft = savedDraft.json.draft as {
        id: string;
        revision: number;
        lines: { id: string }[];
      };
      const shown = (await read(anna.partyId)).json as Rows;

      const submitted = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${anna.partyId}/drafts/${draft.id}/submit`,
        {
          submissionId: randomUUID(),
          expectedPartyRevision: revisionOf(anna.partyId),
          draftRevision: draft.revision,
          groups: [{ lineIds: [draft.lines[0]!.id], release: "fire" }],
          expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, octopusBill)),
        },
      );
      expect(submitted.status, JSON.stringify(submitted.json)).toBe(200);
      expect(revisionOf(anna.partyId)).toBeGreaterThan(shown.partyRevision);

      const path = `/api/parties/${anna.partyId}/split-table`;
      const press = await send(
        venue.app,
        venue.cookie,
        "POST",
        path,
        await observedTableActionBody(venue.db, path, {
          tableId: second,
          selection: { wholeBillIds: [octopusBill], loose: [] },
          expectedPartyRevision: shown.partyRevision,
        }),
      );

      expect(press.status, JSON.stringify(press.json)).toBe(409);
      expect(press.json).toMatchObject({ code: "party.out_of_date" });
    });

    it("reads taken while another till moves a dish back and forth never pair a revision with rows from another", async () => {
      const { anna, octopusBill, cake } = await twoBillsOnTwoTables();
      const start = revisionOf(anna.partyId);
      let moving = true;
      const mover = (async () => {
        for (let turn = 0; turn < 8; turn++) {
          const [from, to] = turn % 2 === 0 ? [anna.tabId, octopusBill] : [octopusBill, anna.tabId];
          const moved = await moveDish(from, to, anna.partyId, cake);
          expect(moved.status, JSON.stringify(moved.json)).toBe(200);
        }
        moving = false;
      })();
      const answers: Rows[] = [];
      const reader = async () => {
        while (moving) answers.push((await read(anna.partyId)).json as Rows);
      };
      await Promise.all([mover, reader(), reader(), reader()]);

      expect(new Set(answers.map((rows) => rows.partyRevision)).size).toBeGreaterThan(2);
      for (const rows of answers) {
        const moved = (rows.partyRevision - start) % 2 === 1;
        expect([rows.partyRevision, dishesOn(rows, octopusBill)]).toEqual([
          rows.partyRevision,
          moved ? 2 : 1,
        ]);
      }
    });
  });

  it("requires a session", async () => {
    const { partyId } = await seatedWith(venue, "Caña");

    const answer = await send(venue.app, "", "GET", `/api/parties/${partyId}/split-sources`);

    expect(answer.status).toBe(401);
    expect(answer.json).toEqual({ code: "session.required", params: {} });
  });

  it("reading it does not stamp the device as seen, where the bills read does", async () => {
    const { partyId } = await seatedWith(venue, "Caña");
    const longAgo = "2020-01-01T00:00:00.000Z";
    await inTx(venue, (tx) =>
      tx.update(devices).set({ lastSeenAt: longAgo }).where(eq(devices.id, venue.deviceId)),
    );
    const lastSeen = async () => {
      const [device] = await inTx(venue, (tx) =>
        tx
          .select({ lastSeenAt: devices.lastSeenAt })
          .from(devices)
          .where(eq(devices.id, venue.deviceId)),
      );
      return device!.lastSeenAt;
    };

    expect((await read(partyId)).status).toBe(200);
    expect(await lastSeen()).toBe(longAgo);

    const notPassive = await send(venue.app, venue.cookie, "GET", `/api/parties/${partyId}/bills`);
    expect(notPassive.status).toBe(200);
    expect(await lastSeen()).not.toBe(longAgo);
  });
});
