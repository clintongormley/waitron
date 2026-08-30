import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles } from "@waitron/ui";
import { resolveActiveLocale } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { LocaleChangeController } from "./state/locale-controller.js";
// Side-effect imports register the screen elements this shell swaps between; it names them only as
// tags below, so the wiring — not the screens — is what lives here.
import "./widgets/language-chooser.js";
import "./screens/login-screen.js";
import "./screens/my-schedule-screen.js";
import "./screens/dashboard-overview-screen.js";
import "./screens/dashboard-sales-screen.js";
import "./screens/staff-screen.js";
import "./screens/catalogue-screen.js";
import "./screens/layout-screen.js";
import "./screens/receipt-screen.js";
import "./screens/service-status-screen.js";
import "./screens/floor-screen.js";
import "./screens/kitchen-screen.js";
import "./screens/roster-screen.js";
import "./screens/approvals-screen.js";
import "./screens/planned-actual-screen.js";
import "./screens/purchases-screen.js";
import "./screens/recipe-screen.js";
import "./screens/devices-screen.js";
import "./screens/printers-screen.js";
import type { DashboardApi, PersonRole } from "./api/client.js";

/**
 * The faces of the management dashboard: sign in, view your own self-service schedule, manage staff,
 * author the catalogue, arrange the till layout, edit the receipt trim, configure the table service
 * statuses, arrange the floor plan (zones + tables), configure the kitchen (stations + bump mode),
 * author the roster, work the approvals queues, review planned vs actual worked time, record received
 * purchase invoices, author ingredients and product recipes, manage enrolled devices, manage printing
 * (agents + printers + status), see today's business overview, or review sales & takings over a date
 * range. Exactly one shows at a time. `overview`, `sales`, `staff`, `catalogue`, `layout`, `receipt`,
 * `statuses`, `floor`, `kitchen`, `roster`, `approvals`, `planned-actual`, `purchases`, `recipe`,
 * `devices` and `printers` are the sixteen MANAGER faces the nav switches between — `overview` is also
 * the post-login/post-probe LANDING for every non-staff role (Task 9); `my-schedule` is the sole face
 * of a `staff`-role session and carries no nav. All logged-in faces share the same chrome (logout, plus
 * the nav for a non-staff session).
 */
type Screen =
  | "login"
  | "my-schedule"
  | "overview"
  | "sales"
  | "staff"
  | "catalogue"
  | "layout"
  | "receipt"
  | "statuses"
  | "floor"
  | "kitchen"
  | "roster"
  | "approvals"
  | "planned-actual"
  | "purchases"
  | "recipe"
  | "devices"
  | "printers";

/**
 * The management dashboard's ROOT element — the shell that turns the screens into a working app.
 *
 * It owns one thing the whole flow shares: the injected {@link DashboardApi}. It runs a screen
 * machine (`login` | `my-schedule` | `overview` | `sales` | `staff` | `catalogue` | `layout` |
 * `receipt` | `statuses` | `floor` | `kitchen` | `roster` | `approvals` | `planned-actual` |
 * `purchases` | `recipe` | `devices` | `printers`) and does the event wiring the screens deliberately
 * do not:
 *
 *  - boot → a SESSION PROBE ({@link DashboardApp.#probeSession}) calls `api.getMe()` (WHOAMI); a
 *    success means a live management session, so it applies the resolved role — a `staff` person
 *    lands on the self-service `my-schedule` screen, a manager/supervisor/admin on the business
 *    `overview` screen (registered Task 9 — the "today at a glance" home) — while ANY rejection (the
 *    common `management_session.required`/401, or a stray/network error) means no usable session, so
 *    it opens on `login`. The probe is fully wrapped
 *    — an unhandled rejection here would be the exact `apps/till` `#boot` defect (`docs/backlog.md`),
 *    so this shell mirrors the login/staff screens' own `try/catch`ed loaders instead;
 *  - `logged-in` (from the login screen, on a successful `api.login`) → re-probe `getMe()` to learn
 *    the freshly-authenticated person's role, then land on `my-schedule` or `overview` the same way;
 *  - the NAV (the shell's own control, shown only for a NON-staff logged-in session) switches between
 *    the sixteen manager faces `overview`, `sales`, `staff`, `catalogue`, `layout`, `receipt`,
 *    `statuses`, `floor`, `kitchen`, `roster`, `approvals`, `planned-actual`, `purchases`, `recipe`,
 *    `devices` and `printers` — a plain local state change, no server call. A `staff` session has no
 *    nav (the self-service view is its only face);
 *  - `logout` (the shell's own control, logged-in only) → end the server session, back to `login`.
 *
 * The default screen is `login`: before the probe resolves the shell shows the sign-in screen, and
 * only a successful probe switches it to a logged-in face — so a not-logged-in cold load never
 * flashes a screen it is not entitled to.
 *
 * HEADING OUTLINE. Each screen owns its OWN top heading — `dashboard-my-schedule-screen` renders the
 * sole `<h1>Mi horario</h1>`, `dashboard-overview-screen` the sole `<h1>Hoy de un vistazo</h1>`,
 * `dashboard-sales-screen` the sole `<h1>Ventas y recaudación</h1>`, `dashboard-staff-screen` the sole
 * `<h1>Usuarios</h1>`, `dashboard-catalogue-screen` the sole `<h1>Carta</h1>`,
 * `dashboard-layout-screen` the sole `<h1>Disposición</h1>`, `dashboard-receipt-screen` the sole
 * `<h1>Recibo</h1>`, `dashboard-service-status-screen` the sole `<h1>Estados de servicio</h1>`,
 * `dashboard-floor-screen` the sole `<h1>Sala</h1>`, `dashboard-kitchen-screen` the sole
 * `<h1>Cocina</h1>`, `dashboard-roster-screen` the sole `<h1>Turnos</h1>`,
 * `dashboard-approvals-screen` the sole `<h1>Aprobaciones</h1>`, `dashboard-planned-actual-screen`
 * the sole `<h1>Previsto vs real</h1>`, `dashboard-purchases-screen` the sole `<h1>Compras</h1>`,
 * `dashboard-recipe-screen` the sole `<h1>Recetas</h1>`, `dashboard-devices-screen` the sole
 * `<h1>Dispositivos</h1>`, `dashboard-printers-screen` the sole `<h1>Impresoras</h1>`, and
 * `dashboard-login-screen`
 * none — so the shell adds no competing `<h1>`: its
 * logged-in chrome (the nav + logout button) sits in a plain `<header>` with no heading, keeping
 * exactly one `<h1>` in the DOM at a time.
 *
 * DISCONNECT SAFETY (per-user-language-preference). `setLocale` mutates module-global locale, so it is
 * the one effect that can outlive the element. It runs on FOUR post-await paths, and each carries
 * `if (!this.isConnected) return` before the switch so a teardown during the await skips it —
 * {@link DashboardApp.#seedLocale} (the boot venue-default seed), {@link DashboardApp.#applyMe} (invoked
 * as `#applyMe(await getMe())`, so the probe's round trip is the await), {@link DashboardApp.#onLogout}
 * (the venue-default revert, after the logout round trip) and {@link DashboardApp.#onLocaleSelected}'s
 * PERSIST path (the preference write has already landed and the next login re-applies it, so only the
 * pointless local repaint is skipped). The TRANSIENT (`screen === "login"`) branch of
 * `#onLocaleSelected` runs its `setLocale` SYNCHRONOUSLY before any await, so it needs no guard. Each
 * guarded site is pinned by a deletion-proven disconnect test. Every OTHER state write here is
 * reactive-only and needs no guard — Lit never paints a detached element.
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

      /* The right-hand chrome group: the language chooser sits beside the logout button, so the two
         travel together while the nav stays on the far side (space-between). */
      .actions {
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

  /**
   * The venue's DERIVED default UI locale (per-user-language-preference), read from
   * `GET /management-api/locales` on boot ({@link #seedLocale}) — the dashboard has no venue locale until
   * this task, so it SEEDS the login screen in the venue's language. It is also the fallback
   * `resolveActiveLocale(personLocale, this.#venueLocale)` falls back to on login ({@link #applyMe}) when
   * the signed-in person has no stored preference. Defaults to the deli's es-ES until boot resolves.
   */
  #venueLocale = "es-ES";

  constructor() {
    super();
    // Follow a locale switch made anywhere (seed/login/the chooser's setLocale): on a locale change the
    // controller calls requestUpdate(), re-running render() so `keyed(currentLocale(), …)` re-keys and the
    // screen repaints. The screens read `t()` at render time, so recreating them applies the switch.
    new LocaleChangeController(this);
  }

  override firstUpdated(): void {
    void this.#boot();
  }

  /**
   * Boot: probe for a session, THEN — only when none was found (still on `login`) — seed the login
   * screen in the venue's language. The two are serialized deliberately, not raced:
   *  - a LOGGED-IN probe's {@link #applyMe} already sets the UI locale from the WHOAMI (`me.locale`
   *    resolved against `me.venueLocale`) and remembers `venueLocale`, so a venue-default seed
   *    afterwards would both fire a REDUNDANT `getLocales` and risk CLOBBERING the person's applied
   *    locale. Gating the seed on `screen === "login"` removes both — the logged-in path makes exactly
   *    one WHOAMI round trip;
   *  - a NO-SESSION probe leaves `screen === "login"`, so the seed runs and localises the sign-in screen.
   * `#probeSession` swallows its own rejection (→ `login`), so this never throws.
   */
  async #boot(): Promise<void> {
    await this.#probeSession();
    if (this.screen === "login") await this.#seedLocale();
  }

  /**
   * Read the venue's offered languages and SEED the UI to the venue default, so the pre-auth login
   * screen renders in the venue's language rather than the module default. Reached only from {@link #boot}
   * on the no-session path. A failure (server unreachable, a non-2xx `{ code }`) is swallowed — the UI
   * simply stays on the module default; this is cosmetic pre-auth polish, never a reason to block sign-in.
   */
  async #seedLocale(): Promise<void> {
    try {
      const { venueDefault } = await this.api.getLocales();
      // Guard the post-await module-global `setLocale`: a teardown during the fetch must not repaint a
      // live sibling's locale (the DISCONNECT SAFETY note). The `#venueLocale` write below the guard is
      // harmless to skip on a detached element — nothing reads it after teardown.
      if (!this.isConnected) return;
      this.#venueLocale = venueDefault;
      setLocale(venueDefault);
    } catch {
      // Stay on the module default — a failed locale read must never block sign-in.
    }
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
   * screen, every other role (supervisor/manager/admin) on the business `overview` screen — the
   * post-login landing since Task 9 (previously the manager `staff` screen; `staff` is still one nav
   * click away). Records the id + role the shell and screen both read. The ONE place the role→screen
   * branch lives, shared by the boot probe and the post-login re-probe.
   *
   * Per-user-language-preference: also apply the signed-in person's UI language —
   * `resolveActiveLocale(me.locale, me.venueLocale)`, their supported stored choice else the venue
   * default — and remember the venue default for later. `#applyMe` is invoked as `#applyMe(await
   * getMe())`, so the module-global `setLocale` runs POST-AWAIT: a teardown during the probe must not
   * repaint a live sibling's locale (the DISCONNECT SAFETY note). The reactive state writes above the
   * guard are harmless on a detached element (Lit never paints one), so only `setLocale` is guarded. */
  #applyMe(me: {
    personId: string;
    role: PersonRole;
    locale: string | null;
    venueLocale: string;
  }): void {
    this.myPersonId = me.personId;
    this.sessionRole = me.role;
    this.screen = me.role === "staff" ? "my-schedule" : "overview";
    this.#venueLocale = me.venueLocale;
    if (!this.isConnected) return;
    setLocale(resolveActiveLocale(me.locale, me.venueLocale));
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
    // Revert the UI to the venue default (per-user-language-preference): the previous operator's chosen
    // language must not linger into the login screen the next person meets — their own login re-applies
    // their stored preference. Guard the post-await module-global `setLocale` (the DISCONNECT SAFETY
    // note): a teardown during the logout round trip must not repaint a live sibling's locale.
    if (!this.isConnected) return;
    setLocale(this.#venueLocale);
  }

  /**
   * The ONE handler for a language pick (per-user-language-preference). The chooser is presentational —
   * it emits a composed `locale-selected` carrying only the chosen `code`; this decides what the pick
   * MEANS, and that turns entirely on whether anyone is signed in:
   *  - PRE-LOGIN (`screen === "login"`): a TRANSIENT switch. Switch the UI (`setLocale`) but write
   *    NOTHING — there is no session to attach a preference to. This runs synchronously before any
   *    await, so the element is still connected and it needs no disconnect guard.
   *  - LOGGED IN: PERSIST the operator's preference (`putLocale`) and only THEN switch the UI, so a
   *    failed save leaves the language unchanged (the shell has no error banner — the write simply does
   *    not take effect and the current language stands). The post-await `setLocale` is disconnect-guarded
   *    (the DISCONNECT SAFETY note): the durable write has already landed and the next login re-applies
   *    it, so a teardown mid-write skips only the now-pointless local repaint.
   */
  async #onLocaleSelected(event: CustomEvent<{ code: string }>): Promise<void> {
    const { code } = event.detail;
    if (this.screen === "login") {
      setLocale(code);
      return;
    }
    try {
      await this.api.putLocale(code);
      if (!this.isConnected) return;
      setLocale(code);
    } catch {
      // Leave the language unchanged on a failed save — the switch is gated behind the durable write.
    }
  }

  override render(): TemplateResult {
    if (this.screen === "login") {
      // The login screen's own chooser bubbles its composed `locale-selected` up to this `<div>`, where
      // `#onLocaleSelected` turns a pre-login pick into a transient switch. `keyed(currentLocale(), …)`
      // recreates the login screen on a locale change so it repaints in the new language (it holds no controller).
      return html`<div
        class="body"
        @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
      >
        ${keyed(
          currentLocale(),
          html`<dashboard-login-screen
            .api=${this.api}
            @logged-in=${(event: Event) => this.#onLoggedIn(event)}
          ></dashboard-login-screen>`,
        )}
      </div>`;
    }
    return html`
      <header
        class="chrome"
        @locale-selected=${(e: CustomEvent<{ code: string }>) => void this.#onLocaleSelected(e)}
      >
        ${this.sessionRole === "staff" ? nothing : this.#nav()}
        <div class="actions">
          <dashboard-language-chooser
            .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
          ></dashboard-language-chooser>
          <wt-button variant="secondary" data-test="logout" @click=${() => void this.#onLogout()}
            >${t("action.logout")}</wt-button
          >
        </div>
      </header>
      <!-- keyed on the active locale: a switch changes the key, so Lit discards and rebuilds the screen
           subtree, repainting every child in the new language (the screens hold no controller). -->
      <div class="body">${keyed(currentLocale(), this.#renderScreen())}</div>
    `;
  }

  /** The manager nav — the sixteen-face switcher, shown only for a NON-staff session (a `staff` person
   * has just the self-service view, so no nav). `overview` leads (it's the post-login landing/home),
   * `sales` follows it (the two reporting faces sit together). Extracted so the `render` chrome reads
   * as "nav-or-nothing, then logout". */
  #nav(): TemplateResult {
    return html`
      <nav class="nav" aria-label=${t("nav.sections")}>
        <wt-button
          variant=${this.screen === "overview" ? "primary" : "secondary"}
          data-test="nav-overview"
          @click=${() => (this.screen = "overview")}
          >${t("nav.overview")}</wt-button
        >
        <wt-button
          variant=${this.screen === "sales" ? "primary" : "secondary"}
          data-test="nav-sales"
          @click=${() => (this.screen = "sales")}
          >${t("nav.sales")}</wt-button
        >
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
          variant=${this.screen === "statuses" ? "primary" : "secondary"}
          data-test="nav-statuses"
          @click=${() => (this.screen = "statuses")}
          >${t("nav.statuses")}</wt-button
        >
        <wt-button
          variant=${this.screen === "floor" ? "primary" : "secondary"}
          data-test="nav-floor"
          @click=${() => (this.screen = "floor")}
          >${t("nav.floor")}</wt-button
        >
        <wt-button
          variant=${this.screen === "kitchen" ? "primary" : "secondary"}
          data-test="nav-kitchen"
          @click=${() => (this.screen = "kitchen")}
          >${t("nav.kitchen")}</wt-button
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
        <wt-button
          variant=${this.screen === "recipe" ? "primary" : "secondary"}
          data-test="nav-recipe"
          @click=${() => (this.screen = "recipe")}
          >${t("nav.recipe")}</wt-button
        >
        <wt-button
          variant=${this.screen === "devices" ? "primary" : "secondary"}
          data-test="nav-devices"
          @click=${() => (this.screen = "devices")}
          >${t("nav.devices")}</wt-button
        >
        <wt-button
          variant=${this.screen === "printers" ? "primary" : "secondary"}
          data-test="nav-printers"
          @click=${() => (this.screen = "printers")}
          >${t("nav.printers")}</wt-button
        >
      </nav>
    `;
  }

  /**
   * The mounted logged-in face for the current `screen`. Reached only from the chrome branch of
   * {@link DashboardApp.render}, where `screen` is never `login`, so `overview` is the default: it is
   * every non-staff role's probe/post-login landing (Task 9), and folding it into the default keeps
   * that branch covered rather than leaving an unreachable exhaustive `default`.
   */
  #renderScreen(): TemplateResult {
    switch (this.screen) {
      case "my-schedule":
        return html`<dashboard-my-schedule-screen
          .api=${this.api}
          .myPersonId=${this.myPersonId}
        ></dashboard-my-schedule-screen>`;
      case "sales":
        return html`<dashboard-sales-screen .api=${this.api}></dashboard-sales-screen>`;
      case "staff":
        return html`<dashboard-staff-screen .api=${this.api}></dashboard-staff-screen>`;
      case "catalogue":
        return html`<dashboard-catalogue-screen .api=${this.api}></dashboard-catalogue-screen>`;
      case "layout":
        return html`<dashboard-layout-screen .api=${this.api}></dashboard-layout-screen>`;
      case "receipt":
        return html`<dashboard-receipt-screen .api=${this.api}></dashboard-receipt-screen>`;
      case "statuses":
        return html`<dashboard-service-status-screen
          .api=${this.api}
        ></dashboard-service-status-screen>`;
      case "floor":
        return html`<dashboard-floor-screen .api=${this.api}></dashboard-floor-screen>`;
      case "kitchen":
        return html`<dashboard-kitchen-screen .api=${this.api}></dashboard-kitchen-screen>`;
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
      case "recipe":
        return html`<dashboard-recipe-screen .api=${this.api}></dashboard-recipe-screen>`;
      case "devices":
        return html`<dashboard-devices-screen .api=${this.api}></dashboard-devices-screen>`;
      case "printers":
        return html`<dashboard-printers-screen .api=${this.api}></dashboard-printers-screen>`;
      default:
        return html`<dashboard-overview-screen .api=${this.api}></dashboard-overview-screen>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-app": DashboardApp;
  }
}
