import { and, eq, inArray, ne } from "drizzle-orm";
import type { RecordSaleInput } from "@waitron/core";
import { parties, saleReceiptGuests, sales, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { LocationId } from "@waitron/shared";
import { isValidGuestCount } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { VENUE_SERVICE } from "./modules.js";
import { partyFamily } from "./parties.js";

/** The guest count a payment request chose: a count, `null` for no line, `undefined` when it sent none. */
export type GuestCountChoice = number | null | undefined;

/** A request's `guestCount`, refused as `management.request_invalid` `{ field: "guestCount" }` unless absent, null or 1 to 999. */
export function readGuestCountChoice(value: unknown): GuestCountChoice {
  if (value === undefined || value === null || isValidGuestCount(value)) return value;
  throw invalid("guestCount");
}

/** A sale just recorded, named by what its caller handed `recordSale`. */
export interface RecordedSale {
  saleId: string;
  workingOrderId: string;
  /** As handed to `recordSale`, which stores its tax id: present only on a full invoice. */
  counterparty: RecordSaleInput["counterparty"];
}

/** Writes, after `recordSale`, the sale's receipt header for its zone (`recordSaleReceiptHeader`), then {@link recordReceiptGuests}. */
export async function recordSaleReceiptFacts(
  tx: Transaction,
  cfg: { locationId: LocationId },
  sale: RecordedSale,
  guestCount: GuestCountChoice,
): Promise<void> {
  const context = await VENUE_SERVICE.findOrderContext(tx, cfg, sale.workingOrderId);
  await VENUE_SERVICE.recordSaleReceiptHeader(tx, cfg, sale.saleId, context?.zoneId ?? null);
  await recordReceiptGuests(tx, sale, guestCount);
}

/** Writes the row of a sale just recorded: the choice, or the default read now when there is none. Skips a full invoice. The choice must already have passed {@link readGuestCountChoice}. */
export async function recordReceiptGuests(
  tx: Transaction,
  sale: RecordedSale,
  choice: GuestCountChoice,
): Promise<void> {
  if (sale.counterparty != null) return;
  const guestCount = choice === undefined ? await storableDefault(tx, sale.workingOrderId) : choice;
  await tx.insert(saleReceiptGuests).values({ saleId: sale.saleId, guestCount });
}

/** The default as the row can hold it: a party's count above 999, which the parties table allows, stores no line. */
async function storableDefault(tx: Transaction, workingOrderId: string): Promise<number | null> {
  const guestCount = await readBillGuests(tx, workingOrderId);
  return guestCount !== undefined && isValidGuestCount(guestCount) ? guestCount : null;
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
      guestCount: saleReceiptGuests.guestCount,
    })
    .from(sales)
    .leftJoin(saleReceiptGuests, eq(saleReceiptGuests.saleId, sales.id))
    .where(eq(sales.id, saleId));
  if (row !== undefined && row.counterpartyTaxId === null && row.stored !== null) {
    return row.guestCount ?? undefined;
  }
  return readReceiptGuests(tx, saleId);
}

const BILL_PARTY = {
  partyId: parties.id,
  guestCount: parties.guestCount,
  mergedInto: parties.mergedIntoPartyId,
};

/**
 * The default guests, read as the party is now, or `undefined` for no line: what a sale with no row
 * and a full invoice print ({@link readPrintedGuests}). A count when the sale's bill belongs to a party with a count that was
 * not merged into another, and that party and every party merged into it hold exactly one bill that
 * is not abandoned.
 */
export async function readReceiptGuests(
  tx: Transaction,
  saleId: string,
): Promise<number | undefined> {
  const [row] = await tx
    .select(BILL_PARTY)
    .from(sales)
    .innerJoin(workingOrders, eq(workingOrders.id, sales.workingOrderId))
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(sales.id, saleId));
  return guestsOfParty(tx, row);
}

/** {@link readReceiptGuests} for the sale of the bill `workingOrderId`. */
async function readBillGuests(
  tx: Transaction,
  workingOrderId: string,
): Promise<number | undefined> {
  const [row] = await tx
    .select(BILL_PARTY)
    .from(workingOrders)
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(workingOrders.id, workingOrderId));
  return guestsOfParty(tx, row);
}

async function guestsOfParty(
  tx: Transaction,
  row: { partyId: string; guestCount: number | null; mergedInto: string | null } | undefined,
): Promise<number | undefined> {
  if (row === undefined || row.guestCount === null || row.mergedInto !== null) return undefined;
  const family = await partyFamily(tx, row.partyId);
  const bills = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(inArray(workingOrders.partyId, family), ne(workingOrders.status, "abandoned")))
    .limit(2);
  return bills.length === 1 ? row.guestCount : undefined;
}
