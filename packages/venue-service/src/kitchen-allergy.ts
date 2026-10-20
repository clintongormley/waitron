import { eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { KitchenAllergyBlock, TicketAllergyCopy } from "@waitron/module";
import { ticketItemAllergies } from "./schema/kitchen-allergy.js";

export async function recordTicketAllergies(
  tx: Transaction,
  rows: readonly ({ ticketItemId: string } & TicketAllergyCopy)[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insert(ticketItemAllergies)
    .values([...rows])
    .onConflictDoNothing({
      target: ticketItemAllergies.ticketItemId,
    });
}

export async function readTicketAllergies(
  tx: Transaction,
  ids: readonly string[],
): Promise<ReadonlyMap<string, TicketAllergyCopy>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(ticketItemAllergies)
    .where(inArray(ticketItemAllergies.ticketItemId, [...ids]));
  return new Map(
    rows.map(({ ticketItemId, originalBlock, currentBlock }) => [
      ticketItemId,
      { originalBlock, currentBlock },
    ]),
  );
}

export async function setTicketAllergyCurrent(
  tx: Transaction,
  id: string,
  block: KitchenAllergyBlock | null,
): Promise<void> {
  await tx
    .update(ticketItemAllergies)
    .set({ currentBlock: block })
    .where(eq(ticketItemAllergies.ticketItemId, id));
}
