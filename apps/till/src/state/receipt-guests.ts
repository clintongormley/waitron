import { defaultGuestCount } from "@waitron/shared";
import type { TableParty } from "../api/client.js";

/** The guests the payment screen fills in when nobody has chosen a count. */
export function defaultReceiptGuestCount(party: TableParty | null | undefined): number | null {
  return party == null ? null : defaultGuestCount(party);
}
