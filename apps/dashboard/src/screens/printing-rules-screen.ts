import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-switch.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { drawerPolicyName, printModeName } from "../i18n/domain.js";
import type {
  DashboardApi,
  DrawerOpenPolicy,
  LocationSummary,
  Printer,
  ReceiptPrintMode,
  Station,
  Till,
  Watcher,
} from "../api/client.js";

const PRINT_MODES: readonly ReceiptPrintMode[] = ["auto", "on_request", "never"];
const DRAWER_POLICIES: readonly DrawerOpenPolicy[] = ["gated", "open"];

@customElement("dashboard-printing-rules-screen")
export class PrintingRulesScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
      }
      h2,
      h3 {
        margin: var(--wt-space-6) 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .row,
      .mode-options {
        display: flex;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
        align-items: center;
      }
      .details {
        margin-right: auto;
        font-weight: var(--wt-font-weight-bold);
      }
      .row wt-combobox {
        flex: 0 1 calc(var(--wt-space-6) * 7);
        min-width: 0;
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .stations {
        display: grid;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-3);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );
  @state() private printers: Printer[] = [];
  @state() private stations: Station[] = [];
  @state() private watchers: Watcher[] = [];
  @state() private printerErrors: Record<string, string> = {};
  @state() private printerStations: Record<string, string[]> = {};
  @state() private tills: Till[] = [];
  @state() private locations: LocationSummary[] = [];
  // Location settings have no read route, so only successful writes establish a known value.
  @state() private printModes: Record<string, ReceiptPrintMode> = {};
  @state() private drawerPolicies: Record<string, DrawerOpenPolicy> = {};
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
  @state() private saving = false;

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load().catch((error: unknown) => {
      this.#showReadError(error);
    });
  }
  async #load(): Promise<void> {
    // Stations gate on venue.configure, locations on schedule.manage, and printers, each printer's
    // stations and tills on printer.manage. Today manager and admin hold all three
    // (packages/identity/src/permissions.ts); revisit this fan-out if one is ever granted on its own.
    await Promise.all([
      this.#queries.watch("listPrinters", [], async (printers) => {
        this.printers = printers;
        await this.#queries.watchGroup(
          "listPrinterStations",
          printers.map((printer) => [printer.id]),
          (lists) => {
            this.printerStations = Object.fromEntries(
              printers.map((printer, index) => [
                printer.id,
                lists[index]!.map((item) => item.stationId),
              ]),
            );
          },
        );
      }),
      this.#queries.watch("listStations", [], (value) => {
        this.stations = value;
      }),
      this.#queries.watch("listWatchers", [], (value) => {
        this.watchers = value;
      }),
      this.#queries.watch("listTills", [], (value) => {
        this.tills = value;
      }),
      this.#queries.watch("getLocations", [], (value) => {
        this.locations = value;
      }),
    ]);
  }
  async #mutate(action: () => Promise<unknown>, printerId?: string): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.#showError(null);
    let written = false;
    try {
      await action();
      written = true;
      await this.#load();
      if (printerId && (this.printerStations[printerId] ?? []).length === 0) {
        this.printerErrors = { ...this.printerErrors, [printerId]: "" };
      }
    } catch (error) {
      const code = codeOf(error);
      if (printerId && code === "printer.makes_and_watches") {
        this.printerErrors = { ...this.printerErrors, [printerId]: code };
      } else if (written) {
        this.#showReadError(error);
      } else {
        this.#showError(code);
      }
    } finally {
      this.saving = false;
    }
  }
  async #setTillPrinter(tillId: string, value: string): Promise<void> {
    await this.#mutate(() => this.api.setTillReceiptPrinter(tillId, value === "" ? null : value));
  }
  async #setPrintMode(locationId: string, mode: ReceiptPrintMode): Promise<void> {
    await this.#mutate(async () => {
      await this.api.setReceiptPrintMode(locationId, mode);
      this.printModes = { ...this.printModes, [locationId]: mode };
    });
  }
  async #setDrawerPolicy(locationId: string, policy: DrawerOpenPolicy): Promise<void> {
    await this.#mutate(async () => {
      await this.api.setDrawerOpenPolicy(locationId, policy);
      this.drawerPolicies = { ...this.drawerPolicies, [locationId]: policy };
    });
  }
  #renderRouting(printer: Printer): TemplateResult {
    return html`<li>
      <wt-card>
        <div class="row">
          <span class="details">${printer.name}</span>
          <wt-combobox
            name="watcherId"
            label=${t("printers.watcher_copies")}
            search="auto"
            searchPlaceholder=${t("categories.combobox_search")}
            noResultsLabel=${t("categories.combobox_no_results")}
            .options=${[
              { value: "", label: t("printers.watcher_no") },
              ...this.watchers
                .filter((watcher) => watcher.active)
                .map((watcher) => ({ value: watcher.id, label: watcher.name })),
            ]}
            .value=${live(printer.watcherId ?? "")}
            .disabled=${this.saving}
            data-test="printer-watcher-${printer.id}"
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              void this.#mutate(
                () => this.api.setPrinterWatcher(printer.id, event.detail.value || null),
                printer.id,
              );
            }}
          ></wt-combobox>
        </div>
        <div class="stations" role="group" aria-label=${t("printers.stations_title")}>
          <strong>${t("printers.stations_title")}</strong>
          ${
            this.stations.length === 0
              ? html`<p class="empty" data-test="no-stations-${printer.id}">
                  ${t("printers.no_stations")}
                </p>`
              : this.stations.map(
                  (station) => html`
                    <wt-switch
                      label=${station.name}
                      name="stationIds"
                      aria-label=${station.name}
                      data-test="station-toggle-${printer.id}-${station.id}"
                      .checked=${live((this.printerStations[printer.id] ?? []).includes(station.id))}
                      .disabled=${this.saving || printer.watcherId !== null}
                      @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                        const checked = event.detail.checked;
                        void this.#mutate(
                          () =>
                            checked
                              ? this.api.attachPrinterToStation(station.id, printer.id)
                              : this.api.detachPrinterFromStation(station.id, printer.id),
                          printer.id,
                        );
                      }}
                    ></wt-switch>
                  `,
                )
          }
        </div>
        ${printer.watcherId !== null ? html`<p>${t("printers.watcher_station_disabled")}</p>` : nothing}
        ${this.printerErrors[printer.id] ? html`<p class="error" role="alert">${t("printers.watcher_conflict")}</p>` : nothing}
      </wt-card>
    </li>`;
  }
  #renderTillPicker(till: Till): TemplateResult {
    const options = this.printers.filter((p) => p.active);
    const receiptPrinter = options.find((p) => p.id === till.receiptPrinterId);
    return html`<li data-test="till-row-${till.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="till-label-${till.id}">${till.label}</span>
          </div>
          <wt-combobox
            name="receiptPrinterId"
            label=${t("printers.receipt_printer")}
            search="auto"
            placeholder=${t("printers.receipt_no_printer")}
            searchPlaceholder=${t("categories.combobox_search")}
            noResultsLabel=${t("categories.combobox_no_results")}
            .options=${[
              { value: "", label: t("printers.receipt_no_printer") },
              ...options.map((p) => ({ value: p.id, label: p.name })),
            ]}
            .value=${live(till.receiptPrinterId ?? "")}
            .disabled=${this.saving}
            data-test="till-receipt-printer-${till.id}"
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              void this.#setTillPrinter(till.id, e.detail.value);
            }}
          ></wt-combobox>
        </div>
        ${
          receiptPrinter?.hasCashDrawer
            ? html`<div class="row">
                <wt-switch
                  label=${t("printers.opens_drawer")}
                  name="opensDrawer"
                  data-test="till-opens-drawer-${till.id}"
                  .checked=${live(till.opensDrawer)}
                  .disabled=${this.saving}
                  @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                    const checked = event.detail.checked;
                    void this.#mutate(() => this.api.setTillOpensDrawer(till.id, checked));
                  }}
                ></wt-switch>
              </div>`
            : nothing
        }
      </wt-card>
    </li>`;
  }

  #printModeOption(locationId: string, mode: ReceiptPrintMode): TemplateResult {
    return html`<wt-button
      variant=${this.printModes[locationId] === mode ? "primary" : "secondary"}
      size="sm"
      .disabled=${this.saving}
      data-test="print-mode-${locationId}-${mode}"
      @click=${() => void this.#setPrintMode(locationId, mode)}
      >${printModeName(mode)}</wt-button
    >`;
  }

  #renderPrintMode(loc: LocationSummary): TemplateResult {
    return html`<li data-test="location-row-${loc.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="location-name-${loc.id}">${loc.name}</span>
          </div>
          <div
            class="mode-options"
            role="group"
            aria-label=${`${t("printers.print_mode")} ${loc.name}`}
          >
            ${this.printModes[loc.id] === undefined ? html`<p class="empty" data-test="print-mode-unknown-${loc.id}">${t("printing_rules.setting_unknown")}</p>` : nothing}
            ${PRINT_MODES.map((mode) => this.#printModeOption(loc.id, mode))}
          </div>
        </div>
      </wt-card>
    </li>`;
  }

  #drawerPolicyOption(locationId: string, policy: DrawerOpenPolicy): TemplateResult {
    return html`<wt-button
      variant=${this.drawerPolicies[locationId] === policy ? "primary" : "secondary"}
      size="sm"
      .disabled=${this.saving}
      data-test="drawer-policy-${locationId}-${policy}"
      @click=${() => void this.#setDrawerPolicy(locationId, policy)}
      >${drawerPolicyName(policy)}</wt-button
    >`;
  }

  #renderDrawerPolicy(loc: LocationSummary): TemplateResult {
    return html`<li data-test="drawer-policy-row-${loc.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="drawer-location-name-${loc.id}">${loc.name}</span>
          </div>
          <div
            class="mode-options"
            role="group"
            aria-label=${`${t("printers.drawer_policy")} ${loc.name}`}
          >
            ${this.drawerPolicies[loc.id] === undefined ? html`<p class="empty" data-test="drawer-policy-unknown-${loc.id}">${t("printing_rules.setting_unknown")}</p>` : nothing}
            ${DRAWER_POLICIES.map((policy) => this.#drawerPolicyOption(loc.id, policy))}
          </div>
        </div>
      </wt-card>
    </li>`;
  }

  #renderReceiptSection(): TemplateResult {
    return html`
      <section>
        <h2 class="panel-title">${t("printers.receipt_title")}</h2>

        <h3 class="panel-title">${t("printers.receipt_printer_title")}</h3>
        ${
          this.tills.length === 0
            ? html`<p class="empty" data-test="no-tills">${t("printers.no_tills")}</p>`
            : html`<ol>
                ${this.tills.map((till) => this.#renderTillPicker(till))}
              </ol>`
        }

        <h3 class="panel-title">${t("printers.print_mode_title")}</h3>
        ${
          this.locations.length === 0
            ? html`<p class="empty" data-test="no-locations">${t("printers.no_locations")}</p>`
            : html`<ol>
                ${this.locations.map((loc) => this.#renderPrintMode(loc))}
              </ol>`
        }

        <h3 class="panel-title">${t("printers.drawer_policy_title")}</h3>
        ${
          this.locations.length === 0
            ? html`<p class="empty" data-test="no-locations-drawer">
                ${t("printers.no_locations")}
              </p>`
            : html`<ol>
                ${this.locations.map((loc) => this.#renderDrawerPolicy(loc))}
              </ol>`
        }
      </section>
    `;
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("printing_rules.title")}</h1>
      <section>
        <h2>${t("printing_rules.routing_title")}</h2>
        ${
          this.printers.length === 0
            ? html`<p class="empty" data-test="no-printers">${t("printers.no_printers")}</p>`
            : html`<ol>
                ${this.printers.map((printer) => this.#renderRouting(printer))}
              </ol>`
        }
      </section>
      ${this.#renderReceiptSection()}
      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-printing-rules-screen": PrintingRulesScreen;
  }
}
