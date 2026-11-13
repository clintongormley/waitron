import { and, eq, inArray, sql } from "drizzle-orm";
import { statementChunks, ticketItems, type Transaction } from "@waitron/db";
import type { KitchenAllergyBlock, TicketAllergyCopy } from "@waitron/module";

export async function recordTicketAllergies(
  tx: Transaction,
  rows: readonly ({ ticketItemId: string } & TicketAllergyCopy)[],
): Promise<void> {
  for (const chunk of statementChunks(ticketItems, rows)) {
    const values = sql.join(
      chunk.map(
        (row) =>
          sql`(${row.ticketItemId}, ${row.originalBlock === null ? null : JSON.stringify(row.originalBlock)}, ${row.currentBlock === null ? null : JSON.stringify(row.currentBlock)})`,
      ),
      sql`, `,
    );
    await tx.run(sql`with v(id, o, c) as (values ${values})
      update ticket_items set allergy_frozen = 1, allergy_original = v.o, allergy_current = v.c
      from v where ticket_items.id = v.id and ticket_items.allergy_frozen = 0`);
  }
}

export async function readTicketAllergies(
  tx: Transaction,
  ids: readonly string[],
): Promise<ReadonlyMap<string, TicketAllergyCopy>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      ticketItemId: ticketItems.id,
      originalBlock: ticketItems.allergyOriginal,
      currentBlock: ticketItems.allergyCurrent,
    })
    .from(ticketItems)
    .where(and(eq(ticketItems.allergyFrozen, true), inArray(ticketItems.id, [...ids])));
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
    .update(ticketItems)
    .set({ allergyCurrent: block })
    .where(and(eq(ticketItems.id, id), eq(ticketItems.allergyFrozen, true)));
}

export async function copyTicketAllergy(
  tx: Transaction,
  fromTicketItemId: string,
  toTicketItemId: string,
): Promise<void> {
  const copy = (await readTicketAllergies(tx, [fromTicketItemId])).get(fromTicketItemId);
  if (copy !== undefined)
    await recordTicketAllergies(tx, [{ ticketItemId: toTicketItemId, ...copy }]);
}
