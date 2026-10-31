import type { BillUnsent } from "../api/client.js";
import { t } from "../i18n/t.js";

export function billUnsentOf(error: unknown): BillUnsent | undefined {
  const refused = error as { code?: unknown; billId?: unknown } | null;
  if (
    refused?.code !== "bill.unsent_dishes" ||
    typeof refused.billId !== "string" ||
    refused.billId.length === 0
  )
    return undefined;
  return { billId: refused.billId };
}

export function billUnsentText(label?: string): string {
  return [label, t("bill_pay.unsent")].filter(Boolean).join(". ");
}

/** A dish in the New order drawn for the bill, or in another person's draft of it drawn with its
 * Take over; nothing while no New order is drawn. The screen's quiet Pay and the payment dialog
 * read the same rule, so every refusal has its way out on the screen. */
export function billHasUnsent(
  draft: { readonly lineCount: number } | null,
  others: readonly { readonly lines: readonly unknown[] }[],
): boolean {
  if (draft === null) return false;
  return draft.lineCount > 0 || others.some((other) => other.lines.length > 0);
}
