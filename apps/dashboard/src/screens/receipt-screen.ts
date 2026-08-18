import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, ReceiptConfig } from "../api/client.js";

/**
 * The management dashboard's RECEIPT SCREEN: authors the NON-FISCAL receipt trim (design §8/§9) — a
 * `headerSubtitle` rendered under the venue name and a `footerMessage` rendered under the VERI*FACTU
 * legend, both optional. It CANNOT touch the immutable art. 7.1 core (issuer/NIF, número/serie/fecha,
 * goods, tipo/base, total, QR + legend); it only authors the two trim strings that render around it.
 *
 * On connect it loads `api.getLayout()` and reads its `receipt` half into the two fields. `headerSubtitle`
 * is a `wt-input`; `footerMessage` is a native token-styled `<textarea>` — `wt-input` exposes no multiline
 * affordance (`packages/ui/src/components/wt-input.ts` renders a single `<input>`), so a multiline field
 * falls back to a native `<textarea>` styled with the shared tokens, exactly as the login/create-person
 * pickers fall back to a native `<select>` for want of a `wt-select` primitive (`select-styles.ts`).
 *
 * GUARDAR composes the two fields back into a `ReceiptConfig` and calls `api.putReceipt`. A BLANK field
 * (empty or whitespace-only) is OMITTED, so its key is ABSENT rather than an empty string — the config a
 * screen with two untouched empty fields sends is `{}`, matching the server's `DEFAULT_RECEIPT = {}`, and
 * `till-ticket-view` renders each trim as `nothing` when its key is absent. A present field is trimmed of
 * surrounding whitespace before it is sent. `putReceipt` is a full-replace idempotent PUT (design §7), so
 * there is no single-flight guard: a double-fire re-sends the same config, not a second distinct write.
 *
 * ERROR HANDLING mirrors `layout-screen.ts`/`catalogue-screen.ts`/`staff-screen.ts`: `#load` and `#save`
 * are each fully `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` — the raw thrown
 * `{ code }`, falling back to `server.internal` — rendered in a `role="alert"` banner, never an unhandled
 * promise rejection. The raw code stays in state; `codeMessage` (`../i18n/codes.js`) maps it to localised
 * copy at the render edge, so the banner shows a sentence and never the raw wire code.
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

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  // The two authored trim strings, loaded from the receipt config on connect and composed back on
  // Guardar. Held as plain strings (never `undefined`) so the fields bind cleanly; a blank one is
  // dropped from the composed config so its key is absent, not `""`.
  @state() private headerSubtitle = "";
  @state() private footerMessage = "";
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /**
   * Load the authored receipt trim (or the server's `DEFAULT_RECEIPT`) and populate the two fields. An
   * absent key resolves to `""` (an empty field, not the string "undefined"). A rejection becomes the
   * `errorKey` banner rather than an unhandled rejection.
   */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const { receipt } = await this.api.getLayout();
      this.headerSubtitle = receipt.headerSubtitle ?? "";
      this.footerMessage = receipt.footerMessage ?? "";
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The header wt-input's composed `wt-change`. `stopPropagation` keeps it inside this screen (the
   * house field-handler pattern). */
  #onHeaderChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.headerSubtitle = event.detail.value;
  }

  /** The footer `<textarea>`'s native `input`. `stopPropagation` keeps the (composed) input event from
   * leaking past this screen's shadow boundary, the same discipline the wt-change handler follows. */
  #onFooterInput(event: Event): void {
    event.stopPropagation();
    this.footerMessage = (event.target as HTMLTextAreaElement).value;
  }

  /**
   * Compose the two fields into a `ReceiptConfig` and persist. A blank field (trimmed to `""`) is
   * OMITTED so its key is absent — a screen with both fields empty sends `{}`, matching the server's
   * `DEFAULT_RECEIPT`; a present field is sent trimmed. A rejection becomes the `errorKey` banner (the
   * raw `receipt.invalid` the server throws, or a fallback); never an unhandled rejection (called via
   * `void`).
   */
  async #save(): Promise<void> {
    this.errorKey = null;
    const config: ReceiptConfig = {};
    const header = this.headerSubtitle.trim();
    const footer = this.footerMessage.trim();
    if (header !== "") config.headerSubtitle = header;
    if (footer !== "") config.footerMessage = footer;
    try {
      await this.api.putReceipt(config);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("receipt.title")}</h1>
      <div class="fields">
        <wt-input
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
        <wt-button variant="primary" data-test="save" @click=${() => void this.#save()}
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
