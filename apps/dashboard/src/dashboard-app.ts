import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "./i18n/t.js";
// Side-effect imports register the screen elements this shell swaps between; it names them only as
// tags below, so the wiring — not the screens — is what lives here.
import "./screens/login-screen.js";
import "./screens/staff-screen.js";
import "./screens/catalogue-screen.js";
import "./screens/layout-screen.js";
import "./screens/receipt-screen.js";
import "./screens/roster-screen.js";
import "./screens/approvals-screen.js";
import type { DashboardApi } from "./api/client.js";

/**
 * The faces of the management dashboard: sign in, manage staff, author the catalogue, arrange the till
 * layout, edit the receipt trim, author the roster, or work the approvals queues. Exactly one shows at
 * a time. `staff`, `catalogue`, `layout`, `receipt`, `roster` and `approvals` are the six LOGGED-IN
 * faces the nav switches between; all carry the same chrome (nav + logout).
 */
type Screen = "login" | "staff" | "catalogue" | "layout" | "receipt" | "roster" | "approvals";

/**
 * The management dashboard's ROOT element — the shell that turns the screens into a working app.
 *
 * It owns one thing the whole flow shares: the injected {@link DashboardApi}. It runs a screen
 * machine (`login` | `staff` | `catalogue` | `layout` | `receipt` | `roster` | `approvals`) and does
 * the event wiring the screens deliberately do not:
 *
 *  - boot → a SESSION PROBE ({@link DashboardApp.#probeSession}) calls `api.listStaff()`; a success
 *    means a live management session, so the app opens on `staff`; ANY rejection (the common
 *    `management_session.required`/401, or a stray/network error) means no usable session, so it
 *    opens on `login`. The probe is fully wrapped — an unhandled rejection here would be the exact
 *    `apps/till` `#boot` defect (`docs/backlog.md`), so this shell mirrors the login/staff screens'
 *    own `try/catch`ed loaders instead;
 *  - `logged-in` (from the login screen, on a successful `api.login`) → show `staff`;
 *  - the NAV (the shell's own control, shown only when logged in) switches between the six logged-in
 *    faces `staff`, `catalogue`, `layout`, `receipt`, `roster` and `approvals` — a plain local state
 *    change, no server call;
 *  - `logout` (the shell's own control, logged-in only) → end the server session, back to `login`.
 *
 * The default screen is `login`: before the probe resolves the shell shows the sign-in screen, and
 * only a successful probe switches it to `staff` — so a not-logged-in cold load never flashes the
 * staff screen it is not entitled to.
 *
 * HEADING OUTLINE. Each screen owns its OWN top heading — `dashboard-staff-screen` renders the sole
 * `<h1>Usuarios</h1>`, `dashboard-catalogue-screen` the sole `<h1>Carta</h1>`,
 * `dashboard-layout-screen` the sole `<h1>Disposición</h1>`, `dashboard-receipt-screen` the sole
 * `<h1>Recibo</h1>`, `dashboard-roster-screen` the sole `<h1>Turnos</h1>`,
 * `dashboard-approvals-screen` the sole `<h1>Aprobaciones</h1>`, and `dashboard-login-screen`
 * none — so the shell adds no competing `<h1>`: its
 * logged-in chrome (the nav + logout button) sits in a plain `<header>` with no heading, keeping
 * exactly one `<h1>` in the DOM at a time.
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
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .nav {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
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
    if (this.screen === "login") {
      return html`<div class="body">
        <dashboard-login-screen
          .api=${this.api}
          @logged-in=${(event: Event) => this.#onLoggedIn(event)}
        ></dashboard-login-screen>
      </div>`;
    }
    return html`
      <header class="chrome">
        <nav class="nav" aria-label=${t("nav.sections")}>
          <wt-button
            variant=${this.screen === "staff" ? "primary" : "secondary"}
            data-test="nav-staff"
            @click=${() => (this.screen = "staff")}
            >${t("nav.staff")}</wt-button
          >
          <wt-button
            variant=${this.screen === "catalogue" ? "primary" : "secondary"}
            data-test="nav-catalogue"
            @click=${() => (this.screen = "catalogue")}
            >${t("nav.catalogue")}</wt-button
          >
          <wt-button
            variant=${this.screen === "layout" ? "primary" : "secondary"}
            data-test="nav-layout"
            @click=${() => (this.screen = "layout")}
            >${t("nav.layout")}</wt-button
          >
          <wt-button
            variant=${this.screen === "receipt" ? "primary" : "secondary"}
            data-test="nav-receipt"
            @click=${() => (this.screen = "receipt")}
            >${t("nav.receipt")}</wt-button
          >
          <wt-button
            variant=${this.screen === "roster" ? "primary" : "secondary"}
            data-test="nav-roster"
            @click=${() => (this.screen = "roster")}
            >${t("nav.roster")}</wt-button
          >
          <wt-button
            variant=${this.screen === "approvals" ? "primary" : "secondary"}
            data-test="nav-approvals"
            @click=${() => (this.screen = "approvals")}
            >${t("nav.approvals")}</wt-button
          >
        </nav>
        <wt-button variant="secondary" data-test="logout" @click=${() => void this.#onLogout()}
          >${t("action.logout")}</wt-button
        >
      </header>
      <div class="body">${this.#renderScreen()}</div>
    `;
  }

  /**
   * The mounted logged-in face for the current `screen`. Reached only from the chrome branch of
   * {@link DashboardApp.render}, where `screen` is never `login`, so `staff` is the default: it is the
   * probe's landing and the post-login/post-logout return, and folding it into the default keeps that
   * branch covered rather than leaving an unreachable exhaustive `default`.
   */
  #renderScreen(): TemplateResult {
    switch (this.screen) {
      case "catalogue":
        return html`<dashboard-catalogue-screen .api=${this.api}></dashboard-catalogue-screen>`;
      case "layout":
        return html`<dashboard-layout-screen .api=${this.api}></dashboard-layout-screen>`;
      case "receipt":
        return html`<dashboard-receipt-screen .api=${this.api}></dashboard-receipt-screen>`;
      case "roster":
        return html`<dashboard-roster-screen .api=${this.api}></dashboard-roster-screen>`;
      case "approvals":
        return html`<dashboard-approvals-screen .api=${this.api}></dashboard-approvals-screen>`;
      default:
        return html`<dashboard-staff-screen .api=${this.api}></dashboard-staff-screen>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-app": DashboardApp;
  }
}
