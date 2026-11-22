import { css, html, nothing } from "lit";
import "@waitron/ui/src/components/wt-button.js";
import { named, t } from "../i18n/t.js";

export const draftHolderStyles = css`
  .held {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--wt-space-2);
    overflow-wrap: anywhere;
  }
`;

export function draftHolderRow({
  billId,
  label,
  ownerName,
  takenFromYou = false,
  takeOver,
}: {
  billId: string;
  label: string;
  ownerName: string | null;
  takenFromYou?: boolean;
  takeOver?: () => void;
}) {
  const name = ownerName ?? "";
  const words = takenFromYou
    ? named(name, t("table.draft_taken_by"), t("table.draft_taken_by_unnamed"))
    : named(name, t("table.others_draft"), t("table.others_draft_unnamed"));
  return html`<div class="held">
    <span>${words}</span>
    ${
      takeOver === undefined
        ? nothing
        : html`<wt-button
            variant="secondary"
            data-split-take-over=${billId}
            aria-label=${`${t("table.take_over")} · ${label}`}
            @click=${takeOver}
            >${t("table.take_over")}</wt-button
          >`
    }
  </div>`;
}
