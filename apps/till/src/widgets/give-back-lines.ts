import { html, nothing } from "lit";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
import "@waitron/ui/src/components/wt-switch.js";
import { currentLocale, t } from "../i18n/t.js";
import type {
  GiveBackAvailability,
  GiveBackLine,
  GiveBackPurpose,
  GiveBackView,
  GiveBackWaitReason,
  GiveBackWay,
} from "../api/give-back-types.js";
import { usable } from "./give-back-draft.js";
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

/** "How it goes back": each payment, up to what it holds for `purpose`, or why it must wait. */
export function wayLines(
  ways: readonly GiveBackWay[],
  options: {
    purpose: GiveBackPurpose;
    chosen: string;
    onChoose: (way: GiveBackWay) => void;
    reasonText: (reason: GiveBackWaitReason) => string;
  },
) {
  return html`<fieldset data-how>
    <legend>${t("give_back.how")}</legend>
    ${ways.map((way) => {
      const upTo = formatMoney(
        options.purpose === "extra" ? way.extraLeft : way.moneyLeft,
        currentLocale(),
      );
      const words =
        way.way === "cash"
          ? t("give_back.way_cash").replace("{amount}", () => upTo)
          : t("give_back.way_card")
              .replace("{card}", () => (way.last4 === null ? "" : `···${way.last4}`))
              .replace("{amount}", () => upTo)
              .replace(/\s+/g, " ");
      return html`<label class="option"
          ><input
            type="radio"
            name="way"
            .value=${way.way}
            .checked=${way.way === options.chosen}
            .disabled=${!usable(way)}
            @change=${(event: Event) => {
              event.stopPropagation();
              options.onChoose(way);
            }}
          /><span>${words}</span></label
        >${
          usable(way)
            ? nothing
            : html`<p class="reason" data-way-reason=${way.way}>
                ${way.reason === null ? t("give_back.way_not_here") : options.reasonText(way.reason)}
              </p>`
        }`;
    })}
  </fieldset>`;
}

/** One answer to "What is it for?", or why it must wait. */
export function choiceRow(
  purpose: GiveBackPurpose,
  hint: string,
  { available, reason }: GiveBackAvailability,
  onChoose: () => void,
  reasonText: (reason: GiveBackWaitReason) => string,
) {
  const heading = t(`give_back.${purpose}`);
  if (available)
    return html`<wt-choice-row data-choice=${purpose} heading=${heading} @click=${onChoose}
      >${hint}</wt-choice-row
    >`;
  return html`<div class="unavailable" data-choice=${purpose} aria-disabled="true">
    <span class="title">${heading}</span>
    <span class="hint">${hint}</span>
    ${
      reason === null
        ? nothing
        : html`<span data-choice-reason=${purpose}>${reasonText(reason)}</span>`
    }
  </div>`;
}
