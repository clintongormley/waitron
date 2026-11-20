import type { DeleteImpactItem, DeleteImpactRefusal } from "@waitron/shared";
import type { DeleteDialogCopy } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import { countedDeleteLine, deleteTargetNames } from "./delete-copy-lines.js";

type Counted =
  | "printers.delete_jobs"
  | "printers.delete_invoice_a4"
  | "printers.delete_invoice_receipts"
  | "printers.delete_device_choice"
  | "printers.delete_device_default"
  | "printers.delete_profile_role"
  | "printers.delete_profile_default"
  | "printers.delete_stations";

const ROLES = [
  ["receipt", "printers.delete_role_receipt", "printers.delete_default_receipt"],
  ["payment_slip", "printers.delete_role_payment_slip", "printers.delete_default_payment_slip"],
  ["cash_drawer", "printers.delete_role_cash_drawer", "printers.delete_default_cash_drawer"],
  ["invoice", "printers.delete_role_invoice", "printers.delete_default_invoice"],
] as const;

function line(key: Counted, item: DeleteImpactItem, role = ""): string {
  return countedDeleteLine(key, item, { role });
}

function itemLine(item: DeleteImpactItem): string {
  const { key } = item;
  if (key === "print_jobs") return line("printers.delete_jobs", item);
  if (key === "invoice_a4") return line("printers.delete_invoice_a4", item);
  if (key === "invoice_receipts") return line("printers.delete_invoice_receipts", item);
  if (key === "portable_holder")
    return fill("printers.delete_holder", { names: deleteTargetNames(item.targets) });
  if (key === "station_printers") return line("printers.delete_stations", item);
  for (const [role, word, defaultWord] of ROLES) {
    if (key === `device_${role}`) return line("printers.delete_device_choice", item, t(word));
    if (key === `device_${role}_default`)
      return line("printers.delete_device_default", item, t(defaultWord));
    if (key === `profile_${role}`) return line("printers.delete_profile_role", item, t(word));
    if (key === `profile_${role}_default`)
      return line("printers.delete_profile_default", item, t(defaultWord));
  }
  return fill("printers.delete_unknown", {
    names: deleteTargetNames(item.targets),
    count: String(item.count),
  }).trim();
}

function refusalLine(refusal: DeleteImpactRefusal): string {
  const named = refusal.targets.map(({ name }) => name).join(", ");
  const message = codeMessage(refusal.code);
  return named ? `${message.replace(/\.$/, "")}: ${named}` : message;
}

/** The printer delete dialog's words, in the language the screen shows now. */
export function printerDeleteCopy(page = false, bluetooth = false): DeleteDialogCopy {
  return {
    heading: t("printers.delete_heading"),
    refusals: t("printers.delete_refusals"),
    ends: t("printers.delete_ends"),
    removes: t("printers.delete_assignments"),
    irreversible: [
      t("printers.delete_retained"),
      ...(page ? [t("printers.page_printer_readd")] : []),
      ...(bluetooth ? [t("printers.delete_bluetooth")] : []),
    ].join(" "),
    cancel: t("action.cancel"),
    confirm: t("action.delete"),
    retry: t("printers.delete_retry"),
    loading: t("printers.delete_loading"),
    item: itemLine,
    refusal: refusalLine,
  };
}
