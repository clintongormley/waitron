import "./errors.js";
import { type Transaction, orderGroups } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { readGroups } from "./order-group-reads.js";
import { type PartyCommandArgs, requireHeldGroup } from "./order-group-records.js";
import { runServiceCommand, checkAndBumpParty } from "./parties.js";
import type { TradingContext } from "./trading-context.js";

/** The longest snooze, in whole minutes. */
export const MAX_SNOOZE_MINUTES = 120;
/**
 * Snooze the release reminder of the group waiting: its `remind_at`
 * becomes now plus `minutes` (D11).
 */
export async function snoozeReminder(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  groupId: string,
  minutes: number,
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.snooze",
    { partyId, groupId, minutes, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SNOOZE_MINUTES) {
        throw new AppError("management.request_invalid", { field: "minutes" });
      }
      await requireWaitingGroup(tx, partyId, groupId);
      await tx
        .update(orderGroups)
        .set({ remindAt: new Date(Date.now() + minutes * 60_000).toISOString() })
        .where(eq(orderGroups.id, groupId));
      return { revision };
    },
    cfg.madeHereSink,
  );
}
/**
 * Clear the snooze of the group waiting, so its reminder falls due as if never snoozed. A group
 * with no snooze is accepted and left as it is.
 */
export async function unsnoozeReminder(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.unsnooze",
    { partyId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      await requireWaitingGroup(tx, partyId, groupId);
      await tx.update(orderGroups).set({ remindAt: null }).where(eq(orderGroups.id, groupId));
      return { revision };
    },
    cfg.madeHereSink,
  );
}
/** The group is the party's first held one with active sent dishes. */
async function requireWaitingGroup(tx: Transaction, partyId: string, groupId: string) {
  await requireHeldGroup(tx, partyId, groupId);
  const waiting = (await readGroups(tx, partyId)).find(
    (group) => group.state === "held" && group.lineIds.length > 0,
  );
  if (waiting?.id !== groupId) throw new AppError("group.not_waiting", { groupId });
}
