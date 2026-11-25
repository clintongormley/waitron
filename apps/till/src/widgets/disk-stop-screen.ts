import "@waitron/ui/src/components/wt-stop-screen.js";
import { html, nothing } from "lit";
import type { StaffNotice } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { recoveryLink, recoveryRefusalOf, recoveryRefusalText } from "./recovery-refusal.js";
import { trackDialog } from "./track-dialog.js";

export function diskStopScreen(
  notices: readonly StaffNotice[],
  covered: boolean,
  paymentRefusal: unknown,
) {
  if (
    covered ||
    !notices.some((notice) => notice.owner === "box" && notice.code === "storage.disk_full")
  ) {
    return nothing;
  }

  return html`<wt-stop-screen
    ${trackDialog()}
    .open=${true}
    .heading=${t("disk_stop.heading")}
    .description=${t("disk_stop.description")}
  >
    <p>${paymentAdvice(paymentRefusal)}</p>
  </wt-stop-screen>`;
}

function paymentAdvice(refusal: unknown) {
  switch (refusal) {
    case "sale.disk_full":
    case "sale.disk_full_manual_card":
    case "sale.charged_disk_full":
    case "sale.unconfirmed":
      return t(refusal);
  }
  if (
    typeof refusal === "object" &&
    refusal !== null &&
    "code" in refusal &&
    refusal.code === "sale.charged_not_recorded"
  ) {
    const recovery = recoveryRefusalOf(refusal);
    return recovery === undefined
      ? codeMessage(refusal.code)
      : html`${recoveryRefusalText(recovery)} ${recoveryLink(recovery, true)}`;
  }
  return t("staff_notice.tell_manager");
}
