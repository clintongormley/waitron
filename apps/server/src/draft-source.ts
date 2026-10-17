import { and, eq, exists, gt, or, sql } from "drizzle-orm";
import {
  orderDraftRecalledLines,
  orderDraftLines,
  orderDrafts,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { VENUE_SERVICE } from "./modules.js";

/** A recalled parent and its extras remain charged, but are no longer sent work. */
export function isRecalledDish(tx: Transaction) {
  return exists(
    tx
      .select({ id: orderDraftRecalledLines.id })
      .from(orderDraftRecalledLines)
      .where(
        or(
          eq(orderDraftRecalledLines.sourceLineId, workingOrderLines.id),
          eq(orderDraftRecalledLines.sourceLineId, workingOrderLines.parentLineId),
        ),
      ),
  );
}

/** A financial split keeps both parts reserved and assigned to the same allergic guest. */
export async function copyRecalledSplit(
  tx: Transaction,
  sourceLineId: string,
  splitLineId: string,
): Promise<void> {
  const [source] = await tx
    .select({ reference: orderDraftRecalledLines, partyId: orderDrafts.partyId })
    .from(orderDraftRecalledLines)
    .innerJoin(orderDrafts, eq(orderDrafts.id, orderDraftRecalledLines.draftId))
    .where(
      and(eq(orderDraftRecalledLines.sourceLineId, sourceLineId), eq(orderDrafts.state, "open")),
    );
  if (source === undefined) return;
  const { reference, partyId } = source;
  await tx
    .update(orderDraftLines)
    .set({ position: sql`${orderDraftLines.position} + 1` })
    .where(
      and(
        eq(orderDraftLines.draftId, reference.draftId),
        gt(orderDraftLines.position, reference.position),
      ),
    );
  await tx
    .update(orderDraftRecalledLines)
    .set({ position: sql`${orderDraftRecalledLines.position} + 1` })
    .where(
      and(
        eq(orderDraftRecalledLines.draftId, reference.draftId),
        gt(orderDraftRecalledLines.position, reference.position),
      ),
    );
  await tx.insert(orderDraftRecalledLines).values({
    draftId: reference.draftId,
    sourceLineId: splitLineId,
    position: reference.position + 1,
    slot: reference.slot,
    joinGroupId: reference.joinGroupId,
    afterGroupId: reference.afterGroupId,
  });
  const allergy = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
  const tick = allergy.ticks.find((item) => item.workingLineId === sourceLineId);
  if (tick !== undefined)
    await VENUE_SERVICE.setAllergyLineTicks(tx, partyId, [
      { workingLineId: splitLineId, guestId: tick.guestId },
    ]);
}
