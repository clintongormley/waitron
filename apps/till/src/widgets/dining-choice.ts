import { css, html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import type { Dining } from "@waitron/shared";
import "@waitron/ui/src/components/wt-segmented-control.js";
import type { DiningChoice, ZoneDining } from "../api/client.js";
import { t } from "../i18n/t.js";

/** What an order screen shows of the way an order sells: a switch, a label, or nothing. */
export type DiningShown = { dining: Dining; switchable: boolean } | null;

/**
 * `choice` is the server's for a saved order and null for an unsaved draft. Only whether the switch
 * is offered comes from the department; a label always names the order's own way.
 */
export function diningShown(
  dining: Dining,
  choice: DiningChoice | null,
  start: ZoneDining | null,
): DiningShown {
  if (choice === "open" || (choice === null && start?.policy === "till_choice"))
    return { dining, switchable: true };
  if (dining === "eat_in" && (start === null || start.policy === "eat_in")) return null;
  return { dining, switchable: false };
}

export const diningStyles = css`
  .dining-label {
    display: inline-block;
    padding: var(--wt-space-1) var(--wt-space-2);
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-surface-raised);
    color: var(--wt-color-text);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
  }
`;

/** `host` re-emits the control's pick as `dining-change`, `detail: { dining }`. */
export function diningControl(
  shown: DiningShown,
  host: HTMLElement,
): TemplateResult | typeof nothing {
  if (shown === null) return nothing;
  if (!shown.switchable)
    return html`<span class="dining-label" data-dining-label
      >${t(shown.dining === "takeaway" ? "dining.takeaway" : "dining.eat_in")}</span
    >`;
  return html`<wt-segmented-control
    class="dining"
    name="dining"
    label=${t("dining.label")}
    hide-label
    .value=${live(shown.dining)}
    .options=${[
      { value: "eat_in", label: t("dining.eat_in") },
      { value: "takeaway", label: t("dining.takeaway") },
    ]}
    @wt-change=${(event: CustomEvent<{ value: Dining }>) => {
      event.stopPropagation();
      host.dispatchEvent(
        new CustomEvent("dining-change", {
          detail: { dining: event.detail.value },
          bubbles: true,
          composed: true,
        }),
      );
    }}
  ></wt-segmented-control>`;
}
