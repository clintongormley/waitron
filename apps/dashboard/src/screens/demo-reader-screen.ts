import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import type { DashboardApi, DemoReaderPayment } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";

@customElement("dashboard-demo-reader-screen")
export class DemoReaderScreen extends LitElement {
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
      .payments {
        display: grid;
        gap: var(--wt-space-4);
        padding: 0;
        list-style: none;
      }
      .payment {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        padding: var(--wt-space-4);
      }
      .amount {
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private payments: DemoReaderPayment[] = [];
  @state() private readError: string | null = null;
  @state() private actionError: string | null = null;
  @state() private decidingId: string | null = null;
  #timer?: ReturnType<typeof setInterval>;
  #loading = false;
  #generation = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    this.#timer = setInterval(() => void this.#load(), 1_000);
  }

  override disconnectedCallback(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#generation++;
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    if (this.#loading || this.decidingId !== null) return;
    this.#loading = true;
    const generation = ++this.#generation;
    try {
      const { payments } = await (this.api.background ?? this.api).listDemoReaderPayments();
      if (!this.isConnected || generation !== this.#generation) return;
      this.payments = payments;
      this.readError = null;
    } catch (error) {
      if (this.isConnected && generation === this.#generation) this.readError = codeOf(error);
    } finally {
      this.#loading = false;
    }
  }

  async #decide(id: string, outcome: "captured" | "declined"): Promise<void> {
    if (this.decidingId !== null) return;
    this.decidingId = id;
    this.actionError = null;
    try {
      await this.api.decideDemoReaderPayment(id, outcome);
      if (!this.isConnected) return;
      this.#generation++;
      this.payments = this.payments.filter((payment) => payment.id !== id);
    } catch (error) {
      if (this.isConnected) this.actionError = codeOf(error);
    } finally {
      this.decidingId = null;
    }
    await this.#load();
  }

  override render() {
    return html`
      <h1>${t("demo_reader.title")}</h1>
      <p>${t("demo_reader.explanation")}</p>
      ${
        this.readError === null
          ? nothing
          : html`<p class="error" role="alert">${codeMessage(this.readError)}</p>`
      }
      ${
        this.actionError === null
          ? nothing
          : html`<p class="error" role="alert">${codeMessage(this.actionError)}</p>`
      }
      ${this.payments.length === 0 ? html`<p>${t("demo_reader.empty")}</p>` : nothing}
      <ol class="payments">
        ${this.payments.map(
          (payment) =>
            html`<li class="payment">
              <p class="amount" data-test="demo-reader-amount">
                ${formatMoney(payment.amount, currentLocale())}
              </p>
              <div class="actions">
                <wt-button
                  data-test="demo-reader-approve"
                  variant="primary"
                  .disabled=${this.decidingId !== null}
                  @click=${() => void this.#decide(payment.id, "captured")}
                  >${t("demo_reader.approve")}</wt-button
                >
                <wt-button
                  data-test="demo-reader-decline"
                  variant="secondary"
                  .disabled=${this.decidingId !== null}
                  @click=${() => void this.#decide(payment.id, "declined")}
                  >${t("demo_reader.decline")}</wt-button
                >
              </div>
            </li>`,
        )}
      </ol>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-demo-reader-screen": DemoReaderScreen;
  }
}
