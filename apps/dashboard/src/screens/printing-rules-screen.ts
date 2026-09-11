import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
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
} from "../api/client.js";

const PRINT_MODES: readonly ReceiptPrintMode[] = ["auto", "on_request", "never"];
const DRAWER_POLICIES: readonly DrawerOpenPolicy[] = ["gated", "open"];

@customElement("dashboard-printing-rules-screen")
export class PrintingRulesScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
      .field {
        display: grid;
        gap: var(--wt-space-1);
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
  @state() private printers: Printer[] = [];
  @state() private stations: Station[] = [];
  @state() private printerStations: Record<string, string[]> = {};
  @state() private tills: Till[] = [];
  @state() private locations: LocationSummary[] = [];
  // Location settings have no read route, so only successful writes establish a known value.
  @state() private printModes: Record<string, ReceiptPrintMode> = {};
  @state() private drawerPolicies: Record<string, DrawerOpenPolicy> = {};
  @state() private errorKey: string | null = null;
  @state() private saving = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load().catch((error: unknown) => {
      this.errorKey = codeOf(error);
    });
  }
  protected override updated(): void {
    // Reconcile after option rendering, including after a rejected change.
    for (const till of this.tills) {
      const select = this.shadowRoot!.querySelector<HTMLSelectElement>(
        `[data-test="till-receipt-printer-${till.id}"]`,
      );
      if (select) select.value = till.receiptPrinterId ?? "";
    }
  }
  async #load(): Promise<void> {
    // Stations and locations use till.configure and schedule.manage; all three permissions currently
    // share manager/admin membership (packages/identity/src/permissions.ts). Keep this read usable if
    // printer.manage is ever assigned independently.
    const [printers, stations, tills, locations] = await Promise.all([
      this.api.listPrinters(),
      this.api.listStations(),
      this.api.listTills(),
      this.api.getLocations(),
    ]);
    const pairs = await Promise.all(
      printers.map(
        async (printer) =>
          [
            printer.id,
            (await this.api.listPrinterStations(printer.id)).map((item) => item.stationId),
          ] as const,
      ),
    );
    this.printers = printers;
    this.stations = stations;
    this.tills = tills;
    this.locations = locations;
    this.printerStations = Object.fromEntries(pairs);
  }
  async #mutate(action: () => Promise<unknown>): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.errorKey = null;
    try {
      await action();
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
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
          <wt-switch
            label=${t("printers.ticket_scope")}
            name="ticketScope"
            data-test="printer-ticket-scope-${printer.id}"
            .checked=${live(printer.ticketScope === "order")}
            .disabled=${this.saving}
            @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                const checked = event.detail.checked;
                void this.#mutate(() =>
                  this.api.updatePrinter(printer.id, {
                    ticketScope: checked ? "order" : "station",
                  }),
                );
              }}
          ></wt-switch>
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
                      .disabled=${this.saving}
                      @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                          const checked = event.detail.checked;
                          void this.#mutate(() =>
                            checked
                              ? this.api.attachPrinterToStation(station.id, printer.id)
                              : this.api.detachPrinterFromStation(station.id, printer.id),
                          );
                        }}
                    ></wt-switch>
                  `,
                )
          }
        </div>
      </wt-card>
    </li>`;
  }
  #renderTillPicker(till: Till): TemplateResult {
    const options = this.printers.filter((p) => p.active);
    return html`<li data-test="till-row-${till.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="till-label-${till.id}">${till.label}</span>
          </div>
          <label class="field"
            >${t("printers.receipt_printer")}
            <select
              name="receiptPrinterId"
              .disabled=${this.saving}
              data-test="till-receipt-printer-${till.id}"
              @change=${(e: Event) => {
                e.stopPropagation();
                void this.#setTillPrinter(till.id, (e.target as HTMLSelectElement).value);
              }}
            >
              <option value="">${t("printers.receipt_no_printer")}</option>
              ${options.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
            </select>
          </label>
        </div>
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
