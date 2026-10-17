import { and, eq, inArray, ne } from "drizzle-orm";
import { parties, saleReceiptGuests, sales, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { isValidGuestCount } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { partyFamily } from "./parties.js";

/** The guests a payment request chose: a count, `null` for no line, `undefined` when it sent none. */
export type GuestsChoice = number | null | undefined;

/** A request's `guests`, refused as `management.request_invalid` `{ field: "guests" }` unless absent, null or 1 to 999. */
export function readGuestsChoice(value: unknown): GuestsChoice {
  if (value === undefined || value === null || isValidGuestCount(value)) return value;
  throw invalid("guests");
}

/** Writes the row of a sale just recorded: the choice, or the default read now when there is none. Skips a full invoice. */
export async function recordReceiptGuests(
  tx: Transaction,
  saleId: string,
  choice: GuestsChoice,
): Promise<void> {
  const [sale] = await tx
    .select({ counterpartyTaxId: sales.counterpartyTaxId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale!.counterpartyTaxId !== null) return;
  const guests = choice === undefined ? ((await readReceiptGuests(tx, saleId)) ?? null) : choice;
  await tx.insert(saleReceiptGuests).values({ saleId, guests });
}

/** What a paper receipt of the sale prints: a simplified sale's stored row when it has one, else {@link readReceiptGuests}. */
export async function readPrintedGuests(
  tx: Transaction,
  saleId: string,
): Promise<number | undefined> {
  const [row] = await tx
    .select({
      counterpartyTaxId: sales.counterpartyTaxId,
      stored: saleReceiptGuests.saleId,
      guests: saleReceiptGuests.guests,
    })
    .from(sales)
    .leftJoin(saleReceiptGuests, eq(saleReceiptGuests.saleId, sales.id))
    .where(eq(sales.id, saleId));
  if (row !== undefined && row.counterpartyTaxId === null && row.stored !== null) {
    return row.guests ?? undefined;
  }
  return readReceiptGuests(tx, saleId);
}

/**
 * The default guests, read as the party is now, or `undefined` for no line: what a sale with no row
 * and a full invoice print ({@link readPrintedGuests}), and what {@link recordReceiptGuests} stores
 * when the request chose none. A count when the sale's bill belongs to a party with a count that was
 * not merged into another, and that party and every party merged into it hold exactly one bill that
 * is not abandoned.
 */
export async function readReceiptGuests(
  tx: Transaction,
  saleId: string,
): Promise<number | undefined> {
  const [row] = await tx
    .select({
      partyId: parties.id,
      guests: parties.guestCount,
      mergedInto: parties.mergedIntoPartyId,
    })
    .from(sales)
    .innerJoin(workingOrders, eq(workingOrders.id, sales.workingOrderId))
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(sales.id, saleId));
  if (row === undefined || row.guests === null || row.mergedInto !== null) return undefined;
  const family = await partyFamily(tx, row.partyId);
  const bills = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(inArray(workingOrders.partyId, family), ne(workingOrders.status, "abandoned")))
    .limit(2);
  return bills.length === 1 ? row.guests : undefined;
}
