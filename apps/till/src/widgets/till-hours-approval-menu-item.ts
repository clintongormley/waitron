import { html, nothing } from "lit";
import { t } from "../i18n/t.js";
import { floorMoreRow } from "./floor-bar.js";

export function hoursApprovalMenuItem(count: number | undefined, open: () => void, floor = false) {
  if (count === undefined) return nothing;
  const label = count ? `${t("hours.approval")} · ${count}` : t("hours.approval");
  return floor
    ? floorMoreRow(label, open, { className: "hours-approval" })
    : html`<wt-button icon="menu-hours" class="hours-approval" @click=${open}>${label}</wt-button>`;
}
