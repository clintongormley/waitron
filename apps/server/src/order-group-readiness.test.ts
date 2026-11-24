import { parties, ticketItems, workingOrderLines, lineServiceCancellations } from "@waitron/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  ALEX,
  setupVenue,
  specExampleOnTwoBills,
  groupTickets,
  ready,
  snapshot,
  groupsOf,
  seated,
  submitGrouped,
  line,
  linesIn,
  submit,
  specExample,
  revisionOf,
  expectRefusedWithNothingWritten,
  fire,
  move,
} from "./testing/order-groups.test-support.js";

async function closeParty(partyId: string): Promise<void> {
  await db
    .update(parties)
    .set({ state: "closed", closedAt: new Date().toISOString(), closedBy: ALEX })
    .where(eq(parties.id, partyId));
}
describe("A773 no dispatch state — group readiness", () => {
  it.each([false, true])(
    "reads a split group's readiness across both bills (ready=%s)",
    async (isReady) => {
      const v = await setupVenue();
      const s = await specExampleOnTwoBills(v);
      const items = await groupTickets(s.cold);
      expect(new Set(items.map((item) => item.workingOrderId)).size).toBe(2);
      if (isReady) await ready(s.partyId, s.cold);
      const before = await snapshot(v, s.partyId);

      const group = (await groupsOf(s.partyId)).groups.find((row) => row.id === s.cold)!;

      expect(group.ready === true).toBe(isReady);
      expect(group).not.toHaveProperty("away");
      expect(group.lineIds).toHaveLength(4);
      expect(await snapshot(v, s.partyId)).toEqual(before);
    },
  );

  it.each([
    { name: "live queued food", kitchenQuantity: 2000, served: 0, madeHere: false, ready: false },
    {
      name: "fully served food",
      kitchenQuantity: 2000,
      served: 2000,
      madeHere: false,
      ready: true,
    },
    {
      name: "partly served food",
      kitchenQuantity: 2000,
      served: 1000,
      madeHere: false,
      ready: false,
    },
    { name: "fully cancelled food", kitchenQuantity: 0, served: 0, madeHere: false, ready: true },
    {
      name: "partly cancelled food",
      kitchenQuantity: 1000,
      served: 0,
      madeHere: false,
      ready: false,
    },
    {
      name: "served active remainder",
      kitchenQuantity: 1000,
      served: 1000,
      madeHere: false,
      ready: true,
    },
    {
      name: "legacy quantity with served food",
      kitchenQuantity: null,
      served: 2000,
      madeHere: false,
      ready: true,
    },
    {
      name: "legacy quantity with live food",
      kitchenQuantity: null,
      served: 1000,
      madeHere: false,
      ready: false,
    },
    { name: "made-here food", kitchenQuantity: 2000, served: 0, madeHere: true, ready: true },
  ])(
    "ignores $name only when no kitchen work remains",
    async ({ kitchenQuantity, served, madeHere, ready: expectedReady }) => {
      const v = await setupVenue();
      const s = await seated(v);
      const group = (
        await submitGrouped(v, s, [
          {
            release: "fire",
            lines: [line(v, "steak"), line(v, "fish", "2")],
          },
        ])
      ).groups[0]!;
      const rows = await linesIn(s.partyId, group.id);
      const steak = rows.find((row) => row.productId === v.productId.steak)!;
      const fish = rows.find((row) => row.productId === v.productId.fish)!;
      await db
        .update(ticketItems)
        .set({ state: "ready", readyAt: "2026-10-20T12:00:00.000Z" })
        .where(eq(ticketItems.workingOrderLineId, steak.id));
      await db
        .update(ticketItems)
        .set({ quantity: kitchenQuantity, madeHere })
        .where(eq(ticketItems.workingOrderLineId, fish.id));
      await db
        .update(workingOrderLines)
        .set({ servedQuantity: served, servedAt: null })
        .where(eq(workingOrderLines.id, fish.id));
      if (kitchenQuantity !== null && kitchenQuantity < 2000) {
        await db.insert(lineServiceCancellations).values({
          lineId: fish.id,
          quantity: 2000 - kitchenQuantity,
          cancelledAt: "2026-10-20T12:02:00.000Z",
          wasStarted: false,
          actorId: ALEX,
        });
      }
      const before = await snapshot(v, s.partyId);

      const read = (await groupsOf(s.partyId)).groups.find((row) => row.id === group.id)!;

      expect(read.ready === true).toBe(expectedReady);
      expect(read.lineIds).toContain(steak.id);
      expect(await snapshot(v, s.partyId)).toEqual(before);
    },
  );

  it.each(["served", "cancelled"] as const)(
    "does not report a wholly %s group ready",
    async (completion) => {
      const v = await setupVenue();
      const s = await seated(v);
      const group = (
        await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "steak", "2")] }])
      ).groups[0]!;
      const [dish] = await linesIn(s.partyId, group.id);
      await db
        .update(ticketItems)
        .set({ state: "ready", quantity: completion === "cancelled" ? 0 : 2000 })
        .where(eq(ticketItems.workingOrderLineId, dish!.id));
      if (completion === "served") {
        await db
          .update(workingOrderLines)
          .set({ servedQuantity: 2000, servedAt: null })
          .where(eq(workingOrderLines.id, dish!.id));
      } else {
        await db.insert(lineServiceCancellations).values({
          lineId: dish!.id,
          quantity: 2000,
          cancelledAt: "2026-10-20T12:02:00.000Z",
          wasStarted: false,
          actorId: ALEX,
        });
      }
      const before = await snapshot(v, s.partyId);

      const read = (await groupsOf(s.partyId)).groups.find((row) => row.id === group.id)!;

      expect(read.ready).toBeUndefined();
      expect(await snapshot(v, s.partyId)).toEqual(before);
    },
  );

  it.each(["served", "cancelled"] as const)(
    "does not report a fired group with nothing for the kitchen ready once its dishes are %s",
    async (completion) => {
      const v = await setupVenue();
      const s = await seated(v);
      const group = (await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "water")] }]))
        .groups[0]!;
      const [water] = await linesIn(s.partyId, group.id);
      if (completion === "served") {
        await db
          .update(workingOrderLines)
          .set({ servedQuantity: 1000, servedAt: null })
          .where(eq(workingOrderLines.id, water!.id));
      } else {
        await db.insert(lineServiceCancellations).values({
          lineId: water!.id,
          quantity: 1000,
          cancelledAt: "2026-10-20T12:02:00.000Z",
          wasStarted: false,
          actorId: ALEX,
        });
      }
      const before = await snapshot(v, s.partyId);

      const read = (await groupsOf(s.partyId)).groups.find((row) => row.id === group.id)!;

      expect(read.ready).toBeUndefined();
      expect(await snapshot(v, s.partyId)).toEqual(before);
    },
  );

  it("does not report a held group with nothing for the kitchen ready", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const group = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "water")] }]))
      .groups[0]!;
    const before = await snapshot(v, s.partyId);

    const read = (await groupsOf(s.partyId)).groups.find((row) => row.id === group.id)!;

    expect(read.state).toBe("held");
    expect(read.ready).toBeUndefined();
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("reads a fired group with nothing for the kitchen ready while its dishes wait", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const group = (await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "water")] }]))
      .groups[0]!;
    expect(await groupTickets(group.id)).toEqual([]);
    const before = await snapshot(v, s.partyId);

    const read = (await groupsOf(s.partyId)).groups.find((row) => row.id === group.id)!;

    expect(read.ready).toBe(true);
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("does not report a fired group ready while its kitchen dish beside the water is not ready", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const group = (
      await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "water"), line(v, "steak")] }])
    ).groups[0]!;
    expect(await groupTickets(group.id)).toHaveLength(1);
    const before = await snapshot(v, s.partyId);

    const read = (await groupsOf(s.partyId)).groups.find((row) => row.id === group.id)!;

    expect(read.ready).toBeUndefined();
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("reads a fired group ready once its kitchen dish is served and its water still waits", async () => {
    const v = await setupVenue();
    const s = await seated(v);
    const group = (
      await submit(v, s.partyId, [{ release: "fire", lines: [line(v, "water"), line(v, "steak")] }])
    ).groups[0]!;
    const steak = (await linesIn(s.partyId, group.id)).find(
      (row) => row.productId === v.productId.steak,
    )!;
    await db
      .update(workingOrderLines)
      .set({ servedQuantity: 1000, servedAt: null })
      .where(eq(workingOrderLines.id, steak.id));
    const before = await snapshot(v, s.partyId);

    const read = (await groupsOf(s.partyId)).groups.find((row) => row.id === group.id)!;

    expect(read.ready).toBe(true);
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });
});
describe("pass retries (D8, D19)", () => {
  it("records a ready resent with its submission id once", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };

    const first = await ready(s.partyId, s.cold, opts);
    const before = await snapshot(v, s.partyId);
    const second = await ready(s.partyId, s.cold, opts);

    expect(second).toEqual(first);
    expect(await snapshot(v, s.partyId)).toEqual(before);
  });

  it("refuses the same id sent for another group (submission.id_reused), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const submissionId = randomUUID();
    await ready(s.partyId, s.cold, { submissionId });

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => ready(s.partyId, s.drinks, { submissionId }),
      { code: "submission.id_reused", params: { submissionId } },
    );
  });

  it("refuses a ready sent with a stale party revision (party.out_of_date), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const stale = await revisionOf(s.partyId);
    await fire(v, s.partyId, s.warm);

    await expectRefusedWithNothingWritten(
      v,
      s.partyId,
      () => ready(s.partyId, s.cold, { revision: stale }),
      { code: "party.out_of_date", params: { partyId: s.partyId, revision: stale + 1 } },
    );
  });

  it("refuses a ready on a closed party (party.not_open), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    await closeParty(s.partyId);

    await expectRefusedWithNothingWritten(v, s.partyId, () => ready(s.partyId, s.cold), {
      code: "party.not_open",
      params: { partyId: s.partyId },
    });
  });

  it("refuses a group the party does not have, or another party's (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const other = await seated(v);
    const theirs = (
      await submit(v, other.partyId, [{ release: "fire", lines: [line(v, "steak")] }])
    ).groups[0]!.id;

    for (const groupId of [randomUUID(), theirs]) {
      await expectRefusedWithNothingWritten(v, s.partyId, () => ready(s.partyId, groupId), {
        code: "group.not_found",
        params: { groupId },
      });
    }
  });

  it("refuses a ready on a removed group (group.not_found), writing nothing", async () => {
    const v = await setupVenue();
    const s = await specExample(v);
    const fishOnly = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
      .groups[0]!.id;
    const [fish] = await linesIn(s.partyId, fishOnly);
    await move(v, s.partyId, [{ lineId: fish!.id, quantity: "1" }], { groupId: s.mains });

    await expectRefusedWithNothingWritten(v, s.partyId, () => ready(s.partyId, fishOnly), {
      code: "group.not_found",
      params: { groupId: fishOnly },
    });
  });
});
