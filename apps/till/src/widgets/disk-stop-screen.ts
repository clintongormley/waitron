import "@waitron/ui/src/components/wt-stop-screen.js";
import { html, nothing } from "lit";
import type { StaffNotice } from "../api/client.js";
import { t } from "../i18n/t.js";
import { trackDialog } from "./track-dialog.js";

export function diskStopScreen(notices: readonly StaffNotice[], covered: boolean) {
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
    <p>${t("staff_notice.tell_manager")}</p>
  </wt-stop-screen>`;
}
