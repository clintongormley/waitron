import { eq } from "drizzle-orm";
import { floorTodayJoins, nowIso, type Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { leaveMergesRestoring } from "./floor-today-merges.js";
import { todayOf, type Today } from "./floor-today-table.js";
import { withMovedSlips } from "./moved-slips.js";
import {
  checkAndBumpParty,
  holdersOf,
  leaveForClearing,
  partiesHoldingOnly,
  partyRevision,
  refuseMovedParty,
} from "./parties.js";
import type { TradingContext } from "./trading-context.js";
import "./errors.js";

interface SplitArgs {
  tableId: string;
  partIds: string[];
  seats: number | null;
  expectedParties: { id: string; revision: number }[];
}

export async function splitOff(
  tx: Transaction,
  cfg: TradingContext,
  _removals: readonly TableRemoval[],
  _now: Date,
  args: SplitArgs,
): Promise<void> {
  const today = await todayOf(tx, args.tableId);
  if (today.merge === null)
    throw new AppError("merge.member_invalid", { tableId: args.tableId, field: "partIds" });
  const members = today.merge.members.map((member) => member.tableId);
  for (const partId of args.partIds) {
    if (!members.includes(partId))
      throw new AppError("merge.member_invalid", { tableId: partId, field: "partIds" });
  }
  const holding = new Set((await holdersOf(tx, args.partIds)).values());
  const expected = new Map(args.expectedParties.map((party) => [party.id, party.revision]));
  for (const partyId of holding) {
    if (!expected.has(partyId)) await refuseMovedParty(tx, partyId);
  }
  for (const [partyId, sent] of expected) {
    if (!holding.has(partyId)) await refuseMovedParty(tx, partyId);
    const revision = await partyRevision(tx, partyId);
    if (revision !== sent) throw new AppError("party.out_of_date", { partyId, revision });
  }

  return splitGroup(tx, cfg, { merge: today.merge }, args);
}

type Merge = NonNullable<Today["merge"]>;
async function splitGroup(
  tx: Transaction,
  cfg: TradingContext,
  { merge }: { merge: Merge },
  { tableId, partIds, seats, expectedParties }: SplitArgs,
): Promise<void> {
  const members = merge.members.map((member) => member.tableId);
  const ticked = new Set(partIds);
  const staying = merge.members.filter((member) => !ticked.has(member.tableId));
  if (staying.length === 0) throw new AppError("merge.split_all", { tableId, field: "partIds" });
  const holders = await holdersOf(tx, members);
  const leaving = partIds.filter((id) => holders.has(id));
  const losing = [...new Set(leaving.map((id) => holders.get(id)!))];
  if (holders.size > 0) {
    const emptied = await partiesHoldingOnly(tx, losing, partIds);
    const stranding = members.find((id) => ticked.has(id) && emptied.has(holders.get(id)!));
    if (stranding !== undefined) {
      throw new AppError("merge.strands_party", { tableId: stranding, field: "partIds" });
    }
  }
  if (staying.length >= 2 && seats === null) throw new AppError("merge.seats_required", {});

  await withMovedSlips(
    tx,
    cfg,
    { parties: [...new Set(holders.values())], deliveredTo: members },
    async () => {
      for (const partyId of losing) {
        await checkAndBumpParty(
          tx,
          partyId,
          expectedParties.find((party) => party.id === partyId)!.revision,
          "open",
        );
      }
      if (leaving.length > 0) await leaveForClearing(tx, leaving, nowIso());
      await leaveAsGroup(tx, merge.joinId, partIds, staying.length >= 2 ? seats : null);
    },
  );
}

/** `partIds` leave the group; with `seats`, what stays is still a group of that many seats. */
async function leaveAsGroup(
  tx: Transaction,
  joinId: string,
  partIds: readonly string[],
  seats: number | null,
): Promise<void> {
  await leaveMergesRestoring(tx, partIds);
  if (seats !== null) {
    await tx.update(floorTodayJoins).set({ seats }).where(eq(floorTodayJoins.id, joinId));
  }
}
