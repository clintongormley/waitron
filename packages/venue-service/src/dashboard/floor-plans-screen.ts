import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { FloorPlanSetsModel } from "../floor-plan-set-types.js";
import type { VenueServiceApi } from "./client.js";
import type {
  FloorPlanSetDialog,
  FloorPlanSetMode,
  FloorPlanSetSave,
} from "./floor-plan-set-dialog.js";
import "./floor-plan-set-dialog.js";
import type {
  FloorPlanSetDeleteConfirm,
  FloorPlanSetDeleteDialog,
  FloorPlanSetDeleteImpact,
} from "./floor-plan-set-delete-dialog.js";
import "./floor-plan-set-delete-dialog.js";
import { format } from "./hours-view.js";
import { PERIOD_COLOUR_TOKENS } from "./period-colour-styles.js";
import { refusalOf } from "./refusal.js";
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

type Deletion = {
  departmentId: string;
  setId: string;
  /** The latest impact read; an answer to an earlier one is ignored. */
  generation: number;
  impact?: FloorPlanSetDeleteImpact;
  readError: string;
  busy: boolean;
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

/** Every active department's floor plan sets, and under each set its department's zones, as an
 *  always-open tree, so a screen reader hears each row's level; the tree's indent and arrow space
 *  are taken out so department and set rows sit flush left, as the mock-up draws them. Cell markup
 *  lives in the table's shadow root, so it is styled through parts. */
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
      wt-data-table {
        --tree-arrow-width: 0px;
      }
      wt-data-table::part(tree-cell) {
        padding-inline-start: 0;
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
  @state() private editing?: { mode: FloorPlanSetMode; set?: { id: string; name: string } };
  @state() private busy = false;
  @state() private deleting?: Deletion;
  @state() private actionError = "";
  private detach?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this.detach = this.api.watchFloorPlanSets(
      (model) => {
        this.model = model;
        if (this.deleting && !this.liveDeletion(model, this.deleting)) this.deleting = undefined;
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
    const set = { id: row.set.id, name: row.set.name };
    return html`<wt-row-actions
      data-set-id=${row.set.id}
      label=${`${row.set.name}: ${t("venue.actions")}`}
      align="end"
    >
      <wt-button variant="secondary" data-test="rename-set" @click=${() => this.edit("rename", set)}
        >${t("floor_plans.rename")}</wt-button
      >
      <wt-button variant="secondary" data-test="copy-set" @click=${() => this.edit("copy", set)}
        >${t("floor_plans.copy")}</wt-button
      >
      ${
        row.set.isDefault
          ? nothing
          : html`<wt-button
                variant="secondary"
                data-test="make-default-set"
                @click=${() => void this.makeDefault(set.id)}
                >${t("floor_plans.make_default")}</wt-button
              ><wt-button
                variant="secondary"
                data-test="delete-set"
                @click=${() => this.askDelete(row.department.id, set.id)}
                >${t("floor_plans.delete")}</wt-button
              >`
      }
    </wt-row-actions>`;
  }

  private async makeDefault(setId: string) {
    if (this.readOnly || this.busy) return;
    this.busy = true;
    this.actionError = "";
    try {
      await this.api.makeDefaultFloorPlanSet(setId);
    } catch (error) {
      this.actionError =
        refusalOf(error).code === "floor_plan_set.not_found"
          ? t("floor_plans.set_gone")
          : t("menu.save_error");
      return;
    } finally {
      this.busy = false;
    }
    this.api.rereadFloorPlanSets();
  }

  /** The deletion's department and set as the latest read has them, or undefined once either is gone. */
  private liveDeletion(model: FloorPlanSetsModel, deletion: Deletion) {
    const department = model.departments.find(({ id }) => id === deletion.departmentId);
    const set = department?.sets.find(({ id }) => id === deletion.setId);
    return department && set ? { department, set } : undefined;
  }

  private askDelete(departmentId: string, setId: string) {
    if (this.readOnly || !this.isConnected || this.editing || this.deleting) return;
    this.actionError = "";
    const deletion: Deletion = { departmentId, setId, generation: 0, readError: "", busy: false };
    this.deleting = deletion;
    void this.readImpact(deletion);
  }

  private async readImpact(deletion: Deletion) {
    const generation = ++deletion.generation;
    const current = () => this.deleting === deletion && deletion.generation === generation;
    let impact: FloorPlanSetDeleteImpact;
    try {
      impact = await this.api.readFloorPlanSetDeleteImpact(deletion.setId);
    } catch {
      if (current()) {
        deletion.readError = t("period.delete_read_error");
        this.requestUpdate();
      }
      return;
    }
    if (!current()) return;
    deletion.impact = impact;
    deletion.readError = "";
    this.requestUpdate();
  }

  private async confirmDelete(event: CustomEvent<FloorPlanSetDeleteConfirm>) {
    event.stopPropagation();
    const deletion = this.deleting;
    const dialog = event.currentTarget as FloorPlanSetDeleteDialog;
    if (!deletion?.impact || deletion.busy || this.readOnly || !this.isConnected) return;
    if (event.detail.setId !== deletion.setId) return;
    deletion.busy = true;
    dialog.refusal = undefined;
    this.requestUpdate();
    try {
      await this.api.deleteFloorPlanSet(deletion.setId, event.detail.replaceWith);
    } catch (error) {
      if (this.deleting === deletion) dialog.refusal = refusalOf(error);
      return;
    } finally {
      deletion.busy = false;
      this.requestUpdate();
    }
    if (this.deleting === deletion) this.deleting = undefined;
    this.api.rereadFloorPlanSets();
  }

  private renderDeletion() {
    const deletion = this.deleting;
    const live = deletion && this.model && this.liveDeletion(this.model, deletion);
    if (!deletion || !live) return nothing;
    const sets = live.department.sets;
    const defaultSet = sets.find(({ isDefault }) => isDefault);
    return keyed(
      deletion,
      html`<dashboard-floor-plan-set-delete-dialog
        .open=${true}
        .set=${{ id: live.set.id, name: live.set.name }}
        .defaultSet=${defaultSet && { id: defaultSet.id, name: defaultSet.name }}
        .replacements=${sets
          .filter(({ id, isDefault }) => !isDefault && id !== deletion.setId)
          .map(({ id, name }) => ({ id, name }))}
        .impact=${deletion.impact}
        .readError=${deletion.readError}
        .busy=${deletion.busy}
        @floor-plan-set-delete-confirm=${(event: CustomEvent<FloorPlanSetDeleteConfirm>) =>
          void this.confirmDelete(event)}
        @floor-plan-set-delete-retry=${(event: Event) => {
          event.stopPropagation();
          if (this.deleting === deletion && !deletion.busy) void this.readImpact(deletion);
        }}
        @floor-plan-set-delete-close=${(event: Event) => {
          event.stopPropagation();
          if (this.deleting === deletion && !deletion.busy) this.deleting = undefined;
        }}
      ></dashboard-floor-plan-set-delete-dialog>`,
    );
  }

  private edit(mode: FloorPlanSetMode, set?: { id: string; name: string }) {
    if (this.readOnly || !this.model || this.editing || this.deleting) return;
    this.actionError = "";
    this.editing = { mode, set };
  }

  private async save(event: CustomEvent<FloorPlanSetSave>) {
    event.stopPropagation();
    const editing = this.editing;
    const dialog = event.currentTarget as FloorPlanSetDialog;
    if (!editing || this.busy || !this.isConnected) return;
    const detail = event.detail;
    this.busy = true;
    dialog.refusal = undefined;
    try {
      if (detail.mode === "add")
        await this.api.createFloorPlanSet({
          departmentId: detail.departmentId,
          name: detail.name,
          ...(detail.fromSetId === undefined ? {} : { fromSetId: detail.fromSetId }),
        });
      else if (detail.mode === "rename")
        await this.api.renameFloorPlanSet(detail.setId, detail.name);
      else await this.api.copyFloorPlanSet(detail.setId, detail.name);
    } catch (error) {
      if (this.editing === editing) dialog.refusal = refusalOf(error);
      return;
    } finally {
      this.busy = false;
    }
    if (this.editing === editing && dialog.commitSubmitted()) this.editing = undefined;
    this.api.rereadFloorPlanSets();
  }

  private renderDialog() {
    const editing = this.editing;
    if (!editing || !this.model) return nothing;
    return keyed(
      editing,
      html`<dashboard-floor-plan-set-dialog
        .open=${true}
        .busy=${this.busy}
        .mode=${editing.mode}
        .set=${editing.set}
        .departments=${this.model.departments}
        @floor-plan-set-save=${(event: CustomEvent<FloorPlanSetSave>) => void this.save(event)}
        @floor-plan-set-close=${(event: Event) => {
          event.stopPropagation();
          if (this.editing === editing && !this.busy) this.editing = undefined;
        }}
      ></dashboard-floor-plan-set-dialog>`,
    );
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
            : html`<wt-button
                data-test="add-set"
                variant="secondary"
                ?disabled=${!model}
                @click=${() => this.edit("add")}
                >${t("floor_plans.add_set")}</wt-button
              >`
        }
      </div>
      ${this.readError ? html`<p role="alert" data-test="read-error">${this.readError}</p>` : nothing}
      ${
        this.actionError
          ? html`<p role="alert" data-test="action-error">${this.actionError}</p>`
          : nothing
      }
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
                .rowParent=${(row: Row) =>
                  row.kind === "set"
                    ? `department:${row.department.id}`
                    : row.kind === "zone"
                      ? `set:${row.set.id}`
                      : null}
                .rowCollapsible=${() => false}
                .rowCellParts=${(row: Row) => (row.kind === "department" ? "department-cell" : "")}
              ></wt-data-table>`
      }
      ${this.readOnly ? nothing : this.renderDialog()}
      ${this.readOnly ? nothing : this.renderDeletion()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-floor-plans-screen": FloorPlansScreen;
  }
}
