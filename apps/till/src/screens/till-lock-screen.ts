import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import "../widgets/numeric-pad.js";
import type { StaffMember, TillApi } from "../api/client.js";

/**
 * The `logged-in` event payload: the server-confirmed `personId`, the operator's `displayName`, and
 * the server-computed `canConfigureTill` capability. The name rides along because the screen already
 * holds it (the roster entry the operator picked), so the parent (`till-app`) can label the counter
 * header without a second `listStaff` round-trip; `canConfigureTill` comes from the `POST /api/session`
 * response so the app can gate manager-only affordances (FP-2's on-till "Editar plano") without another
 * round-trip either — and without the client re-deriving it from a role (which would drift).
 */
export interface LoggedInDetail {
  personId: string;
  displayName: string;
  canConfigureTill: boolean;
}

/**
 * Maps a login error `code` to a user-facing string KEY. Only the two codes the operator can act on
 * are spelled out — a wrong PIN and a suspended account; every other code (a stale roster entry's
 * `person.not_found`, a `server.internal`) collapses to the generic `login.error`. This is the one
 * place that decides what the screen says, and it deliberately NEVER surfaces the raw code: a domain
 * code is an internal contract, not UI copy.
 */
function loginErrorKey(code: string): StringKey {
  if (code === "pin.invalid") return "pin.invalid";
  if (code === "person.suspended") return "person.suspended";
  return "login.error";
}

/**
 * The staff-picker + PIN login screen the counter shows before a shift can sell. Two modes, chosen
 * by whether a person is `selected`:
 *
 *  - LIST — the roster from `api.listStaff()`, one `<wt-button>` per person. It renders a loading
 *    state until the fetch settles, an empty-roster message when nobody is returned, and a
 *    load-failed message if the fetch rejects.
 *  - PIN — a `till-numeric-pad` (the shared numeric surface, reused from Task 15) for the selected
 *    person, with a back control to correct a wrong name and a Log in control that calls
 *    `api.login(personId, pin)`.
 *
 * On a successful login it emits a composed `logged-in` CustomEvent carrying the server-confirmed
 * `personId`; the parent (`till-app`, Task 19) swaps this screen for the counter. On a rejected
 * `{ code }` it shows the LOCALISED message for that code (never the raw code — see
 * {@link loginErrorKey}) and clears the PIN so the operator can retry the same person.
 *
 * The `till-numeric-pad` runs in `mode="pin"` (digit-append, no `.` key), so the pad's entered string
 * is captured raw as the PIN and leading zeros survive — a PIN like `"0000"` or `"0123"` round-trips.
 */
@customElement("till-lock-screen")
export class TillLockScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .heading {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .status {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      .roster {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
        gap: var(--wt-space-2);
      }

      .operator-button {
        width: 100%;
      }

      .operator {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
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

      .actions {
        display: flex;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-3);
      }

      .actions wt-button {
        flex: 1;
      }
    `,
  ];

  /** The HTTP face of the till. Set before the element connects (its lifecycle fetches the roster). */
  @property({ attribute: false }) api!: TillApi;

  /** The roster: `undefined` while the fetch is in flight, then the (possibly empty) list. */
  @state() private staff?: StaffMember[];
  /** The person whose PIN is being entered; its presence is what puts the screen in PIN mode. */
  @state() private selected?: StaffMember;
  /** The raw string the numeric pad has entered — captured verbatim as the PIN. */
  @state() private pin = "";
  /** The string key of the message to show, or `undefined` for none. Shared by both modes. */
  @state() private errorKey?: StringKey;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#loadStaff();
  }

  /** Fetch the roster once on connect. A rejection becomes the load-failed state rather than an
   * unhandled promise. State written after a mid-fetch disconnect is harmless — Lit simply does not
   * paint a detached element — so no `isConnected` guard is needed here. */
  async #loadStaff(): Promise<void> {
    try {
      this.staff = await this.api.listStaff();
    } catch {
      this.staff = [];
      this.errorKey = "login.load_failed";
    }
  }

  /** Enter PIN mode for `person`, starting from a blank PIN and no error. */
  #select(person: StaffMember): void {
    this.selected = person;
    this.pin = "";
    this.errorKey = undefined;
  }

  /** Return to the roster, discarding any half-entered PIN and error. */
  #back(): void {
    this.selected = undefined;
    this.pin = "";
    this.errorKey = undefined;
  }

  /** Capture the pad's new value as the PIN and clear any stale error as the operator retypes. */
  #onPadChange(event: Event): void {
    event.stopPropagation();
    this.pin = (event as CustomEvent<{ value: string }>).detail.value;
    this.errorKey = undefined;
  }

  /**
   * Attempt the login. Guarded so an empty PIN can never call the API, even if Log in is force-clicked
   * past its disabled state. On success — and only if the screen is still connected, so a torn-down
   * screen never announces a login — it emits `logged-in` with the server-confirmed personId. On a
   * rejected `{ code }` it shows the localised message and clears the PIN for a retry.
   */
  async #submit(): Promise<void> {
    const person = this.selected;
    if (person === undefined || this.pin === "") return;
    try {
      const { personId, canConfigureTill } = await this.api.login(person.personId, this.pin);
      if (!this.isConnected) return;
      this.dispatchEvent(
        new CustomEvent<LoggedInDetail>("logged-in", {
          detail: { personId, displayName: person.displayName, canConfigureTill },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      const code = (error as { code?: string }).code ?? "server.internal";
      this.errorKey = loginErrorKey(code);
      this.pin = "";
    }
  }

  override render() {
    return this.selected ? this.#renderPin(this.selected) : this.#renderList();
  }

  #renderList() {
    return html`
      <h1 class="heading">${t("login.pick_operator")}</h1>
      ${this.#renderRoster()}
    `;
  }

  #renderRoster() {
    if (this.staff === undefined) {
      return html`<p class="status">${t("login.loading")}</p>`;
    }
    if (this.staff.length === 0) {
      return this.errorKey
        ? html`<p class="status error" role="alert">${t(this.errorKey)}</p>`
        : html`<p class="status">${t("login.no_staff")}</p>`;
    }
    return html`
      <div class="roster">
        ${this.staff.map(
          (person) => html`
            <wt-button
              class="operator-button"
              data-person=${person.personId}
              @click=${() => this.#select(person)}
            >
              ${person.displayName}
            </wt-button>
          `,
        )}
      </div>
    `;
  }

  #renderPin(person: StaffMember) {
    return html`
      <h1 class="heading">${t("login.enter_pin")}</h1>
      <p class="operator">${person.displayName}</p>
      <div class="pin-display" aria-hidden="true">${"●".repeat(this.pin.length)}</div>
      ${this.errorKey ? html`<p class="error" role="alert">${t(this.errorKey)}</p>` : nothing}
      <till-numeric-pad
        mode="pin"
        .value=${this.pin}
        @wt-change=${(event: Event) => this.#onPadChange(event)}
      ></till-numeric-pad>
      <div class="actions">
        <wt-button class="back" variant="secondary" @click=${() => this.#back()}>
          ${t("action.back")}
        </wt-button>
        <wt-button
          class="submit"
          variant="primary"
          ?disabled=${this.pin === ""}
          @click=${() => void this.#submit()}
        >
          ${t("action.login")}
        </wt-button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-lock-screen": TillLockScreen;
  }
}
