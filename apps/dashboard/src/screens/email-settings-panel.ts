import { LitElement, css, html, nothing, type TemplateResult, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "../widgets/email-settings-form.js";
import type { DashboardApi, EmailSettingsView } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

@customElement("dashboard-email-settings-panel")
export class EmailSettingsPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        margin-bottom: var(--wt-space-4);
        min-width: 0;
      }
      .card {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        padding: var(--wt-space-4);
      }
      h2 {
        margin-top: 0;
        font-size: var(--wt-font-size-lg);
      }
      .summary {
        overflow-wrap: anywhere;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private view?: EmailSettingsView;
  @state() private readError?: string;
  @state() private editor?: { settings: EmailSettingsView["settings"] };
  #generation = 0;
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }
  override disconnectedCallback(): void {
    ++this.#generation;
    super.disconnectedCallback();
  }
  override updated(changed: PropertyValues): void {
    if (changed.has("editor") && changed.get("editor") && !this.editor) void this.#focusChange();
  }
  async #focusChange(): Promise<void> {
    const button =
      this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=change]");
    if (!button) return;
    await button.updateComplete;
    if (this.isConnected && button === this.shadowRoot!.querySelector("[data-test=change]"))
      button.focus();
  }
  async #load(): Promise<void> {
    const generation = ++this.#generation;
    try {
      const view = await (this.api.background ?? this.api).getEmailSettings();
      if (!this.isConnected || generation !== this.#generation) return;
      this.view = view;
      this.readError = undefined;
    } catch (error) {
      if (this.isConnected && generation === this.#generation) this.readError = codeOf(error);
    }
  }
  #saved(event: CustomEvent<{ close: boolean }>): void {
    event.stopPropagation();
    if (
      !this.isConnected ||
      event.target !== this.shadowRoot!.querySelector("dashboard-email-settings-form")
    )
      return;
    if (event.detail.close) this.editor = undefined;
    void this.#load();
  }
  override render(): TemplateResult {
    const view = this.view;
    return html`<section class="card" aria-labelledby="email-settings-heading">
      <h2 id="email-settings-heading">${t("email.settings.heading")}</h2>
      ${
        view
          ? html`<div class="summary" data-test="summary">
              <p>
                ${t(view.mode === "smtp" ? "email.settings.gateway" : view.mode === "local_capture" ? "email.settings.captured" : "email.settings.unavailable")}
              </p>
              ${
                view.settings
                  ? html`<p>
                        ${t("email.settings.server")}: ${view.settings.server}:${view.settings.port}
                        (${view.settings.encryption === "tls" ? "TLS" : "STARTTLS"})
                      </p>
                      <p>${t("email.settings.from")}: ${view.settings.from}</p>`
                  : nothing
              }
            </div>`
          : nothing
      }
      ${
        this.readError
          ? html`<p class="error" role="alert">${codeMessage(this.readError)}</p>
              <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
                >${t("email.settings.retry")}</wt-button
              >`
          : nothing
      }
      ${
        this.editor
          ? keyed(
              this.editor,
              html`<dashboard-email-settings-form
                .api=${this.api}
                .settings=${this.editor.settings}
                @email-saved=${(event: CustomEvent<{ close: boolean }>) => this.#saved(event)}
                @email-cancel=${(event: Event) => {
                  event.stopPropagation();
                  if (
                    event.target === this.shadowRoot!.querySelector("dashboard-email-settings-form")
                  )
                    this.editor = undefined;
                }}
              ></dashboard-email-settings-form>`,
            )
          : view?.editable
            ? html`<wt-button
                data-test="change"
                variant="secondary"
                @click=${() => {
                  if (this.isConnected && this.view?.editable)
                    this.editor = { settings: this.view.settings };
                }}
                >${t(view.settings ? "email.settings.change" : "email.settings.set_up")}</wt-button
              >`
            : nothing
      }
    </section>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-email-settings-panel": EmailSettingsPanel;
  }
}
