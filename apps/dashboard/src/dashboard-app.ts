import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "./i18n/t.js";
// Side-effect imports register the screen elements this shell swaps between; it names them only as
// tags below, so the wiring — not the screens — is what lives here.
import "./screens/login-screen.js";
import "./screens/my-schedule-screen.js";
import "./screens/staff-screen.js";
import "./screens/catalogue-screen.js";
import "./screens/layout-screen.js";
import "./screens/receipt-screen.js";
import "./screens/roster-screen.js";
import "./screens/approvals-screen.js";
import "./screens/planned-actual-screen.js";
import "./screens/purchases-screen.js";
import type { DashboardApi, PersonRole } from "./api/client.js";

/**
 * The faces of the management dashboard: sign in, view your own self-service schedule, manage staff,
 * author the catalogue, arrange the till layout, edit the receipt trim, author the roster, work the
 * approvals queues, review planned vs actual worked time, or record received purchase invoices.
 * Exactly one shows at a time. `staff`, `catalogue`, `layout`, `receipt`, `roster`, `approvals`,
 * `planned-actual` and `purchases` are the eight MANAGER faces the nav switches between; `my-schedule`
 * is the sole face of a `staff`-role session and carries no nav. All logged-in faces share the same
 * chrome (logout, plus the nav for a non-staff session).
 */
type Screen =
  | "login"
  | "my-schedule"
  | "staff"
  | "catalogue"
  | "layout"
  | "receipt"
  | "roster"
  | "approvals"
  | "planned-actual"
  | "purchases";

/**
 * The management dashboard's ROOT element — the shell that turns the screens into a working app.
 *
 * It owns one thing the whole flow shares: the injected {@link DashboardApi}. It runs a screen
 * machine (`login` | `my-schedule` | `staff` | `catalogue` | `layout` | `receipt` | `roster` |
 * `approvals` | `planned-actual` | `purchases`) and does the event wiring the screens deliberately do
 * not:
 *
 *  - boot → a SESSION PROBE ({@link DashboardApp.#probeSession}) calls `api.getMe()` (WHOAMI); a
 *    success means a live management session, so it applies the resolved role — a `staff` person
 *    lands on the self-service `my-schedule` screen, a manager/supervisor/admin on the existing
 *    manager `staff` screen — while ANY rejection (the common `management_session.required`/401, or a
 *    stray/network error) means no usable session, so it opens on `login`. The probe is fully wrapped
 *    — an unhandled rejection here would be the exact `apps/till` `#boot` defect (`docs/backlog.md`),
 *    so this shell mirrors the login/staff screens' own `try/catch`ed loaders instead;
 *  - `logged-in` (from the login screen, on a successful `api.login`) → re-probe `getMe()` to learn
 *    the freshly-authenticated person's role, then land on `my-schedule` or `staff` the same way;
 *  - the NAV (the shell's own control, shown only for a NON-staff logged-in session) switches between
 *    the eight manager faces `staff`, `catalogue`, `layout`, `receipt`, `roster`, `approvals`,
 *    `planned-actual` and `purchases` — a plain local state change, no server call. A `staff` session
 *    has no nav (the self-service view is its only face);
 *  - `logout` (the shell's own control, logged-in only) → end the server session, back to `login`.
 *
 * The default screen is `login`: before the probe resolves the shell shows the sign-in screen, and
 * only a successful probe switches it to a logged-in face — so a not-logged-in cold load never
 * flashes a screen it is not entitled to.
 *
 * HEADING OUTLINE. Each screen owns its OWN top heading — `dashboard-my-schedule-screen` renders the
 * sole `<h1>Mi horario</h1>`, `dashboard-staff-screen` the sole
 * `<h1>Usuarios</h1>`, `dashboard-catalogue-screen` the sole `<h1>Carta</h1>`,
 * `dashboard-layout-screen` the sole `<h1>Disposición</h1>`, `dashboard-receipt-screen` the sole
 * `<h1>Recibo</h1>`, `dashboard-roster-screen` the sole `<h1>Turnos</h1>`,
 * `dashboard-approvals-screen` the sole `<h1>Aprobaciones</h1>`, `dashboard-planned-actual-screen`
 * the sole `<h1>Previsto vs real</h1>`, `dashboard-purchases-screen` the sole `<h1>Compras</h1>`, and
 * `dashboard-login-screen`
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

  /** Which screen is showing. Defaults to `login`, so a cold load never flashes a logged-in face
   * before the probe confirms a session (see the class doc). */
  @state() private screen: Screen = "login";

  /** The logged-in person's role, learned from `getMe()`. `undefined` until a probe/login resolves.
   * `staff` suppresses the manager nav; the four other values keep it. NOT named `role` — that
   * collides with `HTMLElement.role` (the reflected ARIA property), which a `@state` cannot override. */
  @state() private sessionRole?: PersonRole;

  /** The logged-in person's id, threaded to the staff self-service screen (its colleague picker filters
   * this out, and it names a swap's counterparty). Empty until a probe/login resolves. */
  @state() private myPersonId = "";

  override firstUpdated(): void {
    void this.#probeSession();
  }

  /**
   * Probe for a live management session via WHOAMI (`getMe()`) — the role-blind endpoint that resolves
   * for EVERY role (a staff person holds no `person.manage`, so the old `listStaff()` probe would 403
   * them and wrongly drop them to login). A resolved response proves the httpOnly session cookie is
   * valid, so apply the role; ANY rejection means no usable session (the common
   * `management_session.required`/401, but also a stray or network error), so open on `login`. The
   * catch is deliberately total: catching only the session code would let any other rejection escape as
   * an unhandled promise rejection (the `apps/till` `#boot` follow-up, `docs/backlog.md`), and dropping
   * to login is the safe default for every failure anyway.
   */
  async #probeSession(): Promise<void> {
    try {
      this.#applyMe(await this.api.getMe());
    } catch {
      this.screen = "login";
    }
  }

  /** Land a resolved whoami on the right face: a `staff` person on the self-service `my-schedule`
   * screen, every other role on the existing manager `staff` screen. Records the id + role the shell
   * and screen both read. The ONE place the role→screen branch lives, shared by the boot probe and the
   * post-login re-probe. */
  #applyMe(me: { personId: string; role: PersonRole }): void {
    this.myPersonId = me.personId;
    this.sessionRole = me.role;
    this.screen = me.role === "staff" ? "my-schedule" : "staff";
  }

  /**
   * A confirmed login from `dashboard-login-screen`. `stopPropagation` keeps the composed, bubbling
   * `logged-in` inside the shell (the house pattern — the shell is its final consumer, so it must not
   * leak on to the document past the shadow boundary). The login route returns only `{ personId }`, so
   * the shell re-probes `getMe()` to learn the freshly-authenticated role and land on the right face.
   */
  #onLoggedIn(event: Event): void {
    event.stopPropagation();
    void this.#probeSession();
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
        ${this.sessionRole === "staff" ? nothing : this.#nav()}
        <wt-button variant="secondary" data-test="logout" @click=${() => void this.#onLogout()}
          >${t("action.logout")}</wt-button
        >
      </header>
      <div class="body">${this.#renderScreen()}</div>
    `;
  }

  /** The manager nav — the eight-face switcher, shown only for a NON-staff session (a `staff` person
   * has just the self-service view, so no nav). Extracted so the `render` chrome reads as
   * "nav-or-nothing, then logout". */
  #nav(): TemplateResult {
    return html`
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
        <wt-button
          variant=${this.screen === "planned-actual" ? "primary" : "secondary"}
          data-test="nav-planned-actual"
          @click=${() => (this.screen = "planned-actual")}
          >${t("nav.planned_actual")}</wt-button
        >
        <wt-button
          variant=${this.screen === "purchases" ? "primary" : "secondary"}
          data-test="nav-purchases"
          @click=${() => (this.screen = "purchases")}
          >${t("nav.purchases")}</wt-button
        >
      </nav>
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
      case "my-schedule":
        return html`<dashboard-my-schedule-screen
          .api=${this.api}
          .myPersonId=${this.myPersonId}
        ></dashboard-my-schedule-screen>`;
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
      case "planned-actual":
        return html`<dashboard-planned-actual-screen
          .api=${this.api}
        ></dashboard-planned-actual-screen>`;
      case "purchases":
        return html`<dashboard-purchases-screen .api=${this.api}></dashboard-purchases-screen>`;
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
