import type { CardDetails } from "@waitron/payments";

export interface StoredCard {
  scheme: string | null;
  last4: string | null;
  entryMode: string | null;
  authCode: string | null;
}

export function cardDetailsOf(row: StoredCard): CardDetails | null {
  if (row.scheme === null || row.last4 === null) return null;
  return {
    scheme: row.scheme,
    last4: row.last4,
    // `payments_card_entry_mode_ck` admits only CardDetails' entry modes, or null.
    entryMode: (row.entryMode ?? "unknown") as CardDetails["entryMode"],
    authCode: row.authCode,
  };
}

/** How every paper names the card: `Visa ****4034`. */
export function cardName(card: CardDetails): string {
  const scheme = card.scheme
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (initial) => initial.toUpperCase());
  return `${scheme} ****${card.last4}`;
}
