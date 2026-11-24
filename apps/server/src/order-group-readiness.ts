import { type Transaction, ticketItems, workingOrderLines } from "@waitron/db";
import { and, inArray, ne, isNotNull, eq } from "drizzle-orm";
import { captureKitchenActivity } from "./attendance-capture.js";
import { type PartyCommandArgs, type Firer, requireGroup } from "./order-group-records.js";
import { runServiceCommand, checkAndBumpParty } from "./parties.js";
import type { OrderAttendance } from "./working-order-context.js";
import { advanceSet } from "./working-order-kitchen-service.js";

/**
 * The pass's Ready for a group: every fired kitchen item of its lines, on every bill of the party,
 * goes straight to `ready`. A held group's items are unfired, so it changes none, yet the command is
 * recorded and the party's revision moves on.
 */
export async function bumpGroupReady(
  tx: Transaction,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
  firer: Firer = { personId: args.operatorId },
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  return passStep(
    tx,
    partyId,
    groupId,
    args,
    "group.ready",
    async () => {
      const changed = await tx
        .update(ticketItems)
        .set(advanceSet("ready"))
        .where(
          and(
            inArray(ticketItems.workingOrderLineId, groupLinesOf(tx, groupId)),
            ne(ticketItems.state, "ready"),
            isNotNull(ticketItems.firedAt),
          ),
        )
        .returning({ lineId: ticketItems.workingOrderLineId });
      return changed.length === 0 || attendance === undefined
        ? []
        : tx
            .select({ orderId: workingOrderLines.workingOrderId })
            .from(workingOrderLines)
            .where(
              inArray(
                workingOrderLines.id,
                changed.map((row) => row.lineId),
              ),
            );
    },
    attendance,
    "personId" in firer ? firer.personId : undefined,
  );
}

async function passStep(
  tx: Transaction,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
  kind: "group.ready",
  apply: () => Promise<{ orderId: string }[]>,
  attendance: OrderAttendance | undefined,
  personId: string | undefined,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    kind,
    { partyId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      await requireGroup(tx, partyId, groupId);
      const changed = await apply();
      await captureKitchenActivity(
        tx,
        attendance,
        personId,
        changed.map((row) => row.orderId),
        `party:${partyId}:${args.submissionId}`,
      );
      return { revision };
    },
  );
}
function groupLinesOf(tx: Transaction, groupId: string) {
  return tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.groupId, groupId));
}
