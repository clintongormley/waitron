import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

@customElement("dashboard-recovery-document")
export class RecoveryDocumentPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
        margin-block: 0 var(--wt-space-3);
      }
      p {
        margin-block: var(--wt-space-3);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
        align-items: center;
      }
      a {
        color: var(--wt-color-primary-text);
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
      }
    `,
  ];
  @property({ attribute: false }) api!: Pick<DashboardApi, "reissueRecoveryDocument">;
  @property({ type: Boolean }) canManage = false;
  @state() private confirming = false;
  @state() private busy = false;
  @state() private failed = false;
  @state() private url?: string;
  #generation = 0;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(changes: PropertyValues): void {
    if ((changes.has("canManage") && !this.canManage) || changes.has("api")) this.#reset();
  }

  override disconnectedCallback(): void {
    this.#reset();
    super.disconnectedCallback();
  }

  #clear(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined;
  }

  #reset(): void {
    this.#generation++;
    this.#clear();
    this.busy = this.confirming = this.failed = false;
  }

  async #replace(): Promise<void> {
    if (!this.canManage || !this.confirming || this.busy) return;
    const generation = ++this.#generation;
    const api = this.api;
    this.#clear();
    this.busy = true;
    this.failed = false;
    try {
      const pdf = await api.reissueRecoveryDocument(currentLocale().startsWith("es") ? "es" : "en");
      if (
        generation !== this.#generation ||
        api !== this.api ||
        !this.canManage ||
        !this.isConnected
      )
        return;
      this.url = URL.createObjectURL(pdf);
      this.confirming = false;
    } catch {
      if (generation === this.#generation && api === this.api && this.canManage && this.isConnected)
        this.failed = true;
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }

  override render() {
    if (!this.canManage) return nothing;
    return html`<section aria-labelledby="recovery-document-title">
      <h2 id="recovery-document-title">${t("recovery_document.title")}</h2>
      <p>${t("recovery_document.intro")}</p>
      <wt-button
        data-test="new-document"
        variant="primary"
        ?disabled=${this.busy || this.confirming}
        @click=${() => {
          this.failed = false;
          this.confirming = true;
        }}
        >${t("recovery_document.create")}</wt-button
      >
      ${
        this.url
          ? html`<p>${t("recovery_document.keep")}</p>
              <div class="actions">
                <a data-test="download-document" href=${this.url} download="waitron-recovery.pdf"
                  >${t("recovery_document.download")}</a
                >
                <a
                  data-test="print-document"
                  href=${this.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  >${t("recovery_document.print")}</a
                >
                <wt-button data-test="clear-document" variant="ghost" @click=${() => this.#clear()}
                  >${t("recovery_document.clear")}</wt-button
                >
              </div>`
          : nothing
      }
      <wt-dialog
        data-test="confirm-dialog"
        .open=${this.confirming}
        .dismissible=${!this.busy}
        heading=${t("recovery_document.confirm_title")}
        @wt-close=${() => {
          if (!this.busy) this.confirming = false;
        }}
      >
        <p>${t("recovery_document.warning")}</p>
        <wt-form-actions
          data-test="document-error"
          .error=${this.failed ? t("recovery_document.failed") : ""}
        >
          <wt-button
            slot="cancel"
            data-test="cancel-document"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => {
              this.confirming = false;
            }}
            >${t("recovery_document.cancel")}</wt-button
          >
          <wt-button
            data-test="confirm-document"
            variant="danger"
            ?disabled=${this.busy}
            @click=${() => void this.#replace()}
            >${t("recovery_document.replace")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-recovery-document": RecoveryDocumentPanel;
  }
}
