import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import type { PropertyValues } from "lit";
import { baseStyles, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import "./numeric-pad.js";
import type { PersonRole, StaffMember } from "../api/client.js";

export interface OverrideConfirmDetail {
  personId: string;
  pin: string;
}

/** It NEVER surfaces the raw code — a domain code is an internal contract, not UI copy. */
function overrideErrorKey(code: string): StringKey {
  return code === "pin.invalid" || code === "pin.throttled" ? code : "override.error";
}

/**
 * Deliberately GENERIC: it knows nothing of the drawer or of any specific action. The caller supplies
 * the eligible authorizers (the dialog never fetches) and the failed attempt's error code.
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
        grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
        gap: var(--wt-space-2);
      }

      .supervisor-button {
        width: 100%;
      }

      .pin-display {
        min-height: var(--wt-space-6);
        margin-bottom: var(--wt-space-3);
        font-size: var(--wt-font-size-xl);
        letter-spacing: var(--wt-space-2);
      }

      .error {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ attribute: false }) authorizers: StaffMember[] = [];

  @property() error: string | null = null;

  /** The role that must approve, which the prompt then names; without one it asks for a
   * supervisor. */
  @property({ attribute: false }) approverRole: PersonRole | null = null;

  @state() private selected?: StaffMember;
  @state() private pin = "";
  @state() private dismissed = false;
  @state() private active = true;
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

  /** A freshly-delivered error (the parent nulls then re-sets it per attempt) must always show, even
   * after the operator dismissed the previous one by typing — so any change to `error` re-arms it. */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("error")) this.dismissed = false;
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
    if (this.approverRole !== null) return t(`approval.${which}_${this.approverRole}`);
    const supervisor: Record<typeof which, StringKey> = {
      title: "override.title",
      none: "override.no_supervisors",
      pick: "override.pick_supervisor",
      enter_pin: "override.enter_pin",
    };
    return t(supervisor[which]);
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
      this.selected = undefined;
      this.pin = "";
    };
    if (this.#scope) {
      void this.#leave!.request({ scopes: [this], reason: "cancel", proceed });
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
    if (person === undefined || this.pin === "") return;
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
      <wt-button slot="footer" class="cancel" variant="secondary" @click=${() => this.#cancel()}>
        ${t("action.cancel")}
      </wt-button>
    `;
  }

  #renderPin(person: StaffMember) {
    const showError = this.error !== null && !this.dismissed;
    return html`
      <p class="operator">${person.displayName}</p>
      <p class="prompt">${this.#text("enter_pin")}</p>
      <div class="pin-display" aria-hidden="true">${"●".repeat(this.pin.length)}</div>
      ${
        showError
          ? html`<p class="error" role="alert">${t(overrideErrorKey(this.error!))}</p>`
          : nothing
      }
      <till-numeric-pad
        mode="pin"
        .value=${this.pin}
        @wt-change=${(event: Event) => this.#onPadChange(event)}
      ></till-numeric-pad>
      <wt-button slot="footer" class="back" variant="secondary" @click=${() => this.#back()}>
        ${t("action.back")}
      </wt-button>
      <wt-button
        slot="footer"
        class="authorize"
        variant="primary"
        ?disabled=${this.pin === ""}
        @click=${() => this.#confirm()}
      >
        ${t("action.authorize")}
      </wt-button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-supervisor-override-dialog": TillSupervisorOverrideDialog;
  }
}
