import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
// Side-effect imports register the two screen elements this shell swaps between; it names them only
// as tags below, so the wiring — not the screens — is what lives here.
import "./screens/login-screen.js";
import "./screens/staff-screen.js";
import type { DashboardApi } from "./api/client.js";

/** The two faces of the management dashboard: sign in, or manage staff. Exactly one shows at a time. */
type Screen = "login" | "staff";

/**
 * The management dashboard's ROOT element — the shell that turns the two screens into a working app.
 *
 * It owns one thing the whole flow shares: the injected {@link DashboardApi}. It runs a two-state
 * screen machine and does the event wiring the screens deliberately do not:
 *
 *  - boot → a SESSION PROBE ({@link DashboardApp.#probeSession}) calls `api.listStaff()`; a success
 *    means a live management session, so the app opens on `staff`; ANY rejection (the common
 *    `management_session.required`/401, or a stray/network error) means no usable session, so it
 *    opens on `login`. The probe is fully wrapped — an unhandled rejection here would be the exact
 *    `apps/till` `#boot` defect (`docs/backlog.md`), so this shell mirrors the login/staff screens'
 *    own `try/catch`ed loaders instead;
 *  - `logged-in` (from the login screen, on a successful `api.login`) → show `staff`;
 *  - `logout` (the shell's own control, staff-only) → end the server session, back to `login`.
 *
 * The default screen is `login`: before the probe resolves the shell shows the sign-in screen, and
 * only a successful probe switches it to `staff` — so a not-logged-in cold load never flashes the
 * staff screen it is not entitled to.
 *
 * HEADING OUTLINE. Each screen owns its OWN top heading — `dashboard-staff-screen` renders the sole
 * `<h1>Usuarios</h1>`, and `dashboard-login-screen` renders none — so the shell adds no competing
 * `<h1>`: its staff-screen chrome (the logout button) sits in a plain `<header>` with no heading,
 * keeping exactly one `<h1>` in the DOM at a time.
 */
@customElement("dashboard-app")
export class DashboardApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .chrome {
        display: flex;
        justify-content: flex-end;
        padding: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .body {
        padding: var(--wt-space-4);
      }
    `,
  ];

  /** The HTTP face of the dashboard. `main.ts` injects a real same-origin client; a test injects a
   * stub. Assigned as a property (`attribute: false`) — a `DashboardApi` cannot travel through an
   * attribute string. */
  @property({ attribute: false }) api!: DashboardApi;

  /** Which screen is showing. Defaults to `login`, so a cold load never flashes `staff` before the
   * probe confirms a session (see the class doc). */
  @state() private screen: Screen = "login";

  override firstUpdated(): void {
    void this.#probeSession();
  }

  /**
   * Probe for a live management session by making the cheapest session-guarded request the app
   * already has — `listStaff()`, the same call the staff screen makes on entry. A resolved response
   * proves the httpOnly session cookie is valid, so open on `staff`; ANY rejection means no usable
   * session (the common `management_session.required`/401, but also a stray or network error), so
   * open on `login`. The catch is deliberately total: catching only the session code would let any
   * other rejection escape as an unhandled promise rejection (the `apps/till` `#boot` follow-up,
   * `docs/backlog.md`), and dropping to login is the safe default for every failure anyway.
   */
  async #probeSession(): Promise<void> {
    try {
      await this.api.listStaff();
      this.screen = "staff";
    } catch {
      this.screen = "login";
    }
  }

  /**
   * A confirmed login from `dashboard-login-screen`. `stopPropagation` keeps the composed,
   * bubbling `logged-in` inside the shell (the house pattern — the shell is its final consumer, so
   * it must not leak on to the document past the shadow boundary).
   */
  #onLoggedIn(event: Event): void {
    event.stopPropagation();
    this.screen = "staff";
  }

  /**
   * End the shift: tear the server session down, then back to `login`. The await is wrapped so a
   * failed `logout()` is neither an unhandled rejection nor a reason to strand the operator on the
   * staff screen — either way the shell drops to `login` (the local session is over regardless of
   * what the server answered).
   */
  async #onLogout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // A failed logout must still drop to login; the reason it failed is not actionable here.
    }
    this.screen = "login";
  }

  override render(): TemplateResult {
    return this.screen === "login"
      ? html`<div class="body">
          <dashboard-login-screen
            .api=${this.api}
            @logged-in=${(event: Event) => this.#onLoggedIn(event)}
          ></dashboard-login-screen>
        </div>`
      : html`
          <header class="chrome">
            <wt-button variant="secondary" data-test="logout" @click=${() => void this.#onLogout()}
              >Cerrar sesión</wt-button
            >
          </header>
          <div class="body">
            <dashboard-staff-screen .api=${this.api}></dashboard-staff-screen>
          </div>
        `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-app": DashboardApp;
  }
}
