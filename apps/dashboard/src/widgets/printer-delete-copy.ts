import type { DeleteImpact, DeleteImpactRefusal, PrinterDeleteImpact } from "@waitron/shared";
import {
  encodePathSegment,
  type DeleteDialogCopy,
  type DeleteDialogSummaryCopy,
} from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { countedDeleteLine, deleteTargetNames } from "./delete-copy-lines.js";

const TARGETS = [
  ["device_", "printers.delete_device_name", "printers.delete_device_count"],
  ["profile_", "printers.delete_profile_name", "printers.delete_profile_count"],
  ["station_", "printers.delete_station_name", "printers.delete_station_count"],
] as const;

const JOBS = [
  ["print_jobs", "printers.delete_jobs"],
  ["invoice_receipts", "printers.delete_invoice_receipts"],
  ["invoice_a4", "printers.delete_invoice_a4"],
] as const;

function assignmentNames(impact: DeleteImpact): string[] {
  const holder = impact.ends.find(({ key }) => key === "portable_holder");
  return TARGETS.flatMap(([prefix, nameKey, countKey]) => {
    const targets = impact.removes
      .filter(({ key }) => key.startsWith(prefix))
      .flatMap(({ targets }) => targets);
    if (prefix === "device_" && holder) targets.push(...holder.targets);
    const names = new Map(
      targets.filter(({ deleted }) => !deleted).map(({ id, name }) => [id, name]),
    );
    return names.size > 3
      ? [fill(countKey, { count: String(names.size) })]
      : [...names.values()].map((name) => fill(nameKey, { name }));
  });
}

function endLines(impact: DeleteImpact): string[] {
  for (const [key, wording] of JOBS) {
    const item = impact.ends.find((item) => item.key === key && item.count > 0);
    if (item) return [countedDeleteLine(wording, item)];
  }
  return [];
}

function refusalLine(refusal: DeleteImpactRefusal): string {
  const named = refusal.targets.map(({ name }) => name).join(", ");
  const message = codeMessage(refusal.code);
  return named ? `${message.replace(/\.$/, "")}: ${named}` : message;
}

function deleteDialogWords() {
  return {
    refusals: t("printers.delete_refusals"),
    ends: t("printers.delete_ends"),
    cancel: t("action.cancel"),
    confirm: t("action.delete"),
    retry: t("printers.delete_retry"),
    loading: t("printers.delete_loading"),
    refusal: refusalLine,
  };
}

export function deleteAgentCopy(): DeleteDialogCopy {
  return {
    ...deleteDialogWords(),
    heading: t("printers.delete_agent_heading"),
    removes: t("printers.delete_removes"),
    irreversible: t("printers.delete_agent_hint"),
    item: () => "",
  };
}

export function printerDeleteCopy(name: string, bluetooth = false): DeleteDialogSummaryCopy {
  return {
    ...deleteDialogWords(),
    heading: fill("printers.delete_named", { name }),
    summary: (impact) => {
      const names = assignmentNames(impact);
      const targets = new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(names);
      let sentence = "";
      if (targets)
        sentence = fill(bluetooth ? "printers.delete_unpair_remove" : "printers.delete_remove", {
          targets,
        });
      else if (bluetooth) sentence = t("printers.delete_unpair_only");
      return { sentence, ends: endLines(impact) };
    },
    alternative: (impact: PrinterDeleteImpact) => {
      const drawer = impact.drawerClose;
      if (!drawer) return undefined;
      return {
        warning: t("printers.drawer_delete_retained"),
        heading: t("printers.drawer_delete_close_first"),
        guidance: drawer.needsDrawerSetting
          ? fill("printers.drawer_delete_attach", { setting: t("printers.drawer_attached") })
          : drawer.devices.length
            ? fill("printers.drawer_delete_use_till", { names: deleteTargetNames(drawer.devices) })
            : fill("printers.drawer_delete_assign", {
                capability: t("device_profiles.capability.open-cash-drawer"),
              }),
        ...(drawer.needsDrawerSetting
          ? {
              link: {
                href: `/printers/view/printers/printer/${encodePathSegment(impact.target.id)}/editor/edit`,
                label: t("action.edit"),
              },
            }
          : drawer.devices.length === 0
            ? { link: { href: "/devices", label: t("printers.drawer_delete_devices") } }
            : {}),
        confirm: t("printers.drawer_delete_anyway"),
        cancel: t("printers.drawer_delete_stop"),
      };
    },
  };
}
