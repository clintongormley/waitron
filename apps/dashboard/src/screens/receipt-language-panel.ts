import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController } from "@waitron/dashboard-kit";
import { resolveContentText, type ContentLanguages } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  submitOnEnter,
  focusFirstInvalid,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { DashboardApi, ReceiptLanguage } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { receiptLanguageName, receiptLanguageWarning } from "../widgets/receipt-language.js";

@customElement("dashboard-receipt-language-panel")
export class ReceiptLanguagePanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      section {
        display: grid;
        gap: var(--wt-space-3);
        max-width: var(--wt-form-max-width);
      }
      h2,
      p {
        margin: 0;
      }
      h2 {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
        color: var(--wt-color-text-muted);
      }
      [data-test="language-section"] {
        display: grid;
        gap: var(--wt-space-3);
      }
      .reason {
        color: var(--wt-color-text-muted);
      }
      .warning {
        padding: var(--wt-space-3);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private model?: ReceiptLanguage;
  @state() private content?: ContentLanguages;
  @state() private picked = "";
  @state() private saving = false;
  @state() private saved = false;
  @state() private fieldError = "";
  @state() private actionError = "";
  @state() private readError = "";
  #baseline = "";
  #scope?: DraftScope<string>;
  #identity = {};
  #generation = 0;
  #writes = 0;
  readonly #languageQueries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.readError = codeMessage(codeOf(error));
    },
    () => {
      this.readError = "";
    },
  );
  readonly #contentQueries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.content = undefined;
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.model) this.#register();
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.saving = false;
    super.disconnectedCallback();
  }
  #register(): void {
    if (this.#scope || !this.isConnected) return;
    this.#scope = draftScopeFor<string>(this, {
      id: this.#identity,
      parent: this,
      current: () => this.picked,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.picked = value;
        this.fieldError = "";
        this.actionError = "";
        this.saved = false;
        this.#scope?.changed();
      },
    }).scope;
    this.#scope.commit(this.#baseline);
  }
  async #load(): Promise<void> {
    const query = dashboardQuery(this.api, "getReceiptLanguage", []);
    await Promise.all([
      this.#languageQueries
        .watch(
          "language",
          {
            ...query,
            key: `${query.key}:receipt-language-panel`,
            read: async () => {
              const writes = this.#writes;
              return { writes, value: await query.read() };
            },
          },
          ({ writes, value }) => {
            if (writes !== this.#writes) return;
            const clean = this.#scope === undefined || !this.#scope.isDirty();
            if (this.model === undefined || clean || value.fixed !== null) {
              const changed = this.picked !== value.language || this.#baseline !== value.language;
              this.picked = value.language;
              this.#baseline = value.language;
              if (changed) this.#scope?.commit(value.language);
            }
            if (value.fixed !== null) this.fieldError = "";
            this.model = value;
            this.readError = "";
            this.#register();
          },
        )
        .catch(() => {}),
      this.#contentQueries
        .watch("content", dashboardQuery(this.api, "getContentLanguages", []), (value) => {
          this.content = value;
        })
        .catch(() => {}),
    ]);
  }
  #pick(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.picked = event.detail.value;
    this.fieldError = "";
    this.actionError = "";
    this.saved = false;
    this.#scope?.changed();
  }
  async #save(fixedLanguage?: string): Promise<void> {
    if (
      this.saving ||
      !this.model ||
      !this.#scope ||
      (fixedLanguage === undefined && saveActionState(this.#scope).unchanged)
    )
      return;
    const submitted = fixedLanguage ?? this.picked;
    const scope = this.#scope;
    const generation = this.#generation;
    this.saving = true;
    this.saved = false;
    this.fieldError = "";
    this.actionError = "";
    try {
      await this.api.putReceiptLanguage(submitted);
    } catch (error) {
      if (generation !== this.#generation || scope !== this.#scope) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
      const sentence =
        code === "management.request_invalid" && field === "receiptLanguage"
          ? t("receipts.language_invalid")
          : codeMessage(code);
      if (field === "receiptLanguage" && this.model.fixed === null) this.fieldError = sentence;
      else this.actionError = sentence;
      this.saving = false;
      await this.updateComplete;
      if (this.fieldError) await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    if (generation !== this.#generation || scope !== this.#scope) return;
    this.#writes++;
    this.model = { ...this.model, language: submitted };
    this.#baseline = submitted;
    if (fixedLanguage !== undefined) this.picked = submitted;
    scope.commit(submitted);
    this.saving = false;
    this.saved = true;
  }
  override render() {
    const model = this.model;
    const action = saveActionState(this.#scope);
    const fixed = model?.fixed;
    const offered = model ? [...new Set([...model.choices, model.language])] : [];
    return html`<section aria-labelledby="receipt-language-heading">
      <h2 id="receipt-language-heading">${t("receipts.language")}</h2>
      <wt-card>
        ${
          this.readError
            ? html`<p class="error" role="alert" data-test="language-load-error">
                  ${this.readError}
                </p>
                <wt-button variant="secondary" @click=${() => void this.#load()}
                  >${t("location_settings.retry")}</wt-button
                >`
            : nothing
        }
        ${
          model
            ? html`<div
                data-test="language-section"
                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=language-save]"))}
              >
                ${
                  fixed
                    ? html`<p data-test="receipt-language-value">
                          ${receiptLanguageName(model.language)}
                        </p>
                        <p class="reason">
                          ${resolveContentText(fixed.reason, currentLocale(), "en")}
                        </p>
                        ${
                          model.language === fixed.locale
                            ? nothing
                            : html`<p class="warning" role="note">
                                  ${t("receipts.language_stored").replace("{stored}", receiptLanguageName(model.language, false)).replace("{fixed}", receiptLanguageName(fixed.locale, false))}
                                </p>
                                <wt-button
                                  data-test="use-fixed-language"
                                  variant="primary"
                                  ?loading=${this.saving}
                                  ?disabled=${this.saving}
                                  @click=${() => void this.#save(fixed.locale)}
                                  >${t("receipts.language_use").replace("{fixed}", receiptLanguageName(fixed.locale, false))}</wt-button
                                >`
                        }`
                    : html`<wt-combobox
                        name="receiptLanguage"
                        label=${t("receipts.language")}
                        required
                        search="auto"
                        .options=${offered.map((language) => ({ value: language, label: receiptLanguageName(language) }))}
                        .value=${this.picked}
                        error=${this.fieldError}
                        ?disabled=${this.saving}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#pick(event)}
                      ></wt-combobox>`
                }
                ${this.content ? receiptLanguageWarning(fixed ? model.language : this.picked, this.content) : nothing}
                ${this.saved ? html`<p role="status">${t("receipts.saved")}</p>` : nothing}
                <wt-form-actions
                  .error=${[this.fieldError ? t("form.fix_fields") : "", this.actionError].filter(Boolean).join(" ")}
                >
                  ${
                    fixed
                      ? nothing
                      : html`<wt-button
                          data-test="language-save"
                          variant=${action.variant}
                          ?loading=${this.saving}
                          ?disabled=${this.saving || action.unchanged}
                          @click=${() => void this.#save()}
                          >${t("action.save")}</wt-button
                        >`
                  }
                </wt-form-actions>
              </div>`
            : nothing
        }
      </wt-card>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-receipt-language-panel": ReceiptLanguagePanel;
  }
}
