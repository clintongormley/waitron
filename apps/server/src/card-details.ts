import type { ReceiptLabels } from "@waitron/country";
import type { CardDetails } from "@waitron/payments";

export interface StoredCard {
  scheme: string | null;
  last4: string | null;
  entryMode: string | null;
  authCode: string | null;
}

export function cardOf(row: StoredCard | undefined): { card?: CardDetails } {
  const card = row === undefined ? null : cardDetailsOf(row);
  return card === null ? {} : { card };
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

/** How the receipt, the invoice and the payment slip name the card: `Visa ****4034`. */
export function cardName(card: CardDetails, cardWord: string): string {
  const scheme =
    card.scheme.trim().toUpperCase() === "UNKNOWN"
      ? cardWord
      : card.scheme.replace(/\S+/gu, (word) => {
          const letters = [...word];
          // A network's acronym: JCB, CUP, VR.
          if (letters.length <= 3) return word.toUpperCase();
          return letters[0]!.toUpperCase() + letters.slice(1).join("").toLowerCase();
        });
  return `${scheme} ****${card.last4}`;
}

/** How the card was presented, for the documents that name it; nothing for an unknown mode. */
export function cardEntryLabel(
  entryMode: CardDetails["entryMode"],
  labels: Pick<ReceiptLabels, "paymentContactless" | "paymentChip" | "paymentSwipe">,
): string | undefined {
  return {
    contactless: labels.paymentContactless,
    chip: labels.paymentChip,
    swipe: labels.paymentSwipe,
    unknown: undefined,
  }[entryMode];
}
