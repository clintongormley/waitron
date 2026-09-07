import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import "../widgets/numeric-pad.js";
import "../widgets/language-chooser.js";
import type { StaffMember, TillApi } from "../api/client.js";
import type { ServerStatus } from "../api/server-router.js";

/** The localStorage key holding the last operator who logged in on a given device. Keyed by deviceId so
 * two enrolled browsers on one venue remember independently; read on connect to default "Login as". */
const lastOperatorKey = (deviceId: string): string => `waitron.lastOperator.${deviceId}`;

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
  /**
   * The operator's stored per-user UI locale from the `POST /api/session` response (or `null` when
   * they have never set one), forwarded verbatim so `till-app` can `resolveActiveLocale` it against
   * the venue default and switch the UI on login. The lock screen only carries it — it never calls
   * `setLocale` or the preference-write endpoint itself.
   */
  locale: string | null;
}

/**
 * Maps a login error `code` to a user-facing string KEY. Only the two codes the operator can act on
 * are spelled out — a wrong PIN and a suspended account; every other code (a stale roster entry's
 * `person.not_found`, a `server.internal`) collapses to the generic `login.error`. This is the one
 * place that decides what the screen says, and it deliberately NEVER surfaces the raw code: a domain
 * code is an internal contract, not UI copy. `pin.throttled` is handled out of band (a countdown, not
 * a banner) and never reaches here.
 */
function loginErrorKey(code: string): StringKey {
  if (code === "pin.invalid") return "pin.invalid";
  if (code === "person.suspended") return "person.suspended";
  return "login.error";
}

/**
 * The staff-picker + PIN login screen the counter shows before a shift can sell. Its heading is the
 * device's own name; two modes are chosen by whether a person is `selected`:
 *
 *  - LIST — the roster from `api.listStaff()`, one `<wt-button>` per person. It renders a loading
 *    state until the fetch settles, an empty-roster message when nobody is returned, and a
 *    load-failed message if the fetch rejects.
 *  - PIN — a `till-numeric-pad` (the shared numeric surface) for the selected person, with a Cancel
 *    control to correct a wrong name and a Log in control that calls `api.login(personId, pin)`.
 *
 * The screen defaults "Login as" to the last operator who logged in on THIS device (localStorage,
 * keyed by {@link deviceId}), landing straight in PIN mode for them when they are still on the roster.
 * On a successful login it writes that memory and emits a composed `logged-in` CustomEvent carrying the
 * server-confirmed `personId`; the parent (`till-app`) swaps this screen for the counter. On a rejected
 * `{ code }` it shows the LOCALISED message for that code (never the raw code — see {@link loginErrorKey})
 * and clears the PIN so the operator can retry — except `pin.throttled`, which greys the pad and counts
 * a back-off down (Task 10's wrong-PIN throttle).
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

      /* Cap the login form and centre it — a wide till never stretches the roster or pad edge to edge. */
      .screen {
        max-width: 24rem;
        margin-inline: auto;
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

      /* The server status line (till-reroute §4.4) — set off below the roster, muted like the other
         status copy, with the "check again" control spaced off the states it follows. */
      .servers {
        margin-top: var(--wt-space-4);
      }

      .servers wt-button {
        margin-left: var(--wt-space-2);
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

      /* The pad while a throttle back-off runs: greyed and non-interactive (the inert attribute also
         blocks focus and pointer), so the operator waits out the countdown, not a dead submit. */
      .pad-wrap[inert] {
        opacity: 0.5;
      }

      .error {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      .throttle {
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

  /** The enrolled device's own name (from `GET /api/device/me`), shown as the screen's heading. Absent
   * on a browser with no device identity (pre-Task-13), where the heading falls back to a mode label. */
  @property() deviceName?: string;

  /** The enrolled device's id, the key for the remembered-operator default. Absent → no default, no
   * write (a browser with no device identity has nowhere venue-stable to remember an operator). */
  @property() deviceId?: string;

  /** Dev only (device-enrolment §3.2): whether THIS TAB has adopted a dev device — the app sets it from
   * the tab's `sessionStorage` id. When true the screen offers a "Switch device" affordance that emits
   * `switch-device` (the app clears the tab device and returns to the chooser). Off in production. */
  @property({ type: Boolean }) devMode = false;

  /**
   * The venue's known servers and each one's probed state (till-reroute §4.4), from `ServerRouter.statuses()`.
   * Rendered as a one-line status under the roster so the operator can see WHY a till is not selling — the
   * box unreachable, a standby not yet promoted — rather than a silent failure. Empty (the default) on a
   * till with no router (tests, a single-server dev box) renders nothing.
   */
  @property({ attribute: false }) serverStatuses: ServerStatus[] = [];

  /**
   * The URL of the server the till is currently ON (`ServerRouter.current`), so its row can read
   * "On: <label>" (§4.4) rather than "<label>: <state>". Empty (the default) on a till with no router
   * marks nothing — every row then renders as "<label>: <state>". Only a CURRENT server that is also
   * `primary` is marked; a current-but-not-primary server (the waiting case) keeps its state row.
   */
  @property({ attribute: false }) serverCurrent = "";

  /**
   * Whether the router is WAITING for a promotion (§4.4) — no server is accepting sales right now. Drives
   * the "waiting for the standby to be promoted" suffix on the status line. The healthy single-primary
   * till (see {@link #renderServers}) shows no line at all.
   */
  @property({ type: Boolean }) serverWaiting = false;

  /** The roster: `undefined` while the fetch is in flight, then the (possibly empty) list. */
  @state() private staff?: StaffMember[];
  /** The person whose PIN is being entered; its presence is what puts the screen in PIN mode. */
  @state() private selected?: StaffMember;
  /** The raw string the numeric pad has entered — captured verbatim as the PIN. */
  @state() private pin = "";
  /** The string key of the message to show, or `undefined` for none. Shared by both modes. */
  @state() private errorKey?: StringKey;
  /** Seconds left on a `pin.throttled` back-off; `0` means not throttled. While positive the pad is
   * greyed and submit disabled. Driven down each second by {@link #throttleTimer}. */
  @state() private throttleRemaining = 0;

  /** The countdown interval, live only while {@link throttleRemaining} is positive. Cleared on reaching
   * zero, on Cancel, on a fresh submit, and on disconnect — so no timer outlives the screen. */
  #throttleTimer?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#loadStaff();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#clearThrottle();
  }

  /** Fetch the roster once on connect, then default "Login as" to the last operator remembered on this
   * device when they are still present. A rejection becomes the load-failed state rather than an
   * unhandled promise. State written after a mid-fetch disconnect is harmless — Lit simply does not
   * paint a detached element — so no `isConnected` guard is needed here. */
  async #loadStaff(): Promise<void> {
    try {
      this.staff = await this.api.listStaff();
    } catch {
      this.staff = [];
      this.errorKey = "login.load_failed";
      return;
    }
    this.#preselectRemembered();
  }

  /** Preselect the operator remembered on this device (→ straight to PIN mode) when the stored id is
   * still on the roster. Keyed by {@link deviceId}; guarded by the roster membership check so a since-
   * removed person never lands the screen in PIN mode for someone it cannot show. The read is wrapped
   * because localStorage throws in a private window — a failure just means no default. */
  #preselectRemembered(): void {
    if (this.deviceId === undefined || this.staff === undefined) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(lastOperatorKey(this.deviceId));
    } catch {
      return; // no storage → no default
    }
    if (remembered === null) return;
    const person = this.staff.find((s) => s.personId === remembered);
    if (person !== undefined) this.#select(person);
  }

  /** Enter PIN mode for `person`, starting from a blank PIN and no error. */
  #select(person: StaffMember): void {
    this.selected = person;
    this.pin = "";
    this.errorKey = undefined;
  }

  /** Cancel: return to the roster, discarding any half-entered PIN, error, and throttle back-off. */
  #cancel(): void {
    this.selected = undefined;
    this.pin = "";
    this.errorKey = undefined;
    this.#clearThrottle();
    this.throttleRemaining = 0;
  }

  /** Capture the pad's new value as the PIN and clear any stale error as the operator retypes. */
  #onPadChange(event: Event): void {
    event.stopPropagation();
    this.pin = (event as CustomEvent<{ value: string }>).detail.value;
    this.errorKey = undefined;
  }

  /**
   * Attempt the login. Guarded so an empty PIN — and a throttled screen — can never call the API, even
   * if Log in is force-clicked past its disabled state. On success — and only if the screen is still
   * connected, so a torn-down screen never announces a login — it remembers the operator on this device
   * and emits `logged-in` with the server-confirmed personId. On a rejected `{ code }` it either starts
   * the `pin.throttled` back-off or shows the localised message and clears the PIN for a retry.
   */
  async #submit(): Promise<void> {
    const person = this.selected;
    if (person === undefined || this.pin === "" || this.throttleRemaining > 0) return;
    try {
      const { personId, canConfigureTill, locale } = await this.api.login(
        person.personId,
        this.pin,
      );
      if (!this.isConnected) return;
      this.#remember(personId);
      this.dispatchEvent(
        new CustomEvent<LoggedInDetail>("logged-in", {
          detail: { personId, displayName: person.displayName, canConfigureTill, locale },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      const code = (error as { code?: string }).code ?? "server.internal";
      if (code === "pin.throttled") {
        this.#startThrottle((error as { retryAfterSeconds?: number }).retryAfterSeconds);
        return;
      }
      this.errorKey = loginErrorKey(code);
      this.pin = "";
    }
  }

  /** Remember this operator on this device so the next unlock defaults to them. No deviceId → nowhere
   * venue-stable to write; a private-window throw is swallowed (the memory is a convenience, not state
   * the login depends on). */
  #remember(personId: string): void {
    if (this.deviceId === undefined) return;
    try {
      localStorage.setItem(lastOperatorKey(this.deviceId), personId);
    } catch {
      // no storage → the default is simply not remembered
    }
  }

  /** Begin (or restart) the throttle back-off: seconds from the server's `retryAfterSeconds` (min 1 for
   * a missing/absurd value), a per-second tick down, and re-enable at zero. The PIN is kept so entry
   * resumes with what was typed. */
  #startThrottle(retryAfterSeconds: number | undefined): void {
    this.#clearThrottle();
    const seconds =
      typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
        ? Math.ceil(retryAfterSeconds)
        : 1;
    this.throttleRemaining = seconds;
    this.errorKey = undefined;
    this.#throttleTimer = setInterval(() => {
      this.throttleRemaining = this.throttleRemaining - 1;
      if (this.throttleRemaining <= 0) {
        this.throttleRemaining = 0;
        this.#clearThrottle();
      }
    }, 1000);
  }

  /** Stop the countdown interval if one is running. Does not touch {@link throttleRemaining}, so a caller
   * that wants entry live again resets it too (the tick does; disconnect need not). */
  #clearThrottle(): void {
    if (this.#throttleTimer !== undefined) {
      clearInterval(this.#throttleTimer);
      this.#throttleTimer = undefined;
    }
  }

  /** Dev only: drop this tab's adopted device and return to the chooser. The app owns the clear + re-boot;
   * the screen only announces the intent. */
  #switchDevice(): void {
    this.dispatchEvent(new CustomEvent("switch-device", { bubbles: true, composed: true }));
  }

  override render() {
    return html`
      <div class="screen">
        ${this.selected ? this.#renderPin(this.selected) : this.#renderList()}
        <till-language-chooser
          .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
        ></till-language-chooser>
        ${
          this.devMode
            ? html`<wt-button
                class="switch-device"
                data-switch-device
                variant="secondary"
                @click=${() => this.#switchDevice()}
              >
                ${t("device.switch")}
              </wt-button>`
            : nothing
        }
      </div>
      ${this.#renderServers()}
    `;
  }

  /**
   * The venue's server status line (till-reroute §4.4): one `label: state` row per known server joined by
   * " · ", a waiting-promotion suffix while no server accepts sales, and a "check again" control that
   * dispatches `check-again` (the app turns it into `router.probeNow()`). Rendered nothing for a HEALTHY
   * single-server till — the only known server is the page's own and it is primary — so a normal counter
   * shows no status chrome; every other shape (a second server, an unreachable box, a waiting promotion)
   * shows the line. `role="status"` so a screen reader announces a state change without stealing focus.
   */
  #renderServers() {
    const known = this.serverStatuses;
    // No line for a till with no known servers (no router), nor for the healthy single-server till whose
    // only server is its own page origin and it is primary. Every other shape (a second server, an
    // unreachable box, a waiting promotion) shows the line.
    if (known.length === 0) return nothing;
    if (known.length === 1 && !this.serverWaiting && known[0]?.state === "primary") return nothing;
    // The server the till is ON, when it is primary, reads "On: <label>" (§4.4); every other server —
    // including the current one when it is not primary (the waiting case) — reads "<label>: <state>".
    const row = (s: ServerStatus) =>
      s.url === this.serverCurrent && s.state === "primary"
        ? `${t("server.on")} ${s.label}`
        : `${s.label}: ${t(`server.${s.state}` as StringKey)}`;
    return html`
      <p class="servers status" role="status" data-server-status>
        ${known.map(row).join(" · ")}${
          this.serverWaiting ? html` — ${t("server.waiting_promotion")}` : nothing
        }
        <wt-button
          variant="secondary"
          data-check-again
          @click=${() =>
            this.dispatchEvent(new CustomEvent("check-again", { bubbles: true, composed: true }))}
        >
          ${t("server.check_again")}
        </wt-button>
      </p>
    `;
  }

  /** The heading: the device's own name, or a mode-appropriate fallback for a browser with no device
   * identity (pre-Task-13). */
  #renderHeading(fallback: StringKey) {
    return html`<h1 class="heading">${this.deviceName ?? t(fallback)}</h1>`;
  }

  #renderList() {
    return html` ${this.#renderHeading("login.pick_operator")} ${this.#renderRoster()} `;
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
    const throttled = this.throttleRemaining > 0;
    return html`
      ${this.#renderHeading("login.enter_pin")}
      <p class="operator">${person.displayName}</p>
      <div class="pin-display" aria-hidden="true">${"●".repeat(this.pin.length)}</div>
      ${
        throttled
          ? html`<p class="throttle" role="alert">
              ${t("login.throttled").replace("{n}", String(this.throttleRemaining))}
            </p>`
          : this.errorKey
            ? html`<p class="error" role="alert">${t(this.errorKey)}</p>`
            : nothing
      }
      <div class="pad-wrap" ?inert=${throttled}>
        <till-numeric-pad
          mode="pin"
          .value=${this.pin}
          @wt-change=${(event: Event) => this.#onPadChange(event)}
        ></till-numeric-pad>
      </div>
      <div class="actions">
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button>
        <wt-button
          class="submit"
          variant="primary"
          ?disabled=${this.pin === "" || throttled}
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
