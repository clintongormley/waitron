import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { AllergyPatch } from "@waitron/module";
import { readBillEditState, readPartyBillIds } from "./bill-editing.js";
import { moveBill, type MoveBillOptions } from "./move-bill.js";
import { VENUE_SERVICE } from "./modules.js";
import * as kitchenWriter from "./working-order.js";
import {
  OPERATOR,
  counterOrder,
  inTx,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";

let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});
afterEach(() => vi.restoreAllMocks());

async function fixture(existing: boolean | "answered" = false) {
  const tableId = await v.table(`Adoption ${randomUUID().slice(0, 8)}`);
  const destination = existing ? await seat(v, tableId) : null;
  if (existing === "answered")
    await inTx(v, (tx) =>
      VENUE_SERVICE.writePartyAllergy(
        tx,
        destination!.partyId,
        { answer: "none", guests: [] },
        OPERATOR,
      ),
    );
  const billId = await counterOrder(v, "Burger");
  const [line] = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const expectedEdits = await inTx(v, async (tx) => {
    const edits = [];
    for (const id of [
      billId,
      ...(destination === null ? [] : await readPartyBillIds(tx, [destination.partyId])),
    ])
      edits.push(await readBillEditState(tx, id));
    return edits.sort((a, b) => (a.billId < b.billId ? -1 : a.billId > b.billId ? 1 : 0));
  });
  const allergy: AllergyPatch = {
    party: {
      answer: "allergies",
      guests: [{ who: "Arriving guest", allergens: { milk: {} }, note: "Separate preparation" }],
    },
    ticks: [{ line: { kind: "working", id: line!.id }, guestIndex: 0 }],
  };
  const command = {
    operatorId: OPERATOR,
    partyId: null,
    otherPartyId: destination?.partyId ?? null,
    ...(destination === null ? {} : { expectedOtherPartyRevision: destination.revision }),
    bills: "separate" as const,
    expectedEdits,
    submissionId: randomUUID(),
    allergy,
  };
  return { tableId, billId, line: line!, command, destination };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function move(f: Fixture, command: MoveBillOptions = f.command) {
  return inTx(v, (tx) => moveBill(tx, v.cfg, f.billId, { tableId: f.tableId }, command));
}
function frozen() {
  return Object.fromEntries(
    v.db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`)
      .map(({ name }) => [
        name,
        v.db.all(sql`select * from ${sql.identifier(name)} order by rowid`),
      ]),
  );
}

it.each([false, true, "answered"] as const)(
  "adopts into an existing party %s with the answer and tick before kitchen work",
  async (existing) => {
    const f = await fixture(existing);
    const atOutput: unknown[] = [];
    const fire = kitchenWriter.fireLines;
    vi.spyOn(kitchenWriter, "fireLines").mockImplementation(async (...args) => {
      const [tx, , billId] = args;
      const [bill] = await tx
        .select({ partyId: workingOrders.partyId })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId));
      atOutput.push(await VENUE_SERVICE.readPartyAllergy(tx, bill!.partyId!));
      return fire(...args);
    });
    const result = await move(f);
    const state = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, result.partyId!));
    expect(state).toMatchObject({
      answer: "allergies",
      guests: [{ who: "Arriving guest", allergens: { milk: {} }, note: "Separate preparation" }],
    });
    expect(state.ticks).toEqual([
      { guestId: state.guests[0]!.id, workingLineId: f.line.id, draftLineId: null },
    ]);
    expect(atOutput).toEqual([
      expect.objectContaining({
        answer: "allergies",
        guests: [expect.objectContaining({ who: "Arriving guest" })],
        ticks: [{ guestId: state.guests[0]!.id, workingLineId: f.line.id, draftLineId: null }],
      }),
    ]);
    const [line] = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, f.line.id));
    expect(line!.sentAt).not.toBeNull();
    const after = frozen();
    expect(await move(f)).toEqual(result);
    expect(frozen()).toEqual(after);
    await expect(move(f, { ...f.command, operatorId: randomUUID() })).rejects.toMatchObject({
      code: "submission.id_reused",
    });
    await expect(
      move(f, {
        ...f.command,
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      } as MoveBillOptions),
    ).rejects.toMatchObject({ code: "submission.id_reused" });
    expect(frozen()).toEqual(after);
  },
);

it.each(["submissionId", "allergy"] as const)(
  "refuses an unpaired %s without attaching the bill or opening a party",
  async (missing) => {
    const f = await fixture();
    const command: Partial<typeof f.command> = { ...f.command };
    delete command[missing];
    const before = frozen();
    await expect(move(f, command as MoveBillOptions)).rejects.toMatchObject({
      code: "management.request_invalid",
    });
    expect(frozen()).toEqual(before);
  },
);

it("rolls back party, attachment, answer and actual tick writes after a later failure", async () => {
  const f = await fixture();
  const before = frozen();
  const write = VENUE_SERVICE.setAllergyLineTicks;
  const failure = new Error("After adopted tick");
  vi.spyOn(VENUE_SERVICE, "setAllergyLineTicks").mockImplementation(async (...args) => {
    await write(...args);
    if (
      Array.isArray(args[2]) &&
      args[2].some(
        (tick: unknown) =>
          tick !== null &&
          typeof tick === "object" &&
          "workingLineId" in tick &&
          tick.workingLineId === f.line.id,
      )
    )
      throw failure;
  });
  await expect(move(f)).rejects.toBe(failure);
  expect(frozen()).toEqual(before);
});

it("an assignment outside the arriving parents rolls back the entire adoption", async () => {
  const f = await fixture();
  const before = frozen();
  await expect(
    move(f, {
      ...f.command,
      allergy: {
        ...f.command.allergy,
        ticks: [{ line: { kind: "working", id: randomUUID() }, guestIndex: 0 }],
      },
    } as MoveBillOptions),
  ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "ticks.0.line" } });
  expect(frozen()).toEqual(before);
});
