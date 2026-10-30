import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  startAuthentication,
  WebAuthnAbortService,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { baseStyles, formMessage, formMessageStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DashboardApi, FreshSignInBody, OwnProfile } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { classifyPasskeySignInError } from "../passkey-errors.js";
import { LocaleChangeController } from "../state/locale-controller.js";

export interface SignInWays {
  password: boolean;
  passkey: boolean;
}

type Field = "password" | "code";

/**
 * Asks the signed-in person to prove again who they are, by their password or a passkey, plus their
 * authenticator or a recovery code when they have one. The screen holding it owns the action: it
 * calls `signIn()` for the body to send, hands any failure to `refuse()`, and calls `clear()` on
 * close. Fires `sign-in-ways` once the profile is read, `sign-in-passkey` when the passkey button is
 * pressed, and `sign-in-change` on every edit.
 */
@customElement("dashboard-fresh-sign-in")
export class FreshSignIn extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      p {
        margin: 0;
      }
      svg {
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<
    DashboardApi,
    "getProfile" | "recoveryPackPasskeyOptions"
  >;
  @property({ type: Boolean }) disabled = false;

  @state() private profile: OwnProfile | null = null;
  @state() private profileFailed = false;
  @state() private password = "";
  @state() private code = "";
  @state() private revealed = false;
  @state() private errors: Partial<Record<Field, string>> = {};
  @state() private message = "";

  #attempt = 0;
  #prompting = false;
  #reads = 0;
  /** The way the last press checked, so later edits re-check the fields that way needs. */
  #checked: "password" | "passkey" | null = null;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  /** Which ways in the person has; null until the profile is read. */
  get ways(): SignInWays | null {
    const own = this.profile;
    return own === null ? null : { password: own.hasPassword, passkey: own.passkeys.length > 0 };
  }

  /** Whether anything is typed into the password or the code. */
  get typed(): boolean {
    return this.password !== "" || this.code !== "";
  }

  /** Whether, since a press, a field the form needs is empty. A refusal under a field is not this. */
  get invalid(): boolean {
    return this.#checked !== null && Object.keys(this.#ownErrors(this.#checked)).length > 0;
  }

  /** Whether any field shows a sentence, the form's own or a refusal's. */
  get marked(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  #ownErrors(way: "password" | "passkey"): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (way === "password" && this.password === "") errors.password = t("form.password_required");
    if (this.profile?.hasTotp && this.code.trim() === "")
      errors.code = t("fresh_sign_in.code_required");
    return errors;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.profile === null) void this.#readProfile();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#closePrompt();
  }

  /** The library's cancel stops whichever ceremony the page has open, so only while it is ours. */
  #closePrompt(): void {
    this.#attempt++;
    if (this.#prompting) WebAuthnAbortService.cancelCeremony();
    this.#prompting = false;
  }

  async #readProfile(): Promise<void> {
    const read = ++this.#reads;
    this.profileFailed = false;
    try {
      const own = await this.api.getProfile();
      if (read !== this.#reads) return;
      this.profile = own;
      if (this.errors.code !== undefined && !own.hasTotp) {
        this.errors = {};
        this.message = t("fresh_sign_in.code_no_longer_needed");
      }
      this.dispatchEvent(
        new CustomEvent<SignInWays>("sign-in-ways", {
          detail: this.ways!,
          bubbles: true,
          composed: true,
        }),
      );
    } catch {
      if (read === this.#reads) this.profileFailed = true;
    }
  }

  /**
   * The `signIn` value to send, or null when there is nothing to send: a required field is empty
   * (its sentence is then shown under it), the person cancelled the passkey prompt, or they have no
   * way in. Throws whatever the passkey options read or the prompt threw; hand that to `refuse()`.
   */
  async signIn(method?: "password" | "passkey"): Promise<FreshSignInBody | null> {
    const ways = this.ways;
    if (ways === null) return null;
    const way = method ?? (ways.password ? "password" : "passkey");
    if (way === "password" && !ways.password) return null;
    if (!ways.password && !ways.passkey) return null;
    this.message = "";
    this.#checked = way;
    const errors = this.#ownErrors(way);
    const code = this.code.trim();
    const digits = code.replace(/\s+/g, "");
    this.errors = errors;
    if (Object.keys(errors).length > 0) return null;
    const codes = !this.profile!.hasTotp
      ? {}
      : /^\d{6}$/.test(digits)
        ? { totp: digits }
        : { recoveryCode: code };
    if (way === "password") return { method: "password", password: this.password, ...codes };
    const attempt = ++this.#attempt;
    try {
      const { challengeHandle, options } = await this.api.recoveryPackPasskeyOptions();
      if (attempt !== this.#attempt) return null;
      this.#prompting = true;
      const response = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
      }).finally(() => {
        if (attempt === this.#attempt) this.#prompting = false;
      });
      if (attempt !== this.#attempt) return null;
      return { method: "passkey", challengeHandle, response, ...codes };
    } catch (error) {
      if (attempt !== this.#attempt || classifyPasskeySignInError(error) === "cancelled")
        return null;
      throw error;
    }
  }

  /**
   * Shows a sign-in refusal: under its field when it names one (answering ""), otherwise answers
   * the sentence for the screen's bottom message.
   */
  refuse(error: unknown): string {
    this.message = "";
    const passkey = classifyPasskeySignInError(error);
    if (passkey === "cancelled") return "";
    if (passkey === "failed") return codeMessage("passkey.verification_failed");
    const code = codeOf(error, "server.internal");
    if (code === "password.invalid") {
      this.errors = { password: codeMessage(code) };
      return "";
    }
    if (code === "totp.invalid" || code === "totp.required") {
      // A profile read before an authenticator was added draws no code field to type into.
      const stale = !this.profile?.hasTotp;
      this.errors = { code: codeMessage(stale ? "totp.required" : code) };
      if (stale) void this.#readProfile();
      return "";
    }
    if (code === "passkey.not_registered")
      return this.ways?.password
        ? t("fresh_sign_in.passkey_not_registered")
        : `${t("fresh_sign_in.no_way_in")} ${t("profile.password_recovery")}`;
    return codeMessage(code);
  }

  /** Forgets everything typed, and closes a passkey prompt still open, dropping its answer. */
  clear(): void {
    this.#closePrompt();
    this.#checked = null;
    this.password = "";
    this.code = "";
    this.revealed = false;
    this.errors = {};
    this.message = "";
  }

  #edit(field: Field, value: string): void {
    if (field === "password") this.password = value;
    else this.code = value;
    this.message = "";
    const own = this.#checked === null ? undefined : this.#ownErrors(this.#checked)[field];
    const rest = Object.fromEntries(Object.entries(this.errors).filter(([key]) => key !== field));
    this.errors = own === undefined ? rest : { ...rest, [field]: own };
    this.dispatchEvent(new CustomEvent("sign-in-change", { bubbles: true, composed: true }));
  }

  override render() {
    if (this.profileFailed)
      return html`<p data-test="profile-failed" role="alert">
          ${t("fresh_sign_in.profile_failed")}
        </p>
        <div>
          <wt-button data-test="profile-retry" @click=${() => void this.#readProfile()}
            >${t("fresh_sign_in.retry")}</wt-button
          >
        </div>`;
    const ways = this.ways;
    if (ways === null) return nothing;
    if (!ways.password && !ways.passkey)
      return html`<p data-test="no-way-in">
        ${t("fresh_sign_in.no_way_in")} ${t("profile.password_recovery")}
      </p>`;
    return html`
      ${ways.password ? this.#passwordField() : nothing}
      ${this.profile!.hasTotp ? this.#codeField() : nothing}
      <div>
        <wt-button
          data-test="use-passkey"
          variant=${ways.password ? "secondary" : "primary"}
          ?disabled=${this.disabled}
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent("sign-in-passkey", { bubbles: true, composed: true }),
            )}
          >${t(ways.password ? "fresh_sign_in.use_passkey_instead" : "fresh_sign_in.use_passkey")}</wt-button
        >
      </div>
      ${formMessage(this.message)}
    `;
  }

  #passwordField() {
    const revealed = this.revealed;
    return html`<wt-input
      name="current-password"
      label=${t("fresh_sign_in.password")}
      required
      ?disabled=${this.disabled}
      type=${revealed ? "text" : "password"}
      autocomplete="current-password"
      .value=${this.password}
      error=${this.errors.password ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#edit("password", event.detail.value);
      }}
    >
      <wt-button
        slot="end"
        variant="ghost"
        aria-label=${t(revealed ? "login.hide_password" : "login.show_password")}
        @click=${() => {
          this.revealed = !revealed;
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
          <circle cx="8" cy="8" r="2"></circle>
          ${revealed ? html`<path d="m2 2 12 12"></path>` : nothing}
        </svg>
      </wt-button>
    </wt-input>`;
  }

  #codeField() {
    return html`<wt-input
      name="totp"
      label=${t("fresh_sign_in.code")}
      placeholder=${t("fresh_sign_in.code_hint")}
      required
      ?disabled=${this.disabled}
      autocomplete="one-time-code"
      .value=${this.code}
      error=${this.errors.code ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#edit("code", event.detail.value);
      }}
    ></wt-input>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-fresh-sign-in": FreshSignIn;
  }
}
