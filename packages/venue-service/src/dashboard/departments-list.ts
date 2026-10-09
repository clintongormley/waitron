import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import { tableNoMatches } from "@waitron/dashboard-kit";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import type { Department, VenueServiceView } from "./client.js";
import { t } from "./strings.js";

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
  @property({ attribute: false }) model?: VenueServiceView;

  #emit(name: string, detail?: { departmentId: string } | { zoneId: string }) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #setup(row: Department) {
    if (!row.active)
      return html`<span part="disabled-setup">${t("venue.department_disabled")}</span>`;
    return this.model!.readiness.map((issue) => {
      if (issue.code === "department.no_periods" && issue.departmentId === row.id)
        return html`<div part="setup-issue">
          ${issue.departmentName} ${t("venue.readiness.department_no_periods")}
          <a part="link" href=${`/manage/opening-hours/department/${encodeURIComponent(row.id)}`}
            >${t("venue.set_up_periods")}</a
          >
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

  #actions(row: Department) {
    const actions = [
      { key: `open-department-${row.id}`, label: t("venue.open"), event: "open-department" },
      { key: `rename-department-${row.id}`, label: t("venue.rename"), event: "rename-department" },
      row.active
        ? {
            key: `deactivate-department-${row.id}`,
            label: t("venue.disable_department"),
            event: "disable-department",
          }
        : {
            key: `enable-department-${row.id}`,
            label: t("venue.enable"),
            event: "enable-department",
          },
    ];
    return html`<wt-row-actions label=${`${row.name}: ${t("venue.actions")}`} align="end">
      ${actions.map((action) => html`<wt-button variant="secondary" data-test=${action.key} @click=${() => this.#emit(action.event, { departmentId: row.id })}>${action.label}</wt-button>`)}
    </wt-row-actions>`;
  }

  override render() {
    const model = this.model;
    if (!model) return nothing;
    const columns: DataTableColumn<Department>[] = [
      {
        key: "name",
        label: t("venue.department"),
        sortValue: (row) => row.name,
        cell: (row) =>
          html`<a
              part="link"
              data-test=${`open-department-name-${row.id}`}
              data-own-click
              href=${`/manage/venue-operations/department/${encodeURIComponent(row.id)}`}
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
                this.#emit("open-department", { departmentId: row.id });
              }}
              >${row.name}</a
            >${row.active ? nothing : html` <span part="disabled-note">${t("venue.department_disabled")}</span>`}`,
      },
      {
        key: "trading",
        label: t("venue.trading_name"),
        choosable: "shown",
        cell: (row) => row.tradingName,
      },
      {
        key: "zones",
        label: t("venue.list_zones"),
        choosable: "shown",
        cell: (row) =>
          model.zones
            .filter(
              (zone) =>
                zone.departmentId === row.id &&
                zone.active !== false &&
                model.floorZones.find((floorZone) => floorZone.id === zone.id)?.active !== false,
            )
            .map((zone) => zone.name)
            .join(", ") || t("venue.department_no_zones"),
      },
      {
        key: "setup",
        label: t("venue.setup"),
        choosable: "shown",
        cell: (row) => this.#setup(row),
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
      ${model.departments.length > 0 && model.readiness.some((issue) => issue.code === "venue.department_missing") ? html`<p class="issue" data-test="no-enabled-department">${t("venue.no_enabled_department")}</p>` : nothing}
      <wt-data-table
        viewKey="waitron.venue.departments"
        aria-label=${t("venue.departments")}
        .rows=${model.departments}
        .columns=${columns}
        .rowKey=${(row: Department) => row.id}
        .emptyMessage=${t("venue.no_departments")}
        .noMatchesMessage=${tableNoMatches()}
        customiseColumnsLabel=${t("venue.customise_columns")}
        customiseLabel=${t("venue.customise")}
        restoreColumnsLabel=${t("venue.restore_columns")}
        doneLabel=${t("venue.done")}
        moveColumnLabel=${t("venue.move_column")}
        showColumnLabel=${t("venue.show_column")}
        hideColumnLabel=${t("venue.hide_column")}
        alwaysShownColumnLabel=${t("venue.column_always_shown")}
        lastShownColumnLabel=${t("venue.column_last_shown")}
        columnPositionLabel=${t("venue.column_position")}
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
