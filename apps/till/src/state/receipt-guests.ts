import { isValidGuestCount } from "@waitron/shared";
import type { TableParty } from "../api/client.js";

/** What the receipt prints when no count is chosen; mirrors `storableDefault` (via `guestsOfParty`) in `apps/server/src/receipt-guests.ts`. */
export function defaultReceiptGuests(party: TableParty | null | undefined): number | null {
  const count = party?.billCount === 1 ? party.guestCount : null;
  return isValidGuestCount(count) ? count : null;
}
