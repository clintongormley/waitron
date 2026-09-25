import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, dispatchWtChange } from "@waitron/ui";
import { t } from "../i18n/t.js";

/**
 * A PARTIAL number the parent normalises before it reaches `decimal()`: never a leading zero
 * (`"05"`) or a second point, but it may end in `"."` mid-entry (see `till-tender-pay`'s
 * `#enteredDecimal`).
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

/**
 * A PIN's leading zeros are significant, so every digit appends verbatim: `0,0,0,0` builds `"0000"`,
 * which {@link nextPadValue} would collapse to `"0"`.
 */
export function nextPinValue(value: string, key: string): string {
  if (key === "backspace") return value.slice(0, -1);
  if (key === ".") return value;
  return value + key;
}

/** `label` is the accessible name for a key whose glyph is not its own (`.` and `⌫`). */
interface PadKey {
  key: string;
  glyph: string;
  label?: string;
}

/**
 * Deliberately PRESENTATIONAL: it knows nothing of money, weight or PINs. Each key press emits
 * `wt-change` with the string that key produces; the parent holds the value and passes it back down.
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

  @property() value = "";

  @property() mode: "decimal" | "pin" = "decimal";

  #keys(): PadKey[] {
    if (this.mode === "pin") {
      return [
        { key: "1", glyph: "1" },
        { key: "2", glyph: "2" },
        { key: "3", glyph: "3" },
        { key: "4", glyph: "4" },
        { key: "5", glyph: "5" },
        { key: "6", glyph: "6" },
        { key: "7", glyph: "7" },
        { key: "8", glyph: "8" },
        { key: "9", glyph: "9" },
        { key: "", glyph: "" },
        { key: "0", glyph: "0" },
        { key: "backspace", glyph: "⌫", label: t("pad.backspace") },
      ];
    }
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
    const next =
      this.mode === "pin" ? nextPinValue(this.value, key) : nextPadValue(this.value, key);
    dispatchWtChange(this, event, { value: next });
  }

  #renderKey({ key, glyph, label }: PadKey) {
    // The pin layout's spacer: it keeps `0` centred where the calculator layout has `.`.
    if (key === "") return html`<div class="key" aria-hidden="true"></div>`;
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
