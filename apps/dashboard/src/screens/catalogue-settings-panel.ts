import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  leaveCoordinatorFor,
  saveActionState,
  submitOnEnter,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import {
  VAT_CLASSES,
  vatRateOn,
  localToday,
  type VatClass,
} from "@waitron/catalogue/src/vat-rates.js";
import type { CatalogueSettings, DashboardApi } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { vatClassName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";

@customElement("dashboard-catalogue-settings-panel")
export class CatalogueSettingsPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        margin-top: var(--wt-space-4);
      }
      form {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-width: 0;
        gap: var(--wt-space-3);
        max-width: var(--wt-field-max-width);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private model?: CatalogueSettings;
  @state() private draft = "";
  @state() private submitting = false;
  @state() private attempted = false;
  @state() private fieldError = "";
  @state() private actionError = "";
  @state() private readError = "";
  @state() private saved = false;
  #baseline = "";
  #generation = 0;
  #scope?: DraftScope<string>;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readError = codeMessage(codeOf(error));
    },
    () => {
      this.readError = "";
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    const generation = ++this.#generation;
    void this.#queries
      .watch("getCatalogueSettings", [], (model) => {
        if (generation !== this.#generation) return;
        const pristine = this.model === undefined || this.draft === this.#baseline;
        this.model = model;
        this.readError = "";
        if (pristine && !this.submitting) this.#setSaved(model.defaultProductVatClass);
        if (!this.#scope) {
          this.#scope = draftScopeFor<string>(this, {
            id: this,
            current: () => this.draft,
            snapshot: (value) => value,
            equal: (a, b) => a === b,
            restore: () => this.#cancel(),
          }).scope;
          this.#scope.commit(this.#baseline);
        }
      })
      .catch((error: unknown) => {
        if (generation === this.#generation) this.readError = codeMessage(codeOf(error));
      });
  }

  override disconnectedCallback(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.submitting = false;
    super.disconnectedCallback();
  }

  #setSaved(value: VatClass): void {
    this.draft = value;
    this.#baseline = value;
    this.#scope?.commit(value);
  }

  #valid(): boolean {
    return VAT_CLASSES.includes(this.draft as VatClass);
  }

  #change(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (this.submitting) return;
    this.draft = event.detail.value;
    this.fieldError = this.attempted && !this.#valid() ? t("catalogue_settings.invalid") : "";
    this.actionError = "";
    this.saved = false;
    this.#scope?.changed();
  }

  #cancel(): void {
    if (!this.model || this.submitting) return;
    this.#setSaved(this.model.defaultProductVatClass);
    this.attempted = false;
    this.fieldError = "";
    this.actionError = "";
    this.saved = false;
  }

  #requestCancel(): void {
    if (this.submitting) return;
    const leave = leaveCoordinatorFor(this);
    if (!leave || !this.#scope) {
      this.#cancel();
      return;
    }
    void leave.request({ scopes: [this], reason: "cancel", proceed: () => this.#cancel() });
  }

  async #save(): Promise<void> {
    if (!this.model || this.submitting) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.actionError = "";
    this.saved = false;
    this.fieldError = this.#valid() ? "" : t("catalogue_settings.invalid");
    if (this.fieldError) {
      await this.updateComplete;
      this.shadowRoot!.querySelector<HTMLElement>("wt-combobox")!.focus();
      return;
    }
    const generation = this.#generation;
    const submitted = { defaultProductVatClass: this.draft as VatClass };
    this.submitting = true;
    try {
      const model = await this.api.saveCatalogueSettings(submitted);
      if (generation !== this.#generation) return;
      this.model = model;
      this.#setSaved(model.defaultProductVatClass);
      this.saved = true;
      this.attempted = false;
    } catch (error) {
      if (generation !== this.#generation) return;
      const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
      if (codeOf(error) === "product.invalid" && field === "defaultProductVatClass")
        this.fieldError = t("catalogue_settings.invalid");
      else this.actionError = codeMessage(codeOf(error));
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }

  override render() {
    const saveAction = saveActionState(this.#scope);
    return html`
      ${this.readError ? html`<p class="error" role="alert">${this.readError}</p>` : nothing}
      ${
        this.model
          ? html`<form
              @submit=${(event: Event) => {
                event.preventDefault();
                void this.#save();
              }}
              @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
            >
              <wt-combobox
                name="defaultProductVatClass"
                required
                search="never"
                label=${t("catalogue_settings.default_vat")}
                hint=${t("catalogue_settings.hint")}
                .options=${VAT_CLASSES.map((value) => ({ value, label: `${vatClassName(value)} (${vatRateOn(value, localToday()).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")}%)` }))}
                .value=${this.draft}
                error=${this.fieldError}
                ?disabled=${this.submitting}
                @wt-change=${this.#change}
              ></wt-combobox>
              ${this.saved ? html`<p role="status">${t("catalogue_settings.saved")}</p>` : nothing}
              <wt-form-actions .error=${this.fieldError ? t("form.fix_fields") : this.actionError}>
                <wt-button
                  slot="cancel"
                  variant="secondary"
                  data-test="cancel"
                  ?disabled=${this.submitting}
                  @click=${() => this.#requestCancel()}
                  >${t("action.cancel")}</wt-button
                >
                <wt-button
                  variant=${saveAction.variant}
                  data-test="save"
                  ?loading=${this.submitting}
                  ?disabled=${saveAction.unchanged || (this.attempted && !this.#valid())}
                  @click=${() => void this.#save()}
                >
                  ${t("action.save")}</wt-button
                >
              </wt-form-actions>
            </form>`
          : this.readError
            ? nothing
            : html`<wt-spinner label=${t("catalogue_settings.loading")}></wt-spinner>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-settings-panel": CatalogueSettingsPanel;
  }
}
