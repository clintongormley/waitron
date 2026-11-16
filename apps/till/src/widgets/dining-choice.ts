import { html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import type { Dining } from "@waitron/shared";
import "@waitron/ui/src/components/wt-segmented-control.js";
import type { DiningChoice, ZoneDining } from "../api/client.js";
import { t } from "../i18n/t.js";

/** What an order screen shows of the way an order sells: a switch, a label, or nothing. */
export type DiningShown = { dining: Dining; switchable: boolean } | null;

/** A saved order's switch answer not read yet: its own way is unknown, so nothing is shown. */
export type UnreadDiningChoice = "unread";

/**
 * `choice` is the server's for a saved order and null for an unsaved draft. Only whether the switch
 * is offered comes from the department; a label always names the order's own way.
 */
export function diningShown(
  dining: Dining,
  choice: DiningChoice | UnreadDiningChoice | null,
  start: ZoneDining | null,
): DiningShown {
  if (choice === "unread") return null;
  if (choice === "open" || (choice === null && start?.policy === "till_choice"))
    return { dining, switchable: true };
  if (dining === "eat_in" && (start === null || start.policy === "eat_in")) return null;
  return { dining, switchable: false };
}

/** `host` re-emits the control's pick as `dining-change`, `detail: { dining }`. Its label is a
 * `floorChipStyles` chip, which the host's styles must include. */
export function diningControl(
  shown: DiningShown,
  host: HTMLElement,
  disabled = false,
): TemplateResult | typeof nothing {
  if (shown === null) return nothing;
  if (!shown.switchable)
    return shown.dining === "takeaway"
      ? html`<span class="chip tone-primary" data-dining-label>${t("dining.takeaway")}</span>`
      : html`<span class="chip" data-dining-label>${t("dining.eat_in")}</span>`;
  return html`<wt-segmented-control
    class="dining"
    name="dining"
    label=${t("dining.label")}
    hide-label
    ?disabled=${disabled}
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
