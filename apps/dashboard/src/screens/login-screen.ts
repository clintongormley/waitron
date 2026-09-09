import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi } from "../api/client.js";
// The pre-login language chooser (per-user-language-preference). It emits a composed `locale-selected`;
// `dashboard-app` turns a pre-login pick into a transient `setLocale` (nothing is persisted).
import "../widgets/language-chooser.js";

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
 * passkey step. Password and recovery stay behind the alternative-method chooser.
 *
 * It talks to the world through one injected `api` (`@property({ attribute: false })`) and one
 * event: on a successful `api.login(...)` it dispatches `logged-in` carrying `{ personId }`,
 * `bubbles`/`composed` so the app shell above the shadow boundary hears it. A rejected login sets
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
        max-width: 24rem;
        margin-inline: auto;
      }

      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .login-context {
        color: var(--wt-color-text-muted);
      }

      .login-context strong {
        color: var(--wt-color-text);
      }

      .password-toggle svg {
        display: block;
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
        fill: none;
        stroke: currentColor;
      }

      .other-way,
      .alternative-list {
        margin-bottom: var(--wt-space-4);
      }

      .alternative-list,
      .alternative-choice {
        display: grid;
      }

      .alternative-list {
        gap: var(--wt-space-4);
      }

      .alternative-choice {
        gap: var(--wt-space-1);
      }

      .alternative-choice wt-button {
        width: 100%;
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
  @state() private busy = false;
  @state() private email = actionEmailFromUrl();
  @state() private password = "";
  @state() private confirmPassword = "";
  @state() private step: "email" | "passkey" | "password" | "other-ways" = "email";
  @state() private passwordVisible = false;
  @state() private token: string | null = new URLSearchParams(window.location.search).get("token");
  @state() private actionPurpose: AccountActionPurpose | null = actionPurposeFromUrl();
  @state() private resetSent = false;
  @state() private errorKey: string | null = null;
  @state() private emailError = "";
  @state() private passwordError = "";
  @state() private confirmPasswordError = "";

  private get formErrors(): string[] {
    return [
      ...new Set(
        [
          this.emailError,
          this.passwordError,
          this.confirmPasswordError,
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
    this.resetSent = false;
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

  #onConfirmPasswordChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.confirmPassword = event.detail.value;
    this.confirmPasswordError = "";
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
    // Keep this public transition identical for every valid address. Choosing a screen from
    // server-side passkey enrolment would expose whether that account has a passkey.
    this.step = "passkey";
  }

  #showOtherWays(): void {
    this.passwordVisible = false;
    this.errorKey = null;
    this.step = "other-ways";
  }

  #showPasswordStep(): void {
    this.passwordVisible = false;
    this.errorKey = null;
    this.step = "password";
  }

  #showPasskeyStep(): void {
    this.passwordVisible = false;
    this.errorKey = null;
    this.step = "passkey";
  }

  #showEmailStep(): void {
    this.passwordVisible = false;
    this.resetSent = false;
    this.errorKey = null;
    this.step = "email";
  }

  async #submit(): Promise<void> {
    if (this.busy) return;
    if (this.password === "") {
      this.passwordError = t("form.password_required");
      return;
    }
    this.busy = true;
    this.errorKey = null;
    try {
      const out = await this.api.login({
        email: this.email,
        password: this.password,
      });
      this.dispatchEvent(
        new CustomEvent("logged-in", { detail: out, bubbles: true, composed: true }),
      );
    } catch (error) {
      this.errorKey = codeOf(error);
      if (this.errorKey === "password.invalid") this.passwordError = codeMessage(this.errorKey);
    } finally {
      this.busy = false;
    }
  }

  async #requestPasswordReset(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.requestPasswordReset(this.email);
      this.resetSent = true;
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  async #completeAccount(): Promise<void> {
    if (this.busy || this.token === null) return;
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
    this.confirmPasswordError =
      this.confirmPassword === ""
        ? t("form.confirm_password_required")
        : this.password !== this.confirmPassword
          ? t("account.password_mismatch")
          : "";
    if (this.passwordError !== "" || this.confirmPasswordError !== "") return;
    this.busy = true;
    this.errorKey = null;
    try {
      const out = await this.api.completeAccountAction(
        this.token,
        this.actionPurpose,
        this.password,
      );
      if (new URLSearchParams(window.location.search).has("token")) {
        history.replaceState(null, "", "/manage/");
      }
      this.dispatchEvent(
        new CustomEvent("logged-in", { detail: out, bubbles: true, composed: true }),
      );
    } catch (error) {
      this.errorKey = codeOf(error);
      if (this.errorKey === "password.too_short") this.passwordError = codeMessage(this.errorKey);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Log in with a passkey — the password-free parallel of `#submit`, driving the WebAuthn assertion
   * ceremony: `passkeyAuthOptions()` (UNGATED — this IS the login) returns the request options plus a
   * challenge handle; `startAuthentication` runs the browser ceremony against the operator's
   * authenticator; `passkeyAuthVerify` echoes the handle with the signed assertion and, on success,
   * the server sets the session cookie and answers who is now logged in — dispatched as the same
   * `logged-in` event a password login emits, so the app shell above the shadow boundary is agnostic
   * to which credential was used.
   *
   * `startAuthentication` takes `{ optionsJSON }` in `@simplewebauthn/browser` v13 — the options blob
   * is nested under that key, not passed bare. The blob is the server's
   * `PublicKeyCredentialRequestOptionsJSON`; the client types it as an opaque `PasskeyOptions`
   * (`Record<string, unknown>`), which has no structural overlap with the concrete interface, so the
   * cast re-narrows it via `unknown` at this one call site — validated there, exactly as the
   * `PasskeyOptions` note in `api/client.ts` intends.
   *
   * Any failure — a lapsed challenge, a rejected assertion, an aborted ceremony — becomes the same
   * form-error summary a failed password login uses, falling back to
   * `passkey.verification_failed` (the code the server itself throws on a failed verify) when the
   * rejection names none. Caught here because the click handler calls this via `void`, so an
   * uncaught rejection would strand the operator with no feedback.
   */
  async #passkeyLogin(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      const { challengeHandle, options } = await this.api.passkeyAuthOptions();
      const response = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
      });
      const out = await this.api.passkeyAuthVerify({ challengeHandle, response });
      this.dispatchEvent(
        new CustomEvent("logged-in", { detail: out, bubbles: true, composed: true }),
      );
    } catch (error) {
      this.errorKey = codeOf(error, "passkey.verification_failed");
    } finally {
      this.busy = false;
    }
  }

  #renderLoginContext() {
    return html`<p class="login-context" data-test="login-context">
      ${t("login.logging_in_as")} <strong>${this.email}</strong>
    </p>`;
  }

  #renderPasswordIcon() {
    return html`
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
        <circle cx="8" cy="8" r="2"></circle>
        ${this.passwordVisible ? html`<path d="m2 2 12 12"></path>` : nothing}
      </svg>
    `;
  }

  override render() {
    if (this.token !== null) {
      return html`
        <div class="screen">
          <h1>${t("account.setup_title")}</h1>
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
          <wt-input
            class="field"
            name="new-password"
            autocomplete="new-password"
            required
            label=${t("account.new_password")}
            type="password"
            error=${this.passwordError}
            .value=${this.password}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPasswordChange(e)}
          ></wt-input>
          <wt-input
            class="field"
            name="confirm-password"
            autocomplete="new-password"
            required
            label=${t("account.confirm_password")}
            type="password"
            error=${this.confirmPasswordError}
            .value=${this.confirmPassword}
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]"))}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onConfirmPasswordChange(e)}
          ></wt-input>
          <wt-form-actions>
            <wt-button
              variant="primary"
              data-test="complete-account"
              ?disabled=${this.busy}
              @click=${() => void this.#completeAccount()}
              >${t("action.set_password")}</wt-button
            >
          </wt-form-actions>
        </div>
      `;
    }
    const submitTarget = this.step === "email" ? "continue" : "submit";
    return html`
      <div class="screen">
        <dashboard-language-chooser
          .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
        ></dashboard-language-chooser>
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${this.formErrors}
        ></wt-form-error-summary>
        ${
          this.step === "email"
            ? html`
                <wt-input
                  @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test=${submitTarget}]`))}
                  class="field"
                  name="email"
                  autocomplete="username"
                  required
                  label=${t("login.email")}
                  type="email"
                  error=${this.emailError}
                  .value=${this.email}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onEmailChange(e)}
                ></wt-input>
                <wt-form-actions>
                  <wt-button variant="primary" data-test="continue" @click=${() => this.#continue()}
                    >${t("action.continue")}</wt-button
                  >
                </wt-form-actions>
              `
            : this.step === "passkey"
              ? html`
                  ${this.#renderLoginContext()}
                  <h1>${t("login.use_passkey_heading")}</h1>
                  <p class="alternative-hint">${t("login.passkey_hint")}</p>
                  <wt-button
                    class="other-way"
                    variant="ghost"
                    data-test="try-another-way"
                    ?disabled=${this.busy}
                    @click=${() => this.#showOtherWays()}
                    >${t("login.try_another_way")}</wt-button
                  >
                  <wt-form-actions>
                    <wt-button
                      slot="cancel"
                      variant="secondary"
                      data-test="back"
                      ?disabled=${this.busy}
                      @click=${() => this.#showEmailStep()}
                      >${t("action.back")}</wt-button
                    >
                    <wt-button
                      variant="primary"
                      data-test="passkey-login"
                      ?disabled=${this.busy}
                      @click=${() => void this.#passkeyLogin()}
                      >${t("login.with_passkey")}</wt-button
                    >
                  </wt-form-actions>
                `
              : this.step === "password"
                ? html`
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
                          this.passwordVisible ? t("login.hide_password") : t("login.show_password")
                        }
                        ?disabled=${this.busy}
                        @click=${() => (this.passwordVisible = !this.passwordVisible)}
                        >${this.#renderPasswordIcon()}</wt-button
                      >
                    </wt-input>
                    <wt-button
                      class="other-way"
                      variant="ghost"
                      data-test="try-another-way"
                      ?disabled=${this.busy}
                      @click=${() => this.#showOtherWays()}
                      >${t("login.try_another_way")}</wt-button
                    >
                    <wt-form-actions>
                      <wt-button
                        slot="cancel"
                        variant="secondary"
                        data-test="back"
                        ?disabled=${this.busy}
                        @click=${() => this.#showOtherWays()}
                        >${t("action.back")}</wt-button
                      >
                      <wt-button
                        variant="primary"
                        data-test="submit"
                        ?disabled=${this.busy}
                        @click=${() => void this.#submit()}
                        >${t("action.login")}</wt-button
                      >
                    </wt-form-actions>
                  `
                : html`
                    ${this.#renderLoginContext()}
                    <h1>${t("login.other_ways_heading")}</h1>
                    <div class="alternative-list">
                      <div class="alternative-choice">
                        <wt-button
                          variant="secondary"
                          data-test="use-password"
                          ?disabled=${this.busy}
                          @click=${() => this.#showPasswordStep()}
                          >${t("login.use_password")}</wt-button
                        >
                      </div>
                      <div class="alternative-choice">
                        <wt-button
                          variant="secondary"
                          data-test="reset-by-email"
                          ?disabled=${this.busy || this.resetSent}
                          @click=${() => void this.#requestPasswordReset()}
                          >${t("login.reset_by_email")}</wt-button
                        >
                        <p class="alternative-hint">${t("login.reset_by_email_hint")}</p>
                        ${
                          this.resetSent
                            ? html`<p data-test="reset-sent">${t("login.reset_sent")}</p>`
                            : nothing
                        }
                      </div>
                    </div>
                    <wt-form-actions>
                      <wt-button
                        slot="cancel"
                        variant="secondary"
                        data-test="back-to-passkey"
                        ?disabled=${this.busy}
                        @click=${() => this.#showPasskeyStep()}
                        >${t("action.back")}</wt-button
                      >
                    </wt-form-actions>
                  `
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-login-screen": LoginScreen;
  }
}
