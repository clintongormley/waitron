import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, leaveCoordinatorFor } from "@waitron/ui";
import { keyed } from "lit/directives/keyed.js";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { codeMessage, codeOf, type DashboardRequest } from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import { SumUpPaymentsClient } from "./client.js";

/** The pairing code's lifetime; a status timeout leaves pairing unknown, so polling can outlast it. */
export const PAIRING_LIFETIME_MS = 5 * 60 * 1000;
/** How often the dialog re-reads the reader's status while a pairing is in flight. */
export const PAIRING_POLL_MS = 2_000;

/** The dialog's stage. `form` collects the name + code; `pairing` posts the code and then polls;
 * `expired`/`failed` offer _try again_ after a known result ends the attempt. */
type Phase = "form" | "pairing" | "expired" | "failed";

interface PairingAttempt {
  opening: object;
  client: SumUpPaymentsClient;
  added(): void;
  id: string;
  until: number;
  inFlight: boolean;
  closed: boolean;
  timer?: ReturnType<typeof setInterval>;
}

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
  /** A refusal of the pair request, which names no field; shown above Pair until the next press. */
  @state() private refusal = "";
  @state() private phase: Phase = "form";
  @state() private remaining = PAIRING_LIFETIME_MS / 1000;
  @state() private pollTimedOut = false;

  #attempt?: PairingAttempt;
  #closed = false;
  #opening = {};

  #scope?: DraftScope<{ name: string; code: string }>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.phase !== "form" || !this.#scope) return true;
    const opening = this.#opening;
    const outcome = await this.#leave!.request({ scopes: [this], reason, proceed() {} });
    return opening === this.#opening && outcome === "proceeded";
  };

  #value() {
    return { name: this.name, code: this.code };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#opening = {};
    this.#closed = false;
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register({
      id: this,
      parent: (this.getRootNode() as ShadowRoot).host,
      current: () => this.#value(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => this.phase !== "form" || (a.name === b.name && a.code === b.code),
      restore: (value) => {
        this.name = value.name;
        this.code = value.code;
      },
    });
    this.requestUpdate();
  }

  #cancel(opening: object): void {
    if (!this.#current(opening)) return;
    if (this.phase !== "form" || !this.#scope) this.#close();
    else void this.shadowRoot!.querySelector("wt-dialog")!.requestClose("cancel");
  }

  override disconnectedCallback(): void {
    this.#opening = {};
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#endPoll();
    void this.#unpairOrphan(this.#attempt);
    this.#attempt = undefined;
    this.name = "";
    this.code = "";
    this.attempted = false;
    this.refusal = "";
    this.phase = "form";
    this.pollTimedOut = false;
    this.remaining = PAIRING_LIFETIME_MS / 1000;
    super.disconnectedCallback();
  }

  #current(opening: object): boolean {
    return opening === this.#opening && this.isConnected && !this.#closed;
  }

  #onField(event: CustomEvent<{ value: string }>, field: "name" | "code", opening: object): void {
    event.stopPropagation();
    if (!this.#current(opening)) return;
    this[field] = event.detail.value;
    this.#scope?.changed();
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

  async #pair(event: Event, opening: object): Promise<void> {
    event.stopPropagation();
    if (!this.#current(opening) || this.phase === "pairing") return;
    this.attempted = true;
    this.refusal = "";
    if (this.#blocked()) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const submitted = this.#value();
    const scope = this.#scope;
    const attempt: PairingAttempt = {
      opening,
      client: new SumUpPaymentsClient(this.request),
      added: this.onAdded,
      id: "",
      until: 0,
      inFlight: false,
      closed: false,
    };
    this.#attempt = attempt;
    this.phase = "pairing";
    this.#scope?.changed();
    this.pollTimedOut = false;
    this.remaining = PAIRING_LIFETIME_MS / 1000;
    let result;
    try {
      result = await attempt.client.addReader(submitted);
    } catch (error) {
      if (!this.#current(opening)) return;
      this.refusal =
        codeOf(error) === "payment.pairing_refused"
          ? t("payments.sumup.pairing_failed")
          : codeMessage(codeOf(error));
      this.phase = "form";
      this.#scope?.changed();
      return;
    }
    if (this.#current(opening)) scope?.commit(submitted);
    if (result.status === "paired") {
      if (!this.#current(opening)) attempt.added();
      else this.#finish(attempt);
      return;
    }
    attempt.id = result.id;
    if (!this.#current(opening)) {
      void this.#unpairOrphan(attempt, attempt.closed);
      return;
    }
    attempt.until = Date.now() + PAIRING_LIFETIME_MS;
    attempt.timer = setInterval(() => void this.#pollTick(attempt), PAIRING_POLL_MS);
  }

  async #pollTick(attempt: PairingAttempt): Promise<void> {
    if (attempt.inFlight || !this.#current(attempt.opening)) return;
    attempt.inFlight = true;
    let status;
    try {
      status = await attempt.client.readerStatus(attempt.id);
    } catch (error) {
      if (!this.#current(attempt.opening)) return;
      if (codeOf(error) === "connection.timed_out") {
        this.pollTimedOut = true;
        this.remaining = Math.max(0, Math.ceil((attempt.until - Date.now()) / 1000));
        return;
      }
      this.#abandon("failed");
      return;
    } finally {
      attempt.inFlight = false;
    }
    if (!this.#current(attempt.opening)) return;
    this.pollTimedOut = false;
    if (status.pairingStatus === "paired") {
      this.#finish(attempt);
      return;
    }
    this.remaining = Math.max(0, Math.ceil((attempt.until - Date.now()) / 1000));
    if (Date.now() >= attempt.until) this.#abandon("expired");
  }

  #finish(attempt: PairingAttempt): void {
    attempt.id = "";
    this.#endPoll(attempt);
    attempt.added();
    if (this.#current(attempt.opening)) {
      this.shadowRoot!.querySelector("wt-dialog")!.closeAfter("saved");
      this.#close();
    }
  }

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.requestUpdate();
    this.#endPoll();
    if (this.#attempt) this.#attempt.closed = true;
    void this.#unpairOrphan(this.#attempt, true);
    this.onClose();
  }

  /** End a pairing attempt that never reached `paired`: stop the poll, show the end state, and unpair
   * the `processing` reader row this attempt created so it does not linger as an un-paired orphan. */
  #abandon(phase: "expired" | "failed"): void {
    this.#endPoll();
    this.phase = phase;
    void this.#unpairOrphan(this.#attempt);
  }

  /** Best-effort unpair of the row the successful POST created, at most once. A failed unpair must not
   * hang the dialog — the orphan can still be unpaired from the readers list — so its rejection is
   * swallowed. */
  async #unpairOrphan(attempt: PairingAttempt | undefined, checkPaired = false): Promise<void> {
    if (!attempt || attempt.id === "") return;
    const id = attempt.id;
    attempt.id = "";
    if (checkPaired) {
      let status;
      try {
        status = await attempt.client.readerStatus(id);
      } catch {
        // Unknown pairing status still takes the cleanup path.
      }
      if (status?.pairingStatus === "paired") {
        attempt.added();
        return;
      }
    }
    try {
      await attempt.client.unpairReader(id);
    } catch {
      // swallow — cleanup is best-effort; never block the try-again flow on it
    }
  }

  #endPoll(attempt = this.#attempt): void {
    if (attempt?.timer !== undefined) clearInterval(attempt.timer);
    if (attempt) attempt.timer = undefined;
  }

  /** Reset to the form after an expired/failed attempt. The old code is dead, so it is cleared; the
   * name is kept so the operator does not retype it. */
  #tryAgain(opening: object): void {
    if (!this.#current(opening)) return;
    this.#endPoll();
    this.code = "";
    this.attempted = false;
    this.phase = "form";
    this.remaining = PAIRING_LIFETIME_MS / 1000;
    this.#scope?.commit(this.#value());
  }

  #formatRemaining(): string {
    const total = this.remaining;
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  override render(): TemplateResult {
    return html`${keyed(this.#opening, this.#renderForm())}`;
  }

  #renderForm(): TemplateResult {
    const opening = this.#opening;
    return html`
      <wt-dialog
        heading=${t("payments.sumup.add_reader_heading")}
        .open=${!this.#closed}
        .beforeClose=${this.#scope ? this.#beforeClose : undefined}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (this.#current(opening)) this.#close();
        }}
      >
        ${this.#renderBody(opening)} ${this.#renderFooter(opening)}
      </wt-dialog>
    `;
  }

  #renderBody(opening: object): TemplateResult {
    if (this.phase === "pairing") {
      return html`
        <p class="steps">${t("payments.sumup.pairing_steps")}</p>
        <p data-test="pairing-progress">${t("payments.sumup.pairing_in_progress")}</p>
        ${
          this.pollTimedOut
            ? html`<p data-test="pairing-timeout" role="alert">
                ${codeMessage("connection.timed_out")}
              </p>`
            : ""
        }
        ${
          this.remaining > 0
            ? html`<p class="countdown" data-test="countdown">
                ${t("payments.sumup.pairing_time_left").replace("{time}", this.#formatRemaining())}
              </p>`
            : ""
        }
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
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "name", opening)}
      ></wt-input>
      <wt-input
        class="field"
        name="pairingCode"
        data-test="pairing-code"
        label=${t("payments.sumup.pairing_code")}
        required
        error=${errors.code}
        .value=${this.code}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "code", opening)}
      ></wt-input>
    `;
  }

  #renderFooter(opening: object): TemplateResult {
    if (this.phase === "expired" || this.phase === "failed") {
      return html`<wt-button
        slot="footer"
        variant="primary"
        data-test="try-again"
        @click=${() => this.#tryAgain(opening)}
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
        <wt-button slot="cancel" data-test="cancel" @click=${() => this.#cancel(opening)}
          >${t("payments.sumup.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="pair"
          ?loading=${this.phase === "pairing"}
          ?disabled=${blocked}
          @click=${(e: Event) => void this.#pair(e, opening)}
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
