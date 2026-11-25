import { html, nothing } from "lit";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
import "@waitron/ui/src/components/wt-switch.js";
import { currentLocale, t } from "../i18n/t.js";
import type { GiveBackLine, GiveBackView } from "../api/give-back-types.js";
import { lineName } from "../screens/till-ticket-view.js";
import { unservedDishText } from "./dish-format.js";

const positive = (value: string) => compareDecimal(decimal(value), decimal("0")) > 0;

/** A cancelled dish's state: money still owed, money a card refund still waits on, or all back. */
function cancelledLabel(line: GiveBackLine): string {
  if (line.cancelled === null) return "";
  if (positive(line.cancelled.owed)) return t("give_back.cancelled_owed");
  return t(
    positive(line.cancelled.waiting) ? "give_back.cancelled_waiting" : "give_back.cancelled_back",
  );
}

export interface DishLinesOptions {
  namesLocale: string;
  ticked: readonly string[];
  onTick: (line: GiveBackLine, checked: boolean) => void;
  reasonText: (reason: NonNullable<GiveBackLine["reason"]>) => string;
}

/** A dish's "Which dishes?": each dish to tick, its priced extras under it, a dish given free
 * shown but never ticked. */
export function dishLines(view: GiveBackView, options: DishLinesOptions) {
  const dishText = (line: GiveBackLine) =>
    `${unservedDishText({
      dishName: lineName(line.descriptions, options.namesLocale),
      quantity: line.quantity,
    })} · ${formatMoney(line.gross, currentLocale())}`;
  const extrasOf = (dish: GiveBackLine) =>
    view.lines
      .filter((extra) => extra.partOf === dish.id)
      .map(
        (extra) => html`<p class="muted extra-of" data-extra-of=${dish.id}>${dishText(extra)}</p>`,
      );
  return html`<fieldset>
    <legend data-which>${t("give_back.which")}</legend>
    <div class="lines">
      ${view.lines
        .filter((line) => line.partOf === null)
        .map((line) =>
          line.givenFree
            ? html`<div class="free" data-free=${line.id}>
                  <span>${dishText(line)}</span>
                  <span class="muted">${t("give_back.given_free")}</span>
                </div>
                ${extrasOf(line)}`
            : html`<wt-switch
                  name="dish"
                  data-line=${line.id}
                  .label=${dishText(line)}
                  .description=${cancelledLabel(line)}
                  .checked=${options.ticked.includes(line.id)}
                  .disabled=${!line.available}
                  @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                    event.stopPropagation();
                    options.onTick(line, event.detail.checked);
                  }}
                ></wt-switch>
                ${
                  !line.available && line.reason !== null
                    ? html`<p class="reason" data-line-reason=${line.id}>
                        ${options.reasonText(line.reason)}
                      </p>`
                    : nothing
                }
                ${extrasOf(line)}`,
        )}
    </div>
  </fieldset>`;
}
