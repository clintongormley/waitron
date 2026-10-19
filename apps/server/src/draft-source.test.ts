import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { parties, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { refuseRecalledWrite } from "./draft-source.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
let venue: AdjustmentVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});
async function fixture() {
  const p = await billWith(
    venue,
    [{ name: "Pizza", quantity: "2", olives: 2 }, { name: "Water" }],
    { release: "hold" },
  );
  return inTx(venue, async (tx) => {
    const lines = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.billId))
      .orderBy(workingOrderLines.lineNo);
    const parent = lines.find((l) => l.parentLineId === null)!;
    const extra = lines.find((l) => l.parentLineId === parent.id)!;
    const ordinary = lines.find((l) => l.parentLineId === null && l.id !== parent.id)!;
    const [party] = await tx.select().from(parties).where(eq(parties.id, p.partyId));
    const recalled = await recallToDraft(tx, venue.cfg, p.partyId, parent.id, {
      operatorId: venue.staffId,
      submissionId: randomUUID(),
      expectedPartyRevision: party!.revision,
      expectedEdit: await readBillEditState(tx, p.billId),
    });
    return { ...p, parent, extra, ordinary, recalled };
  });
}
describe("a recalled family cannot be changed through a direct source id", () => {
  it.each(["parent", "extra"] as const)(
    "refuses the reserved %s with its current bill edit state",
    async (which) => {
      const p = await fixture();
      await expect(
        inTx(venue, (tx) => refuseRecalledWrite(tx, eq(workingOrderLines.id, p[which].id))),
      ).rejects.toMatchObject({
        code: "draft.out_of_date",
        params: {
          billId: p.billId,
          draftId: p.recalled.draft.id,
          revision: 0,
          edit: p.recalled.edit,
        },
      });
      expect(await inTx(venue, (tx) => readBillEditState(tx, p.billId))).toEqual(p.recalled.edit);
    },
  );
  it("allows an ordinary sibling and a missing source without changing ownership", async () => {
    const p = await fixture();
    await inTx(venue, async (tx) => {
      await refuseRecalledWrite(tx, eq(workingOrderLines.id, p.ordinary.id));
      await refuseRecalledWrite(tx, eq(workingOrderLines.id, randomUUID()));
    });
    expect(await inTx(venue, (tx) => readBillEditState(tx, p.billId))).toEqual(p.recalled.edit);
  });
});
