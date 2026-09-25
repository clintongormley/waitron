import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import "./numeric-pad.js";
import type { StaffMember } from "../api/client.js";

export interface OverrideConfirmDetail {
  personId: string;
  pin: string;
}

/** It NEVER surfaces the raw code — a domain code is an internal contract, not UI copy. */
function overrideErrorKey(code: string): StringKey {
  return code === "pin.invalid" ? "pin.invalid" : "override.error";
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

  @state() private selected?: StaffMember;
  @state() private pin = "";
  @state() private dismissed = false;

  /** A freshly-delivered error (the parent nulls then re-sets it per attempt) must always show, even
   * after the operator dismissed the previous one by typing — so any change to `error` re-arms it. */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("error")) this.dismissed = false;
  }

  #select(person: StaffMember): void {
    this.selected = person;
    this.pin = "";
    this.dismissed = true;
  }

  #back(): void {
    this.selected = undefined;
    this.pin = "";
  }

  #onPadChange(event: Event): void {
    event.stopPropagation();
    this.pin = (event as CustomEvent<{ value: string }>).detail.value;
    this.dismissed = true;
  }

  /** The PIN is wiped from state at once: it has left by value in the event detail. Guarded so an empty
   * PIN can never confirm, even if Authorize is force-clicked past its disabled state. */
  #confirm(): void {
    const person = this.selected;
    if (person === undefined || this.pin === "") return;
    this.dispatchEvent(
      new CustomEvent<OverrideConfirmDetail>("override-confirm", {
        detail: { personId: person.personId, pin: this.pin },
        bubbles: true,
        composed: true,
      }),
    );
    this.pin = "";
  }

  #cancel(): void {
    this.dispatchEvent(new CustomEvent("override-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    return html`<wt-dialog
      .open=${true}
      .heading=${t("override.title")}
      @wt-close=${() => this.#cancel()}
    >
      ${this.selected ? this.#renderPin(this.selected) : this.#renderPicker()}
    </wt-dialog>`;
  }

  #renderPicker() {
    return html`
      ${
        this.authorizers.length === 0
          ? html`<p class="prompt">${t("override.no_supervisors")}</p>`
          : html`
              <p class="prompt">${t("override.pick_supervisor")}</p>
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
      <p class="prompt">${t("override.enter_pin")}</p>
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
