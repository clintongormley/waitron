import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import { SumUpPaymentsClient } from "./client.js";

/** The pairing code's lifetime — the countdown starts here and the poll gives up when it reaches zero. */
export const PAIRING_LIFETIME_MS = 5 * 60 * 1000;
/** How often the dialog re-reads the reader's status while a pairing is in flight. */
export const PAIRING_POLL_MS = 2_000;

/** The dialog's stage. `form` collects the name + code; `pairing` polls with the countdown showing;
 * `expired`/`failed` are the two end states that offer _try again_. */
type Phase = "form" | "pairing" | "expired" | "failed";

/**
 * The SumUp ADD-READER DIALOG (`readerAdd.kind === "pairing-poll"`): the on-device steps in plain words
 * (including that pairing switches off standalone use on that Solo), a reader-name field and the 8–9
 * character pairing-code field. Pressing _Pair_ POSTs the code; the dialog then polls the reader's
 * status every {@link PAIRING_POLL_MS} and shows a countdown from {@link PAIRING_LIFETIME_MS}. It ends
 * three ways: the reader coming online saves the row (`onAdded`) and closes; the countdown running out
 * shows `pairing_expired` and offers _try again_; a rejection shows `pairing_failed` and offers the
 * same. Navigating away stops the poll — `disconnectedCallback` clears the timer, the printers-screen
 * `#endScan` precedent. All pairing calls go through the server, so the API key never reaches the
 * browser.
 */
@customElement("sumup-add-reader")
export class SumUpAddReader extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .steps {
        margin-bottom: var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }
      .countdown {
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) onAdded: () => void = () => {};
  @property({ attribute: false }) onClose: () => void = () => {};

  @state() private name = "";
  @state() private code = "";
  @state() private errors: string[] = [];
  @state() private phase: Phase = "form";
  @state() private remaining = PAIRING_LIFETIME_MS / 1000;

  // The poll timer, its wall-clock end, and an in-flight guard — the printers-screen scan-timer shape
  // (`#scanTimer`/`#scanUntil`/`#scanInFlight`). The timer is cleared in `disconnectedCallback` and
  // never started once the dialog is detached (checked after each await); `#pairUntil` is the clock end
  // (poll ticks are not real seconds in a throttled tab); `#pairInFlight` keeps a slow status read from
  // being overlapped by the next tick.
  #pairTimer?: ReturnType<typeof setInterval>;
  #pairUntil = 0;
  #pairInFlight = false;
  #readerId = "";

  override disconnectedCallback(): void {
    this.#endPoll();
    super.disconnectedCallback();
  }

  #client(): SumUpPaymentsClient {
    return new SumUpPaymentsClient(this.request);
  }

  #onField(event: CustomEvent<{ value: string }>, field: "name" | "code"): void {
    event.stopPropagation();
    this[field] = event.detail.value;
  }

  #validate(): string[] {
    const errors: string[] = [];
    if (this.name.trim() === "") errors.push("payments.sumup.reader_name_required");
    if (this.code.trim() === "") errors.push("payments.sumup.pairing_code_required");
    return errors;
  }

  /** POST the pairing code, then either finish (already paired) or start the status poll + countdown. */
  async #pair(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.phase === "pairing") return; // one pairing at a time
    const errorKeys = this.#validate();
    if (errorKeys.length > 0) {
      this.errors = errorKeys.map((k) => t(k as Parameters<typeof t>[0]));
      return;
    }
    this.errors = [];
    this.phase = "pairing";
    this.remaining = PAIRING_LIFETIME_MS / 1000;
    let result;
    try {
      result = await this.#client().addReader({ name: this.name, code: this.code });
    } catch {
      this.phase = "failed";
      return;
    }
    if (!this.isConnected) return; // detached mid-flight — never start a timer
    this.#readerId = result.id;
    if (result.status === "paired") {
      this.#finish();
      return;
    }
    this.#pairUntil = Date.now() + PAIRING_LIFETIME_MS;
    this.#pairTimer = setInterval(() => void this.#pollTick(), PAIRING_POLL_MS);
  }

  async #pollTick(): Promise<void> {
    if (this.#pairInFlight) return;
    this.#pairInFlight = true;
    let status;
    try {
      status = await this.#client().readerStatus(this.#readerId);
    } catch {
      this.#endPoll();
      this.phase = "failed";
      return;
    } finally {
      this.#pairInFlight = false;
    }
    if (!this.isConnected) return;
    if (status.online) {
      this.#finish();
      return;
    }
    this.remaining = Math.max(0, Math.ceil((this.#pairUntil - Date.now()) / 1000));
    if (Date.now() >= this.#pairUntil) {
      this.#endPoll();
      this.phase = "expired";
    }
  }

  #finish(): void {
    this.#endPoll();
    this.onAdded();
    this.onClose();
  }

  #endPoll(): void {
    if (this.#pairTimer !== undefined) clearInterval(this.#pairTimer);
    this.#pairTimer = undefined;
  }

  /** Reset to the form after an expired/failed attempt. The old code is dead, so it is cleared; the
   * name is kept so the operator does not retype it. */
  #tryAgain(): void {
    this.#endPoll();
    this.code = "";
    this.errors = [];
    this.phase = "form";
    this.remaining = PAIRING_LIFETIME_MS / 1000;
  }

  #formatRemaining(): string {
    const total = this.remaining;
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  override render(): TemplateResult {
    return html`
      <wt-dialog
        heading=${t("payments.sumup.add_reader_heading")}
        .open=${true}
        @wt-close=${() => this.onClose()}
      >
        ${this.#renderBody()} ${this.#renderFooter()}
      </wt-dialog>
    `;
  }

  #renderBody(): TemplateResult {
    if (this.phase === "pairing") {
      return html`
        <p class="steps">${t("payments.sumup.pairing_steps")}</p>
        <p data-test="pairing-progress">${t("payments.sumup.pairing_in_progress")}</p>
        <p class="countdown" data-test="countdown">
          ${t("payments.sumup.pairing_time_left").replace("{time}", this.#formatRemaining())}
        </p>
      `;
    }
    if (this.phase === "expired") {
      return html`<p data-test="pairing-expired" role="alert">
        ${t("payments.sumup.pairing_expired")}
      </p>`;
    }
    if (this.phase === "failed") {
      return html`<p data-test="pairing-failed" role="alert">
        ${t("payments.sumup.pairing_failed")}
      </p>`;
    }
    return html`
      <p class="steps">${t("payments.sumup.pairing_steps")}</p>
      <wt-form-error-summary
        heading=${t("payments.sumup.form_problem")}
        .errors=${this.errors}
      ></wt-form-error-summary>
      <wt-input
        class="field"
        name="name"
        data-test="reader-name"
        label=${t("payments.sumup.reader_name")}
        required
        .value=${this.name}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "name")}
      ></wt-input>
      <wt-input
        class="field"
        name="pairingCode"
        data-test="pairing-code"
        label=${t("payments.sumup.pairing_code")}
        required
        .value=${this.code}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "code")}
      ></wt-input>
    `;
  }

  #renderFooter(): TemplateResult {
    if (this.phase === "expired" || this.phase === "failed") {
      return html`<wt-button
        slot="footer"
        variant="primary"
        data-test="try-again"
        @click=${() => this.#tryAgain()}
        >${t("payments.sumup.try_again")}</wt-button
      >`;
    }
    return html`
      <wt-button slot="footer" data-test="cancel" @click=${() => this.onClose()}
        >${t("payments.sumup.cancel")}</wt-button
      >
      <wt-button
        slot="footer"
        variant="primary"
        data-test="pair"
        ?loading=${this.phase === "pairing"}
        @click=${(e: Event) => void this.#pair(e)}
        >${t("payments.sumup.pair")}</wt-button
      >
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sumup-add-reader": SumUpAddReader;
  }
}
