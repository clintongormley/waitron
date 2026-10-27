import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-icon.js";
import {
  MODES,
  colourToken,
  isTextWarning,
  type ColourWarning,
  type DerivedTheme,
  type Mode,
  type ThemeColour,
} from "@waitron/ui-core/theme";
import { fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { COLOUR_SECTIONS, sectionHasError, type AdvancedSectionId } from "./advanced-sections.js";
import { colourValueField, colourValueStyles } from "./color-field.js";
import { fixLineStyles } from "./fix-line-styles.js";
import {
  anyHandSet,
  handTouched,
  type HandField,
  type LookDraft,
  type TextField,
} from "./look-draft.js";
import "./theme-text.js";
import {
  advancedSummary,
  handFixLabel,
  handFixedText,
  handWarningLines,
  sectionHeading,
  sectionSummary,
  themeColourName,
} from "./theme-words.js";

export interface HandFixed {
  readonly from: string;
  readonly to: string;
}

export type HandAction =
  | { kind: "pick"; mode: Mode; key: ThemeColour; colour: string }
  | { kind: "type"; mode: Mode; key: ThemeColour; text: string }
  | { kind: "worked-out"; mode: Mode; key: ThemeColour }
  | { kind: "fix"; mode: Mode; key: ThemeColour; fix: string }
  | { kind: "undo"; mode: Mode; key: ThemeColour }
  | { kind: "reset-all" };

/** The Look card's Advanced section: every theme colour's light and dark value, set by hand or not. */
@customElement("dashboard-theme-advanced")
export class ThemeAdvanced extends LitElement {
  static override styles = [
    baseStyles,
    colourValueStyles,
    fixLineStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .intro {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
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
      .head {
        display: none;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .name {
        font-weight: var(--wt-font-weight-bold);
      }
      .value {
        display: grid;
        justify-items: start;
        min-width: 0;
      }
      .value.hand wt-input::part(field) {
        font-weight: var(--wt-font-weight-bold);
      }
      .line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        min-width: 0;
      }
      .mode-label {
        min-width: var(--wt-space-6);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
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
      /* A link starting a line of its own lines its words up with the value above. */
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
      .notes > .warning {
        margin: 0;
      }
      .section {
        border-top: 1px solid var(--wt-color-border);
      }
      .reset {
        display: flex;
        justify-content: flex-end;
        margin: var(--wt-space-5) 0 0;
      }
      @container (min-width: 600px) {
        .row {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1.5fr);
          align-items: start;
          column-gap: var(--wt-space-4);
        }
        .head {
          display: grid;
        }
        .name {
          display: flex;
          align-items: center;
          min-height: var(--wt-tap-min);
          font-weight: var(--wt-font-weight-normal);
        }
        .mode-label {
          display: none;
        }
      }
    `,
  ];

  @property({ attribute: false }) draft!: LookDraft;
  @property({ attribute: false }) derived!: DerivedTheme;
  @property({ attribute: false }) errors: Readonly<Partial<Record<HandField, string>>> = {};
  @property({ attribute: false }) fixed: Readonly<Partial<Record<HandField, HandFixed>>> = {};
  @property({ attribute: false }) textErrors: Readonly<Partial<Record<TextField, string>>> = {};
  @property({ type: Boolean }) busy = false;

  #waitingPick: { mode: Mode; key: ThemeColour; colour: string } | undefined;
  #frame: number | undefined;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    this.#waitingPick = undefined;
  }

  /** Opens the section and moves focus to that value's code field. */
  async reveal(mode: Mode, key: ThemeColour): Promise<void> {
    const disclosure =
      this.renderRoot.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
        "[data-test=advanced]",
      )!;
    disclosure.open = true;
    await disclosure.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(`wt-input[name="handSet.${mode}.${key}"]`)!.focus();
  }

  /** Sends a picked colour still waiting for its animation frame. */
  flush(): void {
    this.#flushPick();
  }

  /** A drag fires an input per pointer move; only the latest colour goes out, once a frame. */
  #pick(mode: Mode, key: ThemeColour, colour: string): void {
    const waiting = this.#waitingPick;
    if (waiting !== undefined && (waiting.mode !== mode || waiting.key !== key)) this.#flushPick();
    this.#waitingPick = { mode, key, colour };
    this.#frame ??= requestAnimationFrame(() => {
      this.#frame = undefined;
      this.#sendPick();
    });
  }

  #sendPick(): void {
    const waiting = this.#waitingPick;
    if (waiting === undefined) return;
    this.#waitingPick = undefined;
    this.#dispatch({ kind: "pick", ...waiting });
  }

  #flushPick(): void {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    this.#sendPick();
  }

  #send(detail: HandAction): void {
    this.#flushPick();
    this.#dispatch(detail);
  }

  #dispatch(detail: HandAction): void {
    this.dispatchEvent(
      new CustomEvent<HandAction>("hand-change", { detail, bubbles: true, composed: true }),
    );
  }

  #status(mode: Mode, key: ThemeColour): string {
    if (key !== "primary") return t("appearance.worked_out");
    return this.draft.choices.brandFix[mode] ? t("appearance.value_fixed") : t("appearance.brand");
  }

  #value(mode: Mode, key: ThemeColour): TemplateResult {
    const { choices, handCodes } = this.draft;
    const hand = handTouched(this.draft, mode, key);
    const worked = this.derived[mode][colourToken(key)]!;
    const colour = choices.handSet[mode][key] ?? worked;
    const value = fill("appearance.hand_value", {
      name: themeColourName(key),
      screens: t(`appearance.saved_fix_${mode}`),
    });
    return html`<div class="value ${hand ? "hand" : ""}">
      <span class="line"
        ><span class="mode-label">${t(`theme.${mode}`)}</span>${colourValueField({
          colour,
          code: handCodes[mode][key] ?? colour,
          name: `handSet.${mode}.${key}`,
          pickerName: `handSetPicker.${mode}.${key}`,
          label: value,
          codeLabel: fill("appearance.hand_code", {
            name: themeColourName(key),
            screens: t(`appearance.saved_fix_${mode}`),
          }),
          error: this.errors[`handSet.${mode}.${key}`] ?? "",
          busy: this.busy,
          pick: (picked) => this.#pick(mode, key, picked),
          type: (text) => this.#send({ kind: "type", mode, key, text }),
        })}${
          hand
            ? html`<span class="status tag" data-test="hand-status-${mode}-${key}"
                >${t("appearance.set_by_hand")}</span
              >`
            : html`<span class="status" data-test="hand-status-${mode}-${key}"
                >${this.#status(mode, key)}</span
              >`
        }</span
      >${
        hand
          ? html`<wt-button
              data-test="hand-worked-out-${mode}-${key}"
              class="link flush"
              variant="ghost"
              size="sm"
              aria-label=${fill("appearance.hand_action", {
                action: t("appearance.use_worked_out"),
                value,
              })}
              ?disabled=${this.busy}
              @click=${() => this.#send({ kind: "worked-out", mode, key })}
              >${t("appearance.use_worked_out")}</wt-button
            >`
          : nothing
      }
    </div>`;
  }

  #notes(mode: Mode, key: ThemeColour): TemplateResult {
    const field: HandField = `handSet.${mode}.${key}`;
    const value = fill("appearance.hand_value", {
      name: themeColourName(key),
      screens: t(`appearance.saved_fix_${mode}`),
    });
    const warning = this.derived.warnings.find(
      (w): w is ColourWarning => !isTextWarning(w) && w.field === field,
    );
    const fixed = this.fixed[field];
    return html`${
      warning === undefined
        ? nothing
        : html`<p class="warning">
              <wt-icon name="warning"></wt-icon
              ><span data-test="hand-warning-${mode}-${key}"
                >${handWarningLines(warning, this.draft.choices).join(" ")}</span
              >
            </p>
            ${
              warning.fix === null
                ? nothing
                : html`<p class="fixed">
                    <wt-button
                      data-test="hand-fix-${mode}-${key}"
                      size="sm"
                      aria-label=${fill("appearance.hand_action", {
                        action: handFixLabel(warning.fix),
                        value,
                      })}
                      ?disabled=${this.busy}
                      @click=${() => this.#send({ kind: "fix", mode, key, fix: warning.fix! })}
                      >${handFixLabel(warning.fix)}</wt-button
                    >
                  </p>`
            }`
    }${
      fixed === undefined || this.draft.choices.handSet[mode][key] !== fixed.to
        ? nothing
        : html`<p class="undo-line">
            <span class="fixed-text" data-test="hand-fixed-${mode}-${key}"
              >${handFixedText(mode, fixed.from)} </span
            ><span class="dot" aria-hidden="true">· </span
            ><wt-button
              data-test="hand-undo-${mode}-${key}"
              class="link"
              variant="ghost"
              size="sm"
              aria-label=${fill("appearance.hand_action", { action: t("appearance.undo"), value })}
              ?disabled=${this.busy}
              @click=${() => this.#send({ kind: "undo", mode, key })}
              >${t("appearance.undo")}</wt-button
            >
          </p>`
    }`;
  }

  #section(id: AdvancedSectionId, body: TemplateResult): TemplateResult {
    return html`<wt-disclosure
      class="section"
      data-test="section-${id}"
      heading=${sectionHeading(id)}
      summary=${sectionSummary(id, this.draft.choices, this.derived.warnings)}
      ?has-error=${sectionHasError(id, this.errors, this.textErrors)}
      >${body}</wt-disclosure
    >`;
  }

  override render() {
    return html`<wt-disclosure
      data-test="advanced"
      heading=${t("appearance.advanced")}
      summary=${advancedSummary(this.draft.choices, this.derived.warnings)}
      ?has-error=${
        Object.values(this.errors).some(Boolean) || Object.values(this.textErrors).some(Boolean)
      }
    >
      <p class="intro" data-test="advanced-intro">${t("appearance.advanced_intro")}</p>
      ${COLOUR_SECTIONS.map(({ id, keys }) =>
        this.#section(
          id,
          html`<div class="table">
            <div class="row head" aria-hidden="true">
              <span>${t("appearance.column_colour")}</span>
              ${MODES.map((mode) => html`<span>${t(`appearance.screens.${mode}`)}</span>`)}
            </div>
            ${keys.map(
              (key) =>
                html`<div class="row" data-test="hand-row-${key}">
                  <span class="name">${themeColourName(key)}</span>
                  ${MODES.map((mode) => this.#value(mode, key))}
                  <div class="notes">${MODES.map((mode) => this.#notes(mode, key))}</div>
                </div>`,
            )}
          </div>`,
        ),
      )}
      ${this.#section(
        "text",
        html`<dashboard-theme-text
          .draft=${this.draft}
          .derived=${this.derived}
          .errors=${this.textErrors}
          ?busy=${this.busy}
        ></dashboard-theme-text>`,
      )}
      <p class="reset">
        <wt-button
          data-test="reset-all"
          variant="secondary"
          ?disabled=${this.busy || !anyHandSet(this.draft)}
          @click=${() => this.#send({ kind: "reset-all" })}
          >${t("appearance.reset_all")}</wt-button
        >
      </p>
    </wt-disclosure>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-theme-advanced": ThemeAdvanced;
  }
}
