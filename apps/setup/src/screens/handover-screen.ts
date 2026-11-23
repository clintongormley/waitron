import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  ModulePromotionEntry,
  SetupContribution,
} from "@waitron/module/src/setup-contract.js";
import { SETUP_MODULES } from "@waitron/dashboard-modules/setup";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-file-input.js";
import "@waitron/ui/src/components/wt-segmented-control.js";
import "@waitron/ui/src/components/wt-spinner.js";
import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  baseStyles,
  pageTitleStyles,
  focusFirstInvalid,
  formMessage,
  submitOnEnter,
  formMessageStyles,
  visuallyHiddenStyles,
} from "@waitron/ui";
import { formatDuration, isValidEmail } from "@waitron/shared";
import {
  SetupApi,
  type HandoverStatus,
  type HandoverSignIn,
  type EmergencyHandoverPreview,
  type EmergencyHandoverDeclaration,
  type FollowedCopyTake,
} from "../api/client.js";
import { makeSetupId } from "../random-id.js";
import { passwordVisibility, currentLocale, format, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { fileInputCopy } from "../file-input-copy.js";

const activated = (status?: HandoverStatus) =>
  status?.role === "destination" &&
  ["activated", "return_pending", "return_complete", "return_abandoned"].includes(status.state);
const closed = (status?: HandoverStatus) =>
  status !== undefined && ["abandoned", "replaced"].includes(status.state);
/** Take refusals the copy this spare holds can still answer, and how each is worded. */
const FOLLOWED_REFUSALS: Partial<Record<string, StringKey>> = {
  "handover.copy_predates_destination": "handover.emergency.followed_not_admitted",
  "provisioning.database_ahead": "handover.emergency.followed_ahead",
  "restore.schema_too_new": "handover.emergency.followed_ahead",
  "handover.chain_broken": "handover.emergency.followed_failed",
  "handover.copy_damaged": "handover.emergency.followed_failed",
  "handover.copy_check_failed": "handover.emergency.followed_failed",
};
const HELD_OFFER_AFTER_MS = 60_000;
/** A switch challenge lives two minutes, so a passkey picked from the field leaves at least one. */
const AUTOFILL_RENEW_MS = 60_000;
const MAIN_CHECK_MS = 3000;
/** Refusals the copy the take signs in against may answer differently: it can be newer. */
const HELD_SIGN_IN_REFUSALS = new Set([
  "password.invalid",
  "totp.required",
  "authorization.not_permitted",
  "passkey.not_registered",
  "passkey.verification_failed",
]);

/** Refusals the person answers by signing in again, so the folded sign-in opens. */
const SIGN_IN_REFUSAL_KEYS = new Set<StringKey>([
  "handover.emergency.passkey_failed",
  "handover.emergency.passkey_again",
  "handover.emergency.code_expired",
  "handover.emergency.sign_in_failed",
  "handover.emergency.throttled",
  "handover.emergency.permission",
]);
/** Refusals a fresh passkey answer can lift: no proof cookie, a lapsed one, or a used challenge. */
const PROOF_REFUSALS = new Set(["password.invalid", "passkey.challenge_expired"]);
class PasskeyNotUsed extends Error {}
/** The box wants a fresh passkey answer, but nobody pressed anything that may open the prompt. */
class PasskeyNeedsPress extends Error {}

@customElement("setup-handover-screen")
export class SetupHandoverScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    formMessageStyles,
    css`
      /* Keeps the card's margins inside the page rather than collapsing into the body's. */
      :host {
        display: flow-root;
        overflow-wrap: anywhere;
      }
      main {
        box-sizing: border-box;
        width: min(calc(var(--wt-space-6) * 22), calc(100% - 2 * var(--wt-modal-inline-margin)));
        margin: var(--wt-space-5) auto;
        padding: var(--wt-space-5) var(--wt-modal-inline-padding);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface-raised);
        --wt-form-actions-surface: var(--wt-color-surface-raised);
      }
      .choices {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-4);
      }
      .choices wt-button {
        display: block;
      }
      /* A link that goes back looks like the button beside it: leaving is navigation. */
      a.button {
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
        text-decoration: none;
        text-align: center;
      }
      a.button:not(.primary):hover {
        border-color: var(--wt-color-primary-text);
      }
      a.button.primary {
        border-color: transparent;
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      a.button.primary:hover {
        background: var(--wt-color-primary-hover);
      }
      wt-input,
      wt-textarea,
      wt-file-input,
      wt-segmented-control {
        display: block;
        margin-bottom: var(--wt-space-3);
      }
      h1 {
        margin-top: 0;
      }
      .statements label {
        display: flex;
        align-items: start;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-3);
        min-height: var(--wt-tap-min);
      }
      input[type="checkbox"] {
        accent-color: var(--wt-color-primary);
        flex-shrink: 0;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
      ol.progress {
        list-style: none;
        padding: 0;
        margin-block: var(--wt-space-4);
      }
      ol.progress li {
        display: flex;
        align-items: start;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      ol.progress .mark {
        display: inline-flex;
        justify-content: center;
        flex: none;
        inline-size: var(--wt-space-4);
      }
      li[data-state="done"] .mark {
        color: var(--wt-color-success);
        font-weight: var(--wt-font-weight-bold);
      }
      li[data-state="waiting"] {
        color: var(--wt-color-text-muted);
      }
      .fact {
        margin-block: var(--wt-space-4);
        padding: var(--wt-space-3) var(--wt-space-4);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-lifted);
      }
      .fact h2 {
        margin: 0 0 var(--wt-space-2);
      }
      .fact p {
        margin: 0;
      }
      .fact strong {
        display: block;
      }
      .note {
        color: var(--wt-color-text-muted);
      }
      a,
      summary {
        color: var(--wt-color-primary-text);
      }
      .autofill-username {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        border: 0;
        overflow: hidden;
        clip-path: inset(50%);
      }
    `,
  ];
  @property({ attribute: false }) api = new SetupApi();
  @property() operationId = "";
  @property({ type: Boolean }) emergency = false;
  /** Read once: the page later replaces its address with the operation's. */
  @property({ attribute: false }) pageUrl = location.href;
  @state() private copyPreview?: EmergencyHandoverPreview;
  /** A controlled handover the last check named; kept while that copy is checked again. */
  @state() private controlledOperationId?: string;
  /** A checked copy folds the sign-in away; later steps still send the sign-in. */
  @state() private signInOpen = true;
  /** Before a switch is declared: Continue was pressed, so the copy is being prepared. */
  @state() private preparing = false;
  /** Which step of preparing the copy the page is on; checking follows bringing it up to date. */
  @state() private copyStep: "follow" | "check" = "follow";
  /** Proceed was pressed on the prepared copy, so the statements are asked. */
  @state() private proceeded = false;
  @state() private backupOpen = false;
  @state() private backup?: File;
  @state() private backupKey = "";
  @state() private needsBackupKey = false;
  @state() private backupRestarting = false;
  @state() private followRestarting = false;
  /** Waiting for the spare's followed copy to catch up, asking again every 2 seconds. */
  @state() private following = false;
  /**
   * The copy this spare holds, read before the take; offered once the take waits or is refused, and
   * never to a person it refused.
   */
  @state() private heldCopy?: EmergencyHandoverPreview;
  @state() private heldOffered = false;
  /** A refused take restarts the box; the held copy is offered once the box answers again. */
  @state() private heldWaiting = false;
  /** A copy placed earlier is not the main box's latest once the person chose it as the held copy. */
  @state() private heldChosen = false;
  #heldTimer?: ReturnType<typeof setTimeout>;
  @state() private reason = "";
  @state() private statements = {
    sourceSwitchedOff: false,
    noParallelRecovery: false,
    missingTailAccepted: false,
  };
  @state() private refusalLink?: { href: string; label: StringKey };
  @state() private copyRefused = false;
  @state() private declarationSaved = false;
  /** From the declaration this page saved; a resumed one carries its time in the preview. */
  @state() private declaredAtMs?: number;
  /** The device's own check of the main server, before the switch is offered (4d plan, D5). */
  @state() private mainCheck: "checking" | { serversUrl: string } | "clear" = "clear";
  /** Pressed Start switching on the page that explains the switch, since the last check. */
  @state() private switchStarted = false;
  #mainCheckController?: AbortController;
  /** How long the spare had found the main box silent, and when this page read it. */
  #silentFor?: { ms: number; readAtMs: number };
  #silentTicker?: ReturnType<typeof setInterval>;
  #pendingDeclaration?: Omit<EmergencyHandoverDeclaration, "signIn">;
  get #isEmergency(): boolean {
    return this.emergency || this.status?.scenario === "emergency";
  }
  get #checksMain(): boolean {
    return this.emergency && !this.operationId;
  }
  get #back(): string | undefined {
    const page = new URL(this.pageUrl);
    const back = URL.parse(page.searchParams.get("back") ?? "");
    const venue = /^box-[^.]+\./.test(page.hostname)
      ? page.hostname.slice(page.hostname.indexOf(".") + 1)
      : page.hostname;
    return back?.protocol === "https:" && page.hostname.includes(".") && back.hostname === venue
      ? back.href
      : undefined;
  }
  get #leaveHref(): string {
    return (this.#isEmergency && this.#back) || "/";
  }
  /** Before a switch is declared, leaving names the till when there is one to go back to. */
  get #leaveLabel(): StringKey {
    return this.#isEmergency && this.#back
      ? "handover.emergency.leave_till"
      : "handover.emergency.leave";
  }
  /** The main box is silent and the person has not yet chosen to switch. */
  get #explaining(): boolean {
    return this.#checksMain && this.mainCheck === "clear" && !this.switchStarted && !this.#declared;
  }
  get #declared(): boolean {
    return this.declarationSaved || this.status?.scenario === "emergency";
  }
  get #offersOtherCopy(): boolean {
    return this.#isEmergency && !this.#declared && this.controlledOperationId === undefined;
  }
  /** The pressed button is gone with the page it was on, so focus moves to the new heading. */
  async #focusHeading(still: () => boolean = () => true): Promise<void> {
    await this.updateComplete;
    if (still()) this.shadowRoot!.querySelector<HTMLElement>("h1")?.focus();
  }
  /** The page before Switch: sign-in, the copy being prepared, or the statements. */
  get #page(): "sign-in" | "preparing" | "ready" | undefined {
    if (!this.#isEmergency || this.#declared) return undefined;
    if (!this.preparing) return "sign-in";
    return this.copyPreview && this.proceeded ? "ready" : "preparing";
  }
  get #signInShown(): boolean {
    return !this.copyPreview || this.signInOpen || (this.attempted && !this.#valid());
  }
  #leaveLink() {
    return html`<a href=${this.#leaveHref}
      >${t(this.#declared ? "handover.emergency.leave_saved" : this.#leaveLabel)}</a
    >`;
  }
  @state() private status?: HandoverStatus;
  @state() private readFailed = false;
  @state() private restarting = false;
  @property({ attribute: false }) contributions: readonly SetupContribution[] = SETUP_MODULES;
  @state() private usePasskey = false;
  /** The emergency sign-in asks for the email first, then how to sign in. */
  @state() private signInStep: "email" | "method" = "email";
  /** Set while rendering when the emergency email step is drawn. */
  #emailStepDrawn = false;
  #autofillAttempt = 0;
  #autofillOn = false;
  /** True while this page's own passkey-autofill request is the browser's current ceremony. */
  #autofillWaiting = false;
  #autofillTimer?: ReturnType<typeof setTimeout>;
  /** A renewal fell due while the email field had focus, where it might close the passkey list. */
  #renewDue = false;
  /** From `pagehide` until `pageshow` restores the page. */
  #left = false;
  #modalOpen = false;
  /** False while what a step is doing was started by no press, so no modal prompt may open. */
  #promptAllowed = true;
  /** Sent until a step answers it; never written to storage or the address. */
  #assertion?: unknown;
  @state() private email = "";
  @state() private password = "";
  @state() private code = "";
  @state() private attempted = false;
  @state() private actionError = "";
  @state() private busy = false;
  /**
   * Activation waits for Try again, keeping the chosen minute: the box refused the sign-in, or the
   * fields failed their check when the series became ready.
   */
  @state() private activationHeld = false;
  @state() private retrying = false;
  @state() private entry?: ModulePromotionEntry;
  #signInChecked = false;
  #restorePage = (event: PageTransitionEvent): void => {
    if (!event.persisted) return;
    this.#left = false;
    this.requestUpdate();
    this.#restartPolling();
    if (this.#checksMain) this.#startMainCheck();
  };
  #controller?: AbortController;
  #timer?: ReturnType<typeof setTimeout>;
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.#left = false;
    if (this.hasUpdated) this.requestUpdate();
    this.#restartPolling();
    if (this.#checksMain) this.#startMainCheck();
    window.addEventListener("pagehide", this.#leavePage);
    window.addEventListener("pageshow", this.#restorePage);
    document.addEventListener("visibilitychange", this.#visibilityChanged);
  }
  #visibilityChanged = (): void => {
    if (document.visibilityState === "hidden") this.#stopAutofill();
    else this.requestUpdate();
  };
  protected override updated(): void {
    if (
      this.#emailStepDrawn &&
      this.isConnected &&
      !this.#left &&
      !this.#modalOpen &&
      document.visibilityState !== "hidden"
    ) {
      if (!this.#autofillOn) void this.#autofill();
    } else if (this.#autofillOn) this.#stopAutofill();
  }
  /** Offers a saved passkey in the email field, as the dashboard's login does. */
  async #autofill(): Promise<void> {
    this.#stopAutofill();
    this.#autofillOn = true;
    const attempt = this.#autofillAttempt;
    const current = () => attempt === this.#autofillAttempt && this.isConnected;
    try {
      if (!(await browserSupportsWebAuthnAutofill())) return;
    } catch {
      return;
    }
    if (!current()) return;
    this.#autofillTimer = setTimeout(() => {
      if (!current()) return;
      if (this.shadowRoot!.activeElement?.getAttribute("name") === "handover-email")
        this.#renewDue = true;
      else void this.#autofill();
    }, AUTOFILL_RENEW_MS);
    let response: unknown;
    try {
      const { options } = await this.api.switchPasskeyChallenge();
      if (!current()) return;
      this.#autofillWaiting = true;
      response = await startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
        useBrowserAutofill: true,
        // The email input is in this element's shadow root, which the library's query cannot see.
        verifyBrowserAutofillInput: false,
      });
    } catch {
      return;
    } finally {
      if (current()) this.#autofillWaiting = false;
    }
    if (!current()) return;
    this.#stopAutofill();
    this.usePasskey = true;
    this.#assertion = response;
    this.actionError = "";
    if (this.#choosesOnly) this.signInStep = "method";
    else void this.#previewCopy(false);
  }
  #stopAutofill(): void {
    this.#autofillAttempt += 1;
    this.#autofillOn = false;
    this.#renewDue = false;
    clearTimeout(this.#autofillTimer);
    this.#autofillTimer = undefined;
    if (this.#autofillWaiting) WebAuthnAbortService.cancelCeremony();
    this.#autofillWaiting = false;
  }
  #restartPolling(): void {
    this.#controller?.abort();
    clearTimeout(this.#timer);
    clearTimeout(this.#heldTimer);
    const controller = new AbortController();
    this.#controller = controller;
    if (this.operationId) void this.#poll(controller);
    else if (this.backupRestarting || this.followRestarting) void this.#waitForPlaced(controller);
  }
  override disconnectedCallback(): void {
    window.removeEventListener("pagehide", this.#leavePage);
    window.removeEventListener("pageshow", this.#restorePage);
    document.removeEventListener("visibilitychange", this.#visibilityChanged);
    this.#leavePage();
    super.disconnectedCallback();
  }
  #leavePage = (): void => {
    this.#left = true;
    this.#stopAutofill();
    this.#controller?.abort();
    clearTimeout(this.#timer);
    this.#mainCheckController?.abort();
    this.#mainCheckController = undefined;
    this.#stopSilentTicker();
    this.#resetSelection();
    this.password = this.code = "";
    this.#assertion = undefined;
    this.backup = undefined;
    this.backupKey = "";
    this.backupRestarting = this.followRestarting = this.restarting = false;
    clearTimeout(this.#heldTimer);
    this.following = this.heldOffered = this.heldWaiting = this.heldChosen = false;
    this.heldCopy = undefined;
    this.#signInChecked = false;
    this.copyPreview = this.controlledOperationId = undefined;
    this.preparing = this.proceeded = this.backupOpen = false;
    this.declarationSaved = false;
    this.declaredAtMs = undefined;
    this.reason = "";
    this.statements = {
      sourceSwitchedOff: false,
      noParallelRecovery: false,
      missingTailAccepted: false,
    };
    this.#pendingDeclaration = undefined;
  };
  async #poll(controller: AbortController): Promise<void> {
    try {
      const status = await this.api.handoverStatus(this.operationId, controller.signal);
      if (controller.signal.aborted) return;
      this.status = status;
      if (activated(status) || closed(status)) {
        this.restarting = false;
        this.#resetSelection();
        this.password = this.code = "";
        this.attempted = false;
      }
      this.readFailed = false;
    } catch {
      if (controller.signal.aborted) return;
      this.readFailed = true;
    }
    if (!controller.signal.aborted && !activated(this.status) && !closed(this.status)) {
      this.#timer = setTimeout(() => void this.#poll(controller), 2000);
    }
  }
  #startMainCheck(): void {
    this.mainCheck = "checking";
    this.switchStarted = false;
    void this.#checkMain().then((silent) => {
      if (silent && this.#explaining && this.#silentFor && this.isConnected)
        this.#startSilentTicker();
    });
  }
  /** Redraws the count of the main box's silence once a second while the explanation shows. */
  #startSilentTicker(): void {
    this.#stopSilentTicker();
    this.#silentTicker = setInterval(() => {
      if (this.#explaining) this.requestUpdate();
      else this.#stopSilentTicker();
    }, 1000);
  }
  #stopSilentTicker(): void {
    clearInterval(this.#silentTicker);
    this.#silentTicker = undefined;
  }
  async #startSwitching(): Promise<void> {
    this.switchStarted = true;
    this.#stopSilentTicker();
    await this.#focusHeading();
  }
  /**
   * True when the main server stayed silent and no later check, or leaving the page, replaced this
   * one. Any answer at all counts as the main server answering; a failure or the deadline lets the
   * page go on: a device that cannot trust or resolve the main server always lands here, and the
   * spare's own check still guards every step. When the result changes the page, focus moves to its
   * heading.
   */
  async #checkMain(): Promise<boolean> {
    this.#mainCheckController?.abort();
    const controller = new AbortController();
    this.#mainCheckController = controller;
    this.#silentFor = undefined;
    let limit: ReturnType<typeof setTimeout> | undefined;
    const serversUrl = await Promise.race([
      this.#askMain(controller.signal),
      new Promise<undefined>((resolve) => {
        limit = setTimeout(() => resolve(undefined), MAIN_CHECK_MS);
      }),
    ]);
    clearTimeout(limit);
    controller.abort();
    if (this.#mainCheckController !== controller) return false;
    const changesPage = this.mainCheck === "checking" || serversUrl !== undefined;
    this.mainCheck = serversUrl === undefined ? "clear" : { serversUrl };
    if (changesPage)
      void this.#focusHeading(() => this.isConnected && this.#mainCheckController === controller);
    return serversUrl === undefined;
  }
  /** The main server's Servers page when it answers; never rejects. */
  async #askMain(signal: AbortSignal): Promise<string | undefined> {
    try {
      const { mainUrl, silentForMs } = await this.api.mainServer(signal);
      if (!signal.aborted && silentForMs !== null)
        this.#silentFor = { ms: silentForMs, readAtMs: performance.now() };
      if (typeof mainUrl !== "string" || mainUrl === "") return undefined;
      const serversUrl = new URL("/servers", mainUrl).href;
      await this.api.probeMain(mainUrl, signal);
      return serversUrl;
    } catch {
      return undefined;
    }
  }
  #mainCheckContent(check: "checking" | { serversUrl: string }) {
    if (check === "checking")
      return html`<p>${t("handover.emergency.spare_intro")}</p>
        <p role="status">
          <wt-spinner decorative size="sm"></wt-spinner> ${t("handover.emergency.main_checking")}
        </p>`;
    return html`<p>${t("handover.emergency.main_answering_body")}</p>
      <div class="choices">
        <a class="button primary" data-test="go-back" href=${this.#leaveHref}
          >${t(this.#leaveLabel)}</a
        >
      </div>
      <details>
        <summary>${t("handover.emergency.still_move")}</summary>
        <p>${t("handover.emergency.still_move_body")}</p>
        <p><a href=${check.serversUrl}>${t("handover.emergency.main_servers")}</a></p>
        <wt-button
          data-test="main-check-again"
          variant="secondary"
          @click=${() => {
            this.#startMainCheck();
            void this.#focusHeading();
          }}
          >${t("handover.emergency.main_check_again")}</wt-button
        >
      </details>`;
  }
  #explanation() {
    const silent = this.#silentFor;
    const duration =
      silent && formatDuration(silent.ms + performance.now() - silent.readAtMs, currentLocale());
    return html`<p>
        ${duration ? html`${format("handover.emergency.silent_for", { duration })} ` : nothing}${t("handover.emergency.silent_copy")}
      </p>
      <h2>${t("handover.emergency.before_heading")}</h2>
      <p>${t("handover.emergency.before_body")}</p>
      <h2>${t("handover.emergency.what_heading")}</h2>
      <p>${t("handover.emergency.what_body")}</p>
      <div class="choices">
        <wt-button
          data-test="start-switching"
          variant="primary"
          @click=${() => void this.#startSwitching()}
          >${t("handover.emergency.start")}</wt-button
        >
        ${this.#goBackButton()}
      </div>`;
  }
  get #heading(): StringKey {
    const page = this.#page;
    if ((this.restarting && page !== "preparing") || activated(this.status) || closed(this.status))
      return "handover.heading";
    if (this.mainCheck === "checking") return "handover.emergency.checking_heading";
    if (this.mainCheck !== "clear") return "handover.emergency.main_answering";
    if (page === "preparing") return "handover.emergency.preparing_heading";
    if (page === "ready") return "handover.emergency.ready_heading";
    if (this.status?.scenario === "emergency" && !this.copyPreview)
      return "handover.emergency.switching_heading";
    if (this.#explaining) return "handover.emergency.silent_heading";
    return page === "sign-in" ? "handover.emergency.sign_in_heading" : "handover.heading";
  }
  #resetSelection(): void {
    this.entry?.clear();
    this.entry = undefined;
    this.activationHeld = false;
  }
  #signIn(): HandoverSignIn | undefined {
    if (this.usePasskey)
      return this.#assertion === undefined ? undefined : { passkey: this.#assertion };
    return {
      email: this.email.trim(),
      password: this.password,
      ...(this.code.trim() ? { totp: this.code.trim() } : {}),
    };
  }
  /**
   * With the passkey a step first leans on the proof cookie, which the page cannot read, and unlocks
   * once when the spare refuses. An answer uses up the passkey answer sent, except a take still
   * catching up, which signs nobody in.
   */
  async #step<T>(
    send: (signIn: HandoverSignIn | undefined) => Promise<T>,
    unlock = true,
  ): Promise<T> {
    try {
      const answer = await send(this.#signIn());
      if ((answer as Partial<FollowedCopyTake> | undefined)?.state !== "catching-up")
        this.#assertion = undefined;
      return answer;
    } catch (cause) {
      const code = (cause as { code?: unknown } | null)?.code;
      if (typeof code === "string") this.#assertion = undefined;
      if (!this.usePasskey || !unlock || !PROOF_REFUSALS.has(code as string)) throw cause;
      if (!this.#promptAllowed) throw new PasskeyNeedsPress();
    }
    try {
      const { options } = await this.api.switchPasskeyChallenge();
      if (this.#left) throw new PasskeyNotUsed();
      // Every call aborts the ceremony before it, so the field's offer must not renew over this one.
      this.#stopAutofill();
      this.#modalOpen = true;
      this.#assertion = await startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      });
    } catch {
      throw new PasskeyNotUsed();
    } finally {
      if (this.#modalOpen) this.requestUpdate();
      this.#modalOpen = false;
    }
    return this.#step(send, false);
  }
  #valid(): boolean {
    return this.usePasskey || (this.#emailValid && this.password !== "");
  }
  /** The emergency sign-in checks an address as the dashboard's login does. */
  get #emailValid(): boolean {
    return this.#isEmergency ? isValidEmail(this.email) : this.email.includes("@");
  }
  /** Marks the fields and focuses the first one that fails; false means send nothing. */
  async #checked(): Promise<boolean> {
    this.attempted = true;
    if (this.#valid()) return true;
    await this.updateComplete;
    await focusFirstInvalid(this.shadowRoot!);
    return false;
  }
  async #authenticate(): Promise<void> {
    if (this.busy || (this.#isEmergency && this.copyRefused) || !(await this.#checked())) return;
    this.actionError = "";
    this.#resetSelection();
    this.#prepareClock();
  }
  #prepareClock(): void {
    const contribution = this.contributions.filter((item) => item.createPromotion);
    const status = this.status;
    if (
      contribution.length !== 1 ||
      !status ||
      (!status.copyPlaced && status.scenario !== "emergency")
    )
      return;
    const binding = {
      module: contribution[0]!.module,
      action: "promote",
      eventId: status.operationId,
      sourceId: status.sourceNodeId,
      targetNodeId: status.destinationNodeId,
    };
    // Each request reads the fields again: a code typed after a refusal carries on the same check.
    this.entry = contribution[0]!.createPromotion!({
      locale: currentLocale().startsWith("es") ? "es" : "en",
      scenario: this.#isEmergency ? "emergency" : "controlled",
      binding,
      timeZone: status.timeZone,
      prepare: async (proposal) => {
        // A press in the clock step sends its first request before the press reaches this page's
        // own click listener, which allows the prompt again; a check the step makes by itself
        // leaves it refused.
        if ((proposal as { action?: unknown } | null)?.action === "clock-challenge")
          this.#promptAllowed = false;
        if (!this.#valid()) {
          this.attempted = true;
          // ClockWait.settle takes a TypeError with no code as a lost request: during a wait the
          // entry keeps waiting and checks again at its next turn; a check the person pressed shows
          // the entry's failure. Nothing is sent either way.
          throw new TypeError("sign-in fields incomplete");
        }
        try {
          return await this.#step((signIn) =>
            this.api.prepareHandover(this.operationId, signIn, binding, proposal),
          );
        } catch (cause) {
          if (this.#isEmergency) this.actionError = this.#emergencyError(cause);
          throw cause;
        }
      },
    });
  }
  async #retry(): Promise<void> {
    if (!this.busy && (await this.#checked())) await this.#activate(true);
  }
  /** The button that asked for the start stays on screen, busy, until the start is answered. */
  async #activate(retry = false): Promise<void> {
    const entry = this.entry;
    const moduleOperation = entry?.readOperation();
    if (!entry || !moduleOperation || this.busy) return;
    if (!this.#valid()) {
      this.attempted = true;
      this.activationHeld = true;
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const controller = this.#controller;
    this.#promptAllowed = true;
    this.busy = true;
    this.actionError = "";
    this.activationHeld = false;
    this.retrying = retry;
    entry.starting = !retry;
    let refused = false;
    try {
      const answer = await this.#step((signIn) =>
        this.api.activateHandover(this.operationId, signIn, moduleOperation),
      );
      if (controller?.signal.aborted) return;
      this.restarting = answer.restarting;
      this.#resetSelection();
      this.password = this.code = "";
      this.attempted = false;
      this.#restartPolling();
    } catch (cause) {
      if (controller?.signal.aborted) return;
      refused = true;
      this.actionError = this.#isEmergency
        ? this.#emergencyError(cause)
        : entry.refusalMessage(cause);
      if ((cause as { code?: unknown } | null)?.code === "password.invalid") {
        this.activationHeld = true;
        return;
      }
      this.#resetSelection();
      if (
        this.#isEmergency &&
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "handover.copy_mismatch"
      ) {
        try {
          await this.#readPreview();
        } catch (failure) {
          this.actionError = this.#emergencyError(failure);
        }
      }
      this.#restartPolling();
    } finally {
      this.busy = this.retrying = entry.starting = false;
      if (refused) void this.#focusNextAction();
    }
  }
  /**
   * The refused start's button is gone or idle again, so focus moves to the action now offered,
   * else the first field to fix, else the page heading, as when a copy has failed its check.
   */
  async #focusNextAction(): Promise<void> {
    await this.updateComplete;
    const root = this.shadowRoot!;
    const action = root.querySelector<HTMLElement>("wt-form-actions wt-button:not([disabled])");
    if (action) action.focus();
    else if (!(await focusFirstInvalid(root))) root.querySelector<HTMLElement>("h1")?.focus();
  }
  #emergencyError(cause: unknown): string {
    const error = cause as {
      code?: string;
      params?: { operationId?: string; sourceServersUrl?: string; reason?: string; min?: number };
    } | null;
    const code = error?.code;
    const serversUrl =
      code === "handover.source_still_answering"
        ? (error?.params?.sourceServersUrl ?? this.copyPreview?.sourceServersUrl)
        : undefined;
    this.refusalLink =
      typeof error?.params?.operationId === "string"
        ? {
            href: `/handover/${encodeURIComponent(error.params.operationId)}`,
            label: "handover.emergency.progress",
          }
        : serversUrl
          ? { href: serversUrl, label: "handover.emergency.servers" }
          : undefined;
    this.copyRefused = [
      "handover.copy_damaged",
      "handover.chain_broken",
      "handover.copy_check_failed",
      "handover.copy_mismatch",
    ].includes(code ?? "");
    const key = this.#refusalKey(code, error, cause);
    if (SIGN_IN_REFUSAL_KEYS.has(key)) {
      this.#reopenSignIn();
      if (!this.copyPreview) this.preparing = false;
    }
    return t(key);
  }
  /** A refused sign-in is answered from the choice of method, the email kept. */
  #reopenSignIn(): void {
    this.signInOpen = true;
    this.signInStep = "method";
  }
  /** Where a later button sends the sign-in, a method is only chosen: Ready to switch and after. */
  get #choosesOnly(): boolean {
    const page = this.#page;
    return page === "ready" || (page === undefined && this.#isEmergency && !!this.copyPreview);
  }
  async #continueToMethod(): Promise<void> {
    if (!this.#emailValid) {
      this.attempted = true;
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.attempted = false;
    this.actionError = "";
    this.signInStep = "method";
    await this.updateComplete;
    this.shadowRoot!.querySelector<HTMLElement>("[data-test=sign-in-passkey]")?.focus();
  }
  async #changeEmail(): Promise<void> {
    this.signInStep = "email";
    this.password = this.code = "";
    this.#assertion = undefined;
    this.usePasskey = this.attempted = false;
    this.actionError = "";
    await this.updateComplete;
    this.shadowRoot!.querySelector<HTMLElement>('[name="handover-email"]')?.focus();
  }
  async #signInWithPasskey(): Promise<void> {
    this.usePasskey = true;
    this.#assertion = undefined;
    this.actionError = "";
    await this.#previewCopy();
  }
  /** Starts the step in the same turn as the press, so the page is busy before it redraws. */
  #signInWithPassword(): void {
    this.usePasskey = false;
    this.#assertion = undefined;
    this.actionError = "";
    if (this.#valid()) void this.#previewCopy();
    else void this.#checked();
  }
  #refusalKey(
    code: string | undefined,
    error: { params?: { reason?: string } } | null,
    cause: unknown,
  ): StringKey {
    if (cause instanceof PasskeyNeedsPress) return "handover.emergency.passkey_again";
    if (
      cause instanceof PasskeyNotUsed ||
      (this.usePasskey &&
        [...PROOF_REFUSALS, "passkey.not_registered", "passkey.verification_failed"].includes(
          code ?? "",
        ))
    )
      return "handover.emergency.passkey_failed";
    if (code === "password.invalid" && this.code && this.#signInChecked)
      return "handover.emergency.code_expired";
    if (code === "password.invalid" || code === "totp.required")
      return "handover.emergency.sign_in_failed";
    if (code === "password.throttled") return "handover.emergency.throttled";
    if (code === "node.operation_page_required") return "handover.emergency.connection";
    if (code === "authorization.not_permitted") return "handover.emergency.permission";
    if (code === "handover.source_still_answering") return "handover.emergency.source_answered";
    if (code === "handover.controlled_unresolved") return "handover.emergency.controlled";
    if (code === "handover.copy_predates_destination") return "handover.emergency.backup_too_old";
    if (code === "restore.archive_resource_limit") return "shell.restore.archive_resource_limit";
    if (code === "restore.manifest_invalid")
      return error?.params?.reason === "unsupported"
        ? "shell.restore.manifest_unsupported"
        : "shell.restore.manifest_invalid";
    if (code === "handover.backup_key_missing") return "handover.emergency.backup_key_missing";
    if (code === "backup.new_recovery_key_too_short")
      return "handover.emergency.backup_key_too_short";
    if (
      ["recovery.passphrase_invalid", "backup.artifact_invalid", "backup.archive_invalid"].includes(
        code ?? "",
      )
    )
      return "handover.emergency.backup_invalid";
    if (this.copyRefused)
      return this.#declared
        ? "handover.emergency.copy_failed"
        : this.#offersOtherCopy
          ? "handover.emergency.copy_unchecked"
          : "handover.emergency.copy_unchecked_only";
    if (
      ["node.read_only", "handover.source_no_longer_main", "handover.step_out_of_order"].includes(
        code ?? "",
      )
    )
      return "handover.emergency.changed";
    if (code === "handover.source_not_established" || code === "handover.peer_unknown")
      return "handover.emergency.trust";
    return "handover.emergency.failed";
  }
  async #resume(operationId: string): Promise<void> {
    const controller = this.#controller;
    this.operationId = operationId;
    this.declarationSaved = true;
    const back = this.#back;
    history.replaceState(
      null,
      "",
      `/handover/${encodeURIComponent(operationId)}${back ? `?back=${encodeURIComponent(back)}` : ""}`,
    );
    try {
      const status = await this.api.handoverStatus(operationId, controller?.signal);
      if (controller?.signal.aborted) return;
      this.status = status;
      if (activated(status) || closed(status)) {
        this.#resetSelection();
        this.password = this.code = "";
        this.attempted = false;
      }
      this.readFailed = false;
    } catch {
      if (!controller?.signal.aborted) this.readFailed = true;
    }
    if (!controller?.signal.aborted) this.#restartPolling();
  }
  async #readPreview(unlock = true): Promise<boolean> {
    const controller = this.#controller;
    const preview = await this.#step((signIn) => this.api.previewEmergencyHandover(signIn), unlock);
    if (controller?.signal.aborted) return false;
    return this.#showPreview(preview);
  }
  async #showPreview(preview: EmergencyHandoverPreview): Promise<boolean> {
    this.copyPreview = preview;
    this.controlledOperationId =
      preview.operation?.reason === null ? preview.operation.operationId : undefined;
    this.signInOpen = false;
    this.#signInChecked = true;
    this.copyRefused = false;
    this.refusalLink = undefined;
    if (preview.operation !== null && preview.operation.reason !== null) {
      this.reason = preview.operation.reason;
      await this.#resume(preview.operation.operationId);
      return true;
    }
    return false;
  }
  /**
   * A saved declaration and a placed backup show; otherwise the take decides, signing in against the
   * copy it takes, which may know a person the copy this spare holds does not.
   */
  async #previewCopy(pressed = true): Promise<void> {
    if (this.busy || this.following || this.heldWaiting || !this.#valid()) return;
    this.#promptAllowed = pressed;
    if (this.#controller?.signal.aborted) this.#restartPolling();
    const controller = this.#controller!;
    this.busy = true;
    this.actionError = "";
    this.heldOffered = this.heldChosen = false;
    if (!this.preparing && !this.#declared) {
      this.preparing = true;
      void this.#focusHeading();
    }
    this.copyStep = "follow";
    this.proceeded = false;
    try {
      if (this.#checksMain && !(await this.#checkMain())) return;
      let preview: EmergencyHandoverPreview | undefined;
      try {
        preview = await this.#step((signIn) => this.api.previewEmergencyHandover(signIn));
      } catch (cause) {
        if (!HELD_SIGN_IN_REFUSALS.has((cause as { code?: string } | null)?.code ?? ""))
          throw cause;
      }
      if (controller.signal.aborted) return;
      if (preview?.operation != null || preview?.copy.source === "selected-backup") {
        await this.#showPreview(preview);
        return;
      }
      this.heldCopy = preview;
      this.#signInChecked = preview !== undefined;
      this.busy = false;
      this.following = true;
      this.#heldTimer = setTimeout(() => {
        if (!controller.signal.aborted && this.following) this.heldOffered = true;
      }, HELD_OFFER_AFTER_MS);
      await this.#takeFollowed(controller, true);
    } catch (cause) {
      if (!controller.signal.aborted) this.actionError = this.#emergencyError(cause);
    } finally {
      this.busy = false;
    }
  }
  async #takeFollowed(controller: AbortController, unlock = false): Promise<void> {
    let answer: FollowedCopyTake;
    try {
      answer = await this.#step((signIn) => this.api.takeFollowedCopy(signIn), unlock);
    } catch (cause) {
      if (controller.signal.aborted) return;
      this.following = this.heldOffered = false;
      clearTimeout(this.#heldTimer);
      const code = (cause as { code?: string } | null)?.code ?? "";
      const refusal = FOLLOWED_REFUSALS[code];
      if (refusal === undefined) {
        this.actionError = this.#emergencyError(cause);
        // A retry while catching up resends the passkey answer, whose challenge lasts two minutes.
        if (!unlock && code === "passkey.challenge_expired") {
          this.actionError = t("handover.emergency.passkey_lapsed");
          this.#reopenSignIn();
          this.preparing = false;
        }
      } else {
        this.actionError = t(refusal);
        this.heldWaiting = true;
        this.#timer = setTimeout(() => void this.#waitForHeld(controller), 2000);
      }
      return;
    }
    if (controller.signal.aborted) return;
    if (answer.state === "catching-up") {
      this.#timer = setTimeout(() => void this.#takeFollowed(controller), 2000);
      return;
    }
    clearTimeout(this.#heldTimer);
    this.following = this.heldOffered = false;
    this.copyStep = "check";
    if (answer.state === "taken") {
      this.busy = true;
      try {
        await this.#readPreview();
      } catch (cause) {
        if (!controller.signal.aborted) this.actionError = this.#emergencyError(cause);
      } finally {
        if (!controller.signal.aborted) this.busy = false;
      }
      return;
    }
    this.followRestarting = this.restarting = true;
    this.#restartPolling();
  }
  /** Lost answers while the box restarts are retried; any other answer ends the wait. */
  async #waitForHeld(controller: AbortController): Promise<void> {
    try {
      const preview = await this.#step(
        (signIn) => this.api.previewEmergencyHandover(signIn),
        false,
      );
      if (controller.signal.aborted) return;
      this.heldWaiting = false;
      if (preview.operation === null && preview.copy.source !== "selected-backup") {
        this.heldCopy = preview;
        this.heldOffered = true;
      } else await this.#showPreview(preview);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if ((cause as { code?: unknown } | null)?.code === undefined) {
        this.#timer = setTimeout(() => void this.#waitForHeld(controller), 2000);
        return;
      }
      this.heldWaiting = false;
      // A refusal of the passkey path's sign-in leaves the take's explanation in place.
      if (this.usePasskey && PROOF_REFUSALS.has(String((cause as { code: unknown }).code))) {
        if (this.heldCopy === undefined) {
          this.actionError = `${this.actionError} ${t("handover.emergency.held_passkey_refused")}`;
          this.#reopenSignIn();
          this.preparing = false;
        }
        return;
      }
      this.actionError = this.#emergencyError(cause);
    }
  }
  #stopFollowing(): void {
    if (this.following || this.heldWaiting) this.#restartPolling();
    this.following = this.heldWaiting = false;
  }
  async #useHeldCopy(): Promise<void> {
    if (this.busy) return;
    this.#promptAllowed = true;
    this.#restartPolling();
    this.following = this.heldOffered = false;
    this.heldChosen = this.busy = true;
    this.copyStep = "check";
    this.actionError = "";
    await this.#readHeldCopy(this.#controller!, true);
  }
  /** The old process may still have answered the offer's check; a lost answer waits for the restart. */
  async #readHeldCopy(controller: AbortController, unlock = false): Promise<void> {
    try {
      await this.#readPreview(unlock);
      if (controller.signal.aborted) return;
      this.heldWaiting = this.busy = false;
    } catch (cause) {
      if (controller.signal.aborted) return;
      if ((cause as { code?: unknown } | null)?.code === undefined) {
        this.heldWaiting = true;
        this.busy = false;
        this.#timer = setTimeout(() => void this.#readHeldCopy(controller), 2000);
        return;
      }
      this.heldWaiting = this.busy = false;
      this.actionError = this.#emergencyError(cause);
    }
  }
  async #waitForPlaced(controller: AbortController): Promise<void> {
    try {
      const preview = await this.#step(
        (signIn) => this.api.previewEmergencyHandover(signIn),
        false,
      );
      if (controller.signal.aborted) return;
      // Until the restart places the copy, the old process may still answer with the one it held.
      if (
        preview.operation?.reason == null &&
        preview.copy.source !== (this.followRestarting ? "followed-copy" : "selected-backup")
      )
        throw new TypeError("copy not placed");
      this.backupRestarting = this.followRestarting = this.restarting = this.busy = false;
      await this.#showPreview(preview);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const code = (cause as { code?: string }).code;
      if (code && code !== "handover.copy_mismatch") {
        this.actionError = this.#emergencyError(cause);
        this.backupRestarting = this.followRestarting = this.restarting = this.busy = false;
        return;
      }
      this.#timer = setTimeout(() => void this.#waitForPlaced(controller), 2000);
    }
  }
  async #selectBackup(): Promise<void> {
    if (this.busy || !this.backup || !this.#valid() || (this.needsBackupKey && !this.backupKey))
      return;
    this.#stopFollowing();
    this.#promptAllowed = true;
    this.busy = true;
    this.actionError = "";
    try {
      const backup = this.backup;
      await this.#step((signIn) =>
        this.api.selectEmergencyBackup(backup, signIn, this.backupKey || undefined),
      );
      this.backup = undefined;
      this.backupKey = "";
      this.copyPreview = undefined;
      this.copyStep = "check";
      this.backupOpen = this.proceeded = false;
      this.#pendingDeclaration = undefined;
      this.statements = {
        sourceSwitchedOff: false,
        noParallelRecovery: false,
        missingTailAccepted: false,
      };
      this.backupRestarting = this.restarting = true;
      this.#restartPolling();
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      if (code === "handover.backup_key_missing" || code === "recovery.passphrase_invalid")
        this.needsBackupKey = true;
      this.actionError = this.#emergencyError(cause);
      this.busy = false;
    }
  }
  #validDeclaration(): boolean {
    return (
      this.#valid() &&
      this.reason.trim() !== "" &&
      this.reason.length <= 500 &&
      Object.values(this.statements).every(Boolean)
    );
  }
  async #declareEmergency(): Promise<void> {
    if (this.busy || !this.#validDeclaration() || this.copyRefused) return;
    this.#promptAllowed = true;
    this.busy = true;
    this.actionError = "";
    // A copy refusal the switch request itself answered saved nothing; one from a check of the copy
    // afterwards may be of a switch already saved, so it never sends the person back to choose a copy.
    let switchRefused = false;
    try {
      if (this.#checksMain && !(await this.#checkMain())) return;
      if (this.#pendingDeclaration && (await this.#readPreview())) {
        this.#prepareClock();
        return;
      }
      this.#pendingDeclaration ??= {
        operationId: makeSetupId(),
        expectedCopy: this.copyPreview!.copy,
        reason: this.reason,
        locale: currentLocale().startsWith("es") ? "es" : "en",
        statements: {
          sourceSwitchedOff: true,
          noParallelRecovery: true,
          missingTailAccepted: true,
        },
      };
      const declaration = this.#pendingDeclaration;
      const answer = await this.#step((signIn) =>
        this.api.declareEmergencyHandover({ ...declaration, signIn }),
      ).catch((cause: unknown) => {
        switchRefused = typeof (cause as { code?: unknown } | null)?.code === "string";
        throw cause;
      });
      this.declaredAtMs = answer.declaration.body.declaredAtMs;
      this.signInOpen = false;
      await this.#resume(this.#pendingDeclaration.operationId);
      if (this.isConnected) this.#prepareClock();
    } catch (cause) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "handover.copy_mismatch" &&
        switchRefused
      ) {
        this.#backToPreparing();
        try {
          await this.#readPreview();
          this.actionError = t("handover.emergency.copy_changed");
        } catch (failure) {
          this.actionError = this.#emergencyError(failure);
        }
        return;
      }
      if (typeof cause !== "object" || cause === null || !("code" in cause)) {
        try {
          if (await this.#readPreview()) {
            this.#prepareClock();
            return;
          }
        } catch (failure) {
          this.actionError = this.#emergencyError(failure);
        }
      }
      if (!this.actionError) this.actionError = this.#emergencyError(cause);
      if (this.copyRefused && this.#offersOtherCopy) {
        if (switchRefused) this.#backToPreparing();
        else this.actionError = t("handover.emergency.copy_unchecked_only");
      }
    } finally {
      this.busy = false;
    }
  }
  /** The copy is to be checked again, or replaced, so its facts and the statements are asked anew. */
  #backToPreparing(): void {
    this.copyPreview = undefined;
    this.#pendingDeclaration = undefined;
    this.statements = {
      sourceSwitchedOff: false,
      noParallelRecovery: false,
      missingTailAccepted: false,
    };
    this.proceeded = false;
    void this.#focusHeading();
  }
  #joinedLine(preview: EmergencyHandoverPreview) {
    return html`<p>
      ${
        preview.joinedAtMs === null
          ? t("handover.emergency.held_undated")
          : format("handover.emergency.held_joined", {
              joined: new Date(preview.joinedAtMs).toLocaleString(currentLocale()),
            })
      }
    </p>`;
  }
  /** What the copy holds, and for a copy from the main box, when this spare joined it. */
  #copyLines(preview: EmergencyHandoverPreview) {
    if (preview.copy.source === "mirror-copy")
      return html`${this.#joinedLine(preview)}${this.#activityLine(preview.copy.lastChangeAtMs)}`;
    return html`${this.#activityLine(preview.copy.lastChangeAtMs)}${
      preview.copy.source === "followed-copy" && preview.joinedAtMs !== null
        ? html`<p>
            ${format("handover.emergency.spare_joined", {
              joined: new Date(preview.joinedAtMs).toLocaleString(currentLocale()),
            })}
          </p>`
        : nothing
    }`;
  }
  #activityLine(date: number | null) {
    return html`<p>
      ${date === null ? t("handover.emergency.no_date") : html`<strong>${t("handover.emergency.latest_activity")}</strong> ${new Date(date).toLocaleString(currentLocale())}`}
    </p>`;
  }
  #copyHeading(preview: EmergencyHandoverPreview): StringKey {
    return preview.copy.source === "selected-backup"
      ? "handover.emergency.selected_backup"
      : preview.copy.source === "followed-copy" && !this.heldChosen
        ? "handover.emergency.followed"
        : "handover.emergency.copy";
  }
  /** After Switch: the switch is saved, and what was declared folds behind Details. */
  #emergencyContent() {
    const preview = this.copyPreview;
    if (!preview) return nothing;
    const declaredAt = this.declaredAtMs ?? preview.operation?.declaredAtMs;
    return html`<section data-test="emergency-copy">
      <h2>${t(this.#copyHeading(preview))}</h2>
      <p>${t("handover.emergency.saved")}</p>
      <details data-test="emergency-details">
        <summary>${t("handover.emergency.details")}</summary>
        ${this.#copyLines(preview)}
        <p><a href=${preview.sourceServersUrl}>${t("handover.emergency.servers")}</a></p>
        <p>${this.reason}</p>
        ${declaredAt ? html`<p>${t("handover.emergency.declared_at")} ${new Date(declaredAt).toLocaleString(currentLocale())}</p>` : nothing}
      </details>
    </section>`;
  }
  /**
   * The sign-in: on a controlled handover email, password and code together; on an emergency switch
   * the email first, then how to sign in. `inline` adds the step's own button where the sign-in
   * reopens inside a later page; from Ready to switch on, the method is only chosen there.
   */
  #signInFields(inline = false) {
    const field = (
      name: "email" | "password" | "code",
      key: "handover.email" | "handover.password" | "handover.code",
    ) =>
      html`<wt-input
        name=${`handover-${name}`}
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        label=${t(key)}
        type=${name === "password" ? "password" : name === "email" ? "email" : "text"}
        .passwordVisibility=${name === "password" ? passwordVisibility() : undefined}
        autocomplete=${name === "code" ? "one-time-code" : name === "email" ? (this.#isEmergency && this.#emailStep ? "username webauthn" : "username") : "current-password"}
        .value=${this[name]}
        ?required=${name !== "code"}
        ?disabled=${this.busy}
        .error=${this.#fieldError(name)}
        @keydown=${(event: KeyboardEvent) => {
          if (this.#isEmergency)
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>(
                `[data-test=${name === "email" && this.#emailStep ? "emergency-preview" : "sign-in-password"}]`,
              ),
            );
        }}
        @focusout=${() => {
          if (!this.#renewDue) return;
          this.#stopAutofill();
          this.requestUpdate();
        }}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (name !== "code") this.#signInChecked = false;
          if (name === "email") this.#resetSelection();
          if (name === "email" && event.detail.value !== this.email) {
            this.password = this.code = "";
            this.copyPreview = this.heldCopy = this.controlledOperationId = undefined;
            this.heldOffered = this.following = this.heldWaiting = this.heldChosen = false;
            this.preparing = this.proceeded = false;
            this.declarationSaved = false;
            this.declaredAtMs = undefined;
            this.reason = "";
            this.statements = {
              sourceSwitchedOff: false,
              noParallelRecovery: false,
              missingTailAccepted: false,
            };
            this.#pendingDeclaration = undefined;
            this.#restartPolling();
          }
          this[name] = event.detail.value;
          this.actionError = "";
        }}
      ></wt-input>`;
    if (!this.#isEmergency)
      return html`<p>${t("handover.sign_in")}</p>
        ${field("email", "handover.email")}${field("password", "handover.password")}${field("code", "handover.code")}`;
    if (this.#emailStep) {
      this.#emailStepDrawn = true;
      return html`<p>${t("handover.emergency.sign_in")}</p>
        ${field("email", "handover.email")}
        ${inline ? html`<div class="choices">${this.#signInSubmit()}</div>` : nothing}`;
    }
    // A passkey picked from the field names no email, which only the password needs.
    const email = this.#emailValid
      ? html`<p data-test="sign-in-email">
          ${this.email} ·
          <wt-button
            variant="link"
            data-test="change-email"
            aria-label=${t("handover.emergency.change_email_label")}
            ?disabled=${this.busy}
            @click=${() => void this.#changeEmail()}
            >${t("handover.emergency.change_email")}</wt-button
          >
        </p>`
      : field("email", "handover.email");
    // Without it a password manager may fill another saved login's password (dashboard, #934).
    const username = this.#emailValid
      ? html`<input
          class="autofill-username"
          name="username"
          type="email"
          autocomplete="username"
          .value=${this.email}
          tabindex="-1"
          aria-hidden="true"
          readonly
        />`
      : nothing;
    const password = html`${username}${field("password", "handover.password")}${field("code", "handover.code")}`;
    if (this.#choosesOnly)
      return html`${this.usePasskey && !this.#emailValid ? nothing : email}
        <wt-segmented-control
          name="handover-sign-in-method"
          label=${t("handover.emergency.sign_in_with")}
          .value=${this.usePasskey ? "passkey" : "password"}
          .options=${[
            { value: "password", label: t("handover.emergency.use_password") },
            { value: "passkey", label: t("handover.emergency.use_passkey") },
          ]}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.usePasskey = event.detail.value === "passkey";
            this.#assertion = undefined;
            this.actionError = "";
          }}
        ></wt-segmented-control>
        ${this.usePasskey ? nothing : password}`;
    return html`${email}
      <div class="choices">
        <wt-button
          data-test="sign-in-passkey"
          variant="primary"
          .disabled=${this.busy || this.following || this.heldWaiting}
          @click=${() => void this.#signInWithPasskey()}
          >${t("handover.emergency.use_passkey")}</wt-button
        >
      </div>
      ${password} ${inline ? html`<div class="choices">${this.#signInSubmit()}</div>` : nothing}`;
  }
  #fieldError(name: "email" | "password" | "code"): string {
    if (!this.attempted || name === "code") return "";
    if (name === "password") return this.password ? "" : t("handover.required");
    if (this.#emailValid) return "";
    return this.#isEmergency && this.email.trim() !== ""
      ? t("handover.email_invalid")
      : t("handover.required");
  }
  get #emailStep(): boolean {
    return this.signInStep === "email";
  }
  /** The emergency sign-in step's own button: Continue to the methods, or the password's. */
  #signInSubmit() {
    if (this.#emailStep)
      return html`<wt-button
        data-test="emergency-preview"
        .disabled=${this.busy || (this.attempted && !this.#emailValid)}
        variant="primary"
        @click=${() => void this.#continueToMethod()}
        >${t("handover.emergency.continue")}</wt-button
      >`;
    return html`<wt-button
      data-test="sign-in-password"
      variant="secondary"
      .disabled=${this.busy || this.following || this.heldWaiting || (this.attempted && !this.password)}
      @click=${() => this.#signInWithPassword()}
      >${t("handover.emergency.sign_in_password")}</wt-button
    >`;
  }
  get #formError(): string {
    return this.actionError
      ? this.actionError
      : this.reason.length > 500 ||
          (this.attempted &&
            (this.#isEmergency && this.#emailStep ? !this.#emailValid : !this.#valid()))
        ? t("handover.fix")
        : "";
  }
  #links() {
    return html`<p>
      ${this.refusalLink ? html`<a href=${this.refusalLink.href}>${t(this.refusalLink.label)}</a>` : nothing}
      ${this.#leaveLink()}
    </p>`;
  }
  #refusalLink() {
    return this.refusalLink
      ? html`<p><a href=${this.refusalLink.href}>${t(this.refusalLink.label)}</a></p>`
      : nothing;
  }
  #signInPage() {
    return html`${this.#signInFields()}${this.#signInChoices()}`;
  }
  /** The emergency sign-in's message and full-width buttons, laid out as Ready to switch is. */
  #signInChoices() {
    return html`${formMessage(this.#formError)}
      <div class="choices">${this.#signInSubmit()} ${this.#goBackButton()}</div>
      ${this.#refusalLink()}`;
  }
  #progressRow(name: "follow" | "check", label: StringKey, state: "done" | "working" | "waiting") {
    return html`<li data-test=${`step-${name}`} data-state=${state}>
      <span class="mark" aria-hidden="true"
        >${state === "done" ? "✓" : state === "working" ? html`<wt-spinner decorative size="sm"></wt-spinner>` : "–"}</span
      ><span
        ><span class="visually-hidden">${t(`handover.emergency.step_${state}`)} </span
        ><span class="label">${t(label)}</span></span
      >
    </li>`;
  }
  /** Preparing the venue: brings the copy up to date and checks it; then offers it, or a backup instead. */
  #preparingPage() {
    const preview = this.copyPreview;
    const working =
      this.busy || this.following || this.heldWaiting || this.restarting || this.backupRestarting;
    const followed = preview
      ? preview.copy.source === "followed-copy" && !this.heldChosen
      : !this.heldChosen && !this.backupRestarting;
    const followState =
      preview || this.copyStep === "check" ? "done" : working ? "working" : "waiting";
    const checkState = preview
      ? "done"
      : working && this.copyStep === "check"
        ? "working"
        : "waiting";
    const held = !preview && this.heldOffered ? this.heldCopy : undefined;
    const refused = !preview && !working && this.actionError !== "";
    const backupOffered =
      this.#offersOtherCopy && !this.backupOpen && !this.busy && !this.restarting;
    return html`<div role="status">
        <ol class="progress">
          ${followed ? this.#progressRow("follow", "handover.emergency.step_follow", followState) : nothing}
          ${this.#progressRow("check", "handover.emergency.step_check", checkState)}
        </ol>
      </div>
      ${
        this.restarting
          ? html`<p role="status">
              ${t(this.backupRestarting ? "handover.emergency.backup_restarting" : "handover.emergency.followed_restarting")}
            </p>`
          : nothing
      }
      ${this.heldWaiting ? html`<p role="status">${t("handover.emergency.held_waiting")}</p>` : nothing}
      ${
        held
          ? html`<section data-test="held-copy">
              ${this.following ? html`<p>${t("handover.emergency.still_catching_up")}</p>` : nothing}
              ${this.#copyLines(held)}
            </section>`
          : nothing
      }
      ${
        preview
          ? html`<section class="fact" data-test="emergency-copy">
              <h2>${t(this.#copyHeading(preview))}</h2>
              ${preview.copy.source === "mirror-copy" ? this.#joinedLine(preview) : nothing}
              ${this.#activityLine(preview.copy.lastChangeAtMs)}
            </section>`
          : nothing
      }
      ${this.#controlledLink()} ${preview && this.signInOpen ? this.#signInFields(true) : nothing}
      ${this.backupOpen ? this.#backupFields() : nothing} ${formMessage(this.#formError)}
      <div class="choices">
        ${
          this.backup
            ? html`<wt-button
                data-test="emergency-backup"
                .disabled=${this.busy || !this.#valid() || (this.needsBackupKey && !this.backupKey)}
                variant=${this.#valid() && (!this.needsBackupKey || this.backupKey) ? "primary" : "secondary"}
                @click=${() => void this.#selectBackup()}
                >${t("handover.emergency.use_backup")}</wt-button
              >`
            : nothing
        }
        ${
          held
            ? html`<wt-button
                data-test="emergency-held"
                .disabled=${this.busy}
                variant=${this.backup ? "secondary" : "primary"}
                @click=${() => void this.#useHeldCopy()}
                >${t("handover.emergency.use_held")}</wt-button
              >`
            : nothing
        }
        ${
          preview
            ? html`<wt-button
                data-test="proceed"
                .disabled=${working || this.copyRefused}
                variant=${working || this.backup || this.copyRefused ? "secondary" : "primary"}
                @click=${() => {
                  this.proceeded = true;
                  this.actionError = "";
                  void this.#focusHeading();
                }}
                >${t("handover.emergency.proceed")}</wt-button
              >`
            : refused
              ? html`<wt-button
                  data-test="emergency-preview"
                  .disabled=${!this.#valid()}
                  variant=${this.#valid() && !this.backup && !held ? "primary" : "secondary"}
                  @click=${() => void this.#previewCopy()}
                  >${t("handover.try_again")}</wt-button
                >`
              : nothing
        }
        ${this.#goBackButton()}
      </div>
      ${
        backupOffered
          ? html`<p>
              <wt-button
                variant="link"
                data-test="upload-backup"
                @click=${async () => {
                  this.backupOpen = true;
                  await this.updateComplete;
                  this.shadowRoot!.querySelector<HTMLElement>('[name="handover-backup"]')?.focus();
                }}
                >${t("handover.emergency.upload_backup")}</wt-button
              >
            </p>`
          : nothing
      }
      <p class="note">${t("handover.emergency.keep_open")}</p>
      ${this.#refusalLink()}`;
  }
  #backupFields() {
    return html`<p>${t("handover.emergency.backup_intro")}</p>
      <wt-file-input
        name="handover-backup"
        label=${t("handover.emergency.backup_file")}
        .files=${this.backup ? [this.backup] : []}
        .copy=${fileInputCopy()}
        .locale=${currentLocale()}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
          event.stopPropagation();
          this.backup = event.detail.files[0];
          this.actionError = "";
        }}
      ></wt-file-input>
      ${
        this.needsBackupKey
          ? html`<wt-input
              name="handover-backup-key"
              type="password"
              label=${t("handover.emergency.backup_key")}
              required
              .value=${this.backupKey}
              ?disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                this.backupKey = event.detail.value;
                this.actionError = "";
              }}
            ></wt-input>`
          : nothing
      }`;
  }
  #controlledLink() {
    const operationId = this.controlledOperationId;
    return operationId === undefined
      ? nothing
      : html`<p>
          <a href=${`/handover/${encodeURIComponent(operationId)}`}
            >${t("handover.emergency.controlled_link")}</a
          >
        </p>`;
  }
  #goBackButton() {
    return html`<a class="button" data-test="go-back" href=${this.#leaveHref}
      >${t(this.#declared ? "handover.emergency.leave_saved" : this.#leaveLabel)}</a
    >`;
  }
  /** Ready to switch: the statements and the reason the switch records, then Switch to this box. */
  #readyPage() {
    return html`<section data-test="emergency-ready" data-wording-version="a1018-emergency-v2">
        ${this.#signInShown ? this.#signInFields(true) : nothing} ${this.#controlledLink()}
        <div class="statements">
          ${(["sourceSwitchedOff", "noParallelRecovery", "missingTailAccepted"] as const).map(
            (key) =>
              html`<label
                ><input
                  type="checkbox"
                  name=${key}
                  required
                  .checked=${this.statements[key]}
                  ?disabled=${this.busy || !!this.#pendingDeclaration}
                  @change=${(event: Event) => {
                    this.statements = {
                      ...this.statements,
                      [key]: (event.currentTarget as HTMLInputElement).checked,
                    };
                  }}
                /><span
                  >${t(`handover.emergency.${key}`)} <span aria-hidden="true">*</span></span
                ></label
              >`,
          )}
        </div>
        <wt-textarea
          name="emergency-reason"
          label=${t("handover.emergency.reason")}
          required
          .value=${this.reason}
          ?disabled=${this.busy || !!this.#pendingDeclaration}
          .error=${this.reason.length > 500 ? t("handover.emergency.reason_long") : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.reason = event.detail.value;
          }}
        ></wt-textarea>
      </section>
      ${formMessage(this.#formError)}
      <div class="choices">
        <wt-button
          data-test="emergency-declare"
          .disabled=${this.busy || !this.#validDeclaration() || this.copyRefused}
          variant=${this.#validDeclaration() && !this.copyRefused ? "danger" : "secondary"}
          @click=${() => void this.#declareEmergency()}
          >${t("handover.emergency.declare")}</wt-button
        >
        ${this.#goBackButton()}
      </div>
      ${this.#refusalLink()}`;
  }
  #fields() {
    const page = this.#page;
    if (page === "sign-in") return this.#signInPage();
    if (page === "preparing") return this.#preparingPage();
    if (page === "ready") return this.#readyPage();
    const reopened = this.#isEmergency && !this.copyPreview;
    if (reopened)
      return html`<p>${t("handover.emergency.switching_body")}</p>
        ${this.#signInShown ? this.#signInFields() : nothing} ${this.#signInChoices()}`;
    return html` ${this.#signInShown ? this.#signInFields(this.#isEmergency) : nothing}
      ${this.#isEmergency ? this.#emergencyContent() : nothing}
      ${
        this.entry
          ? html`<p>${t("handover.zone")}</p>
              ${this.entry}
              ${this.busy ? html`<p role="status">${t("handover.starting")}</p>` : nothing}`
          : nothing
      }
      <wt-form-actions .error=${this.#formError}>
        ${
          this.entry
            ? this.activationHeld || this.retrying
              ? html`<wt-button
                  data-test="retry-activation"
                  .disabled=${!this.busy && !this.#valid()}
                  ?loading=${this.busy}
                  variant="primary"
                  @click=${() => void this.#retry()}
                  >${t("handover.try_again")}</wt-button
                >`
              : nothing
            : html`<wt-button
                data-test="authenticate"
                .disabled=${this.busy || (this.attempted && !this.#valid()) || (this.#isEmergency && (this.copyRefused || !this.status))}
                variant=${this.busy || (this.#isEmergency && (this.copyRefused || !this.status)) ? "secondary" : "primary"}
                @click=${() => void this.#authenticate()}
                >${t("handover.compare")}</wt-button
              >`
        }
      </wt-form-actions>
      ${this.#isEmergency ? this.#links() : nothing}`;
  }
  #content() {
    const status = this.status;
    if (activated(status))
      return html`<p role="status">${t("handover.done")}</p>
        <a href=${this.#leaveHref}>${t("handover.continue")}</a>`;
    if (closed(status)) return html`<p role="status">${t("handover.closed")}</p>`;
    if (this.restarting && this.#page !== "preparing")
      return html`<p role="status">
        ${t(this.backupRestarting ? "handover.emergency.backup_restarting" : this.followRestarting ? "handover.emergency.followed_restarting" : "handover.restarting")}
      </p>`;
    if (this.mainCheck !== "clear") return this.#mainCheckContent(this.mainCheck);
    if (this.#explaining) return this.#explanation();
    if (
      this.#isEmergency ||
      (status?.role === "destination" && status.copyPlaced && status.scenario === "controlled")
    )
      return this.#fields();
    return html`<p role="status">${t(status ? "handover.copy" : "handover.loading")}</p>`;
  }
  override render() {
    this.#emailStepDrawn = false;
    const status = this.status;
    return html`<main
      lang=${currentLocale()}
      @click=${(event: Event) => {
        const entry = this.entry;
        const path = event.composedPath();
        if (
          entry &&
          path.includes(entry) &&
          path.some((node) => (node as Element).localName === "wt-button")
        )
          this.#promptAllowed = true;
      }}
      @recovery-edit-details=${(event: Event) => {
        event.stopPropagation();
        this.#resetSelection();
      }}
      @promotion-change=${() => {
        if (!this.activationHeld && this.entry?.readOperation()) void this.#activate();
      }}
    >
      <h1 tabindex="-1">${t(this.#heading)}</h1>
      ${this.#content()}
      ${status?.waitingReason ? html`<p role="status">${t(status.waitingReason === "storage.disk_full" || status.waitingReason === "handover.no_room_to_place" ? "handover.space" : status.waitingReason === "handover.source_unreachable" ? "handover.source" : status.waitingReason === "handover.copy_check_failed" ? "handover.check_failed" : "handover.wait")}</p>` : nothing}
      ${status?.waitingReason === "handover.copy_check_failed" ? html`<p><a href=${`/help/${currentLocale().startsWith("es") ? "es" : "en"}/servers#emergency`}>${t("handover.check_help")}</a></p>` : nothing}
      ${this.readFailed && !this.restarting ? html`<p role="status">${t("handover.read_failed")}</p>` : nothing}
    </main>`;
  }
}
