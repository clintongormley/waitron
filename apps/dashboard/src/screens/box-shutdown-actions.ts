import { html, nothing } from "lit";
import type { BoxHealth, ShutdownDecision } from "../api/servers-api.js";
import { t } from "../i18n/t.js";

export function renderShutdownPauseActions(
  status: NonNullable<BoxHealth["shutdown"]>,
  busy: boolean,
  choose: (decision: ShutdownDecision) => void,
  confirmUnchecked: () => void,
) {
  const { phase } = status;
  if (phase !== "paused" && phase !== "stalled") return nothing;
  const [decision, label] =
    phase === "stalled"
      ? (["keep-waiting", "keep_waiting"] as const)
      : (["retry", status.paired ? "retry_check" : "retry"] as const);
  return html`
    <wt-button
      variant="primary"
      data-test=${`box-shutdown-${decision}`}
      ?disabled=${busy}
      @click=${() => choose(decision)}
      >${t(`box_status.shutdown.${label}`)}</wt-button
    >
    <wt-button
      variant="danger"
      data-test="box-shutdown-anyway"
      ?disabled=${busy}
      @click=${confirmUnchecked}
      >${t("box_status.shutdown.anyway")}</wt-button
    >
  `;
}
