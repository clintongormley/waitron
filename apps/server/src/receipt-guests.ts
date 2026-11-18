import { and, eq, inArray, ne } from "drizzle-orm";
import type { RecordSaleInput } from "@waitron/core";
import { parties, sales, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { defaultGuestCount, isValidGuestCount } from "@waitron/shared";
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

export async function saleReceiptFacts(
  tx: Transaction,
  workingOrderId: string,
  counterparty: RecordSaleInput["counterparty"],
  choice: GuestCountChoice,
): Promise<NonNullable<RecordSaleInput["receipt"]>> {
  const context = await VENUE_SERVICE.findOrderContext(tx, workingOrderId);
  const header = await VENUE_SERVICE.saleReceiptHeader(tx, context?.zoneId ?? null);
  const guestCount =
    counterparty == null
      ? choice === undefined
        ? await storableDefault(tx, workingOrderId)
        : choice
      : null;
  return { ...header, guestCount };
}

/** The default as the row can hold it: a party's count above 999, which the parties table allows, stores no line. */
async function storableDefault(tx: Transaction, workingOrderId: string): Promise<number | null> {
  const party = await readBillParty(tx, workingOrderId);
  return party === undefined ? null : defaultGuestCount(party);
}

/** The trading name distinguishes a stored choice of no guests from a sale without receipt facts. */
export async function readPrintedGuests(
  tx: Transaction,
  saleId: string,
): Promise<number | undefined> {
  const [row] = await tx
    .select({
      counterpartyTaxId: sales.counterpartyTaxId,
      tradingName: sales.receiptTradingName,
      guestCount: sales.receiptGuestCount,
    })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (row !== undefined && row.counterpartyTaxId === null && row.tradingName !== null) {
    return row.guestCount ?? undefined;
  }
  return readReceiptGuests(tx, saleId);
}

const BILL_PARTY = {
  partyId: parties.id,
  guestCount: parties.guestCount,
  mergedInto: parties.mergedIntoPartyId,
};

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
  const party = await countedParty(tx, row);
  return party?.billCount === 1 ? party.guestCount : undefined;
}

/** {@link countedParty} for the party of the bill `workingOrderId`. */
async function readBillParty(
  tx: Transaction,
  workingOrderId: string,
): Promise<CountedParty | undefined> {
  const [row] = await tx
    .select(BILL_PARTY)
    .from(workingOrders)
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(workingOrders.id, workingOrderId));
  return countedParty(tx, row);
}

/** A party's count and how many bills its family holds that are not abandoned. `billCount` stops at 2: enough to tell one bill from several, never a total. */
interface CountedParty {
  guestCount: number;
  billCount: number;
}

async function countedParty(
  tx: Transaction,
  row: { partyId: string; guestCount: number | null; mergedInto: string | null } | undefined,
): Promise<CountedParty | undefined> {
  if (row === undefined || row.guestCount === null || row.mergedInto !== null) return undefined;
  const family = await partyFamily(tx, row.partyId);
  const bills = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(inArray(workingOrders.partyId, family), ne(workingOrders.status, "abandoned")))
    .limit(2);
  return { guestCount: row.guestCount, billCount: bills.length };
}
