import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
// The named import evaluates the module, which registers `<dashboard-location-picker>` via its
// `@customElement` side effect — so no separate side-effect import is needed alongside the helper.
import { resolveLocationSelection } from "../widgets/location-picker.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, LocationCatalogueSummary, LocationSummary } from "../api/client.js";

/**
 * The management dashboard's LOCATION MENUS screen: an owner picks WHICH catalogues (menus) a location
 * sells and WHICH is its default. Modelled on the roster screen's location picker (default-to-first,
 * shown only when the venue has more than one location) and the catalogue/printers screens' error
 * handling. The single owner of the selected location and the loaded per-location catalogue set; it
 * injects the `DashboardApi`.
 *
 * ON CONNECT it loads locations, picks the first (keeping the current selection if it still exists on a
 * reload, else the first), then loads that location's catalogues. Each catalogue row carries a
 * "sells here" CHECKBOX (checked = `sellable`) and a "default" RADIO (checked = `isDefault`):
 *  - toggling the checkbox ON makes the catalogue sellable (`addLocationCatalogue`), OFF stops selling
 *    it (`removeLocationCatalogue`); either reloads;
 *  - the DEFAULT row's checkbox is checked AND disabled — you cannot stop selling the default without
 *    first changing it (the backend enforces this too, this is just correct UI);
 *  - selecting a row's radio sets that catalogue as the default (`setLocationDefaultCatalogue`); the
 *    old default stays sellable (keep-sellable, the backend's job) and this reloads.
 *
 * `getLocations()` (GET /management-api/locations) is `schedule.manage`-gated, whereas the mutating
 * routes here are `person.manage`-gated — but that mismatch is unreachable: both permissions map to
 * exactly {manager, admin} (packages/identity/src/permissions.ts), so every user who can reach this
 * screen holds both (the same note the printers screen carries for its `getLocations()` read).
 *
 * ERROR HANDLING, every async path (mirroring `catalogue-screen.ts`/`printers-screen.ts`): each
 * loader/handler is fully `try/catch`ed — a rejection becomes `errorKey` (from the thrown `{ code }`,
 * falling back to `server.internal`) in a `role="alert"` banner, never an unhandled rejection. A
 * single-flight `busy` gate drops a double-fired mutation (none is server-idempotent for the toggle
 * we care about); `stopPropagation` on every child event keeps the composed events inside this screen.
 */
@customElement("dashboard-location-menus-screen")
export class LocationMenusScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        color: var(--wt-color-text);
      }
      th,
      td {
        /* An explicit surface background (not transparent) so a color-contrast check composites the
         * cell text against a DEFINED background in both themes (the roster-screen precedent — axe
         * cannot see through a transparent cell to the host bg). */
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        padding: var(--wt-space-2);
        text-align: left;
      }
      th.center,
      td.center {
        text-align: center;
      }
      .prompt {
        color: var(--wt-color-text);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  @state() private locations: LocationSummary[] = [];
  @state() private locationId = "";
  @state() private catalogues: LocationCatalogueSummary[] = [];
  @state() private errorKey: string | null = null;
  // Single-flight for the add/remove/set-default mutations. Reactive because rows render off it (the
  // controls disable while a mutation round-trips); set synchronously at handler entry so a
  // double-fired event files at most one mutation.
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  /**
   * (Re)load locations, then pick the first location and load its catalogues. When the tenant has NO
   * location there is nothing to configure — the location stays unset, the catalogue list stays empty
   * and the no-location prompt renders. A reload keeps the current selection when it still exists, else
   * falls back to the first. A rejection anywhere becomes the `errorKey` banner. Public (not `#load`)
   * so a test can force a reload; the screen itself only calls it on connect.
   */
  async load(): Promise<void> {
    this.errorKey = null;
    try {
      const locations = await this.api.getLocations();
      this.locations = locations;
      if (locations.length === 0) {
        this.locationId = "";
        this.catalogues = [];
        return;
      }
      this.locationId = resolveLocationSelection(locations, this.locationId);
      await this.#loadCatalogues();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Load the selected location's catalogue set. Throws to its caller's catch. */
  async #loadCatalogues(): Promise<void> {
    this.catalogues = await this.api.listLocationCatalogues(this.locationId);
  }

  /** The location picker emitted `location-changed`. `stopPropagation` keeps the composed event inside
   * this screen (the roster-screen pattern). Reload the catalogues. */
  async #onSelectLocation(event: CustomEvent<{ locationId: string }>): Promise<void> {
    event.stopPropagation();
    this.locationId = event.detail.locationId;
    this.errorKey = null;
    try {
      await this.#loadCatalogues();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Toggle whether the location SELLS the catalogue `catalogueId`: `checked` adds it
   * (`addLocationCatalogue`), `!checked` stops selling it (`removeLocationCatalogue`), then reload.
   * Single-flight. A rejection becomes the `errorKey` banner and the reload restores the checkbox to the
   * server's truth. */
  async #onToggleSellable(catalogueId: string, checked: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      if (checked) {
        await this.api.addLocationCatalogue(this.locationId, catalogueId);
      } else {
        await this.api.removeLocationCatalogue(this.locationId, catalogueId);
      }
      await this.#loadCatalogues();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** Make the catalogue `catalogueId` the location's DEFAULT menu (`setLocationDefaultCatalogue`), then
   * reload. The old default stays sellable (keep-sellable) — the backend's job; the UI just calls it.
   * Single-flight; a rejection becomes the `errorKey` banner. */
  async #onSetDefault(catalogueId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.setLocationDefaultCatalogue(this.locationId, catalogueId);
      await this.#loadCatalogues();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("location_menus.title")}</h1>
      ${
        this.locations.length === 0
          ? html`<p class="prompt" data-test="no-locations">${t("location_menus.no_locations")}</p>`
          : this.#renderBody()
      }
      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }

  #renderBody(): TemplateResult {
    return html`
      <dashboard-location-picker
        .locations=${this.locations}
        .selected=${this.locationId}
        .label=${t("location_menus.location")}
        @location-changed=${(e: CustomEvent<{ locationId: string }>) =>
          void this.#onSelectLocation(e)}
      ></dashboard-location-picker>
      ${
        this.catalogues.length === 0
          ? html`<p class="prompt" data-test="no-catalogues">
              ${t("location_menus.no_catalogues")}
            </p>`
          : this.#renderTable()
      }
    `;
  }

  #renderTable(): TemplateResult {
    return html`
      <table>
        <thead>
          <tr>
            <th scope="col">${t("location_menus.menu")}</th>
            <th scope="col" class="center">${t("location_menus.sells_here")}</th>
            <th scope="col" class="center">${t("location_menus.default")}</th>
          </tr>
        </thead>
        <tbody>
          ${this.catalogues.map((c) => this.#renderRow(c))}
        </tbody>
      </table>
    `;
  }

  #renderRow(c: LocationCatalogueSummary): TemplateResult {
    return html`<tr data-test="location-menu-row-${c.id}">
      <th scope="row">${c.name}</th>
      <td class="center">
        <input
          type="checkbox"
          data-test="location-menu-${c.id}-sellable"
          aria-label=${`${t("location_menus.sells_here")} — ${c.name}`}
          .checked=${c.sellable}
          ?disabled=${c.isDefault || this.busy}
          @change=${(e: Event) => {
            e.stopPropagation();
            void this.#onToggleSellable(c.id, (e.target as HTMLInputElement).checked);
          }}
        />
      </td>
      <td class="center">
        <input
          type="radio"
          name="location-default-catalogue"
          data-test="location-menu-${c.id}-default"
          aria-label=${`${t("location_menus.default")} — ${c.name}`}
          .checked=${c.isDefault}
          ?disabled=${this.busy}
          @change=${(e: Event) => {
            e.stopPropagation();
            void this.#onSetDefault(c.id);
          }}
        />
      </td>
    </tr>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-location-menus-screen": LocationMenusScreen;
  }
}
