import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { codeMessage, codeOf, type DashboardRequest } from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import { SumUpPaymentsClient } from "./client.js";

/** The pairing code's lifetime — the countdown starts here and the poll gives up when it reaches zero. */
export const PAIRING_LIFETIME_MS = 5 * 60 * 1000;
/** How often the dialog re-reads the reader's status while a pairing is in flight. */
export const PAIRING_POLL_MS = 2_000;

/** The dialog's stage. `form` collects the name + code; `pairing` posts the code and then polls with
 * the countdown showing; `expired`/`failed` are the two end states of a pairing the server accepted,
 * each offering _try again_. */
type Phase = "form" | "pairing" | "expired" | "failed";

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
  @state() private attempted = false;
  /** A refusal of the pair request, which names no field; shown beside Pair until the next press. */
  @state() private refusal = "";
  @state() private phase: Phase = "form";
  @state() private remaining = PAIRING_LIFETIME_MS / 1000;

  // The timer is cleared in `disconnectedCallback` and never started once the dialog is detached
  // (checked after each await); `#pairUntil` is the clock end (poll ticks are not real seconds in a
  // throttled tab); `#pairInFlight` keeps a slow status read from being overlapped by the next tick.
  #pairTimer?: ReturnType<typeof setInterval>;
  #pairUntil = 0;
  #pairInFlight = false;
  /** The `processing` row this attempt created, until it pairs or is unpaired; empty otherwise. */
  #readerId = "";
  #closed = false;

  override disconnectedCallback(): void {
    this.#endPoll();
    void this.#unpairOrphan();
    super.disconnectedCallback();
  }

  #client(): SumUpPaymentsClient {
    return new SumUpPaymentsClient(this.request);
  }

  #onField(event: CustomEvent<{ value: string }>, field: "name" | "code"): void {
    event.stopPropagation();
    this[field] = event.detail.value;
  }

  #fieldErrors(): { name: string; code: string } {
    if (!this.attempted) return { name: "", code: "" };
    return {
      name: this.name.trim() === "" ? t("payments.sumup.reader_name_required") : "",
      code: this.code.trim() === "" ? t("payments.sumup.pairing_code_required") : "",
    };
  }

  #blocked(): boolean {
    const errors = this.#fieldErrors();
    return errors.name !== "" || errors.code !== "";
  }

  async #pair(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.phase === "pairing") return; // one pairing at a time
    this.attempted = true;
    this.refusal = "";
    if (this.#blocked()) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.phase = "pairing";
    this.remaining = PAIRING_LIFETIME_MS / 1000;
    let result;
    try {
      result = await this.#client().addReader({ name: this.name, code: this.code });
    } catch (error) {
      // The server inserts the row only after SumUp accepts the code, so a refused request leaves no row.
      this.refusal =
        codeOf(error) === "payment.pairing_refused"
          ? t("payments.sumup.pairing_failed")
          : codeMessage(codeOf(error));
      this.phase = "form";
      return;
    }
    if (result.status === "paired") {
      if (!this.isConnected || this.#closed) this.onAdded();
      else this.#finish();
      return;
    }
    this.#readerId = result.id;
    if (!this.isConnected || this.#closed) {
      void this.#unpairOrphan(this.#closed);
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
      this.#abandon("failed");
      return;
    } finally {
      this.#pairInFlight = false;
    }
    if (!this.isConnected || this.#closed) return;
    // Gate on PAIRING status, not device connectivity: a reader that has paired may go briefly offline
    // within the code's window, and `online` would wrongly time it out.
    if (status.pairingStatus === "paired") {
      this.#finish();
      return;
    }
    this.remaining = Math.max(0, Math.ceil((this.#pairUntil - Date.now()) / 1000));
    if (Date.now() >= this.#pairUntil) {
      this.#abandon("expired");
    }
  }

  #finish(): void {
    this.#readerId = "";
    this.onAdded();
    this.#close();
  }

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#endPoll();
    void this.#unpairOrphan(true);
    this.onClose();
  }

  /** End a pairing attempt that never reached `paired`: stop the poll, show the end state, and unpair
   * the `processing` reader row this attempt created so it does not linger as an un-paired orphan. */
  #abandon(phase: "expired" | "failed"): void {
    this.#endPoll();
    this.phase = phase;
    void this.#unpairOrphan();
  }

  /** Best-effort unpair of the row the successful POST created, at most once. A failed unpair must not
   * hang the dialog — the orphan can still be unpaired from the readers list — so its rejection is
   * swallowed. */
  async #unpairOrphan(checkPaired = false): Promise<void> {
    const id = this.#readerId;
    if (id === "") return;
    this.#readerId = "";
    if (checkPaired) {
      let status;
      try {
        status = await this.#client().readerStatus(id);
      } catch {
        // Unknown pairing status still takes the cleanup path.
      }
      if (status?.pairingStatus === "paired") {
        this.onAdded();
        return;
      }
    }
    try {
      await this.#client().unpairReader(id);
    } catch {
      // swallow — cleanup is best-effort; never block the try-again flow on it
    }
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
    this.attempted = false;
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
        @wt-close=${() => this.#close()}
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
    const errors = this.#fieldErrors();
    return html`
      <p class="steps">${t("payments.sumup.pairing_steps")}</p>
      <wt-input
        class="field"
        name="name"
        data-test="reader-name"
        label=${t("payments.sumup.reader_name")}
        required
        error=${errors.name}
        .value=${this.name}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "name")}
      ></wt-input>
      <wt-input
        class="field"
        name="pairingCode"
        data-test="pairing-code"
        label=${t("payments.sumup.pairing_code")}
        required
        error=${errors.code}
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
    const blocked = this.#blocked();
    return html`
      <wt-form-actions
        slot="footer"
        .error=${[this.refusal, blocked ? t("payments.sumup.fix_fields") : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <wt-button slot="cancel" data-test="cancel" @click=${() => this.#close()}
          >${t("payments.sumup.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="pair"
          ?loading=${this.phase === "pairing"}
          ?disabled=${blocked}
          @click=${(e: Event) => void this.#pair(e)}
          >${t("payments.sumup.pair")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sumup-add-reader": SumUpAddReader;
  }
}
