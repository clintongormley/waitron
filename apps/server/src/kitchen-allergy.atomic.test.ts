import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as printing from "@waitron/printing";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { eq } from "drizzle-orm";
import { parties, type Transaction } from "@waitron/db";
import { inTx, OPERATOR } from "./testing/party-venue.js";
import { allergyTargets, applyPartyAllergyPatch, readPartyAllergyView } from "./party-allergy.js";
import { enqueueKitchenAllergyChanges } from "./kitchen-allergy.js";
import { markServed } from "./working-order.js";
import { moveDishesToStation } from "./station-move.js";
import { createStation } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  kitchenCallers,
  kitchenCommand,
  kitchenCurrent,
  kitchenFixture,
  kitchenOriginal,
  kitchenState,
  requestKitchen,
  type KitchenFixture,
} from "./testing/kitchen-allergy-fixture.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function ordered(
  f: KitchenFixture,
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<unknown>,
) {
  const entered = barrier();
  const release = barrier();
  const order: string[] = [];
  const a = inTx(f.v, async (tx) => {
    order.push("first acquired");
    entered.resolve();
    await release.promise;
    await first(tx);
    order.push("first finished");
  });
  await entered.promise;
  const b = inTx(f.v, async (tx) => {
    order.push("second acquired");
    await second(tx);
  });
  release.resolve();
  const results = await Promise.allSettled([a, b]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  expect(order).toEqual(["first acquired", "first finished", "second acquired"]);
}
async function editWithin(tx: Transaction, f: KitchenFixture, note: string) {
  const snapshot = await VENUE_SERVICE.readPartyAllergy(tx, f.party.partyId);
  const view = await readPartyAllergyView(tx, f.v.cfg, f.party.partyId);
  const changes = await applyPartyAllergyPatch(
    tx,
    f.party.partyId,
    {
      party: { answer: "allergies", guests: [{ ...snapshot.guests[0]!, note }] },
      ticks: [],
    },
    OPERATOR,
    allergyTargets(view),
  );
  await enqueueKitchenAllergyChanges(tx, f.v.cfg, changes);
}

describe("A669 atomic", () => {
  it.each([false, true])(
    "two queued edits retain their serial notice blocks (reverse %s)",
    async (reverse) => {
      const f = await kitchenFixture(suite.db);
      const notes = reverse ? ["Second tools", "First tools"] : ["First tools", "Second tools"];
      await ordered(
        f,
        (tx) => editWithin(tx, f, notes[0]!),
        (tx) => editWithin(tx, f, notes[1]!),
      );
      const state = await kitchenState(f.v.db);
      expect(
        state.notices.map(({ stationId, quantity, allergyBlock }) => ({
          stationId,
          quantity,
          allergyBlock,
        })),
      ).toEqual(
        notes.map((note) => ({
          stationId: f.ticket.stationId,
          quantity: 3000,
          allergyBlock: { ...kitchenOriginal, note },
        })),
      );
      expect(state.copies).toEqual([
        {
          ticketItemId: f.ticket.id,
          originalBlock: kitchenOriginal,
          currentBlock: { ...kitchenOriginal, note: notes[1] },
        },
      ]);
      expect(state.jobs).toHaveLength(2);
    },
  );

  it.each([false, true])(
    "Serve and edit use remaining work in transaction order (serve first %s)",
    async (serveFirst) => {
      const f = await kitchenFixture(suite.db);
      const serve = async (tx: Transaction) => {
        const [party] = await tx.select().from(parties).where(eq(parties.id, f.party.partyId));
        return markServed(
          tx,
          f.v.cfg,
          f.party.partyId,
          [{ lineId: f.ticket.workingOrderLineId, quantity: "1" }],
          {
            submissionId: randomUUID(),
            expectedPartyRevision: party!.revision,
            operatorId: OPERATOR,
          },
        );
      };
      const edit = (tx: Transaction) => editWithin(tx, f, kitchenCurrent.note!);
      await ordered(f, serveFirst ? serve : edit, serveFirst ? edit : serve);
      const state = await kitchenState(f.v.db);
      expect(
        state.notices.map(({ stationId, quantity, allergyBlock }) => ({
          stationId,
          quantity,
          allergyBlock,
        })),
      ).toEqual([
        {
          stationId: f.ticket.stationId,
          quantity: serveFirst ? 2000 : 3000,
          allergyBlock: kitchenCurrent,
        },
      ]);
      expect(
        state.lines.find((line) => line.id === f.ticket.workingOrderLineId)!.servedQuantity,
      ).toBe(1000);
    },
  );

  it.each([false, true])(
    "reroute and edit address the cook that owns work at each transaction (move first %s)",
    async (moveFirst) => {
      const f = await kitchenFixture(suite.db);
      const destination = await inTx(f.v, (tx) =>
        createStation(tx, f.v.cfg, { name: "Next cook" }),
      );
      const move = (tx: Transaction) =>
        moveDishesToStation(
          tx,
          f.v.cfg,
          f.party.tabId,
          {
            submissionId: randomUUID(),
            lineIds: [f.ticket.workingOrderLineId],
            stationId: destination.id,
          },
          { kind: "kitchen", deviceId: null, personId: OPERATOR },
        );
      const edit = (tx: Transaction) => editWithin(tx, f, kitchenCurrent.note!);
      await ordered(f, moveFirst ? move : edit, moveFirst ? edit : move);
      const state = await kitchenState(f.v.db);
      expect(
        state.notices
          .filter((row) => row.kind === "allergy_changed")
          .map(({ stationId, quantity, allergyBlock }) => ({ stationId, quantity, allergyBlock })),
      ).toEqual(
        (moveFirst ? [destination.id] : [f.ticket.stationId, destination.id]).map((stationId) => ({
          stationId,
          quantity: 3000,
          allergyBlock: kitchenCurrent,
        })),
      );
      expect(state.copies).toEqual([
        { ticketItemId: f.ticket.id, originalBlock: kitchenOriginal, currentBlock: kitchenCurrent },
      ]);
    },
  );

  it.each(kitchenCallers)(
    "%s retries the exact result and refuses a changed body without another correction",
    async (caller) => {
      const f = await kitchenFixture(suite.db);
      const command = await kitchenCommand(f, caller);
      const first = await requestKitchen(f, command);
      const result: unknown = await first.json();
      expect(first.status, JSON.stringify(result)).toBe(200);
      const state = await kitchenState(f.v.db);
      expect(state.notices.filter((row) => row.kind === "allergy_changed")).toMatchObject([
        { stationId: f.ticket.stationId, quantity: 3000, allergyBlock: kitchenCurrent },
      ]);
      expect(state.notices.filter((row) => row.kind === "allergy_changed")).toHaveLength(1);
      expect(state.copies.find((row) => row.ticketItemId === f.ticket.id)).toEqual({
        ticketItemId: f.ticket.id,
        originalBlock: kitchenOriginal,
        currentBlock: kitchenCurrent,
      });
      expect(state.jobs.length).toBeGreaterThan(0);
      const retry = await requestKitchen(f, command);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual(result);
      expect(await kitchenState(f.v.db)).toEqual(state);
      const mismatch = structuredClone(command);
      const allergy = mismatch.body.allergy as { party: { guests: { note: string }[] } };
      allergy.party.guests[0]!.note = "Changed retry";
      const refused = await requestKitchen(f, mismatch);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ error: { code: "submission.id_reused" } });
      expect(await kitchenState(f.v.db)).toEqual(state);
    },
  );

  it.each(kitchenCallers)(
    "%s rolls back a print failure after the notice insert and can then succeed",
    async (caller) => {
      const f = await kitchenFixture(suite.db);
      const command = await kitchenCommand(f, caller);
      const before = await kitchenState(f.v.db);
      const inside: { kind: string; allergyBlock: unknown }[][] = [];
      const enqueue = vi.spyOn(printing, "enqueuePrintJob").mockImplementation(async (tx) => {
        const notices = await VENUE_SERVICE.listStationNotices(tx, f.v.cfg, f.ticket.stationId);
        inside.push(notices.map(({ kind, allergyBlock }) => ({ kind, allergyBlock })));
        throw new Error("controlled print failure after allergy notice");
      });
      try {
        const failed = await requestKitchen(f, command);
        expect(failed.status).toBe(500);
        expect(inside).toEqual([[{ kind: "allergy_changed", allergyBlock: kitchenCurrent }]]);
        expect(await kitchenState(f.v.db)).toEqual(before);
      } finally {
        enqueue.mockRestore();
      }
      const succeeded = await requestKitchen(f, command);
      expect(succeeded.status, JSON.stringify(await succeeded.json())).toBe(200);
      const after = await kitchenState(f.v.db);
      expect(after.notices.filter((row) => row.kind === "allergy_changed")).toHaveLength(1);
      expect(after.jobs.length).toBeGreaterThan(before.jobs.length);
      expect(after.commands.some((row) => row.submissionId === command.body.submissionId)).toBe(
        true,
      );
    },
  );
});
