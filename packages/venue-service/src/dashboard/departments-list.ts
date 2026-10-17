import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import { tableNoMatches } from "@waitron/dashboard-kit";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import {
  type Department,
  type ServiceZone,
  type VenueServiceApi,
  type VenueServiceView,
} from "./client.js";
import { DepartmentsZonesDrag } from "./departments-zones-drag.js";
import { format, formatDate } from "./hours-view.js";
import { t } from "./strings.js";
import { periodsWindowPath } from "./opening-hours-paths.js";

export type DepartmentZoneRow =
  ({ kind: "department" } & Department) | ({ kind: "zone" } & ServiceZone);
type PolicyField = "orderStart" | "paidWhen" | "receiptPrintMode";

@customElement("departments-list")
export class DepartmentsList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin-block-end: var(--wt-space-4);
      }
      h2 {
        margin: 0;
      }
      .issue,
      .unassigned {
        margin-block: var(--wt-space-3);
        overflow-wrap: anywhere;
      }
      a,
      wt-data-table::part(link) {
        color: var(--wt-color-primary-text);
      }
      a:focus-visible,
      wt-data-table::part(link):focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      wt-data-table::part(dragging) {
        opacity: var(--wt-opacity-disabled);
      }
      wt-data-table::part(drop-into) {
        background: var(--wt-color-surface-lifted);
        box-shadow:
          inset 0 var(--wt-field-line-width-active) 0 var(--wt-color-primary),
          inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-primary);
      }
      wt-data-table::part(zone-row-lift) {
        background: var(--wt-color-surface-lifted);
        box-shadow: var(--wt-shadow-2);
        border-radius: var(--wt-radius-md);
      }
      wt-data-table::part(inherited) {
        color: var(--wt-color-text-muted);
        font-style: italic;
      }
      wt-data-table::part(name-link) {
        display: inline-block;
        max-inline-size: var(--wt-cell-name-max-width);
        overflow-wrap: anywhere;
        vertical-align: middle;
      }
      wt-data-table::part(zone-grip) {
        cursor: grab;
        color: var(--wt-color-text-muted);
        background: none;
        border: 0;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        font: inherit;
        touch-action: none;
      }
      wt-data-table::part(zone-grip):focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      wt-data-table::part(disabled-note) {
        color: var(--wt-color-text-muted);
        margin-inline-start: var(--wt-space-2);
      }
      wt-data-table::part(setup-issue) {
        white-space: normal;
        max-inline-size: var(--wt-cell-name-max-width);
        overflow-wrap: anywhere;
        margin-block: var(--wt-space-1);
      }
      wt-data-table::part(disabled-setup) {
        color: var(--wt-color-text-muted);
      }
      .unassigned wt-button {
        margin-inline: var(--wt-space-2);
      }
    `,
  ];
  @state() private moving = new Set<string>();
  private moveFocus = "";
  @state() private moveFailure = "";
  private generation = {};
  private readonly drag = new DepartmentsZonesDrag(
    () => this.shadowRoot?.querySelector("wt-data-table")?.shadowRoot ?? undefined,
    () => this.model,
    (zoneId, departmentId, keyboard) => void this.move(zoneId, departmentId, keyboard),
  );
  private async move(zoneId: string, departmentId: string, keyboard: boolean) {
    if (!this.api || this.moving.has(zoneId) || !this.isConnected) return;
    const generation = this.generation;
    this.moving = new Set([...this.moving, zoneId]);
    this.moveFailure = "";
    if (keyboard) this.moveFocus = zoneId;
    try {
      await this.api.configureZone(zoneId, { departmentId });
      if (this.isConnected && this.generation === generation)
        this.#emit("zone-moved", { zoneId, focus: keyboard && this.moveFocus === zoneId });
    } catch {
      if (this.isConnected && this.generation === generation)
        this.moveFailure = t("venue.save_error");
    } finally {
      if (this.generation === generation) {
        const moving = new Set(this.moving);
        moving.delete(zoneId);
        this.moving = moving;
      }
    }
  }
  @property({ attribute: false }) api?: VenueServiceApi;
  override disconnectedCallback() {
    this.drag.dispose();
    this.generation = {};
    this.moving = new Set();
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    this.drag.reconcile();
  }
  @property({ attribute: false }) model?: VenueServiceView;
  @property({ attribute: false }) receiptAvailable?: (department: Department) => boolean;

  #emit(name: string, detail?: { departmentId: string } | { zoneId: string; focus?: boolean }) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #setup(row: Department) {
    if (!row.active)
      return html`<span part="disabled-setup">${t("venue.department_disabled")}</span>`;
    return this.model!.readiness.map((issue) => {
      if (
        issue.code === "department.operation_description_required" &&
        issue.departmentId === row.id
      )
        return html`<div part="setup-issue">
          ${
            this.receiptAvailable?.(row) === false
              ? t("venue.readiness.department_description")
              : html`<wt-button
                  part="link"
                  variant="ghost"
                  size="sm"
                  data-test=${`receipt-setup-${row.id}`}
                  @click=${(event: Event) => {
                    event.stopPropagation();
                    this.#emit("edit-receipt", { departmentId: row.id });
                  }}
                  >${t("venue.readiness.department_description")}</wt-button
                >`
          }
        </div>`;
      if (issue.code === "department.no_periods" && issue.departmentId === row.id)
        return html`<div part="setup-issue">
          ${issue.departmentName} ${t("venue.readiness.department_no_periods")}
          <a part="link" href=${periodsWindowPath}>${t("venue.set_up_periods")}</a>
        </div>`;
      if (
        (issue.code === "zone.menu_unpublished" || issue.code === "zone.menu_empty") &&
        this.model!.zones.some((zone) => zone.id === issue.zoneId && zone.departmentId === row.id)
      )
        return html`<div part="setup-issue">
          ${
            issue.code === "zone.menu_unpublished"
              ? `${issue.zoneName} ${t("venue.readiness.zone_menu_unpublished")}`
              : `${issue.zoneName}: ${issue.menuName} ${t("venue.readiness.menu_empty")} ${issue.zoneName}.`
          }
        </div>`;
      return nothing;
    });
  }

  #open(row: DepartmentZoneRow) {
    if (row.kind === "zone" && this.moving.has(row.id)) return;
    this.#emit(
      row.kind === "department" ? "open-department" : "edit-zone",
      row.kind === "department" ? { departmentId: row.id } : { zoneId: row.id },
    );
  }
  #also(row: DepartmentZoneRow) {
    if (row.kind === "department") {
      if (this.receiptAvailable?.(row) === false) return nothing;
      const label = t("venue.receipt");
      return html`<a
        part="link"
        data-own-click
        data-test=${`receipt-department-${row.id}`}
        aria-label=${`${row.name}: ${label}`}
        href=${`/manage/venue-operations/department/${encodeURIComponent(row.id)}/view/receipt`}
        @click=${(event: MouseEvent) => {
          if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          this.#emit("edit-receipt", { departmentId: row.id });
        }}
        >${label}</a
      >`;
    }
    const placed =
      this.model!.floorZones.find((floor) => floor.id === row.id)?.hasPlacedTables !== false;
    const label = t(placed ? "venue.floor_plan" : "venue.add_floor_plan");
    // No data-own-click: the dashboard shell's link handler must route this href itself.
    return html`<a
      part="link"
      data-test=${`floor-plan-zone-${row.id}`}
      aria-label=${`${row.name}: ${label}`}
      href=${`/manage/floor-plan/zone/${encodeURIComponent(row.id)}?back=${encodeURIComponent("/manage/venue-operations")}`}
      >${label}</a
    >`;
  }
  #policy(row: DepartmentZoneRow, field: PolicyField) {
    const parentId = row.kind === "department" ? row.id : row.departmentId;
    const parent = this.model!.salePolicies.departments.find(
      (policy) => policy.departmentId === parentId,
    );
    const zone =
      row.kind === "zone"
        ? this.model!.salePolicies.zones.find((policy) => policy.zoneId === row.id)
        : undefined;
    const defaults = { orderStart: "counter", paidWhen: "prepay", receiptPrintMode: "auto" };
    const raw = row.kind === "department" ? parent?.[field] : zone?.[field];
    const value = raw ?? parent?.[field] ?? defaults[field];
    const labels = {
      table: "venue.table_service",
      counter: "venue.counter_service",
      prepay: "venue.paid_before_preparation",
      ticket_then_pay: "venue.paid_at_collection",
      auto: "venue.always",
      on_request: "venue.on_request",
    } as const;
    const inherited = row.kind === "zone" && raw == null;
    return html`<span part=${inherited ? `policy inherited inherited-${field}` : "policy"}
      >${t(labels[value as keyof typeof labels])}</span
    >`;
  }
  #actions(row: DepartmentZoneRow) {
    const department = row.kind === "department";
    const actions = department
      ? [
          { key: `open-department-${row.id}`, label: t("venue.edit"), event: "open-department" },
          { key: `add-zone-${row.id}`, label: t("venue.add_department_zone"), event: "add-zone" },
        ]
      : [{ key: `edit-zone-${row.id}`, label: t("venue.edit"), event: "edit-zone" }];
    const detail = department ? { departmentId: row.id } : { zoneId: row.id };
    return html`<wt-row-actions
      data-zone-id=${department ? nothing : row.id}
      label=${`${row.name}: ${t("venue.actions")}`}
      align="end"
    >
      ${actions.map(
        (action) =>
          html`<wt-button
            variant="secondary"
            data-test=${action.key}
            ?disabled=${!department && this.moving.has(row.id)}
            @click=${() => {
              if (department || !this.moving.has(row.id)) this.#emit(action.event, detail);
            }}
            >${action.label}</wt-button
          >`,
      )}
      <wt-button
        variant="danger"
        data-test=${`delete-${row.kind}-${row.id}`}
        ?disabled=${!department && this.moving.has(row.id)}
        @click=${() => {
          if (department || !this.moving.has(row.id))
            this.#emit(department ? "delete-department" : "delete-zone", detail);
        }}
        >${t("venue.delete")}</wt-button
      >
    </wt-row-actions>`;
  }

  override render() {
    const model = this.model;
    if (!model) return nothing;
    const rows: DepartmentZoneRow[] = model.departments
      .filter((row) => row.active)
      .flatMap((department) => [
        { ...department, kind: "department" as const },
        ...model.zones
          .filter(
            (zone) =>
              zone.departmentId === department.id &&
              zone.active !== false &&
              model.floorZones.find((floor) => floor.id === zone.id)?.active !== false,
          )
          .map((zone) => ({ ...zone, kind: "zone" as const })),
      ]);
    const columns: DataTableColumn<DepartmentZoneRow>[] = [
      {
        key: "name",
        label: t("venue.list_name"),
        sortValue: (row) => row.name,
        cell: (row) =>
          html`${
              row.kind === "zone"
                ? html`<button
                    part="zone-grip"
                    data-own-click
                    data-test=${`zone-grip-${row.id}`}
                    aria-label=${`${row.name}: ${t("venue.move_to_department")}`}
                    ?disabled=${this.moving.has(row.id)}
                    @pointerdown=${(event: PointerEvent) => {
                      if (!this.moving.has(row.id)) this.drag.start(event, row.id);
                    }}
                    @keydown=${(event: KeyboardEvent) => {
                      if (!this.moving.has(row.id)) this.drag.key(event, row.id);
                    }}
                  >
                    <wt-icon name="grip"></wt-icon>
                  </button>`
                : nothing
            }<a
              part="link name-link"
              data-own-click
              data-test=${`open-${row.kind}-name-${row.id}`}
              href=${row.kind === "department" ? `/manage/venue-operations/department/${encodeURIComponent(row.id)}` : `/manage/venue-operations/department/${encodeURIComponent(row.departmentId)}/view/zones/zone/${encodeURIComponent(row.id)}`}
              @click=${(event: MouseEvent) => {
                if (
                  event.button ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                this.#open(row);
              }}
              >${row.name}</a
            >${row.kind === "department" ? this.#setup(row) : nothing}`,
      },
      {
        key: "orderStart",
        label: t("venue.order_start"),
        cell: (row) => this.#policy(row, "orderStart"),
      },
      {
        key: "paidWhen",
        label: t("venue.counter_paid_when"),
        cell: (row) => this.#policy(row, "paidWhen"),
      },
      {
        key: "receiptPrintMode",
        label: t("venue.print_receipt"),
        cell: (row) => this.#policy(row, "receiptPrintMode"),
      },
      {
        key: "also",
        label: t("venue.also_edit"),
        cell: (row) => this.#also(row),
      },
      {
        key: "actions",
        label: t("venue.actions"),
        pinned: "end",
        cell: (row) => this.#actions(row),
      },
    ];
    const unassigned = model.readiness.filter((issue) => issue.code === "zone.department_missing");
    return html`
      <div class="toolbar">
        <h2>${t("venue.departments")}</h2>
        <wt-button data-test="add-department" @click=${() => this.#emit("add-department")}
          >+ ${t("venue.add_department")}</wt-button
        >
      </div>
      ${model.readiness.some((issue) => issue.code === "venue.default_station_missing") ? html`<p class="issue" data-test="default-station-missing">${t("venue.readiness.default_station_missing")} <a href="/manage/prep-stations">${t("nav.prep_stations")}</a></p>` : nothing}
      ${model.readiness.map((issue) =>
        issue.code === "special_day.holiday_missing"
          ? html`<p class="issue" data-test="holiday-missing">
              ${format("venue.readiness.holiday_missing", {
                name: issue.holidayName,
                year: String(issue.year),
              })}
            </p>`
          : issue.code === "special_day.date_shared"
            ? html`<p class="issue" data-test="date-shared">
                ${format("venue.readiness.date_shared", {
                  other: issue.otherSpecialDayName,
                  name: issue.specialDayName,
                  date: formatDate(issue.date),
                })}
              </p>`
            : nothing,
      )}
      ${model.departments.length > 0 && model.readiness.some((issue) => issue.code === "venue.department_missing") ? html`<p class="issue" data-test="no-enabled-department">${t("venue.no_enabled_department")}</p>` : nothing}
      ${this.moveFailure ? html`<p role="alert">${this.moveFailure}</p>` : nothing}
      <wt-data-table
        viewKey="waitron.venue.departments-zones"
        aria-label=${t("venue.departments")}
        .rows=${rows}
        .columns=${columns}
        .rowKey=${(row: DepartmentZoneRow) => `${row.kind}:${row.id}`}
        .rowParent=${(row: DepartmentZoneRow) => (row.kind === "zone" ? `department:${row.departmentId}` : null)}
        .rowCollapsible=${() => false}
        .rowClick=${(row: DepartmentZoneRow) => this.#open(row)}
        .rowClickLabel=${(row: DepartmentZoneRow) => `${t("venue.edit")}: ${row.name}`}
        .emptyMessage=${t("venue.no_departments")}
        .noMatchesMessage=${tableNoMatches()}
      ></wt-data-table>
      ${unassigned.length > 0 ? html`<p class="unassigned" data-test="unassigned-zones">${t("venue.zones_no_department")}: ${unassigned.map((issue, index) => html`${index > 0 ? ", " : nothing}${issue.zoneName}<wt-button variant="secondary" data-test=${`add-zone-to-department-${issue.zoneId}`} aria-label=${`${issue.zoneName}: ${t("venue.add_to_department")}`} @click=${() => this.#emit("add-to-department", { zoneId: issue.zoneId })}>${t("venue.add_to_department")}</wt-button>`)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "departments-list": DepartmentsList;
  }
}
