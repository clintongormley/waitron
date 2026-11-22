import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, saveActionState, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import type { DashboardApi, PaymentSettingsView } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

type Switches = Pick<PaymentSettingsView, "tipsEnabled" | "testProviders">;

@customElement("dashboard-payments-settings")
export class PaymentsSettingsPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      section {
        display: grid;
        gap: var(--wt-space-3);
      }
      h2,
      p {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private draft?: Switches;
  @state() private latest?: PaymentSettingsView;
  @state() private saving = false;
  @state() private readError = "";
  @state() private saveError = "";
  #revision = 0;
  #scope?: DraftScope<Switches>;
  #generation = 0;
  #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readError = codeOf(error);
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#queries
      .watch("getPaymentSettings", [], (view) => this.#received(view))
      .catch(() => {});
  }

  override disconnectedCallback(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.latest = this.draft = undefined;
    this.saving = false;
    this.readError = this.saveError = "";
    super.disconnectedCallback();
  }

  #received(view: PaymentSettingsView): void {
    if (this.latest !== undefined && view.revision < this.latest.revision) return;
    this.latest = view;
    this.readError = "";
    if (view.testProvidersAvailable)
      this.dispatchEvent(
        new CustomEvent("payment-simulator-changed", { detail: !view.testProviders }),
      );
    if (!this.saving && !this.#scope?.isDirty()) this.#resetDraft(view);
  }

  #resetDraft(view: PaymentSettingsView): void {
    this.#revision = view.revision;
    this.draft = {
      tipsEnabled: view.tipsEnabled,
      testProviders: view.testProvidersAvailable && view.testProviders,
    };
    if (this.#scope === undefined) {
      const { scope } = draftScopeFor<Switches>(this, {
        id: this,
        current: () => this.draft!,
        snapshot: (draft) => ({ ...draft }),
        equal: (a, b) => a.tipsEnabled === b.tipsEnabled && a.testProviders === b.testProviders,
        restore: (draft) => {
          this.draft = draft;
          this.saveError = "";
        },
      });
      this.#scope = scope;
    }
    this.#scope.commit(this.draft);
  }

  #change(field: keyof Switches, event: CustomEvent<{ checked: boolean }>): void {
    if (!this.draft || this.saving) return;
    this.draft = { ...this.draft, [field]: event.detail.checked };
    this.saveError = "";
    this.#scope?.changed();
    if (!this.#scope?.isDirty() && this.latest) this.#resetDraft(this.latest);
  }

  async #save(): Promise<void> {
    const draft = this.draft;
    if (draft === undefined || this.saving || saveActionState(this.#scope).unchanged) return;
    this.saving = true;
    this.saveError = "";
    const generation = this.#generation;
    try {
      const saved = await this.api.savePaymentSettings({ ...draft, revision: this.#revision });
      if (generation !== this.#generation) return;
      this.#scope?.commit(draft);
      this.#received(saved);
      this.#resetDraft(this.latest!);
      this.api.liveData?.invalidate([{ type: "settings.payments" }]);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.saveError = codeOf(error);
      if (this.saveError === "settings.out_of_date") {
        const revision = (error as { params?: { revision?: number } }).params?.revision;
        if (typeof revision === "number") this.#revision = revision;
      }
    } finally {
      if (generation === this.#generation) this.saving = false;
    }
  }

  #switch(field: keyof Switches, label: string, hint: string) {
    return html`<div>
      <wt-switch
        name=${field}
        label=${label}
        description=${hint}
        .checked=${this.draft![field]}
        ?disabled=${this.saving}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.#change(field, event)}
      ></wt-switch>
      <p>${hint}</p>
    </div>`;
  }

  override render() {
    const action = saveActionState(this.#scope);
    const error = this.saveError || this.readError;
    return html`<section aria-labelledby="payment-settings-heading">
      <h2 id="payment-settings-heading">${t("payments.settings_heading")}</h2>
      ${
        this.draft
          ? html`${this.#switch("tipsEnabled", t("payments.tips_label"), t("payments.tips_hint"))}
            ${
              this.latest?.testProvidersAvailable
                ? this.#switch(
                    "testProviders",
                    t("payments.test_providers_label"),
                    t("payments.test_providers_hint"),
                  )
                : nothing
            }`
          : error
            ? nothing
            : html`<p role="status">${t("payments.settings_loading")}</p>`
      }
      <wt-form-actions .error=${error ? codeMessage(error) : ""}>
        <wt-button
          variant=${action.variant}
          ?disabled=${action.unchanged || this.saving}
          ?loading=${this.saving}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-payments-settings": PaymentsSettingsPanel;
  }
}
