import { and, eq, inArray } from "drizzle-orm";
import {
  orderDraftLines,
  orderDraftRecalledLines,
  orderDrafts,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { AppError, thousandthsToDecimal } from "@waitron/shared";
import "./errors.js";

export async function readBillUnsent(tx: Transaction, billId: string) {
  const drafts = await tx
    .select({ id: orderDrafts.id, ownerId: orderDrafts.ownerId, name: persons.displayName })
    .from(orderDrafts)
    .leftJoin(persons, eq(persons.id, orderDrafts.ownerId))
    .where(and(eq(orderDrafts.billId, billId), eq(orderDrafts.state, "open")))
    .orderBy(orderDrafts.ownerId);
  if (drafts.length === 0) return [];
  const ids = drafts.map((draft) => draft.id);
  const fresh = await tx
    .select({ draftId: orderDraftLines.draftId, quantity: orderDraftLines.quantity })
    .from(orderDraftLines)
    .where(inArray(orderDraftLines.draftId, ids));
  const recalled = await tx
    .select({ draftId: orderDraftRecalledLines.draftId, quantity: workingOrderLines.quantity })
    .from(orderDraftRecalledLines)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, orderDraftRecalledLines.sourceLineId))
    .where(inArray(orderDraftRecalledLines.draftId, ids));
  const quantities = new Map<string, number>();
  for (const line of [...fresh, ...recalled])
    quantities.set(line.draftId, (quantities.get(line.draftId) ?? 0) + line.quantity);
  const owners = [];
  for (const draft of drafts) {
    const quantity = quantities.get(draft.id) ?? 0;
    if (quantity > 0)
      owners.push({
        personId: draft.ownerId,
        name: draft.name ?? "",
        quantity: thousandthsToDecimal(quantity),
      });
  }
  return owners.sort(
    (a, b) => a.name.localeCompare(b.name) || a.personId.localeCompare(b.personId),
  );
}

export async function assertBillHasNoUnsent(tx: Transaction, billId: string): Promise<void> {
  const owners = await readBillUnsent(tx, billId);
  if (owners.length > 0) throw new AppError("bill.unsent_dishes", { billId, owners });
}
