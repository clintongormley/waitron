import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { captureError, workingOrderLines, workingOrders } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { createPartyBill, insertPartyBill } from "./parties.js";
import { mergeBills } from "./testing/bill-action-fixture.js";
import { finishTable } from "./testing/party-close-fixture.js";
import { allocationsOf, billNumberTables, numbersOf } from "./testing/bill-identities.js";
import {
  OPERATOR,
  billsOfParty,
  commandFor,
  inTx,
  order,
  partyRow,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  zoneOf,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

let v: PartyVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

async function create(partyId: string, expectedPartyRevision: number) {
  return inTx(v, (tx) => createPartyBill(tx, v.cfg, partyId, { expectedPartyRevision }));
}

async function storedRows(partyId: string) {
  return {
    bills: await inTx(v, (tx) => tx.select().from(workingOrders).orderBy(asc(workingOrders.id))),
    numbers: await billNumberTables(suite),
    party: await partyRow(v, partyId),
  };
}

describe("A803 create bill:", () => {
  it("makes an empty open bill on the party numbered next after its highest number, in the party's zone, and moves the revision by one", async () => {
    const { partyId, tabId } = await seat(v, await v.table("C1"));
    await order(v, tabId, "Burger", "Vino");
    const second = await split(v, partyId, tabId, [1]);
    const revision = await revisionOf(v, partyId);

    const created = await create(partyId, revision);

    expect(created.revision).toBe(revision + 1);
    expect(await revisionOf(v, partyId)).toBe(revision + 1);
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [second, 2, null],
      [created.billId, 3, null],
    ]);
    const [bill] = await inTx(v, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, created.billId)),
    );
    expect(bill).toMatchObject({ partyId, status: "open" });
    expect(await zoneOf(v, created.billId)).toBe(v.tables.zoneId);
    expect(
      await inTx(v, (tx) =>
        tx
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, created.billId)),
      ),
    ).toEqual([]);
  });

  it("after Bill 2 was merged away the new bill is Bill 3", async () => {
    const { partyId, tabId } = await seat(v, await v.table("C2"));
    await order(v, tabId, "Burger", "Vino");
    const second = await split(v, partyId, tabId, [1]);
    const command = await commandFor(v, partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, tabId, second, command));

    const created = await create(partyId, await revisionOf(v, partyId));

    expect((await numbersOf(v, partyId)).filter(([id]) => id !== second)).toEqual([
      [tabId, 1, null],
      [created.billId, 3, null],
    ]);
    expect(await allocationsOf(v, partyId)).toEqual([
      [1, tabId],
      [2, second],
      [3, created.billId],
    ]);
  });

  it("a stale revision refuses party.out_of_date and writes nothing", async () => {
    const { partyId } = await seat(v, await v.table("C3"));
    const revision = await revisionOf(v, partyId);
    const before = await storedRows(partyId);

    const error = await captureError(() => create(partyId, revision + 3));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "party.out_of_date", params: { partyId, revision } });
    expect(await storedRows(partyId)).toEqual(before);
  });

  it("a closed party refuses party.not_open, writing nothing", async () => {
    const { partyId } = await seat(v, await v.table("C4"));
    await inTx(v, (tx) =>
      finishTable(tx, {
        partyId,
        expectedPartyRevision: 0,
        operatorId: OPERATOR,
      }),
    );
    const revision = await revisionOf(v, partyId);
    const before = await storedRows(partyId);

    const error = await captureError(() => create(partyId, revision));

    expect(error).toMatchObject({ code: "party.not_open", params: { partyId } });
    expect(await storedRows(partyId)).toEqual(before);
  });

  it("two requests with the same revision: the second refuses party.out_of_date and only one bill exists", async () => {
    const { partyId, tabId } = await seat(v, await v.table("C5"));
    const revision = await revisionOf(v, partyId);

    const answers = await Promise.allSettled([
      create(partyId, revision),
      create(partyId, revision),
    ]);

    const made = answers.filter((answer) => answer.status === "fulfilled");
    const refused = answers.filter((answer) => answer.status === "rejected");
    expect(made).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "party.out_of_date",
      params: { partyId, revision: revision + 1 },
    });
    const billId = (made[0] as PromiseFulfilledResult<{ billId: string }>).value.billId;
    expect(await billsOfParty(v, partyId)).toEqual([tabId, billId]);
    expect(await revisionOf(v, partyId)).toBe(revision + 1);
  });

  it("insertPartyBill makes the same bill and leaves the party's revision where it was", async () => {
    const { partyId, tabId } = await seat(v, await v.table("C6"));
    const revision = await revisionOf(v, partyId);

    const billId = await inTx(v, (tx) => insertPartyBill(tx, v.cfg, partyId));

    expect(await revisionOf(v, partyId)).toBe(revision);
    expect(await numbersOf(v, partyId)).toEqual([
      [tabId, 1, null],
      [billId, 2, null],
    ]);
    expect(
      await inTx(v, (tx) => tx.select().from(workingOrders).where(eq(workingOrders.id, billId))),
    ).toEqual([expect.objectContaining({ partyId, status: "open" })]);
    expect(await zoneOf(v, billId)).toBe(v.tables.zoneId);
  });
});
