import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ContentLanguages } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  VAT_CLASSES,
  vatRateOn,
  localToday,
  type VatClass,
} from "@waitron/catalogue/src/vat-rates.js";
import { QueryController } from "@waitron/dashboard-kit";
import type { DashboardApi, VenueDefaults } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { vatClassName } from "../i18n/domain.js";
import { fill, t } from "../i18n/t.js";
import { receiptLanguageName, receiptLanguageWarning } from "../widgets/receipt-language.js";
import { settingsCard, settingsCardStyles, settingsRows } from "../widgets/settings-card.js";

type Draft = Pick<VenueDefaults, "receiptLanguage" | "defaultProductVatClass">;
type Field = keyof Draft;
const FIELDS: readonly Field[] = ["receiptLanguage", "defaultProductVatClass"];
const LANGUAGE_REFUSALS = new Set(["receipt.language_orders_open", "receipt.language_fixed"]);

function changes(expected: Draft, draft: Draft): Partial<Draft> {
  return Object.fromEntries(
    FIELDS.filter((key) => draft[key] !== expected[key]).map((key) => [key, draft[key]]),
  );
}

export function vatClassLabel(value: VatClass): string {
  const rate = vatRateOn(value, localToday()).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
  return `${vatClassName(value)} (${rate}%)`;
}

@customElement("dashboard-venue-defaults-panel")
export class VenueDefaultsPanel extends LitElement {
  static override styles = [
    baseStyles,
    settingsCardStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      p {
        margin: var(--wt-space-3) 0 0;
      }
      .warning {
        padding: var(--wt-space-3);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
      }
      .error {
        color: var(--wt-color-danger);
      }
      form {
        display: grid;
        gap: var(--wt-space-3);
      }
      form > wt-combobox {
        max-width: var(--wt-form-max-width);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private model?: VenueDefaults;
  @state() private content?: ContentLanguages;
  @state() private readError = "";
  @state() private draft?: Draft;
  @state() private errors: Partial<Record<Field, string>> = {};
  @state() private actionError = "";
  @state() private submitting = false;
  #expected?: Draft;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #generation = 0;
  #writes = 0;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.readError = codeMessage(codeOf(error));
    },
    () => {
      this.readError = "";
    },
  );
  readonly #contentQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.content = undefined;
    },
  );

  constructor() {
    super();
    this.addEventListener("venue-settings-hidden", () => {
      if (this.#scope && saveActionState(this.#scope).unchanged) this.#cancel();
    });
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.#generation++;
    this.#registerDraft();
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.submitting = false;
    super.disconnectedCallback();
  }
  #begin(): void {
    const model = this.model;
    if (!model) return;
    this.#expected = {
      receiptLanguage: model.receiptLanguage,
      defaultProductVatClass: model.defaultProductVatClass,
    };
    this.draft = {
      ...this.#expected,
      receiptLanguage: model.fixedReceiptLanguage ?? model.receiptLanguage,
    };
    this.errors = {};
    this.actionError = "";
    this.#registerDraft();
  }
  #registerDraft(): void {
    if (!this.isConnected || !this.draft || !this.#expected || this.#scope) return;
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.draft!,
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => Object.keys(changes(a, b)).length === 0,
      restore: () => this.#cancel(),
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#expected);
  }
  #cancel(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.draft = undefined;
    this.#expected = undefined;
    this.errors = {};
    this.actionError = "";
  }
  #requestCancel(): void {
    if (this.submitting) return;
    const scope = this.#scope;
    if (!scope || !this.#leave) {
      this.#cancel();
      return;
    }
    void this.#leave.request({
      scopes: [this],
      reason: "cancel",
      proceed: () => {
        if (this.#scope === scope) this.#cancel();
      },
    });
  }
  #adopt(model: VenueDefaults): void {
    if (!this.draft || !this.#scope) return;
    if (!saveActionState(this.#scope).unchanged) {
      const fixed = model.fixedReceiptLanguage;
      if (fixed && this.draft.receiptLanguage !== fixed) {
        this.draft = { ...this.draft, receiptLanguage: fixed };
        this.#scope.changed();
      }
      return;
    }
    const expected = {
      receiptLanguage: model.receiptLanguage,
      defaultProductVatClass: model.defaultProductVatClass,
    };
    const draft = {
      ...expected,
      receiptLanguage: model.fixedReceiptLanguage ?? model.receiptLanguage,
    };
    if (this.#expected && Object.keys(changes(this.#expected, expected)).length === 0) {
      if (Object.keys(changes(this.draft, draft)).length > 0) {
        this.draft = draft;
        this.#scope.changed();
      }
      return;
    }
    this.#expected = expected;
    this.draft = draft;
    this.#scope.commit(expected);
  }
  #change(field: Field, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.draft || this.submitting) return;
    this.draft = { ...this.draft, [field]: event.detail.value };
    const errors = { ...this.errors };
    delete errors[field];
    this.errors = errors;
    this.actionError = "";
    this.#scope?.changed();
  }
  async #save(): Promise<void> {
    if (this.submitting || !this.draft || !this.#expected) return;
    if (saveActionState(this.#scope).unchanged) return;
    const generation = this.#generation;
    const scope = this.#scope;
    this.submitting = true;
    this.errors = {};
    this.actionError = "";
    try {
      const answer = await this.api.putVenueDefaults(changes(this.#expected, this.draft));
      if (generation !== this.#generation || scope !== this.#scope) return;
      this.#writes++;
      this.model = answer;
      this.#cancel();
    } catch (error) {
      if (generation !== this.#generation || scope !== this.#scope) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
      if (LANGUAGE_REFUSALS.has(code)) this.errors = { receiptLanguage: codeMessage(code) };
      else if (code === "management.request_invalid" && field === "receiptLanguage")
        this.errors = { receiptLanguage: t("receipts.language_invalid") };
      else if (code === "product.invalid" && field === "defaultProductVatClass")
        this.errors = { defaultProductVatClass: t("catalogue_settings.invalid") };
      else this.actionError = codeMessage(code);
      this.submitting = false;
      if (Object.keys(this.errors).length > 0) {
        await this.updateComplete;
        await focusFirstInvalid(this.shadowRoot!.querySelector("form")!);
      }
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }
  #form(model: VenueDefaults) {
    const draft = this.draft!;
    const fixed = model.fixedReceiptLanguage;
    const languages = fixed
      ? [fixed]
      : [...new Set([...model.receiptLanguageChoices, model.receiptLanguage])];
    const saveAction = saveActionState(this.#scope);
    return html`<form
      @submit=${(event: Event) => {
        event.preventDefault();
        void this.#save();
      }}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
    >
      <wt-combobox
        name="receiptLanguage"
        label=${t("receipts.language")}
        required
        search="never"
        .options=${languages.map((value) => ({ value, label: receiptLanguageName(value) }))}
        .value=${draft.receiptLanguage}
        .error=${this.errors.receiptLanguage ?? ""}
        ?disabled=${this.submitting}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("receiptLanguage", event)}
      ></wt-combobox>
      <wt-combobox
        name="defaultProductVatClass"
        label=${t("catalogue_settings.default_vat")}
        required
        search="never"
        .options=${VAT_CLASSES.map((value) => ({ value, label: vatClassLabel(value) }))}
        .value=${draft.defaultProductVatClass}
        .error=${this.errors.defaultProductVatClass ?? ""}
        ?disabled=${this.submitting}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("defaultProductVatClass", event)}
      ></wt-combobox>
      ${this.content ? receiptLanguageWarning(draft.receiptLanguage, this.content) : nothing}
      <wt-form-actions
        .error=${Object.keys(this.errors).length > 0 ? t("form.fix_fields") : this.actionError}
      >
        <wt-button
          slot="cancel"
          data-test="cancel"
          ?disabled=${this.submitting}
          @click=${() => this.#requestCancel()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant=${saveAction.variant}
          ?loading=${this.submitting}
          ?disabled=${saveAction.unchanged || this.submitting}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </form>`;
  }
  async #load(): Promise<void> {
    const generation = this.#generation;
    const query = dashboardQuery(this.api, "getVenueDefaults", []);
    await Promise.all([
      this.#queries
        .watch(
          "getVenueDefaults",
          {
            ...query,
            key: `${query.key}:venue-defaults-panel`,
            read: async () => {
              const writes = this.#writes;
              return { writes, value: await query.read() };
            },
          },
          ({ writes, value }) => {
            if (generation !== this.#generation || writes !== this.#writes) return;
            this.model = value;
            this.readError = "";
            this.#adopt(value);
          },
        )
        .catch(() => {}),
      this.#contentQueries
        .watch("getContentLanguages", [], (value) => {
          if (generation === this.#generation) this.content = value;
        })
        .catch(() => {}),
    ]);
  }
  override render() {
    const model = this.model;
    const fixed = model?.fixedReceiptLanguage;
    return html`${
      this.readError
        ? html`<p class="error" role="alert" data-test="read-error">${this.readError}</p>
            <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
              >${t("location_settings.retry")}</wt-button
            >`
        : nothing
    }
    ${
      model
        ? settingsCard({
            id: "defaults-card",
            heading: t("venue_settings.card.defaults"),
            editing: Boolean(this.draft),
            action: this.draft
              ? nothing
              : html`<wt-button data-test="edit" @click=${() => this.#begin()}
                  >${t("action.edit")}</wt-button
                >`,
            body: this.draft
              ? this.#form(model)
              : html`${settingsRows([
                  {
                    label: t("receipts.language"),
                    value: receiptLanguageName(model.receiptLanguage),
                    dataTest: "saved-receiptLanguage",
                  },
                  {
                    label: t("catalogue_settings.default_vat"),
                    value: vatClassLabel(model.defaultProductVatClass),
                    dataTest: "saved-defaultProductVatClass",
                  },
                ])}
                ${this.content ? receiptLanguageWarning(model.receiptLanguage, this.content) : nothing}
                ${
                  fixed && fixed !== model.receiptLanguage
                    ? html`<p class="warning" role="note" data-test="stored-differs">
                        ${fill("receipts.language_stored", {
                          stored: receiptLanguageName(model.receiptLanguage, false),
                          fixed: receiptLanguageName(fixed, false),
                        })}
                      </p>`
                    : nothing
                }`,
          })
        : nothing
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-defaults-panel": VenueDefaultsPanel;
  }
}
