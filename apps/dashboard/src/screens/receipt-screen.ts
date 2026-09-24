import { DraftRows } from "@waitron/dashboard-kit";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, ReceiptConfig } from "../api/client.js";

/**
 * Authors only the non-fiscal trim printed around a receipt; the fiscal core of the receipt is not
 * editable here. The footer is a native `<textarea>` because `wt-input` has no multiline form.
 */
@customElement("dashboard-receipt-screen")
export class ReceiptScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        max-width: 32rem;
      }
      .field-label {
        display: block;
        margin-bottom: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      textarea {
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        resize: vertical;
      }
      .save {
        margin-top: var(--wt-space-6);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #draft = new DraftRows<{ id: string; headerSubtitle: string; footerMessage: string }>();
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @state() private submitting = false;
  @state() private headerSubtitle = "";
  @state() private footerMessage = "";
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#queries.watch("getReceipt", [], ({ receipt }) => {
        const [merged] = this.#draft.merge(
          [
            {
              id: "receipt",
              headerSubtitle: this.headerSubtitle,
              footerMessage: this.footerMessage,
            },
          ],
          [
            {
              id: "receipt",
              headerSubtitle: receipt.headerSubtitle ?? "",
              footerMessage: receipt.footerMessage ?? "",
            },
          ],
        );
        this.headerSubtitle = merged!.headerSubtitle;
        this.footerMessage = merged!.footerMessage;
      });
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onHeaderChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.headerSubtitle = event.detail.value;
  }

  #onFooterInput(event: Event): void {
    event.stopPropagation();
    this.footerMessage = (event.target as HTMLTextAreaElement).value;
  }

  /** A blank field is left out rather than sent as `""`, so two empty fields send `{}`, the server's
   * `DEFAULT_RECEIPT`. */
  async #save(): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    const config: ReceiptConfig = {};
    const header = this.headerSubtitle.trim();
    const footer = this.footerMessage.trim();
    if (header !== "") config.headerSubtitle = header;
    if (footer !== "") config.footerMessage = footer;
    this.submitting = true;
    try {
      await this.api.putReceipt(config);
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("receipt.title")}</h1>
      <div class="fields">
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
          label=${t("receipt.header_subtitle")}
          data-test="header-subtitle"
          .value=${this.headerSubtitle}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onHeaderChange(e)}
        ></wt-input>
        <label class="field">
          <span class="field-label">${t("receipt.footer_message")}</span>
          <textarea
            data-test="footer-message"
            rows="3"
            .value=${this.footerMessage}
            @input=${(e: Event) => this.#onFooterInput(e)}
          ></textarea>
        </label>
      </div>

      <div class="save">
        <wt-button
          variant="primary"
          data-test="save"
          ?disabled=${this.submitting}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </div>

      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-receipt-screen": ReceiptScreen;
  }
}
