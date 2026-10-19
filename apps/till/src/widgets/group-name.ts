import { t } from "../i18n/t.js";

interface NumberedGroup {
  displayNumber: number | null;
  numberPartyLabel?: string;
}

export function groupNumberText(group: NumberedGroup): string {
  if (group.displayNumber === null) return "";
  const number = String(group.displayNumber);
  return group.numberPartyLabel === undefined ? number : `${number} · ${group.numberPartyLabel}`;
}

export function groupName(group: NumberedGroup): string {
  return group.displayNumber === null
    ? ""
    : t("table.group_n").replace("{n}", () => groupNumberText(group));
}
