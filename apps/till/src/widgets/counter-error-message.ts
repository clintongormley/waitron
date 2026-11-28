import { html, type TemplateResult } from "lit";
import { formatMoney } from "@waitron/shared";
import type { TillZoneMenu } from "../api/menu-api.js";
import type { TableState } from "../api/floor-api.js";
import { codeMessage } from "../i18n/codes.js";
import { sentDishRefusalText } from "../i18n/sent-item-refusal.js";
import type { StringKey } from "../i18n/strings.js";
import { clockUnusableText, currentLocale, fill, named, overLimitText, t } from "../i18n/t.js";
import { billUnsentText } from "../state/bill-unsent.js";
import type { CounterError, ExcessCause } from "../state/counter-error.js";
import { tableSentence } from "../state/floor-today.js";
import { partyChangeMessage } from "../state/party-change.js";
import { lateChangeMessage } from "../state/sent-line-change.js";
import { recoveryLink, recoveryRefusalText } from "./recovery-refusal.js";

/** What was refused for leaving a bill owing less than it has received, which picks its words. */
const EXCESS_WORDS = {
  move: "bill.received_exceeds_total_excess",
  line: "bill.received_exceeds_total_line_excess",
  send: "bill.received_exceeds_total_send_excess",
  merge: "bill.received_exceeds_total_merge_excess",
} as const satisfies Record<ExcessCause, StringKey>;

export function errorText(
  error: CounterError,
  menus: readonly TillZoneMenu[],
  tables: readonly TableState[],
  billLabel?: string,
  checkTime = false,
  surface: "banner" | "panel" = "banner",
): string | TemplateResult {
  if (typeof error === "object" && "unsentBill" in error) return billUnsentText(billLabel);
  if (typeof error === "string") return t(error);
  if ("replacedGroups" in error)
    return t("table.draft_replaced_groups").replace("{groups}", () => error.replacedGroups);
  if ("code" in error) {
    const recovery = recoveryRefusalText(error);
    if (recovery !== null) return html`${recovery} ${recoveryLink(error, surface === "banner")}`;
    if (error.code === "menu_period.not_running") {
      const menu = menus.find((menu) => menu.id === error.menuId);
      if (menu !== undefined)
        return t("menu.period_not_running").replace("{menu}", () => menu.name);
    }
    if (error.code === "table.needs_moving") {
      const table = tables.find((each) => each.id === error.tableId);
      if (table !== undefined)
        return tableSentence(table, "floor.needs_moving_first", "floor.needs_moving_first_named");
    }
    const message =
      error.dishes === undefined
        ? codeMessage(error.code, undefined, error)
        : fill(t("station.no_default_named"), { dishes: error.dishes });
    const bill = error.bill;
    if (bill !== undefined) return fill(t("table.refused_on_bill"), { bill, message });
    if (error.printedInstead === true) return `${message} ${t("sale.email_unavailable_print")}`;
    return message;
  }
  if ("billNameTakenOver" in error)
    return named(
      error.billNameTakenOver,
      t("table.bill_name_taken_over"),
      t("table.bill_name_taken_over_unnamed"),
    );
  if ("printTakenOver" in error)
    return named(
      error.printTakenOver,
      t("table.print_taken_over"),
      t("table.print_taken_over_unnamed"),
    );
  if ("takenOver" in error)
    return error.unsent === true
      ? named(
          error.takenOver,
          t("table.draft_taken_over_unsent"),
          t("table.draft_taken_over_unsent_unnamed"),
        )
      : named(
          error.takenOver,
          t("table.draft_taken_over_unsaved"),
          t("table.draft_taken_over_unsaved_unnamed"),
        );
  if ("partyChanged" in error) return partyChangeMessage(error.partyChanged);
  if ("billChanged" in error)
    return t(error.billChanged.key).replace("{line}", () => error.billChanged.line);
  if ("splitChanged" in error) return fill(t("table.split_changed"), { bill: error.splitChanged });
  if ("splitTaken" in error)
    return error.splitTaken === ""
      ? t("table.split_taken_unnamed")
      : fill(t("table.split_taken"), { who: error.splitTaken });
  if ("splitGone" in error) return fill(t("table.split_bill_gone"), { bill: error.splitGone });
  if ("refundGone" in error)
    return fill(t("bill.refund_excess_bill_gone"), { bill: error.refundGone });
  if ("excess" in error) {
    const amount = formatMoney(error.excess, currentLocale());
    const words = t(EXCESS_WORDS[error.cause ?? "move"]).replaceAll("{amount}", () => amount);
    return html`<span class="error-part"
        >${
          error.bill === undefined
            ? words
            : fill(t("table.refused_on_bill"), { bill: error.bill, message: words })
        }</span
      ><span class="error-action"
        ><wt-button
          variant="secondary"
          size="sm"
          data-refund-excess
          @click=${(event: Event) =>
            event.currentTarget!.dispatchEvent(
              new CustomEvent("refund-excess", {
                detail: {
                  excess: error.excess,
                  ...(error.billId === undefined ? {} : { billId: error.billId }),
                  ...(error.bill === undefined ? {} : { bill: error.bill }),
                  ...(error.split === true ? { split: true } : {}),
                },
                bubbles: true,
                composed: true,
              }),
            )}
          >${t("bill.refund_excess").replace("{amount}", () => amount)}</wt-button
        ></span
      >`;
  }
  if ("overLimit" in error) return overLimitText(error.overLimit);
  if ("sentDishRefused" in error) return sentDishRefusalText(error.sentDishRefused);
  if ("clockUnusable" in error)
    return clockUnusableText(
      error.clockUnusable.clockAt,
      error.clockUnusable.offsetMinutes,
      checkTime,
    );
  if ("billPayments" in error)
    return [
      t("table.bill_to_pay").replace("{amount}", () =>
        formatMoney(error.billPayments, currentLocale()),
      ),
      t("bill.pay_with_bill_payments"),
    ].join(". ");
  const late = lateChangeMessage(error.lateChange);
  return error.also === undefined
    ? late
    : html`<span class="error-part">${late}</span
        ><span class="error-part"
          >${typeof error.also === "string" ? t(error.also) : codeMessage(error.also.code)}</span
        >`;
}
