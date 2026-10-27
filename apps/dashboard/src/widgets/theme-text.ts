import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import {
  TEXT_SIZE_KEYS,
  TEXT_WEIGHTS,
  TEXT_WEIGHT_KEYS,
  TYPEFACES,
  drawnTextSize,
  type DerivedTheme,
  type TextSizeKey,
  type TextWeight,
  type TextWeightKey,
  type Typeface,
} from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import { fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { textTouched, type LookDraft, type TextField } from "./look-draft.js";
import { textAtStep, textFieldName } from "./theme-words.js";

export type TextAction =
  | { kind: "family"; family: Typeface }
  | { kind: "size"; key: TextSizeKey; text: string }
  | { kind: "weight"; key: TextWeightKey; weight: TextWeight }
  | { kind: "worked-out"; field: TextField }
  | { kind: "fix"; key: TextSizeKey; px: number };

const decreaseLabel = (label: string) => fill("action.decrease", { label });
const increaseLabel = (label: string) => fill("action.increase", { label });

const WORKED_OUT_WORDS = {
  family: "appearance.use_worked_out_typeface",
  size: "appearance.use_worked_out_size",
  weight: "appearance.use_worked_out_weight",
} as const;

const isTypeface = (value: string): value is Typeface =>
  (TYPEFACES as readonly string[]).includes(value);

function asWeight(value: string): TextWeight | undefined {
  return TEXT_WEIGHTS.find((weight) => String(weight) === value);
}

/** Advanced's Text rows: the typeface, the four sizes and the three weights. */
@customElement("dashboard-theme-text")
export class ThemeTextRows extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .table {
        container-type: inline-size;
        display: grid;
      }
      .row {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-1);
        padding-block: var(--wt-space-1);
        border-bottom: 1px solid var(--wt-color-border);
      }
      .name {
        font-weight: var(--wt-font-weight-bold);
      }
      .value {
        display: grid;
        justify-items: start;
        min-width: 0;
      }
      .value.hand wt-number-stepper::part(field),
      .value.hand wt-combobox::part(field) {
        font-weight: var(--wt-font-weight-bold);
      }
      .line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        min-width: 0;
      }
      .size {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
        white-space: nowrap;
      }
      .status {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
        white-space: nowrap;
      }
      .tag {
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-primary-text);
        border-radius: var(--wt-radius-full);
        color: var(--wt-color-primary-text);
      }
      wt-button.link::part(button) {
        font-weight: var(--wt-font-weight-normal);
        text-decoration: underline;
      }
      wt-button.link.flush::part(button) {
        padding-inline: 0;
      }
      .notes {
        grid-column: 1 / -1;
        display: grid;
        gap: var(--wt-space-2);
        min-width: 0;
      }
      .notes:empty {
        display: none;
      }
      .step {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      @container (min-width: 600px) {
        .row {
          grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
          align-items: start;
          column-gap: var(--wt-space-4);
        }
        .name {
          display: flex;
          align-items: center;
          min-height: var(--wt-tap-min);
          font-weight: var(--wt-font-weight-normal);
        }
        .notes {
          grid-column: 2;
        }
      }
    `,
  ];

  @property({ attribute: false }) draft!: LookDraft;
  @property({ attribute: false }) derived!: DerivedTheme;
  @property({ attribute: false }) errors: Readonly<Partial<Record<TextField, string>>> = {};
  @property({ type: Boolean }) busy = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #send(detail: TextAction): void {
    this.dispatchEvent(
      new CustomEvent<TextAction>("text-change", { detail, bubbles: true, composed: true }),
    );
  }

  #status(field: TextField, hand: boolean): TemplateResult {
    const row = field.slice("text.".length);
    return hand
      ? html`<span class="status tag" data-test="text-status-${row}"
          >${t("appearance.set_by_hand")}</span
        >`
      : html`<span class="status" data-test="text-status-${row}"
          >${t("appearance.worked_out")}</span
        >`;
  }

  #workedOut(field: TextField, part: keyof typeof WORKED_OUT_WORDS): TemplateResult {
    const words = t(WORKED_OUT_WORDS[part]);
    return html`<wt-button
      data-test="text-worked-out-${field.slice("text.".length)}"
      class="link flush"
      variant="ghost"
      size="sm"
      aria-label=${fill("appearance.hand_action", { action: words, value: textFieldName(field) })}
      ?disabled=${this.busy}
      @click=${() => this.#send({ kind: "worked-out", field })}
      >${words}</wt-button
    >`;
  }

  #row(
    field: TextField,
    part: keyof typeof WORKED_OUT_WORDS,
    control: TemplateResult,
    notes: TemplateResult | typeof nothing = nothing,
  ): TemplateResult {
    const hand = textTouched(this.draft, field);
    return html`<div class="row" data-test="text-row-${field.slice("text.".length)}">
      <span class="name">${textFieldName(field)}</span>
      <div class="value ${hand ? "hand" : ""}">
        <span class="line">${control}${this.#status(field, hand)}</span>
        ${hand ? this.#workedOut(field, part) : nothing}
      </div>
      <div class="notes">${notes}</div>
    </div>`;
  }

  #family(): TemplateResult {
    const field = "text.family";
    return this.#row(
      field,
      "family",
      html`<wt-combobox
        name=${field}
        label=${textFieldName(field)}
        hide-label
        search="never"
        stable-width
        .options=${TYPEFACES.map((value) => ({ value, label: t(`appearance.typeface.${value}`) }))}
        .value=${this.draft.choices.text.family ?? "system"}
        .error=${this.errors[field] ?? ""}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (isTypeface(event.detail.value)) {
            this.#send({ kind: "family", family: event.detail.value });
          }
        }}
      ></wt-combobox>`,
    );
  }

  #size(key: TextSizeKey): TemplateResult {
    const field = `text.size.${key}` as const;
    const { choices, textCodes } = this.draft;
    const own = drawnTextSize({ text: {}, textScale: 100 }, key, WAITRON_DEFAULTS);
    const step =
      choices.textScale === 100
        ? nothing
        : html`<p class="step" data-test="text-step-size.${key}">
            ${textAtStep(choices.textScale, drawnTextSize(choices, key, WAITRON_DEFAULTS))}
          </p>`;
    return this.#row(
      field,
      "size",
      html`<span class="size"
        ><wt-number-stepper
          name=${field}
          label=${fill("appearance.text_px_label", { name: textFieldName(field) })}
          hide-label
          .min=${8}
          .max=${40}
          .decreaseLabel=${decreaseLabel}
          .increaseLabel=${increaseLabel}
          .value=${textCodes[key] ?? String(choices.text.size?.[key] ?? own)}
          .error=${this.errors[field] ?? ""}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#send({ kind: "size", key, text: event.detail.value });
          }}
        ></wt-number-stepper
        ><span aria-hidden="true">${t("appearance.px")}</span></span
      >`,
      step,
    );
  }

  #weight(key: TextWeightKey): TemplateResult {
    const field = `text.weight.${key}` as const;
    const own = WAITRON_DEFAULTS.structure[`--wt-font-weight-${key}`];
    return this.#row(
      field,
      "weight",
      html`<wt-combobox
        name=${field}
        label=${textFieldName(field)}
        hide-label
        search="never"
        stable-width
        .options=${TEXT_WEIGHTS.map((weight) => ({ value: String(weight), label: String(weight) }))}
        .value=${String(this.draft.choices.text.weight?.[key] ?? own)}
        .error=${this.errors[field] ?? ""}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          const weight = asWeight(event.detail.value);
          if (weight !== undefined) this.#send({ kind: "weight", key, weight });
        }}
      ></wt-combobox>`,
    );
  }

  override render() {
    return html`<div class="table">
      ${this.#family()} ${TEXT_SIZE_KEYS.map((key) => this.#size(key))}
      ${TEXT_WEIGHT_KEYS.map((key) => this.#weight(key))}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-theme-text": ThemeTextRows;
  }
}
