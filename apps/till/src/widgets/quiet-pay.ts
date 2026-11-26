import { css, html, nothing, type TemplateResult } from "lit";
import { registerIcons, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-amount-block.js";
import "@waitron/ui/src/components/wt-choice-tile.js";
import "@waitron/ui/src/components/wt-foot-button-bar.js";
import "@waitron/ui/src/components/wt-full-screen-panel.js";
import "@waitron/ui/src/components/wt-top-bar.js";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { BILL_PAY_WAYS, type PayChoice } from "../state/bill-payment.js";
import { helpBadge } from "./help-badge.js";

registerIcons({
  "pay-card": "M2 3h12v10H2V3zm1.5 1.5v2h9v-2h-9zm0 3.5v3.5h9V8h-9z",
  "pay-contactless":
    "M3.5 5a5.5 5.5 0 0 1 0 6l-1.2-.8a4 4 0 0 0 0-4.4l1.2-.8zm3-1.5a8.3 8.3 0 0 1 0 9l-1.2-.8a6.9 6.9 0 0 0 0-7.4l1.2-.8zM9.5 2a11 11 0 0 1 0 12l-1.2-.8a9.6 9.6 0 0 0 0-10.4L9.5 2z",
});

const [contribution, share, items, whole] = BILL_PAY_WAYS;
const payWays = [whole, share, items, contribution];

export const quietPayStyles = css`
  .quiet-pay-ways-label {
    ${visuallyHiddenStyles}
  }

  .quiet-pay-controls {
    padding: var(--wt-space-3);
  }

  .quiet-pay-ways {
    display: grid;
    gap: var(--wt-space-2);
  }

  .quiet-pay-footer {
    background: var(--wt-color-surface);
  }

  .quiet-pay-footer > wt-form-actions {
    padding-inline: var(--wt-space-4);
  }

  [data-quiet-pay-equipment] {
    --wt-action-padding: 0;
    --wt-action-text: var(--wt-color-primary-text);
    inline-size: var(--wt-tap-min);
    margin-inline-end: var(--wt-space-3);
  }

  [data-quiet-pay-breakdown] wt-button {
    --wt-action-text: var(--wt-color-primary-text);
    --wt-action-font-size: var(--wt-font-size-md);
  }
`;

export function quietPay(panel: {
  title: string;
  subtitle: string;
  equipment: TemplateResult;
  back: string;
  close: () => void;
  amount: string;
  breakdown?: TemplateResult;
  body: TemplateResult;
  actions: TemplateResult;
}): TemplateResult {
  return html`<wt-full-screen-panel data-quiet-pay .bodyLabel=${panel.title}>
    <wt-top-bar
      slot="header"
      .heading=${panel.title}
      .subtitle=${panel.subtitle}
      .backLabel=${panel.back}
      @wt-back=${panel.close}
    >
      ${panel.equipment}
    </wt-top-bar>
    <wt-amount-block>
      <span slot="label">${t("bill_pay.quiet_amount")}</span>
      <span data-quiet-pay-amount>${panel.amount}</span>
      ${panel.breakdown ?? nothing}
    </wt-amount-block>
    <div class="quiet-pay-controls">${panel.body}</div>
    <div class="quiet-pay-footer" slot="footer">${panel.actions}</div>
  </wt-full-screen-panel>`;
}

interface QuietTenderAction {
  run: () => void;
  disabled?: boolean;
}

export function quietTenderActions(
  amount: string,
  busy: boolean,
  { card, cash, manual }: Partial<Record<"card" | "cash" | "manual", QuietTenderAction>>,
): TemplateResult {
  return html`<wt-foot-button-bar
    >${
      card === undefined
        ? nothing
        : html`<wt-button
            data-quiet-pay-card
            icon="pay-card"
            variant="primary"
            .loading=${busy}
            .disabled=${busy || card.disabled === true}
            @click=${card.run}
            >${fill(t("bill_pay.charge_on_reader"), { amount })}</wt-button
          >`
    }
    ${
      cash === undefined
        ? nothing
        : html`<wt-button
            data-quiet-pay-cash
            variant="secondary"
            .disabled=${busy || cash.disabled === true}
            @click=${cash.run}
            >${t("tender.cash")}</wt-button
          >`
    }
    ${
      manual === undefined
        ? nothing
        : html`<wt-button
            data-quiet-pay-manual
            slot="link"
            variant="ghost"
            .disabled=${busy || manual.disabled === true}
            @click=${manual.run}
            >${t("bill_pay.method_other_terminal")}</wt-button
          >`
    }</wt-foot-button-bar
  >`;
}

export function quietEquipmentButton(
  expanded: boolean,
  busy: boolean,
  toggle: () => void,
): TemplateResult {
  return html`<wt-button
    data-quiet-pay-equipment
    slot="action"
    variant="secondary"
    aria-label=${t("pay_equipment.heading")}
    aria-expanded=${expanded}
    .disabled=${busy}
    @click=${toggle}
    ><wt-icon name="pay-contactless" size="md"></wt-icon
  ></wt-button>`;
}

export function quietWays(
  selected: PayChoice["kind"],
  itemsBarred: StringKey | null,
  busy: boolean,
  wholeAmount: string | undefined,
  choose: (way: PayChoice["kind"]) => void,
): TemplateResult {
  return html`<fieldset
    class="choice"
    data-pay-way
    aria-describedby=${itemsBarred === null ? nothing : "items-reason"}
  >
    <legend class="help-anchor">
      <span class="quiet-pay-ways-label">${t("bill_pay.way")}</span>
      ${helpBadge("help.payment", t("action.pay"), { guide: "table-service.pay-window" })}
    </legend>
    <div class="quiet-pay-ways">
      ${payWays.map(({ way, label }) => {
        const disabled = busy || (way === "items" && itemsBarred !== null);
        return html`<wt-choice-tile
          data-quiet-pay-way=${way}
          check-position="start"
          .label=${t(label)}
          .hint=${way === "whole" && wholeAmount !== undefined ? wholeAmount : t(`${label}_hint`)}
          .selected=${selected === way}
          .disabled=${disabled}
          @click=${disabled ? nothing : () => choose(way)}
        ></wt-choice-tile>`;
      })}
    </div>
    ${itemsBarred === null ? nothing : html`<p class="way-reason" id="items-reason" data-pay-items-reason>${t(itemsBarred)}</p>`}
  </fieldset>`;
}

export function quietTipBreakdown({
  bill,
  tip,
  busy,
  edit,
  remove,
}: {
  bill: string;
  tip?: string;
  busy: boolean;
  edit: () => void;
  remove: () => void;
}): TemplateResult {
  return html`<div slot="breakdown" data-quiet-pay-breakdown>
    ${tip === undefined ? nothing : fill(t("bill_pay.quiet_breakdown"), { bill, tip })}
    <wt-button size="sm" variant="ghost" data-quiet-pay-tip .disabled=${busy} @click=${edit}
      >${t("bill_pay.quiet_tip")}</wt-button
    >
    ${
      tip === undefined
        ? nothing
        : html`<wt-button
            size="sm"
            variant="ghost"
            data-quiet-pay-remove-tip
            .disabled=${busy}
            @click=${remove}
            >${t("bill_pay.remove_tip")}</wt-button
          >`
    }
  </div>`;
}
