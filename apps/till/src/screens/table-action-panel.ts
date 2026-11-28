import { css, html, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { LeaveReason, WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-full-screen-panel.js";
import "@waitron/ui/src/components/wt-foot-button-bar.js";
import "@waitron/ui/src/components/wt-top-bar.js";
import { t } from "../i18n/t.js";
import { trackDialog } from "../widgets/track-dialog.js";

export const tableActionPanelStyles = css`
  .table-action-body {
    display: grid;
    gap: var(--wt-space-4);
    padding: var(--wt-space-4);
  }

  .table-action-list-label {
    margin: 0;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
    letter-spacing: var(--wt-letter-spacing-caps);
    text-transform: uppercase;
  }

  .table-action-message {
    padding-inline: var(--wt-space-4);
  }

  .table-action-message[data-move-bill-refusal] {
    padding-block-end: var(--wt-space-2);
  }

  .move-dishes-destinations {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wt-space-2);
    margin-inline: calc(var(--wt-space-3) - var(--wt-space-4));
  }

  .move-dishes-action-label {
    text-wrap: balance;
  }

  [data-move-dishes] till-portion-picker {
    margin-inline: calc(-1 * var(--wt-space-4));
  }

  [data-move-dishes] wt-foot-button-bar {
    --wt-foot-padding-inline: var(--wt-space-3);
    --wt-foot-action-font-size: calc((var(--wt-font-size-md) + var(--wt-font-size-lg)) / 2);
  }
`;

export function tableActionPanel(
  open: boolean,
  beforeClose: (reason: LeaveReason) => Promise<boolean>,
  closed: (event: Event) => void,
  step: TemplateResult | typeof nothing,
  label: string,
): TemplateResult {
  return html`<wt-dialog
    ${trackDialog()}
    data-action-panel
    data-table-action-dialog
    full-screen
    .open=${open}
    .ariaLabel=${label}
    .beforeClose=${beforeClose}
    @wt-back=${(event: Event) => void (event.currentTarget as WtDialog).requestClose("navigation")}
    @wt-close=${closed}
    >${step}</wt-dialog
  >`;
}

export function tableActionStep(
  kind: "target" | "split-table" | "split-pick" | "move-dishes",
  heading: { title: string; subtitle: string; label: string; showLabel?: boolean },
  body: TemplateResult,
  busy: boolean,
  footer: TemplateResult | typeof nothing = nothing,
): TemplateResult {
  return html`<wt-full-screen-panel
    ?data-target-picker=${kind === "target"}
    ?data-split-table=${kind === "split-table"}
    ?data-split-pick=${kind === "split-pick"}
    ?data-move-dishes=${kind === "move-dishes"}
    .bodyLabel=${heading.label}
  >
    ${keyed(
      kind,
      html`<section slot="header">
        <wt-top-bar
          data-action-back
          .backLabel=${t("action.back")}
          .backDisabled=${busy}
          .subtitle=${heading.subtitle}
          ><span slot="title" data-action-heading tabindex="-1">${heading.title}</span></wt-top-bar
        >
      </section>`,
    )}
    <div class="table-action-body">
      ${heading.showLabel ? html`<h2 class="table-action-list-label">${heading.label}</h2>` : nothing}
      ${body}
    </div>
    ${footer === nothing ? nothing : html`<div slot="footer">${footer}</div>`}
  </wt-full-screen-panel>`;
}
