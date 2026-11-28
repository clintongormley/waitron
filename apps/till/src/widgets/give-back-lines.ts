import { html, nothing } from "lit";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
import type { WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dish-pick-row.js";
import "@waitron/ui/src/components/wt-stepper.js";
import { currentLocale, fill, t } from "../i18n/t.js";
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
import { quantityText, unservedDishText } from "./dish-format.js";

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
  portionCount: number | null;
  portionAmount: string;
  onPortions: (amounts: readonly string[], count: number) => void;
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
      .map((extra) => html`<p slot="details" data-extra-of=${dish.id}>${dishText(extra)}</p>`);
  return html`<fieldset>
    <legend data-which>${t("give_back.which")}</legend>
    <div class="lines">
      ${view.lines
        .filter((line) => line.partOf === null)
        .map((line) => {
          const label = lineName(line.descriptions, options.namesLocale);
          const checked = options.ticked.includes(line.id);
          const partial = checked && options.portionCount !== null;
          const amounts = checked && options.ticked.length === 1 ? line.portionAmounts : undefined;
          const count = options.portionCount ?? amounts?.length ?? 0;
          return html`<wt-dish-pick-row
            name="dish"
            data-line=${line.givenFree ? nothing : line.id}
            data-free=${line.givenFree ? line.id : nothing}
            .label=${label}
            .quantity=${quantityText(line.quantity)}
            .amount=${formatMoney(line.gross, currentLocale())}
            .description=${line.givenFree ? t("give_back.given_free") : cancelledLabel(line)}
            .displayOnly=${line.givenFree}
            .checked=${checked}
            .indeterminate=${partial}
            .disabled=${line.givenFree || !line.available || (options.portionCount !== null && !checked)}
            .portionLabel=${amounts === undefined ? "" : t("give_back.refunding_portions")}
            .portionAmount=${amounts === undefined ? "" : options.portionAmount}
            @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
              event.stopPropagation();
              options.onTick(line, !partial && event.detail.checked);
            }}
          >
            ${extrasOf(line)}
            ${
              amounts === undefined
                ? nothing
                : html`<wt-stepper
                    slot="stepper"
                    variant="portion"
                    .label=${label}
                    .value=${count}
                    .min=${1}
                    .max=${amounts.length}
                    .formatCount=${(value: number, max: number) => fill(t("give_back.portion_count"), { count: String(value), total: String(max) })}
                    .decreaseLabel=${(name: string) => fill(t("action.decrease"), { label: name })}
                    .increaseLabel=${(name: string) => fill(t("action.increase"), { label: name })}
                    @wt-change=${(event: CustomEvent<{ value: number }>) => {
                      event.stopPropagation();
                      options.onPortions(amounts, event.detail.value);
                    }}
                  ></wt-stepper>`
            }
            ${
              !line.givenFree && !line.available && line.reason !== null
                ? html`<p slot="details" data-line-reason=${line.id}>
                    ${options.reasonText(line.reason)}
                  </p>`
                : nothing
            }
          </wt-dish-pick-row>`;
        })}
    </div>
    <p class="reason portion-note" role="status">
      ${options.portionCount === null ? nothing : t("give_back.portions_lock")}
    </p>
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

/** A step replaces the control that was pressed, so the new step's first control takes focus;
 * a press whose answer was lost, its Send again. */
export async function focusFirstControl(root: ShadowRoot): Promise<void> {
  await root.querySelector<WtDialog>("wt-dialog")?.updateComplete;
  (
    root.querySelector<HTMLElement>("[data-send-again]:not([disabled])") ??
    root.querySelector<HTMLElement>(
      ".body :is(wt-choice-row, wt-dish-pick-row, wt-switch, wt-price-input, wt-button):not([disabled])",
    )
  )?.focus();
}
