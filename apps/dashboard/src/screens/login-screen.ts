import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi } from "../api/client.js";
// The pre-login language chooser (per-user-language-preference). It emits a composed `locale-selected`;
// `dashboard-app` turns a pre-login pick into a transient `setLocale` (nothing is persisted).
import "../widgets/language-chooser.js";

/**
 * The dashboard's pre-session login screen: an email field, a password field, an optional TOTP field,
 * and a submit button (plus a passkey button and the pre-login language chooser).
 *
 * It talks to the world through one injected `api` (`@property({ attribute: false })`) and one
 * event: on a successful `api.login(...)` it dispatches `logged-in` carrying `{ personId }`,
 * `bubbles`/`composed` so the app shell above the shadow boundary hears it. A rejected login sets
 * `errorKey` from the thrown `{ code }` (falling back to `server.internal`); the raw code is kept in
 * state, and `codeMessage` (`../i18n/codes.js`) maps it to localised copy at the render edge, so the
 * `role="alert"` paragraph shows a sentence and never the raw wire code.
 */
@customElement("dashboard-login-screen")
export class LoginScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private email = "";
  @state() private password = "";
  @state() private totp = "";
  @state() private errorKey: string | null = null;

  /**
   * Capture the email field's new value. `wt-change` is dispatched `bubbles`+`composed`, so
   * `stopPropagation` is what stops it leaking past this screen's shadow boundary to the app shell.
   */
  #onEmailChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.email = event.detail.value;
  }

  /**
   * Capture the password field's new value. `wt-change` is dispatched `bubbles`+`composed`, so
   * `stopPropagation` is what stops it leaking past this screen's shadow boundary to the app shell
   * (Task 7) — the till's field handlers do the same.
   */
  #onPasswordChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.password = event.detail.value;
  }

  /** Capture the optional TOTP field's new value; stops the composed `wt-change` from leaking out. */
  #onTotpChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.totp = event.detail.value;
  }

  async #submit(): Promise<void> {
    this.errorKey = null;
    try {
      const out = await this.api.login({
        email: this.email,
        password: this.password,
        totp: this.totp === "" ? undefined : this.totp,
      });
      this.dispatchEvent(
        new CustomEvent("logged-in", { detail: out, bubbles: true, composed: true }),
      );
    } catch (error) {
      this.errorKey = codeOf(error);
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
   * `errorKey`-in-a-`role="alert"` banner a failed password login uses, falling back to
   * `passkey.verification_failed` (the code the server itself throws on a failed verify) when the
   * rejection names none. Caught here because the click handler calls this via `void`, so an
   * uncaught rejection would strand the operator with no feedback.
   */
  async #passkeyLogin(): Promise<void> {
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
    }
  }

  override render() {
    return html`
      <dashboard-language-chooser
        .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
      ></dashboard-language-chooser>
      <wt-input
        class="field"
        label=${t("login.email")}
        type="email"
        .value=${this.email}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onEmailChange(e)}
      ></wt-input>
      <wt-input
        class="field"
        label=${t("login.password")}
        type="password"
        .value=${this.password}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPasswordChange(e)}
      ></wt-input>
      <wt-input
        class="field"
        label=${t("login.totp")}
        .value=${this.totp}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onTotpChange(e)}
      ></wt-input>
      <wt-button variant="primary" data-test="submit" @click=${() => void this.#submit()}
        >${t("action.login")}</wt-button
      >
      <wt-button
        variant="secondary"
        data-test="passkey-login"
        @click=${() => void this.#passkeyLogin()}
        >${t("login.with_passkey")}</wt-button
      >
      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-login-screen": LoginScreen;
  }
}
