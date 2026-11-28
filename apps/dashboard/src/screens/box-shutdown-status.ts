import { html, nothing } from "lit";
import type { BoxHealth } from "../api/servers-api.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";

export function renderShutdownStatus(status: NonNullable<BoxHealth["shutdown"]>) {
  const { phase } = status;
  const powerOff = phase === "ready" ? status.powerOff : undefined;
  return html`
    <p role="status" data-test="box-shutdown-status">
      ${
        powerOff !== undefined
          ? t(`box_status.shutdown.power_off_${powerOff}`)
          : phase === "ready" && status.checked === false
            ? t("box_status.shutdown.unchecked")
            : phase === "idle"
              ? ""
              : t(
                  phase === "checking" && status.paired
                    ? "box_status.shutdown.checking_pair"
                    : phase === "checking" && status.directBucket
                      ? "box_status.shutdown.checking_bucket"
                      : `box_status.shutdown.${phase}`,
                )
      }
      ${powerOff !== undefined ? t("box_status.shutdown.power_off_manual") : nothing}
      ${
        powerOff !== undefined && phase === "ready" && status.checked === false
          ? t("box_status.shutdown.older_backup")
          : nothing
      }
      ${(phase === "paused" || phase === "download") && status.errorCode ? codeMessage(status.errorCode) : nothing}
      ${
        phase === "paused" && status.failedDestination !== undefined
          ? fill("box_status.shutdown.failed_destination", {
              destination: status.failedDestination,
            })
          : nothing
      }
    </p>
  `;
}
