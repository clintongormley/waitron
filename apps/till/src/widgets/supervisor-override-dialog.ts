import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import "./numeric-pad.js";
import type { StaffMember } from "../api/client.js";

/** The `override-confirm` payload: the authorizing supervisor the operator picked and the PIN they
 * entered — exactly the `authorize()` override shape (`{ personId, pin }`) the server expects. */
export interface OverrideConfirmDetail {
  personId: string;
  pin: string;
}

/**
 * Map a raw error `code` the parent hands in to a user-facing string KEY. A wrong supervisor PIN
 * surfaces the shared `pin.invalid` copy (as the lock screen's own PIN entry does); anything else
 * collapses to the generic `override.error`. It NEVER surfaces the raw code — a domain code is an
 * internal contract, not UI copy — mirroring the lock screen's `loginErrorKey`.
 */
function overrideErrorKey(code: string): StringKey {
  return code === "pin.invalid" ? "pin.invalid" : "override.error";
}

/**
 * A reusable "authorize this action" dialog — the first supervisor-override UI on the till
 * (cash-drawer-authorization §5), which any future privileged till action (on-till config,
 * till-side void/refund) reuses. It is deliberately GENERIC and MINIMAL: it knows nothing of the
 * drawer or of any specific action. The CALLER supplies the eligible authorizers as a property (the
 * dialog never fetches), and the dialog emits the picked supervisor + PIN back out — so the same
 * component authorizes any action gated on a supervisor override.
 *
 * Two modes, like the lock screen it mirrors:
 *  - PICKER — one `<wt-button>` per `authorizers` entry (an empty list shows the no-supervisors state).
 *  - PIN — a `till-numeric-pad` in `mode="pin"` for the chosen supervisor, with Back + Authorize.
 *
 * Events (both composed + bubbling, so a parent listening on its app wrapper catches them):
 *  - `override-confirm` carrying `{ personId, pin }` on Authorize.
 *  - `override-cancel` on Cancel, or when the modal is dismissed (Escape / `wt-close`).
 *
 * PIN privacy: the PIN lives only in this element's transient `pin` state while being typed, travels
 * out in the `override-confirm` detail (captured by value), and is wiped from state the instant it is
 * dispatched — never logged, never stored beyond the in-flight submit, never placed in a URL. The
 * authenticated request the parent makes with it is the only place it goes.
 *
 * The retry error is passed IN as a raw code via the `error` property (the house pattern —
 * `dashboard-person-edit`): the parent sets it to the failed authorize's code (a wrong PIN →
 * `pin.invalid`) and keeps the dialog open. It shows in PIN mode and hides again the moment the
 * operator starts correcting (a fresh keypress or a re-selection), so a stale message never lingers.
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

  /** The eligible authorizers to pick from — supplied by the caller, never fetched here (what makes
   * the dialog reusable for any privileged action). An empty list renders the no-supervisors state. */
  @property({ attribute: false }) authorizers: StaffMember[] = [];

  /** A raw error code from the parent's last failed authorize (e.g. `pin.invalid`), or `null`. Shown
   * mapped to copy in PIN mode; the parent nulls it before each attempt so a repeat re-shows. */
  @property() error: string | null = null;

  /** The supervisor whose PIN is being entered; its presence is what puts the dialog in PIN mode. */
  @state() private selected?: StaffMember;
  /** The raw string the numeric pad has entered — captured verbatim as the PIN, wiped on confirm. */
  @state() private pin = "";
  /** Hides a stale error once the operator starts correcting; reset whenever a fresh `error` arrives. */
  @state() private dismissed = false;

  /** A freshly-delivered error (the parent nulls then re-sets it per attempt) must always show, even
   * after the operator dismissed the previous one by typing — so any change to `error` re-arms it. */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("error")) this.dismissed = false;
  }

  /** Enter PIN mode for `person`, starting from a blank PIN with any prior error dismissed. */
  #select(person: StaffMember): void {
    this.selected = person;
    this.pin = "";
    this.dismissed = true;
  }

  /** Return to the picker, discarding any half-entered PIN. */
  #back(): void {
    this.selected = undefined;
    this.pin = "";
  }

  /** Capture the pad's new value as the PIN and dismiss any stale error as the operator retypes. */
  #onPadChange(event: Event): void {
    event.stopPropagation();
    this.pin = (event as CustomEvent<{ value: string }>).detail.value;
    this.dismissed = true;
  }

  /** Emit the picked supervisor + PIN, then WIPE the PIN from state at once — it has left by value in
   * the event detail, and must not be held beyond this synchronous dispatch. Guarded so an empty PIN
   * can never confirm, even if Authorize is force-clicked past its disabled state. */
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

  /** Emit the cancel so the parent tears the dialog down (which unmounts this element). */
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
