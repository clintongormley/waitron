import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  focusFirstInvalid,
  formMessage,
  formMessageStyles,
  submitOnEnter,
  baseStyles,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { classifyPasskeyRegistrationError, classifyPasskeySignInError } from "../passkey-errors.js";
import type { DashboardApi, PasskeyOptions } from "../api/client.js";
import { signalUnknownPasskey } from "../passkey-signals.js";
import {
  forgetLoginPreference,
  readLoginPreference,
  prepareGoogleLoginPreference,
} from "../login-preference.js";
import waitronLockup from "../../../../packages/ui/brand/waitron-lockup.svg?raw";

const GOOGLE_G_URL = new URL("../assets/google-g.svg", import.meta.url).href;

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
 * Asks for the email first, then the password. A device passkey prompt opens only on an explicit
 * passkey action; cancelling it returns to the password step.
 */
@customElement("dashboard-login-screen")
export class LoginScreen extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        width: 100%;
        max-width: calc(var(--wt-space-6) * 15);
        margin-inline: auto;
        padding: var(--wt-space-5) var(--wt-modal-inline-padding);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface-raised);
      }

      .logo {
        margin-bottom: var(--wt-space-4);
      }
      .logo svg {
        display: block;
        width: calc(var(--wt-space-6) * 5);
        height: auto;
      }
      /* The brand file paints fixed light-theme ink; inlined, its two groups (the waiter, then the
         word) follow the theme. */
      .logo svg > g:first-of-type {
        fill: var(--wt-color-primary);
      }
      .logo svg > g:last-of-type {
        fill: var(--wt-color-text);
      }

      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
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

      .password-toggle svg,
      .change-account svg,
      .method svg,
      .method img {
        display: block;
        flex: none;
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
      }
      .password-toggle svg,
      .change-account svg,
      .method svg {
        fill: none;
        stroke: currentColor;
      }
      .method svg {
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      /* Pulled up into the field's bottom margin, so the link's tap area starts at the field. */
      .field-link {
        display: flex;
        justify-content: flex-end;
        margin-top: calc(-1 * var(--wt-space-4));
      }
      .field-link a {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary);
        font-size: var(--wt-font-size-sm);
      }

      .form-message {
        margin: var(--wt-space-4) 0 0;
      }

      wt-button.method {
        display: block;
      }
      wt-button.method[variant="primary"] {
        margin-top: var(--wt-space-4);
      }

      .or {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .or::before,
      .or::after {
        content: "";
        flex: 1;
        border-top: 1px solid var(--wt-color-border);
      }

      .other-ways {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
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
  @state() private passkeyForgotten = false;
  /** The shown field `errorKey`'s refusal names, if any; the refusal shows under that field. */
  @state() private refusalField: string | null = null;
  @state() private attempted = false;
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

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("step") || changed.has("token") || changed.has("actionValidated")) {
      this.attempted = false;
      if (this.refusalField !== null) this.errorKey = null;
      this.refusalField = null;
    }
  }

  #focusFirstInvalid(): void {
    void this.updateComplete.then(() => {
      if (this.isConnected) void focusFirstInvalid(this.shadowRoot!);
    });
  }

  /** Records a refusal, under `field` when this form shows it, otherwise above the action. */
  #refuse(code: string, field: string): void {
    this.errorKey = code;
    if (this.#shownFields().has(field)) {
      this.refusalField = field;
      this.#focusFirstInvalid();
    }
  }

  #dismissRefusal(field: string): void {
    if (this.refusalField !== field) return;
    this.refusalField = null;
    this.errorKey = null;
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

  #shownFields(): Set<string> {
    if (this.token !== null) {
      if (!this.actionValidated) return new Set();
      return new Set(
        this.actionPurpose === "invitation" ? ["new-password", "new-pin"] : ["new-password"],
      );
    }
    switch (this.step) {
      case "email":
        return new Set(["email"]);
      case "password":
        return new Set(["password"]);
      case "factor":
        return new Set(["one-time-code"]);
      case "setup-passkey":
        return new Set(
          this.passkeyFactorRequired ? ["passkey-name", "one-time-code"] : ["passkey-name"],
        );
      default:
        return new Set();
    }
  }

  /** What is wrong with the current form's values, keyed by field name. */
  #validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (this.token !== null) {
      if (!this.actionValidated) return errors;
      if (this.password === "") errors["new-password"] = t("form.password_required");
      else if (this.password.length < 8) errors["new-password"] = codeMessage("password.too_short");
      if (this.actionPurpose === "invitation") {
        if (this.pin === "") errors["new-pin"] = t("form.pin_required");
        else if (this.pin.length < 4) errors["new-pin"] = codeMessage("pin.too_short");
      }
      return errors;
    }
    if (this.step === "email") {
      const email = this.email.trim();
      if (email === "") errors.email = t("form.email_required");
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.email = codeMessage("person.email_invalid");
    } else if (this.step === "password" || this.step === "factor") {
      if (this.step === "factor" && this.secondFactor === "")
        errors["one-time-code"] = t("form.factor_required");
      // On the code step the password is not shown, so this reaches the message above the action.
      if (this.password === "") errors.password = t("form.password_required");
    } else if (this.step === "setup-passkey") {
      if (this.passkeyName.trim().length > 80)
        errors["passkey-name"] = t("profile.passkey_name_too_long");
      if (this.passkeyFactorRequired && this.secondFactor === "")
        errors["one-time-code"] = t("form.factor_required");
    }
    return errors;
  }

  /** Marks the form submitted; returns false, focusing the first invalid field, when it is not valid. */
  #check(): boolean {
    this.attempted = true;
    if (Object.keys(this.#validate()).length === 0) return true;
    this.#focusFirstInvalid();
    return false;
  }

  #errors(): Record<string, string> {
    const refused =
      this.refusalField !== null && this.errorKey !== null
        ? { [this.refusalField]: codeMessage(this.errorKey) }
        : {};
    return { ...(this.attempted ? this.#validate() : {}), ...refused };
  }

  /** Each shown field's message, the one message above the action, and whether the action waits
   * for a field to be corrected. Only the form's own checks make it wait. */
  #formState(): { fields: Record<string, string>; bottom: string; blocked: boolean } {
    const errors = this.#errors();
    const shown = this.#shownFields();
    const fields: Record<string, string> = {};
    const messages: string[] = [];
    for (const [key, message] of Object.entries(errors)) {
      if (shown.has(key)) fields[key] = message;
      else messages.push(message);
    }
    if (this.errorKey !== null && this.refusalField === null)
      messages.unshift(
        this.errorKey === "password.invalid" && (this.step === "password" || this.step === "factor")
          ? t("login.failed")
          : this.errorKey === "passkey.not_registered"
            ? t(this.passkeyForgotten ? "login.passkey_forgotten" : "login.passkey_unknown")
            : codeMessage(this.errorKey),
      );
    const marked = Object.keys(fields).length > 0;
    const invalid = this.attempted ? Object.keys(this.#validate()) : [];
    return {
      fields,
      bottom: [...new Set(messages), ...(marked ? [t("form.fix_fields")] : [])].join(" "),
      blocked: invalid.some((key) => shown.has(key)),
    };
  }

  /** `wt-change` is composed, so without `stopPropagation` it would reach the app shell too. */
  #onEmailChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.email = event.detail.value;
  }

  #onPasswordChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.password = event.detail.value;
    this.#dismissRefusal("new-password");
  }

  #onSecondFactorChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.secondFactor = event.detail.value.trim();
    this.#dismissRefusal("one-time-code");
  }

  #onPinChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.pin = event.detail.value;
    this.#dismissRefusal("new-pin");
  }

  #clearSecrets(): void {
    this.password = "";
    this.secondFactor = "";
    this.factorMode = "totp";
    this.pin = "";
    this.passwordVisible = false;
    this.newPasswordVisible = false;
    this.pinVisible = false;
    this.passkeyName = "";
    this.passkeyFactorRequired = false;
    this.attempted = false;
    this.refusalField = null;
  }

  #submitAccountOnEnter(event: KeyboardEvent): void {
    submitOnEnter(
      event,
      this.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]"),
    );
  }

  #continue(): void {
    if (!this.#check()) return;
    this.email = this.email.trim();
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
    this.errorKey = null;
    this.refusalField = null;
    if (!this.#check()) return;
    this.#cancelPasskeyCeremony();
    this.busy = true;
    try {
      const { personId, offerPasskey } = await this.api.login({
        email: this.email,
        password: this.password,
        ...(this.secondFactor === ""
          ? {}
          : this.factorMode === "totp"
            ? { totp: this.secondFactor }
            : { recoveryCode: this.secondFactor }),
      });
      if (!this.isConnected) return;
      // Named apart from the rest of the response rather than spread: `offerPasskey` answers this
      // screen's question about which step comes next, and is not part of what a completed sign-in
      // tells the app shell.
      const detail: CompletedLogin = {
        personId,
        accountSetup: false,
        loginMethod: "password",
        ...this.#preferenceDetail(),
      };
      if (this.offerAfterLogin || offerPasskey) this.#offerPasskey(detail);
      else this.#announceLogin(detail);
    } catch (error) {
      const code = codeOf(error);
      if (code === "totp.required") {
        this.step = "factor";
        this.#focusField("one-time-code");
      } else if (code === "password.invalid") this.#loginFailed();
      else this.errorKey = code;
    } finally {
      this.busy = false;
    }
  }

  /** A refused sign-in marks no field: a message under the password or the code would say the
   * details before it were right, and so that the account exists (owner rule, C95). */
  #loginFailed(): void {
    this.errorKey = "password.invalid";
    if (this.step === "factor") {
      this.secondFactor = "";
      // The emptied code is not an error the operator made, so it waits for the next Log in.
      this.attempted = false;
      this.#focusField("one-time-code");
    } else this.#focusField("password");
  }

  async #requestPasswordReset(): Promise<void> {
    if (this.busy) return;
    this.errorKey = null;
    this.#updateResetCountdown();
    if (this.resetSeconds > 0) {
      this.step = "reset-sent";
      return;
    }
    this.busy = true;
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
    this.errorKey = null;
    this.refusalField = null;
    if (!this.#check()) return;
    this.busy = true;
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
      const code = codeOf(error);
      if (code === "password.too_short") this.#refuse(code, "new-password");
      else if (code === "pin.too_short") this.#refuse(code, "new-pin");
      else this.errorKey = code;
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
  }

  /**
   * Signs in even if recording the offer fails: that bookkeeping must never keep somebody out of their
   * dashboard. A session-shaped rejection has already reached the shell through the request
   * primitive's `onError`, which runs before it throws (`packages/dashboard-kit/src/request.ts`).
   * `busy` keeps a second Skip, or Add on top of a pending Skip, from signing the person in twice.
   */
  async #resolvePasskeyOffer(detail: CompletedLogin): Promise<void> {
    this.busy = true;
    try {
      await this.api.passkeyOfferSeen();
    } catch {
      // Deliberately swallowed — see above.
    }
    this.busy = false;
    if (this.isConnected) this.#announceLogin(detail);
  }

  async #setupPasskey(): Promise<void> {
    if (this.busy || this.completedLogin === null) return;
    this.errorKey = null;
    this.refusalField = null;
    if (!this.#check()) return;
    this.busy = true;
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
      await this.#resolvePasskeyOffer(this.completedLogin);
    } catch (error) {
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      // Classified first, so no WebAuthn library `.code` reaches codeOf and degrades to the generic
      // banner.
      const passkey = classifyPasskeyRegistrationError(error);
      if (passkey === "cancelled") return;
      if (passkey === "already_registered") {
        this.errorKey = "passkey.already_registered";
        return;
      }
      if (passkey === "failed") {
        this.errorKey = "passkey.verification_failed";
        return;
      }
      const code = codeOf(error, "passkey.verification_failed");
      const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
      if (code === "totp.invalid") {
        this.passkeyFactorRequired = true;
        this.secondFactor = "";
        this.#refuse(code, "one-time-code");
      } else if (code === "profile.invalid" && field === "passkeyName")
        this.#refuse(code, "passkey-name");
      else this.errorKey = code;
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
      const out = await this.#verifyPasskey(challengeHandle, options, response, attempt);
      if (out === null) return;
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
      const passkey = classifyPasskeySignInError(error);
      if (passkey === "cancelled") {
        this.errorKey = null;
        this.step = "password";
        this.#focusField("password");
      } else {
        this.errorKey =
          passkey === "failed"
            ? "passkey.verification_failed"
            : codeOf(error, "passkey.verification_failed");
      }
    } finally {
      if (attempt === this.passkeyAttempt) this.busy = false;
    }
  }

  /**
   * Null when the attempt was superseded or a passkey Waitron does not hold was refused, which is
   * shown here after the browser is asked to forget it.
   */
  async #verifyPasskey(
    challengeHandle: string,
    options: PasskeyOptions,
    response: AuthenticationResponseJSON,
    attempt: number,
  ): Promise<{ personId: string } | null> {
    let out: { personId: string };
    try {
      out = await this.api.passkeyAuthVerify({ challengeHandle, response });
    } catch (error) {
      if (codeOf(error) !== "passkey.not_registered") throw error;
      const forgotten = await signalUnknownPasskey(
        typeof options.rpId === "string" ? options.rpId : undefined,
        response.id,
      );
      if (!this.isConnected || attempt !== this.passkeyAttempt) return null;
      this.passkeyForgotten = forgotten;
      this.errorKey = "passkey.not_registered";
      return null;
    }
    return this.isConnected && attempt === this.passkeyAttempt ? out : null;
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
      // Nobody asked for this attempt, so a successful options answer whose body is not JSON
      // (parsing it throws a `SyntaxError`), or is empty or `null`, ends it quietly; a refusal, an
      // unreachable server or a body that fails while being read still shows.
      const challenge = await this.api.passkeyAuthOptions().catch((error: unknown) => {
        if (error instanceof SyntaxError) return null;
        throw error;
      });
      if (!this.isConnected || attempt !== this.passkeyAttempt || this.step !== "email") return;
      if (challenge == null) return;
      const { challengeHandle, options } = challenge;
      // Any rejection from the passkey prompt also ends it quietly.
      const response = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
        useBrowserAutofill: true,
        // The eligible email input lives in this component's shadow root, which the library's
        // document-level query cannot see. The component renders that input before this call.
        verifyBrowserAutofillInput: false,
      }).catch(() => null);
      if (response === null || !this.isConnected || attempt !== this.passkeyAttempt) return;
      const out = await this.#verifyPasskey(challengeHandle, options, response, attempt);
      if (out === null) return;
      this.dispatchEvent(
        new CustomEvent("logged-in", {
          detail: { ...out, loginMethod: "passkey", ...this.#preferenceDetail() },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (!this.isConnected || attempt !== this.passkeyAttempt) return;
      this.errorKey = codeOf(error, "passkey.verification_failed");
    }
  }

  async #googleLogin(): Promise<void> {
    if (this.busy) return;
    // The email step's autofill passkey would otherwise sign in after Google was chosen.
    this.#cancelPasskeyCeremony();
    this.busy = true;
    this.errorKey = null;
    try {
      const { authorizationUrl } = await this.api.beginGoogleLogin();
      if (!this.isConnected) return;
      prepareGoogleLoginPreference(this.rememberEmail, this.rememberedEmail);
      this.navigate(authorizationUrl);
    } catch (error) {
      this.errorKey = codeOf(error);
      if (this.isConnected && this.step === "email") void this.#conditionalPasskeyLogin();
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

  /** Named apart from the hidden `autofill-username` input, so that input stays the only field
   * named `email` for password managers. */
  #renderLoginContext(changeable = true) {
    return html`<wt-input
      class="field"
      data-test="login-context"
      name="chosen-email"
      type="email"
      autocomplete="off"
      readonly
      label=${t("login.email")}
      .value=${this.email}
    >
      ${
        changeable
          ? html`<wt-button
              class="change-account"
              slot="end"
              variant="ghost"
              data-test="change-account"
              aria-label=${t("login.use_another_account")}
              ?disabled=${this.busy}
              @click=${() => {
                if (!this.busy) this.#cancelLogin();
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5" />
              </svg>
            </wt-button>`
          : nothing
      }
    </wt-input>`;
  }

  #fieldLink(id: string, label: string, action: () => void) {
    return html`<div class="field-link">
      <a
        href=${`#${id}`}
        data-test=${id}
        aria-disabled=${this.busy}
        @click=${(event: Event) => {
          event.preventDefault();
          if (!this.busy) action();
        }}
        >${label}</a
      >
    </div>`;
  }

  #otherWay(id: string, label: string, icon: TemplateResult, action: () => void) {
    return html`<wt-button
      class="method"
      variant="secondary"
      data-test=${id}
      ?disabled=${this.busy}
      @click=${() => {
        if (!this.busy) action();
      }}
      >${icon}${label}</wt-button
    >`;
  }

  #otherWays() {
    const password = this.#otherWay(
      "use-password",
      t("login.use_password"),
      html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="7.5" cy="15.5" r="4.5"></circle>
        <path d="m10.7 12.3 9.8-9.8M17 5.8l2.7 2.7M14.6 8.2l2.2 2.2"></path>
      </svg>`,
      () => this.#showPasswordStep(),
    );
    const passkey = this.#otherWay(
      "passkey-login",
      t("login.with_passkey"),
      html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M2 21v-1a7 7 0 0 1 10.5-6"></path>
        <circle cx="18" cy="14" r="2.5"></circle>
        <path d="M18 16.5V22M18 19.5h2"></path>
      </svg>`,
      () => void this.#passkeyLogin(),
    );
    const google = this.googleConfigured
      ? [
          this.#otherWay(
            "google-login",
            t("login.with_google"),
            html`<img src=${GOOGLE_G_URL} alt="" />`,
            () => void this.#googleLogin(),
          ),
        ]
      : [];
    const others =
      this.step === "email"
        ? google
        : this.step === "password"
          ? [passkey, ...google]
          : this.step === "passkey"
            ? [password, ...google]
            : [password, passkey];
    if (others.length === 0) return nothing;
    return html`<p class="or" data-test="login-or">${t("login.or")}</p>
      <div class="other-ways">${others}</div>`;
  }

  #methodActions(primary: TemplateResult, message: string) {
    return html`${formMessage(message)}${primary}${this.#otherWays()}`;
  }

  /** Decorative: the banner above the card already names Waitron. */
  #logo() {
    return html`<div class="logo" data-test="login-logo" aria-hidden="true">
      ${unsafeHTML(waitronLockup)}
    </div>`;
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
    const form = this.#formState();
    const fieldError = (name: string) => form.fields[name] ?? "";
    if (this.token !== null) {
      return html`
        <div class="screen">
          ${this.#logo()}
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
          ${
            !this.actionValidated
              ? html`
                  <p role="status">${t("account.validating_link")}</p>
                  ${this.actionResent ? html`<p role="status">${t("account.link_resent")}</p>` : nothing}
                  <wt-form-actions .error=${form.bottom}>
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
                    error=${fieldError("new-password")}
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
                            error=${fieldError("new-pin")}
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
                  <wt-form-actions .error=${form.bottom}>
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
                      ?disabled=${this.busy || form.blocked}
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
        ${this.#logo()}
        ${this.noticeCode && this.noticeCode !== "management_session.required" ? html`<p class="notice" role="status">${codeMessage(this.noticeCode)}</p>` : nothing}
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
                  error=${fieldError("passkey-name")}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.passkeyName = event.detail.value;
                    this.#dismissRefusal("passkey-name");
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
                        error=${fieldError("one-time-code")}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onSecondFactorChange(event)}
                        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]"))}
                      ></wt-input>`
                    : nothing
                }
                <wt-form-actions .error=${form.bottom}>
                  <wt-button
                    slot="cancel"
                    variant="secondary"
                    data-test="skip-passkey"
                    ?disabled=${this.busy}
                    @click=${() => {
                      if (!this.busy && this.completedLogin !== null)
                        void this.#resolvePasskeyOffer(this.completedLogin);
                    }}
                    >${t("account.skip_passkey")}</wt-button
                  >
                  <wt-button
                    variant="primary"
                    data-test="setup-passkey"
                    ?disabled=${this.busy || form.blocked}
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
                    error=${fieldError("email")}
                    .value=${this.email}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onEmailChange(e)}
                  ></wt-input>
                  ${this.#rememberChoice()}
                  ${this.#methodActions(
                    html`<wt-button
                      class="method"
                      variant="primary"
                      data-test="continue"
                      ?disabled=${this.busy || form.blocked}
                      @click=${() => {
                        if (!this.busy) this.#continue();
                      }}
                      >${t("action.continue")}</wt-button
                    >`,
                    form.bottom,
                  )}
                `
              : this.step === "google"
                ? html`
                    <h1>${t("login.google_heading")}</h1>
                    ${this.#renderLoginContext()}
                    <p class="alternative-hint">${t("login.google_hint")}</p>
                    ${this.#methodActions(
                      html`<wt-button
                        class="method"
                        variant="primary"
                        data-test="google-login"
                        ?disabled=${this.busy || !this.googleConfigured}
                        @click=${() => void this.#googleLogin()}
                        >${t("login.with_google")}</wt-button
                      >`,
                      form.bottom,
                    )}
                  `
                : this.step === "passkey"
                  ? html`
                      <h1>${t("login.use_passkey_heading")}</h1>
                      ${this.#renderLoginContext()}
                      <p class="alternative-hint">${t("login.passkey_hint")}</p>
                      ${this.#methodActions(
                        html`<wt-button
                          class="method"
                          variant="primary"
                          data-test="passkey-login"
                          ?disabled=${this.busy}
                          @click=${() => void this.#passkeyLogin()}
                          >${t("login.with_passkey")}</wt-button
                        >`,
                        form.bottom,
                      )}
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
                          error=${fieldError("password")}
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
                        ${this.#fieldLink(
                          "reset-by-email",
                          t("login.reset_by_email"),
                          () => void this.#requestPasswordReset(),
                        )}
                        ${this.#methodActions(
                          html`<wt-button
                            class="method"
                            variant="primary"
                            data-test="submit"
                            ?disabled=${this.busy || form.blocked}
                            @click=${() => void this.#submit()}
                            >${t("action.login")}</wt-button
                          >`,
                          form.bottom,
                        )}
                      `
                    : this.step === "factor"
                      ? html`
                          <h1>${t("login.factor_heading")}</h1>
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
                            class="field"
                            name="one-time-code"
                            autocomplete="one-time-code"
                            required
                            label=${
                              this.factorMode === "totp"
                                ? t("login.authenticator_code")
                                : t("login.recovery_code")
                            }
                            error=${fieldError("one-time-code")}
                            .value=${this.secondFactor}
                            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=submit-factor]"))}
                            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onSecondFactorChange(e)}
                          ></wt-input>
                          ${this.#fieldLink(
                            "switch-factor",
                            this.factorMode === "totp"
                              ? t("login.use_recovery_code")
                              : t("login.use_authenticator_code"),
                            () => {
                              this.factorMode = this.factorMode === "totp" ? "recovery" : "totp";
                              this.secondFactor = "";
                              this.attempted = false;
                            },
                          )}
                          <wt-form-actions .error=${form.bottom}>
                            <wt-button
                              slot="cancel"
                              variant="secondary"
                              data-test="back-to-password"
                              ?disabled=${this.busy}
                              @click=${() => {
                                if (this.busy) return;
                                this.secondFactor = "";
                                this.errorKey = null;
                                this.step = "password";
                              }}
                              >${t("action.back")}</wt-button
                            >
                            <wt-button
                              variant="primary"
                              data-test="submit-factor"
                              ?disabled=${this.busy || form.blocked}
                              @click=${() => void this.#submit()}
                              >${t("action.login")}</wt-button
                            >
                          </wt-form-actions>
                        `
                      : this.step === "reset-sent"
                        ? html`
                            <h1>${t("login.check_email")}</h1>
                            ${this.#renderLoginContext()}
                            <p data-test="reset-sent" role="status">
                              ${t("login.reset_sent").replace("{email}", this.email)}
                            </p>
                            <p class="alternative-hint">${t("login.reset_delivery_hint")}</p>
                            <wt-form-actions .error=${form.bottom}>
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
