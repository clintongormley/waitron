import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, leaveCoordinatorFor, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-language-chooser.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { StringKey } from "../i18n/strings.js";
import "../widgets/numeric-pad.js";
import { languageChooserStyles } from "../widgets/language-chooser-styles.js";
import type { StaffMember, TillApi } from "../api/client.js";
import type { ServerStatus } from "../api/server-router.js";

/** Keyed by deviceId so two enrolled browsers at one venue remember their last operator independently. */
const lastOperatorKey = (deviceId: string): string => `waitron.lastOperator.${deviceId}`;

/**
 * `permissions` is the server's answer from `POST /api/session`, so the client never re-derives it
 * from a role.
 */
export interface LoggedInDetail {
  personId: string;
  displayName: string;
  permissions: string[];
  /** `null` when the operator has never set one. */
  locale: string | null;
}

/** Only `pin.invalid` is spelled out; every other code collapses to the generic `login.error`, never
 * the raw code. */
function loginErrorKey(code: string): StringKey {
  if (code === "pin.invalid") return "pin.invalid";
  return "login.error";
}

/**
 * The staff-picker + PIN login screen. The `till-numeric-pad` runs in `mode="pin"`, so the entered
 * string is captured raw and leading zeros survive — a PIN like `"0123"` round-trips.
 */
@customElement("till-lock-screen")
export class TillLockScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    languageChooserStyles,
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

      /* The server status line — set off below the roster, muted like the other
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

  @property() deviceName?: string;

  /** Absent → no remembered operator, read or written: there is nowhere venue-stable to keep one. */
  @property() deviceId?: string;

  /** Whether THIS TAB has adopted a dev device; off in production. */
  @property({ type: Boolean }) devMode = false;

  /** From `ServerRouter.statuses()`; empty on a till with no router, which renders no status line. */
  @property({ attribute: false }) serverStatuses: ServerStatus[] = [];

  /** The URL of the server the till is currently ON (`ServerRouter.current`). */
  @property({ attribute: false }) serverCurrent = "";

  @property({ type: Boolean }) serverWaiting = false;

  /** `undefined` while the fetch is in flight. */
  @state() private staff?: StaffMember[];
  /** Its presence is what puts the screen in PIN mode. */
  @state() private selected?: StaffMember;
  @state() private pin = "";
  @state() private errorKey?: StringKey;
  /** Seconds left on a `pin.throttled` back-off; `0` means not throttled. */
  @state() private throttleRemaining = 0;

  #throttleTimer?: ReturnType<typeof setInterval>;
  #scope?: DraftScope<string>;
  #connection = 0;
  #loginPending: string[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = leaveCoordinatorFor(this)?.register<string>({
      id: this,
      current: () => (this.#loginPending.includes(this.pin) ? "" : this.pin),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.pin = value;
      },
    });
    void this.#loadStaff();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#connection++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.pin = "";
    this.selected = undefined;
    this.staff = undefined;
    this.errorKey = undefined;
    this.throttleRemaining = 0;
    this.#loginPending = [];
    this.#clearThrottle();
  }

  async #loadStaff(): Promise<void> {
    const connection = this.#connection;
    try {
      const staff = await this.api.listStaff();
      if (!this.isConnected || connection !== this.#connection) return;
      this.staff = staff;
    } catch {
      if (!this.isConnected || connection !== this.#connection) return;
      this.staff = [];
      this.errorKey = "login.load_failed";
      return;
    }
    this.#preselectRemembered();
  }

  /** The read is wrapped because localStorage can throw in a private window. */
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

  #select(person: StaffMember): void {
    this.selected = person;
    this.pin = "";
    this.#scope?.changed();
    this.errorKey = undefined;
  }

  #requestCancel(): void {
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator && this.#scope) {
      void coordinator.request({ scopes: [this], reason: "cancel", proceed: () => this.#cancel() });
    } else this.#cancel();
  }

  #cancel(): void {
    this.selected = undefined;
    this.pin = "";
    this.#scope?.changed();
    this.errorKey = undefined;
    this.#clearThrottle();
    this.throttleRemaining = 0;
  }

  #onPadChange(event: Event): void {
    event.stopPropagation();
    this.pin = (event as CustomEvent<{ value: string }>).detail.value;
    this.#scope?.changed();
    this.errorKey = undefined;
  }

  /** Guarded so an empty PIN or a throttled screen never calls the API, even if Log in is force-clicked
   * past its disabled state. Only a still-connected screen remembers the operator and announces
   * `logged-in`: those are side effects, not state writes. */
  async #submit(): Promise<void> {
    const person = this.selected;
    if (person === undefined || this.pin === "" || this.throttleRemaining > 0) return;
    const connection = this.#connection;
    const submitted = this.pin;
    this.#loginPending.push(submitted);
    this.#scope?.changed();
    try {
      const { personId, permissions, locale } = await this.api.login(person.personId, submitted);
      if (!this.isConnected || connection !== this.#connection) return;
      this.pin = "";
      this.#scope?.commit("");
      this.#remember(personId);
      this.dispatchEvent(
        new CustomEvent<LoggedInDetail>("logged-in", {
          detail: { personId, displayName: person.displayName, permissions, locale },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (!this.isConnected || connection !== this.#connection) return;
      const code = (error as { code?: string }).code ?? "server.internal";
      if (code === "pin.throttled") {
        this.#startThrottle((error as { retryAfterSeconds?: number }).retryAfterSeconds);
        return;
      }
      this.errorKey = loginErrorKey(code);
      this.pin = "";
    } finally {
      if (this.isConnected && connection === this.#connection) {
        this.#loginPending.splice(this.#loginPending.indexOf(submitted), 1);
        this.#scope?.changed();
      }
    }
  }

  /** A private-window throw is swallowed: the memory is a convenience the login does not depend on. */
  #remember(personId: string): void {
    if (this.deviceId === undefined) return;
    try {
      localStorage.setItem(lastOperatorKey(this.deviceId), personId);
    } catch {
      // no storage → the default is simply not remembered
    }
  }

  /** The PIN is kept so entry resumes with what was typed. */
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

  /** Does not touch {@link throttleRemaining}, so a caller that wants entry live again resets it too. */
  #clearThrottle(): void {
    if (this.#throttleTimer !== undefined) {
      clearInterval(this.#throttleTimer);
      this.#throttleTimer = undefined;
    }
  }

  #switchDevice(): void {
    this.dispatchEvent(new CustomEvent("switch-device", { bubbles: true, composed: true }));
  }

  override render() {
    return html`
      <div class="language-corner">
        <wt-language-chooser
          active=${currentLocale()}
          .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
        ></wt-language-chooser>
      </div>
      <div class="screen">
        ${this.selected ? this.#renderPin(this.selected) : this.#renderList()}
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

  /** Shows the operator WHY a till is not selling; a healthy single-primary till shows no line. */
  #renderServers() {
    const known = this.serverStatuses;
    if (known.length === 0) return nothing;
    if (known.length === 1 && !this.serverWaiting && known[0]?.state === "primary") return nothing;
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

  #renderHeading(fallback: StringKey) {
    return html`<h1 class="heading">${this.deviceName ?? t(fallback)}</h1>`;
  }

  #renderList() {
    return html` ${this.#renderHeading("login.pick_operator")} ${this.#renderRoster()} `;
  }

  #renderRoster() {
    if (this.staff === undefined) {
      return html`<p class="status" role="status">${t("login.loading")}</p>`;
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
        <wt-button class="cancel" variant="secondary" @click=${() => this.#requestCancel()}>
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
