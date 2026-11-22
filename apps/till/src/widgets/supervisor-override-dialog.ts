import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import type { PropertyValues } from "lit";
import { baseStyles, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import "./numeric-pad.js";
import { pressIfEnabled } from "../state/pad-keys.js";
import { CountdownController } from "../state/countdown-controller.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { StaffMember } from "../api/client.js";

export interface OverrideConfirmDetail {
  personId: string;
  pin: string;
}

/** An approver's PIN refused, naming the approver whose PIN was sent: an answer that arrives after
 * the person moved on to another approver must not show, or lock, under that other one. */
export interface ApproverRefusal {
  code: string;
  personId: string;
  /** Only on `pin.throttled`: how long the server makes this approver wait. */
  retryAfterSeconds?: number;
}

export function approverRefusal(error: unknown, personId: string): ApproverRefusal {
  const { code, retryAfterSeconds } = (error ?? {}) as {
    code?: unknown;
    retryAfterSeconds?: unknown;
  };
  if (typeof code !== "string") return { code: "server.internal", personId };
  return code === "pin.throttled" && typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
    ? { code, personId, retryAfterSeconds }
    : { code, personId };
}

/** It NEVER surfaces the raw code — a domain code is an internal contract, not UI copy. */
export function overrideErrorText(code: string): string {
  if (code === "pin.invalid" || code === "pin.throttled") return t(code);
  return code === "authorization.not_permitted" ? codeMessage(code) : t("override.error");
}

/**
 * Deliberately GENERIC: it knows nothing of the drawer or of any specific action. The caller supplies
 * the eligible authorizers (the dialog never fetches) and the failed attempt's refusal.
 */
@customElement("till-supervisor-override-dialog")
export class TillSupervisorOverrideDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .operator {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      .prompt {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }

      .roster {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--wt-till-roster-card-min-width), 1fr));
        gap: var(--wt-space-2);
      }

      .supervisor-button {
        width: 100%;
      }

      .pad-wrap[inert] {
        opacity: 0.5;
      }

      .pin-display {
        min-height: var(--wt-space-6);
        margin-bottom: var(--wt-space-3);
        font-size: var(--wt-font-size-xl);
        letter-spacing: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) authorizers: StaffMember[] = [];

  @property({ attribute: false }) error: ApproverRefusal | null = null;

  @state() private selected?: StaffMember;
  @state() private pin = "";
  @state() private dismissed = false;
  @state() private active = true;
  /** The chosen approver's wait before they may try again. */
  readonly #wait = new CountdownController(this);
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.pin = "";
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  /** A freshly-delivered refusal for the chosen approver (the parent nulls then re-sets it per
   * attempt) must show, even after the operator dismissed the previous one by typing — so any
   * change to `error` re-arms it. */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("error")) {
      this.dismissed = false;
      this.#wait.stop();
      const seconds = this.#refusalFor(this.selected)?.retryAfterSeconds ?? 0;
      if (this.active && seconds > 0) this.#wait.start(seconds);
    }
    if (!this.active || this.#scope) return;
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<string>({
      id: this,
      current: () => this.pin,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => (this.pin = value),
    });
  }

  #text(which: "title" | "none" | "pick" | "enter_pin"): string {
    const supervisor: Record<typeof which, StringKey> = {
      title: "override.title",
      none: "override.no_supervisors",
      pick: "override.pick_supervisor",
      enter_pin: "override.enter_pin",
    };
    return t(supervisor[which]);
  }

  #refusalFor(person: StaffMember | undefined): ApproverRefusal | null {
    return person !== undefined && this.error?.personId === person.personId ? this.error : null;
  }

  #select(person: StaffMember): void {
    if (!this.isConnected || !this.active) return;
    this.selected = person;
    this.pin = "";
    this.#scope?.changed();
    this.dismissed = true;
  }

  #back(): void {
    if (!this.isConnected || !this.active) return;
    const proceed = () => {
      // The wait is the approver's own, so another approver may try at once.
      this.#wait.stop();
      this.selected = undefined;
      this.pin = "";
    };
    if (this.#scope) {
      void this.#leave!.request({ scopes: [this], reason: "navigation", proceed });
    } else proceed();
  }

  #onPadChange(event: Event): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    this.pin = (event as CustomEvent<{ value: string }>).detail.value;
    this.#scope?.changed();
    this.dismissed = true;
  }

  #confirm(): void {
    if (!this.isConnected || !this.active) return;
    const person = this.selected;
    if (person === undefined || this.pin === "" || this.#wait.remaining > 0) return;
    const pin = this.pin;
    this.pin = "";
    this.#scope?.commit("");
    this.dispatchEvent(
      new CustomEvent<OverrideConfirmDetail>("override-confirm", {
        detail: { personId: person.personId, pin },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active) return;
    if (this.#scope) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
      return;
    }
    this.#reportClose();
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.pin = "";
    this.#wait.stop();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#reportClose();
  }

  #reportClose(): void {
    this.dispatchEvent(new CustomEvent("override-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      .heading=${this.#text("title")}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      ${this.selected ? this.#renderPin(this.selected) : this.#renderPicker()}
    </wt-dialog>`;
  }

  #renderPicker() {
    return html`
      ${
        this.authorizers.length === 0
          ? html`<p class="prompt">${this.#text("none")}</p>`
          : html`
              <p class="prompt">${this.#text("pick")}</p>
              <div class="roster">
                ${this.authorizers.map(
                  (person) => html`
                    <wt-button
                      class="supervisor-button"
                      data-person=${person.personId}
                      @click=${() => this.#select(person)}
                    >
                      ${person.displayName}
                    </wt-button>
                  `,
                )}
              </div>
            `
      }
      <wt-form-actions slot="footer"
        ><wt-button slot="cancel" class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button></wt-form-actions
      >
    `;
  }

  #renderPin(person: StaffMember) {
    const waiting = this.#wait.remaining > 0;
    const refusal = this.#refusalFor(person);
    const errorText = waiting
      ? t("override.throttled").replace("{n}", String(this.#wait.remaining))
      : refusal !== null && (refusal.retryAfterSeconds ?? 0) === 0 && !this.dismissed
        ? overrideErrorText(refusal.code)
        : "";
    return html`
      <p class="operator">${person.displayName}</p>
      <p class="prompt">${this.#text("enter_pin")}</p>
      <div class="pin-display" aria-hidden="true">${"●".repeat(this.pin.length)}</div>
      <div class="pad-wrap" ?inert=${waiting}>
        <till-numeric-pad
          mode="pin"
          .value=${this.pin}
          @wt-change=${(event: Event) => this.#onPadChange(event)}
          @pad-enter=${() =>
            pressIfEnabled(this.renderRoot.querySelector<HTMLElement>(".authorize"))}
        ></till-numeric-pad>
      </div>
      <wt-form-actions slot="footer" .error=${errorText}>
        <wt-button slot="cancel" class="back" variant="secondary" @click=${() => this.#back()}>
          ${t("action.back")}
        </wt-button>
        <wt-button
          class="authorize"
          variant="primary"
          ?disabled=${this.pin === "" || waiting}
          @click=${() => this.#confirm()}
        >
          ${t("action.authorize")}
        </wt-button></wt-form-actions
      >
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-supervisor-override-dialog": TillSupervisorOverrideDialog;
  }
}
