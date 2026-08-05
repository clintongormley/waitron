import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, dispatchWtChange } from "@waitron/ui";
import { t } from "../i18n/t.js";

/**
 * The number string produced by pressing `key` on a pad currently showing `value`.
 *
 * `key` is a digit `"0"`–`"9"`, `"."` (the decimal point) or `"backspace"`. The result is a
 * PARTIAL number the parent normalises before it reaches `decimal()`:
 *  - no leading zeros — a lone `"0"` is replaced by the next digit (`"0"` + `"5"` → `"5"`), so the
 *    string never becomes `"05"` (which `decimal()` rejects);
 *  - at most one decimal point — a second `"."` is ignored;
 *  - a decimal point on an empty pad seeds `"0."` rather than a bare `"."`.
 *
 * It may TRANSIENTLY end in `"."` (e.g. `"0."` while the operator is half-way through `"0.3"`),
 * which is the one shape `decimal()` rejects — stripping that trailing dot is the parent's single
 * normalisation step (see `till-tender-pay`'s `#enteredDecimal`). Kept pure and exported so every
 * branch is pinned by a unit test independent of the DOM.
 */
export function nextPadValue(value: string, key: string): string {
  if (key === "backspace") {
    return value.slice(0, -1);
  }
  if (key === ".") {
    if (value.includes(".")) return value;
    return value === "" ? "0." : `${value}.`;
  }
  // A digit. A lone leading zero is replaced rather than kept, except by another zero.
  if (value === "0") {
    return key === "0" ? "0" : key;
  }
  return value + key;
}

/** The pad's key layout, top-left to bottom-right. `glyph` is what shows; `label` is the a11y name
 * for the two keys whose glyph is not its own accessible name (`.` and `⌫`). */
interface PadKey {
  key: string;
  glyph: string;
  label?: string;
}

/**
 * A reusable touch numeric keypad — the shared input surface for the cash-tender amount and the kg
 * weight entry (Task 15). It is deliberately PRESENTATIONAL: it knows nothing of money, weight or
 * totals. It reads the current string via its `value` property, and on each key press emits a
 * `wt-change` CustomEvent carrying `{ value }` — the string that pressing that key produces (see
 * {@link nextPadValue}). The parent owns the meaning: it holds the value, decides what it means, and
 * passes the updated string back down.
 *
 * Every key is a `<wt-button>` (a 44px tap target with a focus ring for free). The `.` and `⌫` keys
 * carry an accessible `aria-label` and hide their decorative glyph, so their name is spoken text and
 * not a bare symbol.
 */
@customElement("till-numeric-pad")
export class TillNumericPad extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .pad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--wt-space-2);
      }

      .key {
        width: 100%;
      }

      /* Visually-hidden but kept in the accessibility tree, so the decimal and backspace keys take
         their spoken name from slotted text rather than an aria-label on the roleless wt-button host
         (which axe aria-prohibited-attr flags once the button is nested two shadow roots deep). */
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ];

  /** The string the pad is editing. Owned by the parent; the pad only reads it to compute the next. */
  @property() value = "";

  #keys(): PadKey[] {
    return [
      { key: "7", glyph: "7" },
      { key: "8", glyph: "8" },
      { key: "9", glyph: "9" },
      { key: "4", glyph: "4" },
      { key: "5", glyph: "5" },
      { key: "6", glyph: "6" },
      { key: "1", glyph: "1" },
      { key: "2", glyph: "2" },
      { key: "3", glyph: "3" },
      { key: ".", glyph: ".", label: t("pad.decimal") },
      { key: "0", glyph: "0" },
      { key: "backspace", glyph: "⌫", label: t("pad.backspace") },
    ];
  }

  #press(key: string, event: Event): void {
    dispatchWtChange(this, event, { value: nextPadValue(this.value, key) });
  }

  /**
   * One key. A digit's own glyph is its accessible name. The `.` and `⌫` keys hide their glyph and
   * take their name from a visually-hidden `.sr-only` label — see the styles for why that beats an
   * aria-label on the host.
   */
  #renderKey({ key, glyph, label }: PadKey) {
    const content = label
      ? html`<span aria-hidden="true">${glyph}</span><span class="sr-only">${label}</span>`
      : glyph;
    return html`
      <wt-button class="key" data-key=${key} @click=${(event: Event) => this.#press(key, event)}>
        ${content}
      </wt-button>
    `;
  }

  override render() {
    return html`<div class="pad">${this.#keys().map((padKey) => this.#renderKey(padKey))}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-numeric-pad": TillNumericPad;
  }
}
