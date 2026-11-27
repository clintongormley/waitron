import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { captureError, parties, partyTables } from "@waitron/db";
import { setNeedsClearingInEveryDepartment } from "./testing/needs-clearing.js";
import {
  OPERATOR,
  activeTablesOf,
  floorRow,
  inTx,
  order,
  partyRow,
  partyTestHelpers,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  statusOf,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import { checkAndBumpParty, finishTable } from "./testing/party-close-fixture.js";
import { markTableCleared } from "./party-close.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const { partyForTable, membershipsOf, join } = partyTestHelpers(suite);

describe("finish table", () => {
  it("is refused while a check is unpaid, and changes nothing", async () => {
    const venue = await setupPartyVenue(suite.db);
    const table4 = await venue.table("Table 4");
    const { partyId, tabId } = await seat(venue, table4, 2);
    await order(venue, tabId, "Burger", "Red wine bottle", "Water");
    const checkId = await split(venue, partyId, tabId, [2]);
    await pay(venue, tabId, "14.00");

    const error = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 1, operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({ code: "party.bill_outstanding", params: { partyId } });
    expect(await partyRow(suite, partyId)).toMatchObject({
      state: "open",
      revision: 1,
      closedAt: null,
    });
    expect((await membershipsOf(partyId))[0]!.leftAt).toBeNull();
    expect(await statusOf(suite, checkId)).toBe("open");
  });

  it("closes the party and its membership, frees the table once everything is paid", async () => {
    const venue = await setupPartyVenue(suite.db);
    const table4 = await venue.table("Table 4");
    const { partyId, tabId } = await seat(venue, table4, 2);
    await order(venue, tabId, "Burger", "Red wine bottle", "Water");
    const checkId = await split(venue, partyId, tabId, [2]);
    await pay(venue, tabId, "14.00");
    await pay(venue, checkId, "30.00");

    const result = await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: 1, operatorId: OPERATOR }),
    );

    expect(result).toEqual({ state: "closed" });
    const closed = await partyRow(suite, partyId);
    expect(closed).toMatchObject({ state: "closed", closedBy: OPERATOR, revision: 2 });
    expect(closed.closedAt).not.toBeNull();
    expect(await membershipsOf(partyId)).toEqual([]);
    expect(closed.tableNames).toEqual(["Table 4"]);
    expect(await inTx(suite, (tx) => partyForTable(tx, table4))).toBeNull();
  });

  it("abandons an empty open tab rather than counting it as owed", async () => {
    const venue = await setupPartyVenue(suite.db);
    const table4 = await venue.table("Table 4");
    const { partyId, tabId } = await seat(venue, table4);

    expect(
      await inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
      ),
    ).toEqual({ state: "closed" });
    expect(await statusOf(suite, tabId)).toBe("abandoned");
  });

  it("is refused with a stale party revision, and changes nothing", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId } = await seat(venue, await venue.table("Table 4"));
    await inTx(suite, (tx) => checkAndBumpParty(tx, partyId, 0, "open"));

    const error = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({ code: "party.out_of_date", params: { partyId, revision: 1 } });
    expect(await partyRow(suite, partyId)).toMatchObject({ state: "open", revision: 1 });
  });

  it("is refused for a party that is not open, or does not exist", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId } = await seat(venue, await venue.table("Table 4"));
    await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
    );

    const again = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 1, operatorId: OPERATOR }),
      ),
    );
    expect(again).toMatchObject({ code: "party.not_open", params: { partyId } });
    const unknown = randomUUID();
    const absent = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, {
          partyId: unknown,
          expectedPartyRevision: 0,
          operatorId: OPERATOR,
        }),
      ),
    );
    expect(absent).toMatchObject({ code: "party.not_open", params: { partyId: unknown } });
  });

  it("answers a party that is not open as not open, even when the revision sent is stale too", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId } = await seat(venue, await venue.table("Table 4"));
    await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
    );

    const error = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({ code: "party.not_open", params: { partyId } });
  });

  it("closes a party that no longer holds any table", async () => {
    const venue = await setupPartyVenue(suite.db);
    const table4 = await venue.table("Table 4");
    const { partyId } = await seat(venue, table4);
    await inTx(suite, (tx) =>
      tx
        .update(partyTables)
        .set({ leftAt: new Date().toISOString() })
        .where(eq(partyTables.partyId, partyId)),
    );

    expect(
      await inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
      ),
    ).toEqual({ state: "closed" });
  });

  it("frees every table of a joined party", async () => {
    const venue = await setupPartyVenue(suite.db);
    const table4 = await venue.table("Table 4");
    const table5 = await venue.table("Table 5");
    const { partyId } = await seat(venue, table4);
    await join(venue.cfg, partyId, table5);

    await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: 1, operatorId: OPERATOR }),
    );

    for (const table of [table4, table5]) {
      expect(await inTx(suite, (tx) => partyForTable(tx, table))).toBeNull();
    }
    expect(await membershipsOf(partyId)).toEqual([]);
    expect([...(await partyRow(suite, partyId)).tableNames!].sort()).toEqual([
      "Table 4",
      "Table 5",
    ]);
  });
});

describe("a table needs clearing, not its party (P8, P9)", () => {
  let v: PartyVenue;
  beforeEach(async () => {
    v = await setupPartyVenue(suite.db);
  });
  // Every revision is read BEFORE the transaction opens: a read through `inTx` inside a running
  // body asks for the write lock it holds, which the queue refuses.
  async function finish(partyId: string) {
    const expectedPartyRevision = await revisionOf(v, partyId);
    return inTx(v, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision, operatorId: OPERATOR }),
    );
  }
  async function condition(tableId: string) {
    return (await floorRow(v, tableId)).condition;
  }
  async function partyCount(): Promise<number> {
    return (await inTx(v, (tx) => tx.select({ id: parties.id }).from(parties))).length;
  }

  it("closes the party at Finish and leaves each of its tables needing clearing, with no party on them", async () => {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));
    const table4 = await v.table("Table 4c");
    const table5 = await v.table("Table 5c");
    const { partyId } = await seat(v, table4);
    await join(v.cfg, partyId, table5);

    expect(await finish(partyId)).toEqual({ state: "closed" });

    expect(await partyRow(v, partyId)).toMatchObject({ state: "closed", closedBy: OPERATOR });
    expect(await activeTablesOf(v, partyId)).toEqual([]);
    for (const table of [table4, table5]) {
      expect((await tableRow(v, table)).needsClearingSince).not.toBeNull();
      expect(await condition(table)).toBe("needs_clearing");
      expect((await floorRow(v, table)).party).toBeNull();
    }
  });

  it("refuses seating a table that needs clearing until it is cleared, one table at a time", async () => {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));
    const table6 = await v.table("Table 6c");
    const table7 = await v.table("Table 7c");
    const { partyId } = await seat(v, table6);
    await join(v.cfg, partyId, table7);
    await finish(partyId);
    const partiesBefore = await partyCount();

    const refused = await captureError(() => seat(v, table6));
    expect(refused).toMatchObject({ code: "table.needs_clearing", params: { tableId: table6 } });
    expect(await partyCount()).toBe(partiesBefore);
    expect(await condition(table6)).toBe("needs_clearing");

    await inTx(v, (tx) => markTableCleared(tx, table6));
    expect(await condition(table6)).toBe("free");
    expect((await tableRow(v, table6)).needsClearingSince).toBeNull();
    expect(await condition(table7)).toBe("needs_clearing");
    await seat(v, table6);
    expect(await condition(table6)).toBe("held");
  });

  it("refuses a tab opened straight onto a table that needs clearing, as the till's free-table route and a booking do", async () => {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, true));
    const table4 = await v.table("Table 4c");
    const { partyId } = await seat(v, table4);
    await finish(partyId);

    expect(
      await captureError(() => inTx(v, (tx) => openPartyTab(tx, v.cfg, { tableId: table4 }))),
    ).toMatchObject({ code: "table.needs_clearing", params: { tableId: table4 } });
    expect(await condition(table4)).toBe("needs_clearing");
  });

  it("frees the tables at once when their department has Needs clearing off (P8)", async () => {
    await inTx(v, (tx) => setNeedsClearingInEveryDepartment(tx, false));
    const table8 = await v.table("Table 8c");
    const { partyId } = await seat(v, table8);
    expect(await finish(partyId)).toEqual({ state: "closed" });
    expect(await condition(table8)).toBe("free");
    expect((await tableRow(v, table8)).needsClearingSince).toBeNull();
  });

  it("frees the tables at once in a department that never switched Needs clearing on", async () => {
    const table8 = await v.table("Table 8c");
    const { partyId } = await seat(v, table8);
    await finish(partyId);
    expect(await condition(table8)).toBe("free");
  });

  it("clears a table that does not need clearing without complaint, and changes nothing", async () => {
    const table9 = await v.table("Table 9c");
    const table11 = await v.table("Table 11c");
    const { partyId, revision } = await seat(v, table9);
    await inTx(v, (tx) => markTableCleared(tx, table9));
    await inTx(v, (tx) => markTableCleared(tx, table11));
    expect(await condition(table9)).toBe("held");
    expect(await condition(table11)).toBe("free");
    expect(await revisionOf(v, partyId)).toBe(revision);
  });

  it("refuses clearing a table that does not exist", async () => {
    const unknown = randomUUID();
    expect(await captureError(() => inTx(v, (tx) => markTableCleared(tx, unknown)))).toMatchObject({
      code: "table.not_found",
      params: { tableId: unknown },
    });
  });
});
