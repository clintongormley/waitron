import { css, html, nothing, type TemplateResult } from "lit";
import "@waitron/ui/src/components/wt-button.js";
import type { PairingHoldStatus } from "../api/pairing-hold.js";
import { t } from "../i18n/t.js";

/** For the styles of the dialog's host, beside {@link holdNotice}. */
export const holdNoticeStyles = css`
  .hold-lapsed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
    margin: var(--wt-space-2) 0;
    color: var(--wt-color-danger);
  }
`;

/**
 * Says a dialog's hold on the join window is gone, lapsed or refused, and offers to take a new one.
 * A refusal's reason is the dialog's own message to show; this says only that devices are no longer
 * accepted.
 */
export function holdNotice(
  status: PairingHoldStatus,
  restart: () => void,
): TemplateResult | typeof nothing {
  if (status !== "lapsed" && status !== "failed") return nothing;
  return html`<p role="status" class="hold-lapsed" data-test="hold-lapsed" data-status=${status}>
    ${t("pairing.hold_lapsed")}
    <wt-button size="sm" data-test="hold-restart" @click=${restart}
      >${t("pairing.hold_restart")}</wt-button
    >
  </p>`;
}
