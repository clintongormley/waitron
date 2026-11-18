import { defaultGuestCount } from "@waitron/shared";
import type { TableParty } from "../api/client.js";

/** What the receipt prints when no count is chosen. */
export function defaultReceiptGuestCount(party: TableParty | null | undefined): number | null {
  return party == null ? null : defaultGuestCount(party.guestCount, party.billCount);
}
