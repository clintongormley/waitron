import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi } from "../api/client.js";
import {
  forgetLoginPreference,
  readLoginPreference,
  prepareGoogleLoginPreference,
} from "../login-preference.js";
// The pre-login language chooser (per-user-language-preference). It emits a composed `locale-selected`;
// `dashboard-app` turns a pre-login pick into a transient `setLocale` (nothing is persisted).
import "../widgets/language-chooser.js";

interface CompletedLogin {
  personId: string;
  accountSetup: boolean;
  loginMethod: "password";
  rememberEmail: boolean;
  rememberedEmail?: string;
}

type AccountActionPurpose = "invitation" | "password_reset";

function actionPurposeFromUrl(): AccountActionPurpose | null {
  const purpose = new URLSearchParams(window.location.search).get("purpose");
  return purpose === "invitation" || purpose === "password_reset" ? purpose : null;
}

function actionEmailFromUrl(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get("email") ?? "";
}

/**
 * The dashboard's pre-session login screen. It asks for the account email first, then presents the
 * password step. Device prompts require an explicit passkey action; cancellation returns to password.
 *
 * It talks to the world through one injected `api` (`@property({ attribute: false })`) and one
 * event: after a successful login it dispatches `logged-in` with the authenticated person and the
 * selected preference. It bubbles across the shadow boundary so the app shell hears it. A rejected login sets
 * `errorKey` from the thrown `{ code }` (falling back to `server.internal`); the raw code is kept in
 * state, and `codeMessage` (`../i18n/codes.js`) maps it to localised copy at the render edge. The
 * shared form summary announces that sentence and never exposes the raw wire code.
 */
@customElement("dashboard-login-screen")
export class LoginScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        max-width: 30rem;
        margin-inline: auto;
      }

      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .login-context {
        color: var(--wt-color-text-muted);
      }

      .login-context {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-block: var(--wt-space-4);
      }
      .login-context strong {
        display: block;
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
      }
      a {
        color: var(--wt-color-text);
      }
      a[aria-disabled="true"] {
        opacity: 0.6;
      }
      wt-form-actions {
        margin-top: var(--wt-space-4);
      }

      .notice {
        color: var(--wt-color-text);
      }

      .remember-choice {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-4);
      }

      .password-toggle svg {
        display: block;
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
        fill: none;
        stroke: currentColor;
      }

      .other-way {
        margin-top: var(--wt-space-4);
      }

      .alternative-list {
        margin-block: var(--wt-space-4);
        padding-inline-start: var(--wt-space-6);
      }
      .alternative-list li {
        margin-block: var(--wt-space-2);
      }

      .alternative-hint {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* Keep the username in split password forms for password managers without adding another
         visible or keyboard-focusable control to the step. */
      .autofill-username {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) navigate: (url: string) => void = (url) =>
    window.location.assign(url);
  @property({ attribute: false }) noticeCode: string | null = null;
  private readonly rememberedLogin = new URLSearchParams(window.location.search).has("token")
    ? null
    : readLoginPreference();
  @state() private busy = false;
  @state() private email = actionEmailFromUrl() || this.rememberedLogin?.email || "";
  @state() private password = "";
  @state() private secondFactor = "";
  @state() private factorMode: "totp" | "recovery" = "totp";
  @state() private pin = "";
  @state() private step:
    "email" | "passkey" | "password" | "google" | "factor" | "reset-sent" | "setup-passkey" =
    this.rememberedLogin?.method ?? "email";
  private rememberedEmail = this.rememberedLogin?.email;
  private offerAfterLogin = false;
  private completedLogin: CompletedLogin | null = null;
  @state() private passkeyName = "";
  @state() private passkeyNameError = "";
  @state() private passkeyFactorRequired = false;
  @state() private rememberEmail = this.rememberedLogin?.persistent ?? false;
  @state() private passwordVisible = false;
  @state() private newPasswordVisible = false;
  @state() private pinVisible = false;
  @state() private token: string | null = new URLSearchParams(window.location.search).get("token");
  @state() private actionPurpose: AccountActionPurpose | null = actionPurposeFromUrl();
  @state() private actionValidated = false;
  @state() private actionResent = false;
  @state() private resetSeconds = 0;
  private readonly resetDeadlines = new Map<string, number>();
  private resetTimer?: ReturnType<typeof setInterval>;
  private passkeyAttempt = 0;
  @state() private errorKey: string | null = null;
  @state() private emailError = "";
  @state() private passwordError = "";
  @state() private secondFactorError = "";
  @state() private pinError = "";
  @state() private googleConfigured = false;
  @state() private privacyNoticeUrl = "";

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.token !== null && this.actionPurpose !== null) void this.#inspectAccountAction();
    else if (this.rememberedLogin === null) void this.#conditionalPasskeyLogin();
    else if (this.step === "password") this.#focusField("password");
    void this.api
      .getGoogleConfig()
      .then(({ configured, privacyNoticeUrl }) => {
        if (this.isConnected) {
          this.googleConfigured = configured;
          if (!configured && this.step === "google") this.#showPasswordStep();
          this.privacyNoticeUrl = privacyNoticeUrl ?? "";
        }
      })
      .catch(() => undefined);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.resetTimer);
    this.#cancelPasskeyCeremony();
    this.#clearSecrets();
    this.completedLogin = null;
  }

  #focusField(name: string): void {
    void this.updateComplete.then(() => {
      if (this.isConnected)
        this.shadowRoot?.querySelector<HTMLElement>(`wt-input[name=${name}]`)?.focus();
    });
  }

  #cancelPasskeyCeremony(): void {
    this.passkeyAttempt += 1;
    this.busy = false;
    WebAuthnAbortService.cancelCeremony();
  }

  #updateResetCountdown(): void {
    const deadline = this.resetDeadlines.get(this.email.trim().toLowerCase()) ?? 0;
    this.resetSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }

  private get formErrors(): string[] {
    return [
      ...new Set(
        [
          this.emailError,
          this.passwordError,
          this.secondFactorError,
          this.pinError,
          this.passkeyNameError,
          this.errorKey === null ? "" : codeMessage(this.errorKey),
        ].filter(Boolean),
      ),
    ];
  }

  /**
   * Capture the email field's new value. `wt-change` is dispatched `bubbles`+`composed`, so
   * `stopPropagation` is what stops it leaking past this screen's shadow boundary to the app shell.
   */
  #onEmailChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.email = event.detail.value;
    this.emailError = "";
  }

  /**
   * Capture the password field's new value. `wt-change` is dispatched `bubbles`+`composed`, so
   * `stopPropagation` is what stops it leaking past this screen's shadow boundary to the app shell
   * (Task 7) — the till's field handlers do the same.
   */
  #onPasswordChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.password = event.detail.value;
    this.passwordError = "";
  }

  #onSecondFactorChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.secondFactor = event.detail.value.trim();
    this.secondFactorError = "";
    this.errorKey = null;
  }

  #onPinChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.pin = event.detail.value;
    this.pinError = "";
  }

  #clearSecrets(): void {
    this.password = "";
    this.secondFactor = "";
    this.factorMode = "totp";
    this.pin = "";
    this.passwordVisible = false;
    this.newPasswordVisible = false;
    this.pinVisible = false;
    this.passwordError = "";
    this.secondFactorError = "";
    this.pinError = "";
    this.passkeyName = "";
    this.passkeyNameError = "";
    this.passkeyFactorRequired = false;
  }

  #submitAccountOnEnter(event: KeyboardEvent): void {
    submitOnEnter(
      event,
      this.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]"),
    );
  }

  #continue(): void {
    const email = this.email.trim();
    if (email === "") this.emailError = t("form.email_required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.emailError = codeMessage("person.email_invalid");
    }
    if (this.emailError !== "") return;
    this.email = email;
    this.errorKey = null;
    this.passwordVisible = false;
    // Public method selection never depends on server-side account enrolment.
    this.#showPasswordStep();
  }

  #showPasswordStep(): void {
    this.#cancelPasskeyCeremony();
    this.#clearSecrets();
    this.errorKey = null;
    this.step = "password";
    this.#focusField("password");
  }

  #cancelLogin(): void {
    forgetLoginPreference();
    this.#resetLoginForm();
  }

  #resetLoginForm(): void {
    this.#cancelPasskeyCeremony();
    this.email = "";
    this.rememberedEmail = undefined;
    this.offerAfterLogin = false;
    this.completedLogin = null;
    this.#clearSecrets();
    this.errorKey = null;
    this.emailError = "";
    this.rememberEmail = false;
    this.step = "email";
    this.#focusField("email");
    void this.#conditionalPasskeyLogin();
  }

  #cancelAccountAction(): void {
    this.token = null;
    this.actionPurpose = null;
    this.actionValidated = false;
    this.actionResent = false;
    if (new URLSearchParams(window.location.search).has("token")) {
      history.replaceState(null, "", "/manage/");
    }
    this.#resetLoginForm();
  }

  async #inspectAccountAction(): Promise<void> {
    if (this.busy || this.actionPurpose === null || this.token === null) return;
    this.busy = true;
    this.errorKey = null;
    try {
      const inspection = await this.api.inspectAccountAction(this.token, this.actionPurpose);
      if (!this.isConnected) return;
      this.email = inspection.email;
      this.actionPurpose = inspection.purpose;
      this.actionValidated = true;
      this.actionResent = false;
      this.#focusField("new-password");
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  async #requestAccountLink(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.requestPasswordReset(this.email);
      if (this.isConnected) this.actionResent = true;
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  async #submit(): Promise<void> {
    if (this.busy) return;
    if (this.step === "factor" && this.secondFactor === "") {
      this.secondFactorError = t("form.factor_required");
      return;
    }
    if (this.password === "") {
      this.passwordError = t("form.password_required");
      return;
    }
    this.#cancelPasskeyCeremony();
    this.busy = true;
    this.errorKey = null;
    try {
      const out = await this.api.login({
        email: this.email,
        password: this.password,
        ...(this.secondFactor === ""
          ? {}
          : this.factorMode === "totp"
            ? { totp: this.secondFactor }
            : { recoveryCode: this.secondFactor }),
      });
      if (!this.isConnected) return;
      const detail: CompletedLogin = {
        ...out,
        accountSetup: false,
        loginMethod: "password",
        ...this.#preferenceDetail(),
      };
      if (this.offerAfterLogin) this.#offerPasskey(detail);
      else this.#announceLogin(detail);
    } catch (error) {
      this.errorKey = codeOf(error);
      if (this.errorKey === "password.invalid") this.passwordError = codeMessage(this.errorKey);
      if (this.errorKey === "totp.required") {
        this.errorKey = null;
        this.step = "factor";
        this.#focusField("one-time-code");
      } else if (this.errorKey === "totp.invalid") {
        this.secondFactorError = codeMessage(this.errorKey);
      }
    } finally {
      this.busy = false;
    }
  }

  async #requestPasswordReset(): Promise<void> {
    if (this.busy) return;
    this.#updateResetCountdown();
    if (this.resetSeconds > 0) {
      this.step = "reset-sent";
      return;
    }
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.requestPasswordReset(this.email);
      this.resetDeadlines.set(this.email.trim().toLowerCase(), Date.now() + 60_000);
      this.#updateResetCountdown();
      clearInterval(this.resetTimer);
      if (this.isConnected) this.resetTimer = setInterval(() => this.#updateResetCountdown(), 1000);
      this.step = "reset-sent";
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  async #completeAccount(): Promise<void> {
    if (this.busy || !this.actionValidated || this.token === null) return;
    if (this.actionPurpose === null) {
      this.errorKey = "account_action.invalid";
      return;
    }
    this.passwordError =
      this.password === ""
        ? t("form.password_required")
        : this.password.length < 8
          ? codeMessage("password.too_short")
          : "";
    if (this.actionPurpose === "invitation") {
      this.pinError =
        this.pin === ""
          ? t("form.pin_required")
          : this.pin.length < 4
            ? codeMessage("pin.too_short")
            : "";
    }
    if (this.passwordError !== "" || this.pinError !== "") return;
    this.busy = true;
    this.errorKey = null;
    try {
      const out =
        this.actionPurpose === "invitation"
          ? await this.api.completeAccountAction(
              this.token,
              this.actionPurpose,
              this.password,
              this.pin,
            )
          : await this.api.completeAccountAction(this.token, this.actionPurpose, this.password);
      if (!this.isConnected) return;
      const accountSetup = this.actionPurpose === "invitation";
      const completedEmail = this.email;
      const completedPassword = this.password;
      this.#cancelAccountAction();
      this.email = completedEmail;
      if (out.authenticated) {
        this.password = completedPassword;
        this.#offerPasskey({
          personId: out.personId,
          accountSetup,
          loginMethod: "password",
          rememberEmail: false,
        });
      } else {
        this.offerAfterLogin = true;
        this.noticeCode = "password.reset_complete";
        this.#focusField("email");
      }
    } catch (error) {
      this.errorKey = codeOf(error);
      if (this.errorKey === "password.too_short") this.passwordError = codeMessage(this.errorKey);
    } finally {
      this.busy = false;
    }
  }

  #announceLogin(detail: CompletedLogin): void {
    this.#clearSecrets();
    this.errorKey = null;
    this.step = "password";
    this.completedLogin = null;
    this.offerAfterLogin = false;
    this.dispatchEvent(new CustomEvent("logged-in", { detail, bubbles: true, composed: true }));
  }

  #offerPasskey(detail: CompletedLogin): void {
    this.completedLogin = detail;
    this.step = "setup-passkey";
    this.noticeCode = null;
    this.pin = "";
    this.passkeyFactorRequired = this.factorMode === "recovery";
    if (this.passkeyFactorRequired) this.secondFactor = "";
    this.passkeyName = "";
    this.passkeyNameError = "";
  }

  async #setupPasskey(): Promise<void> {
    if (this.busy || this.completedLogin === null) return;
    this.passkeyNameError =
      this.passkeyName.trim().length > 80 ? t("profile.passkey_name_too_long") : "";
    this.secondFactorError =
      this.passkeyFactorRequired && this.secondFactor === "" ? t("form.factor_required") : "";
    if (this.passkeyNameError || this.secondFactorError) return;
    this.busy = true;
    this.errorKey = null;
    const attempt = ++this.passkeyAttempt;
    try {
      const { challengeHandle, options } = await this.api.passkeyRegisterOptions({
        currentPassword: this.password,
        ...(this.secondFactor === "" ? {} : { totp: this.secondFactor }),
      });
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      const response = await startRegistration({
        optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      await this.api.passkeyRegisterVerify({
        challengeHandle,
        response,
        name: this.passkeyName.trim(),
      });
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      this.#announceLogin(this.completedLogin);
    } catch (error) {
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      if (
        error instanceof Error &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      )
        return;
      this.errorKey = codeOf(error, "passkey.verification_failed");
      if (this.errorKey === "totp.invalid") {
        this.passkeyFactorRequired = true;
        this.secondFactor = "";
        this.secondFactorError = codeMessage(this.errorKey);
      }
    } finally {
      if (attempt === this.passkeyAttempt) this.busy = false;
    }
  }

  /** Device cancellation returns to password entry without reporting an authentication error. */
  async #passkeyLogin(): Promise<void> {
    if (this.busy) return;
    this.#cancelPasskeyCeremony();
    if (this.step === "password" || this.step === "factor") this.#clearSecrets();
    this.step = "passkey";
    const attempt = ++this.passkeyAttempt;
    this.busy = true;
    this.errorKey = null;
    try {
      const { challengeHandle, options } = await this.api.passkeyAuthOptions();
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      const response = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
      });
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      const out = await this.api.passkeyAuthVerify({ challengeHandle, response });
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      this.dispatchEvent(
        new CustomEvent("logged-in", {
          detail: {
            ...out,
            loginMethod: "passkey",
            ...this.#preferenceDetail(),
          },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      if (
        error instanceof Error &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        this.errorKey = null;
        this.step = "password";
        this.#focusField("password");
      } else {
        this.errorKey = codeOf(error, "passkey.verification_failed");
      }
    } finally {
      if (attempt === this.passkeyAttempt) this.busy = false;
    }
  }

  async #conditionalPasskeyLogin(): Promise<void> {
    try {
      if (!(await browserSupportsWebAuthnAutofill())) return;
    } catch {
      return;
    }
    await this.updateComplete;
    if (!this.isConnected || this.step !== "email" || this.token !== null) return;
    const attempt = ++this.passkeyAttempt;
    try {
      const { challengeHandle, options } = await this.api.passkeyAuthOptions();
      if (!this.isConnected || attempt !== this.passkeyAttempt || this.step !== "email") return;
      const response = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
        useBrowserAutofill: true,
        // The eligible email input lives in this component's shadow root, which the library's
        // document-level query cannot see. The component renders that input before this call.
        verifyBrowserAutofillInput: false,
      });
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      const out = await this.api.passkeyAuthVerify({ challengeHandle, response });
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      this.dispatchEvent(
        new CustomEvent("logged-in", {
          detail: { ...out, loginMethod: "passkey", ...this.#preferenceDetail() },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      if (!(
        error instanceof Error &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      )) {
        this.errorKey = codeOf(error, "passkey.verification_failed");
      }
    }
  }

  async #googleLogin(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      const { authorizationUrl } = await this.api.beginGoogleLogin();
      if (!this.isConnected) return;
      prepareGoogleLoginPreference(this.rememberEmail, this.rememberedEmail);
      this.navigate(authorizationUrl);
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  #preferenceDetail() {
    return {
      rememberEmail: this.rememberEmail,
      ...(this.rememberedEmail === undefined ? {} : { rememberedEmail: this.rememberedEmail }),
    };
  }

  #renderLoginContext(changeable = true) {
    return html`<div class="login-context" data-test="login-context">
      <div><span>${t("login.email")}</span><strong>${this.email}</strong></div>
      ${
        changeable
          ? html`<wt-button
              variant="ghost"
              data-test="change-account"
              aria-label=${t("login.use_another_account")}
              ?disabled=${this.busy}
              @click=${() => {
                if (!this.busy) this.#cancelLogin();
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5" />
              </svg>
            </wt-button>`
          : nothing
      }
    </div>`;
  }

  #methodLink(id: string, label: string, action: () => void) {
    return html`<a
      href=${`#${id}`}
      data-test=${id}
      aria-disabled=${this.busy}
      @click=${(event: Event) => {
        event.preventDefault();
        if (!this.busy) action();
      }}
      >${label}</a
    >`;
  }

  #alternatives() {
    return html`<ul class="alternative-list">
      ${this.step !== "password" ? html`<li>${this.#methodLink("use-password", t("login.use_password"), () => this.#showPasswordStep())}</li>` : nothing}
      ${this.step !== "passkey" ? html`<li>${this.#methodLink("passkey-login", t("login.with_passkey"), () => void this.#passkeyLogin())}</li>` : nothing}
      ${this.step !== "password" ? html`<li>${this.#methodLink("reset-by-email", t("login.reset_by_email"), () => void this.#requestPasswordReset())}</li>` : nothing}
      ${this.googleConfigured && this.step !== "google" ? html`<li>${this.#methodLink("google-login", t("login.with_google"), () => void this.#googleLogin())}</li>` : nothing}
    </ul>`;
  }

  #privacyLink() {
    return this.privacyNoticeUrl === ""
      ? nothing
      : html`<p>
          <a href=${this.privacyNoticeUrl} target="_blank" rel="noopener noreferrer"
            >${t("account.privacy_notice")}</a
          >
        </p>`;
  }

  #renderPasswordIcon(visible: boolean) {
    return html`
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
        <circle cx="8" cy="8" r="2"></circle>
        ${visible ? html`<path d="m2 2 12 12"></path>` : nothing}
      </svg>
    `;
  }

  #rememberChoice() {
    return html`<label class="remember-choice">
      <input
        data-test="remember-email"
        type="checkbox"
        .checked=${this.rememberEmail}
        @change=${(event: Event) => {
          this.rememberEmail = (event.currentTarget as HTMLInputElement).checked;
          if (!this.rememberEmail) forgetLoginPreference();
        }}
      />
      ${t("login.remember_email")}
    </label>`;
  }

  override render() {
    if (this.token !== null) {
      return html`
        <div class="screen">
          <dashboard-language-chooser
            .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
          ></dashboard-language-chooser>
          <h1>
            ${this.actionPurpose === "password_reset" ? t("account.reset_title") : t("account.setup_title")}
          </h1>
          ${this.actionValidated ? this.#renderLoginContext(false) : nothing}
          <input
            class="autofill-username"
            data-autofill-username
            name="email"
            type="email"
            autocomplete="username"
            .value=${this.email}
            tabindex="-1"
            aria-hidden="true"
            readonly
          />
          <wt-form-error-summary
            heading=${t("form.error_heading")}
            .errors=${this.formErrors}
          ></wt-form-error-summary>
          ${
            !this.actionValidated
              ? html`
                  <p role="status">${t("account.validating_link")}</p>
                  ${this.actionResent ? html`<p role="status">${t("account.link_resent")}</p>` : nothing}
                  <wt-form-actions>
                    <wt-button
                      slot="cancel"
                      variant="secondary"
                      data-test="cancel-account-action"
                      ?disabled=${this.busy}
                      @click=${() => this.#cancelAccountAction()}
                      >${t("action.cancel")}</wt-button
                    >
                  </wt-form-actions>
                  ${
                    this.errorKey === "account_action.invalid" || this.actionResent
                      ? html`<wt-button
                          variant="ghost"
                          data-test="resend-account-link"
                          ?disabled=${this.busy}
                          @click=${() => void this.#requestAccountLink()}
                          >${t("account.resend_link")}</wt-button
                        >`
                      : nothing
                  }
                `
              : html`
                  <wt-input
                    class="field"
                    name="new-password"
                    autocomplete="new-password"
                    required
                    label=${t("account.new_password")}
                    type=${this.newPasswordVisible ? "text" : "password"}
                    error=${this.passwordError}
                    .value=${this.password}
                    @keydown=${(e: KeyboardEvent) => this.#submitAccountOnEnter(e)}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPasswordChange(e)}
                  >
                    <wt-button
                      class="password-toggle"
                      slot="end"
                      variant="ghost"
                      data-test="toggle-new-password"
                      aria-label=${this.newPasswordVisible ? t("account.hide_new_password") : t("account.show_new_password")}
                      ?disabled=${this.busy}
                      @click=${() => (this.newPasswordVisible = !this.newPasswordVisible)}
                      >${this.#renderPasswordIcon(this.newPasswordVisible)}</wt-button
                    >
                  </wt-input>
                  ${
                    this.actionPurpose === "invitation"
                      ? html`
                          <wt-input
                            class="field"
                            name="new-pin"
                            autocomplete="off"
                            required
                            label=${t("account.new_pin")}
                            type=${this.pinVisible ? "text" : "password"}
                            error=${this.pinError}
                            .value=${this.pin}
                            @keydown=${(e: KeyboardEvent) => this.#submitAccountOnEnter(e)}
                            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPinChange(e)}
                          >
                            <wt-button
                              class="password-toggle"
                              slot="end"
                              variant="ghost"
                              data-test="toggle-new-pin"
                              aria-label=${this.pinVisible ? t("account.hide_new_pin") : t("account.show_new_pin")}
                              ?disabled=${this.busy}
                              @click=${() => (this.pinVisible = !this.pinVisible)}
                              >${this.#renderPasswordIcon(this.pinVisible)}</wt-button
                            >
                          </wt-input>
                        `
                      : nothing
                  }
                  <wt-form-actions>
                    <wt-button
                      slot="cancel"
                      variant="secondary"
                      data-test="cancel-account-action"
                      ?disabled=${this.busy}
                      @click=${() => this.#cancelAccountAction()}
                      >${t("action.cancel")}</wt-button
                    >
                    <wt-button
                      variant="primary"
                      data-test="complete-account"
                      ?disabled=${this.busy}
                      @click=${() => void this.#completeAccount()}
                      >${t("action.set_password")}</wt-button
                    >
                  </wt-form-actions>
                `
          }
          ${this.#privacyLink()}
        </div>
      `;
    }
    const submitTarget =
      this.step === "email" ? "continue" : this.step === "factor" ? "submit-factor" : "submit";
    return html`
      <div class="screen">
        <dashboard-language-chooser
          .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
        ></dashboard-language-chooser>
        ${this.noticeCode && this.noticeCode !== "management_session.required" ? html`<p class="notice" role="status">${codeMessage(this.noticeCode)}</p>` : nothing}
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${this.formErrors}
        ></wt-form-error-summary>
        ${
          this.step === "setup-passkey"
            ? html`
                <h1>${t("account.offer_passkey")}</h1>
                ${this.#renderLoginContext(false)}
                <p>${t("account.passkey_optional")}</p>
                <wt-input
                  class="field"
                  name="passkey-name"
                  autocomplete="off"
                  label=${t("profile.passkey_name")}
                  .value=${this.passkeyName}
                  error=${this.passkeyNameError}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.passkeyName = event.detail.value;
                    this.passkeyNameError = "";
                  }}
                  @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]"))}
                ></wt-input>
                ${
                  this.passkeyFactorRequired
                    ? html`<wt-input
                        class="field"
                        name="one-time-code"
                        autocomplete="one-time-code"
                        required
                        label=${t("login.authenticator_code")}
                        .value=${this.secondFactor}
                        error=${this.secondFactorError}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onSecondFactorChange(event)}
                        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]"))}
                      ></wt-input>`
                    : nothing
                }
                <wt-form-actions>
                  <wt-button
                    slot="cancel"
                    variant="secondary"
                    data-test="skip-passkey"
                    ?disabled=${this.busy}
                    @click=${() => {
                      if (!this.busy && this.completedLogin !== null)
                        this.#announceLogin(this.completedLogin);
                    }}
                    >${t("account.skip_passkey")}</wt-button
                  >
                  <wt-button
                    variant="primary"
                    data-test="setup-passkey"
                    ?disabled=${this.busy}
                    @click=${() => void this.#setupPasskey()}
                    >${t("staff.add_passkey")}</wt-button
                  >
                </wt-form-actions>
              `
            : this.step === "email"
              ? html`
                  <h1>${t("login.heading")}</h1>
                  <wt-input
                    @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test=${submitTarget}]`))}
                    class="field"
                    name="email"
                    autocomplete="username webauthn"
                    required
                    label=${t("login.email")}
                    type="email"
                    error=${this.emailError}
                    .value=${this.email}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onEmailChange(e)}
                  ></wt-input>
                  ${this.#rememberChoice()}
                  <wt-form-actions>
                    <wt-button
                      variant="primary"
                      data-test="continue"
                      @click=${() => this.#continue()}
                      >${t("action.continue")}</wt-button
                    >
                  </wt-form-actions>
                `
              : this.step === "google"
                ? html`
                    <h1>${t("login.google_heading")}</h1>
                    ${this.#renderLoginContext()}
                    <p class="alternative-hint">${t("login.google_hint")}</p>
                    <wt-form-actions
                      ><wt-button
                        variant="primary"
                        data-test="google-login"
                        ?disabled=${this.busy || !this.googleConfigured}
                        @click=${() => void this.#googleLogin()}
                        >${t("login.with_google")}</wt-button
                      ></wt-form-actions
                    >
                    ${this.#alternatives()}
                  `
                : this.step === "passkey"
                  ? html`
                      <h1>${t("login.use_passkey_heading")}</h1>
                      ${this.#renderLoginContext()}
                      <p class="alternative-hint">${t("login.passkey_hint")}</p>
                      <wt-form-actions>
                        <wt-button
                          variant="primary"
                          data-test="passkey-login"
                          ?disabled=${this.busy}
                          @click=${() => void this.#passkeyLogin()}
                          >${t("login.with_passkey")}</wt-button
                        >
                      </wt-form-actions>
                      ${this.#alternatives()}
                    `
                  : this.step === "password"
                    ? html`
                        <h1>${t("login.password_heading")}</h1>
                        ${this.#renderLoginContext()}
                        <input
                          class="autofill-username"
                          data-autofill-username
                          name="email"
                          type="email"
                          autocomplete="username"
                          .value=${this.email}
                          tabindex="-1"
                          aria-hidden="true"
                          readonly
                        />
                        <wt-input
                          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test=${submitTarget}]`))}
                          class="field"
                          name="password"
                          autocomplete="current-password"
                          required
                          label=${t("login.password")}
                          type=${this.passwordVisible ? "text" : "password"}
                          error=${this.passwordError}
                          .value=${this.password}
                          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPasswordChange(e)}
                        >
                          <wt-button
                            class="password-toggle"
                            slot="end"
                            variant="ghost"
                            data-test="toggle-password"
                            aria-label=${
                              this.passwordVisible
                                ? t("login.hide_password")
                                : t("login.show_password")
                            }
                            ?disabled=${this.busy}
                            @click=${() => (this.passwordVisible = !this.passwordVisible)}
                            >${this.#renderPasswordIcon(this.passwordVisible)}</wt-button
                          >
                        </wt-input>
                        ${this.#methodLink("reset-by-email", t("login.reset_by_email"), () => void this.#requestPasswordReset())}
                        <wt-form-actions>
                          <wt-button
                            variant="primary"
                            data-test="submit"
                            ?disabled=${this.busy}
                            @click=${() => void this.#submit()}
                            >${t("action.login")}</wt-button
                          >
                        </wt-form-actions>
                        ${this.#alternatives()}
                      `
                    : this.step === "factor"
                      ? html`
                          ${this.#renderLoginContext()}
                          <h1>${t("login.factor_heading")}</h1>
                          <input
                            class="autofill-username"
                            data-autofill-username
                            name="email"
                            type="email"
                            autocomplete="username"
                            .value=${this.email}
                            tabindex="-1"
                            aria-hidden="true"
                            readonly
                          />
                          <wt-input
                            class="field"
                            name="one-time-code"
                            autocomplete="one-time-code"
                            required
                            label=${
                              this.factorMode === "totp"
                                ? t("login.authenticator_code")
                                : t("login.recovery_code")
                            }
                            error=${this.secondFactorError}
                            .value=${this.secondFactor}
                            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=submit-factor]"))}
                            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onSecondFactorChange(e)}
                          ></wt-input>
                          <wt-form-actions>
                            <wt-button
                              slot="cancel"
                              variant="secondary"
                              data-test="back-to-password"
                              ?disabled=${this.busy}
                              @click=${() => {
                                this.secondFactor = "";
                                this.secondFactorError = "";
                                this.step = "password";
                              }}
                              >${t("action.back")}</wt-button
                            >
                            <wt-button
                              variant="primary"
                              data-test="submit-factor"
                              ?disabled=${this.busy}
                              @click=${() => void this.#submit()}
                              >${t("action.login")}</wt-button
                            >
                          </wt-form-actions>
                          <ul class="alternative-list">
                            <li>
                              ${this.#methodLink(
                                "switch-factor",
                                this.factorMode === "totp"
                                  ? t("login.use_recovery_code")
                                  : t("login.use_authenticator_code"),
                                () => {
                                  this.factorMode =
                                    this.factorMode === "totp" ? "recovery" : "totp";
                                  this.secondFactor = "";
                                  this.secondFactorError = "";
                                },
                              )}
                            </li>
                          </ul>
                        `
                      : this.step === "reset-sent"
                        ? html`
                            <h1>${t("login.check_email")}</h1>
                            ${this.#renderLoginContext()}
                            <p data-test="reset-sent" role="status">
                              ${t("login.reset_sent").replace("{email}", this.email)}
                            </p>
                            <p class="alternative-hint">${t("login.reset_delivery_hint")}</p>
                            <wt-form-actions>
                              <wt-button
                                variant="primary"
                                data-test="resend-reset"
                                ?disabled=${this.busy || this.resetSeconds > 0}
                                @click=${() => void this.#requestPasswordReset()}
                                >${this.resetSeconds > 0 ? t("login.resend_countdown").replace("{seconds}", String(this.resetSeconds)) : t("login.resend_link")}</wt-button
                              >
                            </wt-form-actions>
                          `
                        : nothing
        }
        ${this.#privacyLink()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-login-screen": LoginScreen;
  }
}
