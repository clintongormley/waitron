import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { DashboardApi, EmailInbox, TestEmail, TestEmailAddress } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

const displayAddress = (address: TestEmailAddress): string =>
  address.name === "" ? address.address : `${address.name} <${address.address}>`;

@customElement("dashboard-email-screen")
export class EmailScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin-top: 0;
        font-size: var(--wt-font-size-lg);
      }
      .status,
      .message,
      .message-list {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        padding: var(--wt-space-4);
      }
      .toolbar {
        margin: var(--wt-space-3) 0;
      }
      .message-list {
        list-style: none;
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
      }
      .message-list button {
        width: 100%;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: transparent;
        color: var(--wt-color-text);
        text-align: start;
        cursor: pointer;
      }
      .message-list strong,
      .message-list span {
        display: block;
      }
      .message-list span,
      .meta,
      .empty {
        color: var(--wt-color-text-muted);
      }
      .message {
        margin-top: var(--wt-space-4);
      }
      .message pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
      }
      .message a {
        color: var(--wt-color-primary);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private inbox?: EmailInbox;
  @state() private message?: TestEmail;
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      this.inbox = await this.api.getEmailInbox();
      this.errorKey = null;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #open(id: string): Promise<void> {
    try {
      this.message = await this.api.getTestEmail(id);
      this.errorKey = null;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #accountLink(text: string): string | undefined {
    const candidate = text.match(/https?:\/\/[^\s]+/u)?.[0];
    if (candidate === undefined) return undefined;
    try {
      const url = new URL(candidate);
      return url.origin === window.location.origin ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  #renderLocal(inbox: EmailInbox): TemplateResult {
    return html`
      <p class="status" data-test="local-capture">${t("email.local_capture")}</p>
      <div class="toolbar">
        <wt-button variant="secondary" data-test="refresh" @click=${() => void this.#load()}>
          ${t("email.refresh")}
        </wt-button>
      </div>
      ${
        inbox.messages.length === 0
          ? html`<p class="empty">${t("email.empty")}</p>`
          : html`<ol class="message-list">
              ${inbox.messages.map(
                (message) =>
                  html`<li>
                    <button
                      type="button"
                      data-test="message-${message.id}"
                      @click=${() => void this.#open(message.id)}
                    >
                      <strong>${message.subject}</strong>
                      <span>${displayAddress(message.to[0] ?? { name: "", address: "" })}</span>
                      <span>${message.snippet}</span>
                    </button>
                  </li>`,
              )}
            </ol>`
      }
      ${this.message ? this.#renderMessage(this.message) : nothing}
    `;
  }

  #renderMessage(message: TestEmail): TemplateResult {
    const link = this.#accountLink(message.text);
    return html`<article class="message">
      <h2>${message.subject}</h2>
      <p class="meta">${t("email.from")}: ${displayAddress(message.from)}</p>
      <p class="meta">${t("email.to")}: ${message.to.map(displayAddress).join(", ")}</p>
      <pre data-test="message-body">${message.text}</pre>
      ${
        link
          ? html`<p><a data-test="message-link" href=${link}>${t("email.open_link")}</a></p>`
          : nothing
      }
    </article>`;
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("email.title")}</h1>
      ${
        this.inbox?.mode === "local_capture"
          ? this.#renderLocal(this.inbox)
          : this.inbox?.mode === "smtp"
            ? html`<p class="status" data-test="smtp">${t("email.smtp")}</p>`
            : this.inbox?.mode === "unconfigured"
              ? html`<p class="status" data-test="unconfigured">${t("email.unconfigured")}</p>`
              : nothing
      }
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-email-screen": EmailScreen;
  }
}
