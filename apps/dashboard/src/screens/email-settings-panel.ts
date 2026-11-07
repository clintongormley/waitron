import { LitElement, css, html, nothing, type TemplateResult, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "../widgets/email-settings-form.js";
import type { DashboardApi, EmailSettingsView } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { guideHref } from "../help-guide.js";

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
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      a {
        color: var(--wt-color-primary-text);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property() intent?: "demo" | "prepare" | "live";
  @state() private view?: EmailSettingsView;
  @state() private readError?: string;
  @state() private editor?: { settings: EmailSettingsView["settings"] };
  @state() private removeOpen = false;
  @state() private removing = false;
  @state() private actionError?: string;
  @state() private modeKnown = true;
  #generation = 0;
  #lifetime = 0;
  #focusAfterRemove = false;
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
    ++this.#lifetime;
    this.removeOpen = false;
    this.removing = false;
    this.actionError = undefined;
    this.#focusAfterRemove = false;
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
      this.modeKnown = true;
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
    this.api.liveData?.invalidate([{ type: "email_inbox" }]);
    void this.#load();
  }
  async #remove(): Promise<void> {
    if (
      !this.isConnected ||
      !this.removeOpen ||
      this.removing ||
      !this.view?.editable ||
      !this.view.settings
    )
      return;
    const lifetime = this.#lifetime;
    const current = () => this.isConnected && lifetime === this.#lifetime;
    this.removing = true;
    this.actionError = undefined;
    try {
      await this.api.removeEmailSettings();
      if (!current()) {
        if (this.isConnected) void this.#load();
        return;
      }
      ++this.#generation;
      this.view = { ...this.view!, settings: null };
      this.modeKnown = false;
      this.#focusAfterRemove = true;
      this.removeOpen = false;
      this.api.liveData?.invalidate([{ type: "email_inbox" }]);
    } catch (error) {
      if (current()) this.actionError = codeOf(error);
      else if (this.isConnected) void this.#load();
    } finally {
      if (current()) this.removing = false;
    }
  }
  async #removedClosed(event: Event): Promise<void> {
    event.stopPropagation();
    this.removeOpen = false;
    if (!this.isConnected || !this.#focusAfterRemove) return;
    this.#focusAfterRemove = false;
    const lifetime = this.#lifetime;
    await this.updateComplete;
    await this.#focusChange();
    if (this.isConnected && lifetime === this.#lifetime) void this.#load();
  }
  override render(): TemplateResult {
    const view = this.view;
    return html`<section class="card" aria-labelledby="email-settings-heading">
      <h2 id="email-settings-heading">${t("email.settings.heading")}</h2>
      ${
        view
          ? html`<div class="summary" data-test="summary">
              ${
                this.modeKnown
                  ? html`<p>
                      ${t(view.mode === "smtp" ? "email.settings.gateway" : view.mode === "local_capture" ? "email.settings.captured" : "email.settings.unavailable")}
                    </p>`
                  : nothing
              }
              ${this.intent === "prepare" && view.editable && !view.settings ? html`<p>${t("email.settings.prepare_save")}</p>` : nothing}
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
            ? html`<div class="actions">
                <wt-button
                  data-test="change"
                  variant="secondary"
                  @click=${() => {
                    if (this.isConnected && this.view?.editable)
                      this.editor = { settings: this.view.settings };
                  }}
                  >${t(view.settings ? "email.settings.change" : "email.settings.set_up")}</wt-button
                >
                ${
                  view.settings
                    ? html`<wt-button
                        data-test="remove"
                        variant="danger"
                        .disabled=${this.removing}
                        @click=${() => {
                          if (
                            this.isConnected &&
                            this.view?.editable &&
                            this.view.settings &&
                            !this.editor &&
                            !this.removing
                          ) {
                            this.actionError = undefined;
                            this.removeOpen = true;
                          }
                        }}
                        >${t("email.settings.remove")}</wt-button
                      >`
                    : nothing
                }
              </div>`
            : nothing
      }
      <wt-dialog
        data-test="remove-dialog"
        .open=${this.removeOpen}
        .dismissible=${!this.removing}
        .heading=${t("email.settings.remove")}
        @wt-close=${(event: Event) => void this.#removedClosed(event)}
      >
        <p>
          ${t(
            this.intent === "prepare" || this.view?.mode === "local_capture"
              ? "email.settings.remove_capture"
              : "email.settings.remove_live",
          )}
        </p>
        <p><a href=${guideHref("email.remove")}>${t("email.settings.remove_help")}</a></p>
        <wt-form-actions
          slot="footer"
          data-test="remove-actions"
          .error=${this.actionError ? codeMessage(this.actionError) : ""}
        >
          <wt-button
            data-test="remove-stop"
            variant="secondary"
            .disabled=${this.removing}
            @click=${() => {
              if (!this.removing) this.removeOpen = false;
            }}
            >${t("email.settings.stop")}</wt-button
          >
          <wt-button
            data-test="remove-confirm"
            variant="danger"
            .disabled=${this.removing}
            @click=${() => void this.#remove()}
            >${t("email.settings.remove")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
    </section>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-email-settings-panel": EmailSettingsPanel;
  }
}
