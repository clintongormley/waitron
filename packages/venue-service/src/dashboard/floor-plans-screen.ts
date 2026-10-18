import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { FloorPlanSetsModel } from "../floor-plan-set-types.js";
import type { VenueServiceApi } from "./client.js";
import { format } from "./hours-view.js";
import { PERIOD_COLOUR_TOKENS } from "./period-colour-styles.js";
import { t } from "./strings.js";

type Department = FloorPlanSetsModel["departments"][number];
type FloorPlanSet = Department["sets"][number];
type Zone = Department["zones"][number];
type Row =
  | { kind: "department"; key: string; department: Department }
  | { kind: "set"; key: string; department: Department; set: FloorPlanSet }
  | {
      kind: "zone";
      key: string;
      set: FloorPlanSet;
      zone: Zone;
      layout: FloorPlanSet["layouts"][number];
    };

const PAGE = "/manage/floor-plans";

export function layoutPath(setId: string, zoneId: string): string {
  return `/manage/floor-plan/set/${encodeURIComponent(setId)}/zone/${encodeURIComponent(zoneId)}?back=${encodeURIComponent(PAGE)}`;
}

const swatchColours = unsafeCSS(
  Object.entries(PERIOD_COLOUR_TOKENS)
    .map(([colour, { fill }]) => `wt-data-table::part(colour-${colour}) { background: ${fill}; }`)
    .join("\n"),
);

/** Every active department's floor plan sets, and under each set its department's zones, as one
 *  flat table in the model's order: the department and set rows sit flush left, as the mock-up
 *  draws them, which a tree's indent would not. Cell markup lives in the table's shadow root, so
 *  it is styled through parts. */
@customElement("dashboard-floor-plans-screen")
export class FloorPlansScreen extends LitElement {
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
      h1 {
        margin: 0;
        font-size: var(--wt-font-size-xl);
      }
      wt-data-table::part(department-cell) {
        background: var(--wt-color-bg);
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(set-name) {
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(muted) {
        margin-inline-start: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-normal);
      }
      wt-data-table::part(default) {
        margin-inline-start: var(--wt-space-1);
        padding: 0 var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
        white-space: nowrap;
      }
      wt-data-table::part(not-used) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(zone-link) {
        margin-inline-start: var(--wt-space-4);
        color: var(--wt-color-primary-text);
      }
      wt-data-table::part(zone-link):focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      wt-data-table::part(count) {
        white-space: nowrap;
      }
      wt-data-table::part(empty) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(chips) {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-1);
      }
      wt-data-table::part(chip) {
        display: inline-flex;
        align-items: center;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        white-space: nowrap;
      }
      wt-data-table::part(swatch) {
        display: inline-block;
        inline-size: var(--wt-space-3);
        block-size: var(--wt-space-3);
        margin-inline-end: var(--wt-space-1);
        border-radius: var(--wt-radius-sm);
      }
      ${swatchColours}
    `,
  ];
  @property({ attribute: false }) api!: VenueServiceApi;
  @property({ type: Boolean }) readOnly = false;
  @state() private model?: FloorPlanSetsModel;
  @state() private readError = "";
  private detach?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this.detach = this.api.watchFloorPlanSets(
      (model) => {
        this.model = model;
      },
      () => {
        this.readError = t("floor_plans.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }
  override disconnectedCallback() {
    this.detach?.();
    this.detach = undefined;
    super.disconnectedCallback();
  }

  private rows(model: FloorPlanSetsModel): Row[] {
    return model.departments.flatMap((department) => [
      { kind: "department" as const, key: `department:${department.id}`, department },
      ...department.sets.flatMap((set) => [
        { kind: "set" as const, key: `set:${set.id}`, department, set },
        ...department.zones.map((zone) => ({
          kind: "zone" as const,
          key: `zone:${set.id}:${zone.id}`,
          set,
          zone,
          layout: set.layouts.find((layout) => layout.zoneId === zone.id)!,
        })),
      ]),
    ]);
  }

  private nameCell(row: Row) {
    if (row.kind === "department")
      return row.department.sets.length
        ? row.department.name
        : html`${row.department.name} <span part="muted">${t("floor_plans.no_sets")}</span>`;
    if (row.kind === "set")
      return html`<span part="set-name">${row.set.name}</span>${
          row.set.isDefault
            ? html` <span part="default">${t("floor_plans.default")}</span>`
            : nothing
        }`;
    // No data-own-click: the dashboard shell's link handler routes this href itself.
    return html`<a
      part="zone-link"
      href=${layoutPath(row.set.id, row.zone.id)}
      aria-label=${format("floor_plans.zone_layout", { zone: row.zone.name, set: row.set.name })}
      >${row.zone.name}</a
    >`;
  }

  private usedByCell(row: Row) {
    if (row.kind !== "set") return nothing;
    if (!row.set.usedBy.length)
      return html`<span part="not-used">${t("floor_plans.not_used")}</span>`;
    return html`<span part="chips"
      >${row.set.usedBy.map(
        (period) =>
          html`<span part="chip"
            ><span part=${`swatch colour-${period.colour}`} data-colour=${period.colour}></span
            >${period.name}</span
          >`,
      )}</span
    >`;
  }

  private tablesCell(row: Row) {
    if (row.kind !== "zone") return nothing;
    const { onPlan, spare } = row.layout;
    const n = String(onPlan);
    const m = String(spare);
    const [part, text] =
      row.zone.tableCount === 0
        ? ["count empty", t("floor_plans.no_tables")]
        : onPlan === 0
          ? [
              "count empty",
              spare
                ? format("floor_plans.none_on_plan_spare", { m })
                : t("floor_plans.none_on_plan"),
            ]
          : [
              "count",
              spare
                ? format("floor_plans.on_plan_spare", { n, m })
                : format("floor_plans.on_plan", { n }),
            ];
    return html`<span part=${part}>${text}</span>`;
  }

  private actionsCell(row: Row) {
    if (row.kind !== "set") return nothing;
    return html`<wt-row-actions
      data-set-id=${row.set.id}
      label=${`${row.set.name}: ${t("venue.actions")}`}
      align="end"
    ></wt-row-actions>`;
  }

  override render() {
    const model = this.model;
    const columns: DataTableColumn<Row>[] = [
      { key: "name", label: t("floor_plans.column.set_zone"), cell: (row) => this.nameCell(row) },
      {
        key: "usedBy",
        label: t("floor_plans.column.used_by"),
        cell: (row) => this.usedByCell(row),
      },
      { key: "tables", label: t("floor_plans.column.tables"), cell: (row) => this.tablesCell(row) },
      ...(this.readOnly
        ? []
        : [
            {
              key: "actions",
              label: t("venue.actions"),
              pinned: "end",
              cell: (row: Row) => this.actionsCell(row),
            } satisfies DataTableColumn<Row>,
          ]),
    ];
    return html`<div class="toolbar">
        <h1>${t("floor_plans.title")}</h1>
        ${
          this.readOnly
            ? nothing
            : html`<wt-button data-test="add-set" variant="secondary" ?disabled=${!model}
                >${t("floor_plans.add_set")}</wt-button
              >`
        }
      </div>
      ${this.readError ? html`<p role="alert" data-test="read-error">${this.readError}</p>` : nothing}
      ${
        !model
          ? nothing
          : model.departments.length === 0
            ? html`<p data-test="no-departments">${t("menu.no_departments")}</p>`
            : html`<wt-data-table
                wrap-to-fit
                aria-label=${t("floor_plans.title")}
                .columns=${columns}
                .rows=${this.rows(model)}
                .rowKey=${(row: Row) => row.key}
                .rowCellParts=${(row: Row) => (row.kind === "department" ? "department-cell" : "")}
              ></wt-data-table>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-floor-plans-screen": FloorPlansScreen;
  }
}
