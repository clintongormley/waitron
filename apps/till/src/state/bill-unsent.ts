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
