import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { MIN_PIN_LENGTH } from "@waitron/shared";
import {
  ThemeChoiceController,
  VenueLogoController,
  baseStyles,
  reportVenueLogoFailure,
  reportVenueLogoLoaded,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-language-chooser.js";
import "@waitron/ui/src/components/wt-powered-by.js";
import "@waitron/ui/src/components/wt-venue-logo.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { CountdownController } from "../state/countdown-controller.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { pressIfEnabled } from "../state/pad-keys.js";
import type { StringKey } from "../i18n/strings.js";
import "../widgets/numeric-pad.js";
import { chooserStyles } from "../widgets/chooser-styles.js";
import { themeChooser } from "../widgets/theme-chooser.js";
import "../widgets/about-button.js";
import "../widgets/main-server-strip.js";
import {
  serverConnectionNotice,
  serverConnectionNoticeStyles,
  serverWaitingText,
} from "../widgets/server-connection-notice.js";
import { noticeLine, noticeLineStyles } from "../widgets/notice-strip.js";
import type { TillApi } from "../api/client.js";
import type { ServerWaitingFor } from "../api/server-router.js";
import type { StaffMember, StaffNotice } from "../api/device-session-api.js";
import { TILL_LIVE_TYPES, type TillLiveConnection } from "../api/live-connection.js";
import { queuedLiveRefresh } from "../state/live-gate.js";

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

/** Account-specific causes stay private at sign-in. */
function loginErrorKey(code: string): StringKey | "storage.disk_full" {
  if (code === "storage.disk_full") return code;
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
    new ThemeChoiceController(this);
  }

  static override styles = [
    baseStyles,
    chooserStyles,
    noticeLineStyles,
    serverConnectionNoticeStyles,
    css`
      :host {
        display: block;
      }

      :host(:not([compact])) {
        display: flex;
        flex-direction: column;
      }

      /* Cap the login form and centre it — a wide till never stretches the roster or pad edge to edge. */
      .screen {
        inline-size: 100%;
        max-width: var(--wt-till-form-column-width);
        margin-inline: auto;
      }

      .pin-screen {
        display: flex;
        flex: 1;
        flex-direction: column;
      }

      /* A live notice scrolls within its own space so it cannot move keys under a finger. */
      .pin-notices {
        flex: 1;
        min-block-size: var(--wt-tap-min);
        overflow: auto;
        contain: size;
      }

      .pin-screen .switch-device {
        align-self: start;
        margin-block-start: var(--wt-space-3);
      }

      .pin-notices > :first-child {
        margin-block-start: 0;
      }

      .pin-notices:focus-visible {
        outline-offset: calc(-2 * var(--wt-focus-offset));
      }

      .compact {
        --wt-till-pin-status-height: 2lh;
        --wt-till-keypad-row-height: var(--wt-tap-min);
        max-block-size: 45dvh;
        overflow: auto;
        padding: var(--wt-space-2) var(--wt-space-4);
      }

      .compact-controls {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .compact .actions {
        position: sticky;
        inset-block-end: 0;
        background: var(--wt-color-bg);
      }

      .compact .roster {
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(100%, var(--wt-till-roster-card-min-width)), 1fr)
        );
      }

      .logo-place {
        display: flex;
        justify-content: center;
        margin-block-end: var(--wt-space-4);
      }

      .logo-place:has(> wt-venue-logo[failed]) {
        margin-block-end: 0;
      }

      .powered-by {
        margin-block-start: var(--wt-space-4);
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

      .pin-status {
        block-size: var(--wt-till-pin-status-height);
        flex: none;
        margin-block-end: var(--wt-space-3);
        line-height: 1.35;
        color: var(--wt-color-text-muted);
      }

      .pin-status .error {
        color: var(--wt-color-danger);
      }

      .pin-screen .pin-heading {
        margin-block-end: var(--wt-space-3);
      }

      .pin-screen .pin-status {
        margin-block-end: 0;
      }

      .servers,
      .clock {
        margin-top: var(--wt-space-4);
      }

      .servers wt-button {
        margin-left: var(--wt-space-2);
      }

      till-main-server-strip .servers {
        width: 100%;
        max-width: var(--wt-till-form-column-width);
        margin: 0;
      }

      /* The strip's own panel-button rules cannot reach this slotted button; these match them. */
      till-main-server-strip .servers wt-button {
        width: 100%;
        margin-left: 0;
      }

      till-main-server-strip wt-button::part(button) {
        background: var(--wt-color-on-danger);
        color: var(--wt-color-danger);
        border-color: var(--wt-color-on-danger);
      }

      till-main-server-strip wt-button::part(button):hover:not(:disabled) {
        border-color: var(--wt-color-danger);
      }

      .roster {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--wt-till-roster-card-min-width), 1fr));
        gap: var(--wt-space-2);
      }

      .operator-button {
        width: 100%;
      }

      .pin-heading,
      .actions .cancel::part(button) {
        overflow-wrap: anywhere;
      }

      .pin-display {
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-xl);
        line-height: 1;
        letter-spacing: var(--wt-space-2);
      }

      /* The pad while a throttle back-off runs: greyed and non-interactive (the inert attribute also
         blocks focus and pointer), so the operator waits out the countdown, not a dead submit. */
      .pad-wrap[inert] {
        opacity: 0.5;
      }

      .status.error {
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
        min-inline-size: 0;
      }

      .pin-screen .actions wt-button::part(button) {
        block-size: 100%;
      }
    `,
  ];

  /** The HTTP face of the till. Set before the element connects (its lifecycle fetches the roster). */
  @property({ attribute: false }) api!: TillApi;

  /** What a sign-in waits for before it asks the server for a session; it never rejects. */
  @property({ attribute: false }) untilSignedOut: () => Promise<void> | undefined = () => undefined;

  @property({ attribute: false }) live?: TillLiveConnection;

  @property({ type: Boolean }) compact = false;

  @property() compactOperator = "";

  @property({ type: Boolean }) kitchenUnavailable = false;

  @state() private compactOpen = false;

  @property() deviceName?: string;

  /** Names the venue's logo for a screen reader. */
  @property() legalName = "";

  /** Absent → no remembered operator, read or written: there is nowhere venue-stable to keep one. */
  @property() deviceId?: string;

  @property({ type: Boolean }) canChooseDevice = false;

  @property({ type: Boolean }) serverWaiting = false;
  @property({ attribute: false }) serverWaitingFor?: ServerWaitingFor;
  @property({ type: Boolean }) noBoxAnswering = false;

  @property({ type: Boolean }) mainServerSilent = false;
  @property({ attribute: false }) mainSilentSince: number | null = null;
  @property({ attribute: false }) mainLastAnsweredAt: number | null = null;
  @property({ type: Boolean }) spareAnswering = false;
  @property({ type: Boolean }) mainServerRefused = false;
  @property({ type: Boolean }) spareSwitchBusy = false;
  @property({ type: Boolean }) showCloudEmergency = false;
  @property({ type: Boolean }) cloudEmergencyBusy = false;
  @property({ type: Boolean }) cloudEmergencyRefused = false;

  @property({ type: Boolean }) loggedOutByOther = false;
  @property({ attribute: false }) clockNotice?: StaffNotice;
  @property({ attribute: false }) notices: readonly StaffNotice[] = [];

  /** `undefined` while the fetch is in flight. */
  @state() private staff?: StaffMember[];
  /** Its presence is what puts the screen in PIN mode. */
  @state() private selected?: StaffMember;
  @state() private pin = "";
  @state() private errorKey?: StringKey | "storage.disk_full";
  /** Stays set after a successful login: the till keeps this screen up while its first reads wait. */
  @state() private signingIn = false;

  readonly #venueLogo = new VenueLogoController(this);
  /** A `pin.throttled` back-off. */
  readonly #throttle = new CountdownController(this);
  #connection = 0;
  /** Advanced by Cancel and by leaving the page, so a sign-in still waiting to be sent is dropped. */
  #submission = 0;
  #staffLive?: { stop(): void };
  #initialStaffRead?: Promise<void>;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.live?.up) this.#initialStaffRead = this.#loadStaff();
  }

  override updated(changed: PropertyValues): void {
    if (changed.has("live")) {
      this.#staffLive?.stop();
      this.#staffLive = undefined;
    }
    if (this.compact && changed.has("compactOperator"))
      this.#button(
        this.compactOperator === "" ? "[data-kitchen-sign-in]" : "[data-kitchen-sign-out]",
      )?.focus();
    if (this.isConnected && this.live && !this.#staffLive)
      this.#staffLive = queuedLiveRefresh(this.live, {
        types: TILL_LIVE_TYPES.signIn!,
        beforeRun: () => this.#initialStaffRead,
        run: () => this.#loadStaff(),
      });
  }

  override disconnectedCallback(): void {
    this.#staffLive?.stop();
    this.#staffLive = undefined;
    this.#initialStaffRead = undefined;
    super.disconnectedCallback();
    this.#connection++;
    this.#submission++;
    this.compactOpen = false;
    this.pin = "";
    this.selected = undefined;
    this.staff = undefined;
    this.errorKey = undefined;
    this.signingIn = false;
  }

  async #loadStaff(): Promise<void> {
    const initial = this.staff === undefined;
    const connection = this.#connection;
    try {
      const staff = await this.api.listStaff();
      if (!this.isConnected || connection !== this.#connection) return;
      this.staff = staff;
    } catch {
      if (!this.isConnected || connection !== this.#connection) return;
      if (!initial) return;
      this.staff = [];
      this.errorKey = "login.load_failed";
      return;
    }
    if (initial) this.#preselectRemembered();
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
    this.errorKey = undefined;
  }

  #cancel(): void {
    this.#submission++;
    this.selected = undefined;
    this.pin = "";
    this.errorKey = undefined;
    this.signingIn = false;
    this.#throttle.stop();
  }

  #onPadChange(event: Event): void {
    event.stopPropagation();
    this.pin = (event as CustomEvent<{ value: string }>).detail.value;
    this.errorKey = undefined;
  }

  async #submit(): Promise<void> {
    const person = this.selected;
    if (
      person === undefined ||
      this.pin.length < MIN_PIN_LENGTH ||
      this.#throttle.remaining > 0 ||
      this.signingIn
    )
      return;
    const connection = this.#connection;
    const submission = ++this.#submission;
    const submitted = this.pin;
    this.signingIn = true;
    try {
      const signedOut = this.untilSignedOut();
      if (signedOut !== undefined) {
        await signedOut;
        if (!this.isConnected || submission !== this.#submission) return;
      }
      const { personId, permissions, locale } = await this.api.login(person.personId, submitted);
      if (!this.isConnected || connection !== this.#connection) return;
      this.pin = "";
      this.#remember(personId);
      this.dispatchEvent(
        new CustomEvent<LoggedInDetail>("logged-in", {
          detail: { personId, displayName: person.displayName, permissions, locale },
          bubbles: true,
          composed: true,
        }),
      );
      if (this.compact) {
        this.compactOpen = false;
        this.#cancel();
      }
    } catch (error) {
      if (!this.isConnected || connection !== this.#connection || submission !== this.#submission)
        return;
      this.signingIn = false;
      const code = (error as { code?: string }).code ?? "server.internal";
      if (code === "pin.throttled") {
        this.#startThrottle((error as { retryAfterSeconds?: number }).retryAfterSeconds);
        return;
      }
      this.errorKey = loginErrorKey(code);
      this.pin = "";
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
    this.errorKey = undefined;
    this.#throttle.start(
      typeof retryAfterSeconds === "number" && retryAfterSeconds > 0 ? retryAfterSeconds : 1,
    );
  }

  #switchDevice(): void {
    this.dispatchEvent(new CustomEvent("switch-device", { bubbles: true, composed: true }));
  }

  override render() {
    if (this.compact) return this.#renderCompact();
    if (this.mainServerSilent) return this.#renderMainServer();
    const pinScreen = this.selected !== undefined && !this.kitchenUnavailable;
    return html`
      <div class="language-corner">
        <till-about-button></till-about-button>
        ${themeChooser()}
        <wt-language-chooser
          active=${currentLocale()}
          .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
        ></wt-language-chooser>
      </div>
      ${!pinScreen && this.noBoxAnswering ? this.#renderServers() : nothing}
      <div class=${pinScreen ? "screen pin-screen" : "screen"}>
        ${this.#renderLogo()}
        ${
          this.kitchenUnavailable
            ? html`<p class="status" role="status">${t("login.kitchen_unavailable")}</p>
                <wt-button
                  data-kitchen-retry
                  variant="secondary"
                  @click=${() => this.dispatchEvent(new Event("kitchen-retry"))}
                  >${t("find_page.retry")}</wt-button
                >`
            : this.selected
              ? this.#renderPin(this.selected)
              : this.#renderList()
        }
        ${pinScreen ? nothing : this.#renderNotices()}
        ${
          this.canChooseDevice
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
        ${this.#renderPoweredBy()}
      </div>
      ${pinScreen || this.noBoxAnswering ? nothing : this.#renderServers()}
    `;
  }

  #renderNotices() {
    return html`
      ${this.notices.map(
        (notice) =>
          html`<div
            class="clock"
            role="status"
            ?data-storage-notice=${notice.owner === "box"}
            ?data-office-invoice-notice=${notice.owner === "office-invoices"}
          >
            ${noticeLine(notice)}
          </div>`,
      )}
      ${
        this.loggedOutByOther
          ? html`<p class="clock status" role="status" data-logged-out-by-other>
              ${t("login.logged_out_by_other")}
            </p>`
          : nothing
      }
      ${
        this.clockNotice === undefined
          ? nothing
          : html`<div class="clock" role="status" data-clock-notice>
              ${noticeLine(this.clockNotice, { hint: false })}
            </div>`
      }
    `;
  }

  async #showCompact(open: boolean): Promise<void> {
    if (this.signingIn) return;
    this.compactOpen = open;
    if (!open) this.#cancel();
    await this.updateComplete;
    this.#button(open ? ".operator-button" : "[data-kitchen-sign-in]")?.focus();
  }

  #renderCompact() {
    if (this.compactOperator !== "")
      return html`<div class="compact compact-controls">
        <span data-kitchen-operator>${this.compactOperator}</span>
        <wt-button
          data-kitchen-sign-out
          variant="secondary"
          @click=${() => this.dispatchEvent(new Event("kitchen-sign-out"))}
          >${t("action.logout")}</wt-button
        >
      </div>`;
    if (!this.compactOpen && (this.staff?.length ?? 0) === 0) return nothing;
    return html`<div class="compact">
      ${
        this.selected === undefined
          ? html`<div class="compact-controls">
              <wt-button
                data-kitchen-sign-in
                variant="secondary"
                @click=${() => void this.#showCompact(!this.compactOpen)}
                >${t(this.compactOpen ? "action.cancel" : "action.login")}</wt-button
              >
            </div>`
          : nothing
      }
      ${
        this.compactOpen
          ? html`<div class="screen">
              ${this.selected ? this.#renderPin(this.selected) : this.#renderList()}
            </div>`
          : nothing
      }
    </div>`;
  }

  #renderLogo() {
    const state = this.#venueLogo.state;
    if (state.kind === "none") return nothing;
    if (state.kind === "waiting") {
      return html`<div class="logo-place"><wt-venue-logo size="sign-in"></wt-venue-logo></div>`;
    }
    const { logo } = state;
    return html`<div class="logo-place">
      <wt-venue-logo
        size="sign-in"
        light=${logo.light}
        dark=${logo.dark ?? nothing}
        alt=${this.legalName}
        @wt-logo-error=${() => reportVenueLogoFailure(logo)}
        @wt-logo-load=${() => reportVenueLogoLoaded(logo)}
      ></wt-venue-logo>
    </div>`;
  }

  #renderPoweredBy() {
    const state = this.#venueLogo.state;
    return state.kind === "logo" && !state.failed
      ? html`<wt-powered-by class="powered-by" label=${t("login.powered_by")}></wt-powered-by>`
      : nothing;
  }

  #renderMainServer() {
    return html`<till-main-server-strip
      .noBoxAnswering=${this.noBoxAnswering}
      panel
      .spareAnswering=${this.spareAnswering}
      .showSwitch=${true}
      .refused=${this.mainServerRefused}
      .switchBusy=${this.spareSwitchBusy}
      .showCloud=${this.showCloudEmergency}
      .cloudBusy=${this.cloudEmergencyBusy}
      .cloudRefused=${this.cloudEmergencyRefused}
      .silentSince=${this.mainSilentSince}
      .lastAnsweredAt=${this.mainLastAnsweredAt}
      >${this.#renderServers()}</till-main-server-strip
    >`;
  }

  #renderServers() {
    if (!this.serverWaiting) return nothing;
    const checkAgain = html`<wt-button
      variant="secondary"
      size=${this.mainServerSilent ? "lg" : "md"}
      data-check-again
      @click=${() =>
        this.dispatchEvent(new CustomEvent("check-again", { bubbles: true, composed: true }))}
      >${t("server.check_again")}</wt-button
    >`;
    if (this.noBoxAnswering && !this.mainServerSilent)
      return serverConnectionNotice(true, undefined, checkAgain);
    return html`<p class="servers status" role="status" data-server-status>
      ${this.mainServerSilent ? nothing : serverWaitingText(this.serverWaitingFor)} ${checkAgain}
    </p>`;
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
        ? html`<p class="status error" role="alert">
            ${this.errorKey === "storage.disk_full" ? codeMessage(this.errorKey) : t(this.errorKey)}
          </p>`
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

  #button(selector: string): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(selector);
  }

  #renderPin(person: StaffMember) {
    const throttled = this.#throttle.remaining > 0;
    const error = this.errorKey;
    const hasNotices =
      this.serverWaiting ||
      this.notices.length > 0 ||
      this.loggedOutByOther ||
      this.clockNotice !== undefined;
    let status = "";
    if (throttled) status = t("pin.throttled");
    else if (this.signingIn) status = t("login.signing_in");
    else if (error === "storage.disk_full") status = codeMessage(error);
    else if (error) status = t(error);
    else if (this.pin === "") status = t("login.enter_pin");
    return html`
      <h1 class="heading pin-heading">${person.displayName}</h1>
      <div class="pin-status">
        <span role="status" class=${error || throttled ? "error" : nothing}>${status}</span>
        <span class="pin-display" aria-hidden="true" ?hidden=${status !== ""}
          >${"●".repeat(this.pin.length)}</span
        >
        ${throttled ? html`<span class="pin-countdown" aria-hidden="true">${t("login.throttled").replace("{n}", String(this.#throttle.remaining))}</span>` : nothing}
      </div>
      ${
        this.compact
          ? nothing
          : html`<div
              class="pin-notices"
              role=${hasNotices ? "region" : nothing}
              aria-label=${hasNotices ? t("staff_notice.list") : nothing}
              tabindex=${hasNotices ? 0 : nothing}
            >
              ${this.#renderServers()}${this.#renderNotices()}
            </div>`
      }
      <div class="pad-wrap" ?inert=${throttled}>
        <till-numeric-pad
          mode="pin"
          .value=${this.pin}
          @wt-change=${(event: Event) => this.#onPadChange(event)}
          @pad-enter=${() => pressIfEnabled(this.#button(".submit"))}
          @pad-escape=${() => pressIfEnabled(this.#button(".cancel"))}
        ></till-numeric-pad>
      </div>
      <div class="actions">
        <wt-button
          class="cancel"
          size=${this.compact ? "md" : "lg"}
          variant="secondary"
          ?disabled=${this.compact && this.signingIn}
          @click=${() => this.#cancel()}
        >
          ${this.compact ? t("action.cancel") : t("login.not_person").replace("{name}", () => person.displayName)}
        </wt-button>
        <wt-button
          class="submit"
          size=${this.compact ? "md" : "lg"}
          variant="primary"
          ?disabled=${this.pin.length < MIN_PIN_LENGTH || throttled}
          .loading=${this.signingIn}
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
