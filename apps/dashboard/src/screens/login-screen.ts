import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DashboardApi, RosterEntry } from "../api/client.js";

/**
 * The dashboard's pre-session login screen: a roster picker (native `<select>` — there is no
 * `wt-select` primitive), a password field, an optional TOTP field, and a submit button.
 *
 * It talks to the world through one injected `api` (`@property({ attribute: false })`) and one
 * event: on a successful `api.login(...)` it dispatches `logged-in` carrying `{ personId }`,
 * `bubbles`/`composed` so the app shell above the shadow boundary hears it. A rejected login — or a
 * rejected roster fetch — sets `errorKey` from the thrown `{ code }` (falling back to
 * `server.internal`), which renders raw in a `role="alert"` paragraph — a later i18n task maps those
 * codes to Spanish copy, exactly as `apps/till/src/i18n` does; the screen deliberately does not
 * translate here.
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
      select {
        font: inherit;
        padding: var(--wt-space-2);
        border-radius: var(--wt-radius-md);
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        width: 100%;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private roster: RosterEntry[] = [];
  @state() private selected = "";
  @state() private password = "";
  @state() private totp = "";
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#loadRoster();
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
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    }
  }

  /** Capture the picked person; `stopPropagation` keeps the native `change` inside this screen. */
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
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    }
  }

  override render() {
    return html`
      <label class="field"
        >Usuario
        <select .value=${this.selected} @change=${(e: Event) => this.#onRosterChange(e)}>
          ${this.roster.map((p) => html`<option value=${p.personId}>${p.displayName}</option>`)}
        </select>
      </label>
      <wt-input
        class="field"
        label="Contraseña"
        type="password"
        .value=${this.password}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPasswordChange(e)}
      ></wt-input>
      <wt-input
        class="field"
        label="Código (si procede)"
        .value=${this.totp}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onTotpChange(e)}
      ></wt-input>
      <wt-button variant="primary" data-test="submit" @click=${() => void this.#submit()}
        >Entrar</wt-button
      >
      ${this.errorKey ? html`<p class="error" role="alert">${this.errorKey}</p>` : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-login-screen": LoginScreen;
  }
}
