import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

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

function post(path: string, body: unknown, cookie = venue.cookie) {
  return send(venue.app, cookie, "POST", path, body);
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

async function freeTable(): Promise<string> {
  const table = await post("/api/tables", {
    label: `Mesa ${randomUUID().slice(0, 8)}`,
    zoneId: venue.zoneId,
  });
  expect(table.status).toBe(200);
  return table.json.id as string;
}

/** Ana at two tables, her main bill (Tarta) and a split bill (Pulpo). */
async function anaAtTwo() {
  const ana = await seatedWith(venue, "Tarta", "Pulpo");
  const second = await freeTable();
  const joined = await post(`/api/parties/${ana.partyId}/join`, {
    tableId: second,
    expectedPartyRevision: revisionOf(ana.partyId),
  });
  expect(joined.status).toBe(200);
  const split = await post(`/api/bills/${ana.tabId}/split`, {
    transfers: [{ lineNo: 2 }],
    expectedPartyRevision: revisionOf(ana.partyId),
  });
  expect(split.status).toBe(200);
  return { ana, second, billId: split.json.billId as string };
}

describe("the table action routes", () => {
  it("move guests to a free table, answering the party and its main bill", async () => {
    const ana = await seatedWith(venue, "Tarta");
    const to = await freeTable();

    const answer = await post(`/api/parties/${ana.partyId.toUpperCase()}/move`, {
      toTableId: to.toUpperCase(),
      expectedPartyRevision: ana.revision,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: false });
    expect(tablesOf(ana.partyId)).toEqual([to]);
  });

  it("move guests to another party's table merges the bills by default, or keeps them separate", async () => {
    const ana = await seatedWith(venue, "Tarta");
    const luis = await seatedWith(venue, "Caña");
    const bea = await seatedWith(venue, "Pulpo");
    const cris = await seatedWith(venue, "Caña");

    const merged = await post(`/api/parties/${ana.partyId}/move`, {
      toTableId: luis.tableId,
      expectedPartyRevision: ana.revision,
      otherPartyId: luis.partyId,
      expectedOtherPartyRevision: luis.revision,
    });
    const separate = await post(`/api/parties/${bea.partyId}/move`, {
      toTableId: cris.tableId,
      bills: "separate",
      expectedPartyRevision: bea.revision,
      otherPartyId: cris.partyId,
      expectedOtherPartyRevision: cris.revision,
    });

    expect(merged.status).toBe(200);
    expect(merged.json).toEqual({ partyId: luis.partyId, mainBillId: luis.tabId, merged: true });
    expect(await statusOf(venue, ana.tabId)).toBe("abandoned");
    expect(separate.status).toBe(200);
    expect(separate.json).toEqual({ partyId: cris.partyId, mainBillId: cris.tabId, merged: false });
    expect(await statusOf(venue, bea.tabId)).toBe("open");
  });

  it("join tables, answering the party that holds them all", async () => {
    const ana = await seatedWith(venue, "Tarta");
    const luis = await seatedWith(venue, "Caña");

    const answer = await post(`/api/parties/${ana.partyId}/join`, {
      tableId: luis.tableId,
      bills: "separate",
      expectedPartyRevision: ana.revision,
      otherPartyId: luis.partyId,
      expectedOtherPartyRevision: luis.revision,
    });

    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: false });
    expect(tablesOf(ana.partyId).sort()).toEqual([ana.tableId, luis.tableId].sort());
  });

  it("split a table, answering the new party and its main bill", async () => {
    const { ana, second, billId } = await anaAtTwo();

    const answer = await post(`/api/parties/${ana.partyId}/split-table`, {
      tableId: second.toUpperCase(),
      billId: billId.toUpperCase(),
      expectedPartyRevision: revisionOf(ana.partyId),
    });

    expect(answer.status).toBe(200);
    expect(Object.keys(answer.json).sort()).toEqual(["mainBillId", "partyId"]);
    expect(answer.json.mainBillId).toBe(billId);
    expect(tablesOf(answer.json.partyId as string)).toEqual([second]);
    expect(tablesOf(ana.partyId)).toEqual([ana.tableId]);
  });

  it("split a table choosing no bill, answering the new empty main bill", async () => {
    const { ana, second } = await anaAtTwo();

    const answer = await post(`/api/parties/${ana.partyId}/split-table`, {
      tableId: second,
      billId: null,
      expectedPartyRevision: revisionOf(ana.partyId),
    });

    expect(answer.status).toBe(200);
    expect(answer.json.mainBillId).toEqual(expect.any(String));
    expect(await statusOf(venue, answer.json.mainBillId as string)).toBe("open");
  });

  for (const path of ["move", "join", "split-table"]) {
    it(`answers ${path} without a session with 401`, async () => {
      const ana = await seatedWith(venue);

      const answer = await send(venue.app, "", "POST", `/api/parties/${ana.partyId}/${path}`, {
        toTableId: randomUUID(),
        tableId: randomUUID(),
        billId: null,
        expectedPartyRevision: ana.revision,
      });

      expect(answer.status).toBe(401);
      expect(answer.json).toMatchObject({ code: "session.required" });
      expect(revisionOf(ana.partyId)).toBe(ana.revision);
    });

    it(`answers ${path} on a malformed party id with 409 party.not_open`, async () => {
      const answer = await post(`/api/parties/not-a-uuid/${path}`, {
        toTableId: randomUUID(),
        tableId: randomUUID(),
        billId: null,
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
        const ana = await seatedWith(venue);

        const answer = await post(`/api/parties/${ana.partyId}/${path}`, {
          toTableId: randomUUID(),
          tableId: randomUUID(),
          billId: null,
          ...(revision === undefined ? {} : { expectedPartyRevision: revision }),
        });

        expect(answer.status).toBe(400);
        expect(answer.json).toMatchObject({
          code: "management.request_invalid",
          params: { field: "expectedPartyRevision" },
        });
        expect(revisionOf(ana.partyId)).toBe(ana.revision);
      },
    );
  }

  for (const [path, field] of [
    ["move", "toTableId"],
    ["join", "tableId"],
  ] as const) {
    it.each([["together"], [null], [1]])(
      `answers ${path} with the bill choice %j with 400 management.request_invalid`,
      async (bills) => {
        const ana = await seatedWith(venue);

        const answer = await post(`/api/parties/${ana.partyId}/${path}`, {
          [field]: await freeTable(),
          bills,
          expectedPartyRevision: ana.revision,
        });

        expect(answer.status).toBe(400);
        expect(answer.json).toMatchObject({
          code: "management.request_invalid",
          params: { field: "bills" },
        });
        expect(revisionOf(ana.partyId)).toBe(ana.revision);
      },
    );

    it(`answers ${path} with a malformed other party revision with 400`, async () => {
      const ana = await seatedWith(venue);

      const answer = await post(`/api/parties/${ana.partyId}/${path}`, {
        [field]: await freeTable(),
        expectedPartyRevision: ana.revision,
        expectedOtherPartyRevision: "3",
      });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "expectedOtherPartyRevision" },
      });
    });

    it.each([["not-a-uuid"], [7], [null]])(
      `answers ${path} with the other party id %j with 400 management.request_invalid`,
      async (otherPartyId) => {
        const ana = await seatedWith(venue);
        const to = await freeTable();

        const answer = await post(`/api/parties/${ana.partyId}/${path}`, {
          [field]: to,
          expectedPartyRevision: ana.revision,
          otherPartyId,
        });

        expect(answer.status).toBe(400);
        expect(answer.json).toMatchObject({
          code: "management.request_invalid",
          params: { field: "otherPartyId" },
        });
        expect(revisionOf(ana.partyId)).toBe(ana.revision);
        expect(tablesOf(ana.partyId)).toEqual([ana.tableId]);
      },
    );

    it(`answers ${path} with the other party's revision but not its id with 400`, async () => {
      const ana = await seatedWith(venue);
      const luis = await seatedWith(venue);

      const answer = await post(`/api/parties/${ana.partyId}/${path}`, {
        [field]: luis.tableId,
        expectedPartyRevision: ana.revision,
        expectedOtherPartyRevision: luis.revision,
      });

      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "otherPartyId" },
      });
      expect(revisionOf(ana.partyId)).toBe(ana.revision);
      expect(revisionOf(luis.partyId)).toBe(luis.revision);
      expect(tablesOf(luis.partyId)).toEqual([luis.tableId]);
    });

    it(`answers ${path} naming the other party in upper case as it names it in lower`, async () => {
      const ana = await seatedWith(venue);
      const luis = await seatedWith(venue);

      const answer = await post(`/api/parties/${ana.partyId}/${path}`, {
        [field]: luis.tableId,
        expectedPartyRevision: ana.revision,
        otherPartyId: luis.partyId.toUpperCase(),
        expectedOtherPartyRevision: luis.revision,
      });

      expect(answer.status).toBe(200);
    });

    it(`answers ${path} to a table the party it read there has left with 409 party.out_of_date`, async () => {
      const ana = await seatedWith(venue);
      const luis = await seatedWith(venue);
      const read = { otherPartyId: luis.partyId, expectedOtherPartyRevision: luis.revision };
      const left = await post(`/api/parties/${luis.partyId}/move`, {
        toTableId: await freeTable(),
        expectedPartyRevision: luis.revision,
      });
      expect(left.status).toBe(200);

      const answer = await post(`/api/parties/${ana.partyId}/${path}`, {
        [field]: luis.tableId,
        expectedPartyRevision: ana.revision,
        ...read,
      });

      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: luis.partyId, revision: revisionOf(luis.partyId) },
      });
      expect(revisionOf(ana.partyId)).toBe(ana.revision);
      expect(tablesOf(ana.partyId)).toEqual([ana.tableId]);
    });

    it(`answers ${path} with no table with 400, and a malformed one with 404 table.not_found`, async () => {
      const ana = await seatedWith(venue);

      const missing = await post(`/api/parties/${ana.partyId}/${path}`, {
        expectedPartyRevision: ana.revision,
      });
      const malformed = await post(`/api/parties/${ana.partyId}/${path}`, {
        [field]: "not-a-uuid",
        expectedPartyRevision: ana.revision,
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
      expect(revisionOf(ana.partyId)).toBe(ana.revision);
    });
  }

  it("answers split-table with a malformed table with 409 table.not_joined, and a malformed or missing bill", async () => {
    const { ana, second } = await anaAtTwo();
    const revision = revisionOf(ana.partyId);

    const table = await post(`/api/parties/${ana.partyId}/split-table`, {
      tableId: "not-a-uuid",
      billId: null,
      expectedPartyRevision: revision,
    });
    const noTable = await post(`/api/parties/${ana.partyId}/split-table`, {
      billId: null,
      expectedPartyRevision: revision,
    });
    const bill = await post(`/api/parties/${ana.partyId}/split-table`, {
      tableId: second,
      billId: "not-a-uuid",
      expectedPartyRevision: revision,
    });
    const noBill = await post(`/api/parties/${ana.partyId}/split-table`, {
      tableId: second,
      expectedPartyRevision: revision,
    });

    expect(table.status).toBe(409);
    expect(table.json).toMatchObject({
      code: "table.not_joined",
      params: { tableId: "not-a-uuid", partyId: ana.partyId },
    });
    expect(noTable.status).toBe(400);
    expect(noTable.json).toMatchObject({ params: { field: "tableId" } });
    expect(bill.status).toBe(409);
    expect(bill.json).toMatchObject({ code: "tab.not_open", params: { tabId: "not-a-uuid" } });
    expect(noBill.status).toBe(400);
    expect(noBill.json).toMatchObject({ params: { field: "billId" } });
    expect(revisionOf(ana.partyId)).toBe(revision);
  });

  it("answers each refusal of the actions with 409, changing no revision", async () => {
    const { ana, second, billId } = await anaAtTwo();
    const luis = await seatedWith(venue, "Caña");
    const alone = await seatedWith(venue);
    const revision = revisionOf(ana.partyId);
    const splitOf = (partyId: string, tableId: string, bill: string | null, rev = revision) =>
      post(`/api/parties/${partyId}/split-table`, {
        tableId,
        billId: bill,
        expectedPartyRevision: rev,
      });

    const answers = [
      [
        await post(`/api/parties/${ana.partyId}/join`, {
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
      [await splitOf(ana.partyId, second, ana.tabId), "party.main_bill_stays"],
      [await splitOf(ana.partyId, second, luis.tabId), "bill.other_party"],
      [await splitOf(ana.partyId, luis.tableId, billId), "table.not_joined"],
      [await splitOf(alone.partyId, alone.tableId, null, alone.revision), "table.not_shared"],
      [await splitOf(ana.partyId, second, billId, revision - 1), "party.out_of_date"],
    ] as const;

    for (const [answer, code] of answers) {
      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code });
    }
    expect(revisionOf(ana.partyId)).toBe(revision);
    expect(revisionOf(alone.partyId)).toBe(alone.revision);
    expect(revisionOf(luis.partyId)).toBe(luis.revision);
  });
});
