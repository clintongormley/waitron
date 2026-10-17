import { css, html, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { isValidGuestCount, MAX_GUEST_COUNT } from "@waitron/shared";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { t } from "../i18n/t.js";

/** A blank field records no count; anything else must be a whole number from 1. */
export function parseGuestCount(value: string): { guestCount: number | null } | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return { guestCount: null };
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const count = Number(trimmed);
  return isValidGuestCount(count) ? { guestCount: count } : undefined;
}

/** Two field values that record the same count, however spelled; two invalid ones only when they
 * match once trimmed. */
export function sameGuestCount(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: string): string {
  const parsed = parseGuestCount(value);
  return parsed === undefined ? `invalid:${value.trim()}` : String(parsed.guestCount);
}

export function guestsText(entry: string | undefined, receiptGuests: number | null): string {
  return entry ?? (receiptGuests === null ? "" : String(receiptGuests));
}

export const guestsStepperStyles = css`
  /* Room for the empty field's placeholder between the two buttons. */
  .guests {
    --wt-stepper-field-width: calc(var(--wt-tap-min) * 3);
  }
`;

/** No draft scope tracks this field (A663 Part 3b plan). */
export function guestsStepper(field: {
  text: string;
  disabled: boolean;
  error: string;
  onChange: (event: Event) => void;
}): TemplateResult {
  return html`<wt-number-stepper
    name="guests"
    class="guests"
    clearable
    .min=${1}
    .max=${MAX_GUEST_COUNT}
    .label=${t("seat.guest_count")}
    .placeholder=${t("receipt.guests_none")}
    .decreaseLabel=${(label: string) => t("action.decrease").replace("{label}", label)}
    .increaseLabel=${(label: string) => t("action.increase").replace("{label}", label)}
    .value=${live(field.text)}
    .disabled=${field.disabled}
    .error=${field.error}
    @wt-change=${field.onChange}
  ></wt-number-stepper>`;
}
