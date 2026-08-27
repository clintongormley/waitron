import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, RosterEntry } from "../api/client.js";
import { selectStyles } from "../select-styles.js";
// The pre-login language chooser (per-user-language-preference). It emits a composed `locale-selected`;
// `dashboard-app` turns a pre-login pick into a transient `setLocale` (nothing is persisted).
import "../widgets/language-chooser.js";

/**
 * The dashboard's pre-session login screen: a roster picker (native `<select>` — there is no
 * `wt-select` primitive), a password field, an optional TOTP field, and a submit button.
 *
 * It talks to the world through one injected `api` (`@property({ attribute: false })`) and one
 * event: on a successful `api.login(...)` it dispatches `logged-in` carrying `{ personId }`,
 * `bubbles`/`composed` so the app shell above the shadow boundary hears it. A rejected login — or a
 * rejected roster fetch — sets `errorKey` from the thrown `{ code }` (falling back to
 * `server.internal`); the raw code is kept in state, and `codeMessage` (`../i18n/codes.js`) maps it to
 * localised copy at the render edge, so the `role="alert"` paragraph shows a sentence and never the
 * raw wire code.
 */
@customElement("dashboard-login-screen")
export class LoginScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
  @state() private roster: RosterEntry[] = [];
  @state() private selected = "";
  @state() private password = "";
  @state() private totp = "";
  @state() private errorKey: string | null = null;

  // A handle to the native roster <select>, reconciled to `selected` in `updated()` (see that method
  // for why a template binding cannot do this on a native select).
  #rosterSelect = createRef<HTMLSelectElement>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#loadRoster();
  }

  /**
   * Reconcile the native roster <select>'s live value to `selected` after every render, once its
   * <option> children are in the DOM. A `.value` bound in the template commits BEFORE the options
   * exist, so a selection that is not the first roster entry would fall back to the first (the latent
   * picker bug #73 fixed in the edit dialog; the create form mirrors it). Today `#loadRoster` always
   * selects roster[0] — the first option — so a template binding renders right only by luck; setting
   * `.value` here keeps the picker correct even if the initial-selection policy ever changes. Setting
   * `.value` imperatively does not trigger a reactive update, so this does not loop.
   *
   * The ref is normally live (the `<select>` renders unconditionally). The one case it is NOT: when the
   * shell re-keys this screen to repaint it in a new language (`dashboard-app`'s `keyed(currentLocale(), …)`),
   * a pending update can flush on the OUTGOING element after Lit has cleared its refs on disconnect. So
   * GUARD the access — a reconcile with no live `<select>` is simply a no-op (the element is on its way
   * out). Without the guard that flush throws `Cannot set properties of undefined`, an unhandled
   * rejection the pristine-output rule forbids.
   */
  override updated(): void {
    if (this.#rosterSelect.value) this.#rosterSelect.value.value = this.selected;
  }

  /**
   * Fetch the roster once on connect. Called via `void this.#loadRoster()`, so a rejected
   * `getStaffRoster()` MUST be caught here — otherwise it is an unhandled promise rejection and the
   * operator is stranded at an empty `<select>` with no feedback. A rejection becomes the same
   * `errorKey`-in-a-`role="alert"`-banner state a failed login uses, mirroring the till's
   * `#loadStaff`.
   */
  async #loadRoster(): Promise<void> {
    try {
      this.roster = await this.api.getStaffRoster();
      if (this.roster[0]) this.selected = this.roster[0].personId;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /**
   * Capture the picked person. A native `<select>` `change` is `composed: false`, so it cannot cross
   * this screen's shadow boundary anyway — the `stopPropagation` here is defensive consistency with the
   * composed `wt-change` handlers below, not a boundary guard.
   */
  #onRosterChange(event: Event): void {
    event.stopPropagation();
    this.selected = (event.target as HTMLSelectElement).value;
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
        personId: this.selected,
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
      <label class="field"
        >${t("login.roster")}
        <select ${ref(this.#rosterSelect)} @change=${(e: Event) => this.#onRosterChange(e)}>
          ${this.roster.map((p) => html`<option value=${p.personId}>${p.displayName}</option>`)}
        </select>
      </label>
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
