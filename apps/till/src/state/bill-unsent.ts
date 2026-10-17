import type { BillUnsent } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { trimQuantity } from "../widgets/dish-format.js";

export function billUnsentOf(error: unknown): BillUnsent | undefined {
  const refused = error as { code?: unknown; billId?: unknown; owners?: unknown } | null;
  if (
    refused?.code !== "bill.unsent_dishes" ||
    typeof refused.billId !== "string" ||
    refused.billId.length === 0 ||
    !Array.isArray(refused.owners) ||
    refused.owners.length === 0
  )
    return undefined;
  const owners: BillUnsent["owners"] = [];
  for (const value of refused.owners) {
    const owner = value as { personId?: unknown; name?: unknown; quantity?: unknown } | null;
    if (
      typeof owner?.personId !== "string" ||
      typeof owner.name !== "string" ||
      typeof owner.quantity !== "string" ||
      !/^\d+(?:\.\d{1,3})?$/.test(owner.quantity) ||
      !/[1-9]/.test(owner.quantity)
    )
      return undefined;
    owners.push({ personId: owner.personId, name: owner.name, quantity: owner.quantity });
  }
  return { billId: refused.billId, owners };
}

export function billUnsentText(unsent: BillUnsent, label?: string): string {
  return [
    label,
    t("bill_pay.unsent"),
    ...unsent.owners.map((owner) => {
      const quantity = trimQuantity(owner.quantity);
      const count = currentLocale().startsWith("es") ? quantity.replace(".", ",") : quantity;
      const key = quantity === "1" ? "bill_pay.unsent_one" : "bill_pay.unsent_many";
      return t(key)
        .replace("{n}", () => count)
        .replace("{name}", () => owner.name || t("bill_pay.unsent_unnamed"));
    }),
  ]
    .filter(Boolean)
    .join(". ");
}
