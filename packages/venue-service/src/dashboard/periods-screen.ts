import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { PaintedIn } from "../period-delete.js";
import { format } from "./hours-view.js";
import { seasonPainterPath, specialDayPainterPath } from "./opening-hours-paths.js";
import type { OpeningHoursApi, PeriodDeleteImpact } from "./opening-hours-client.js";
import type { PeriodDeleteDialog } from "./period-delete-dialog.js";
import { PeriodEditing } from "./period-editing.js";
import { PERIOD_COLOUR_TOKENS } from "./period-colour-styles.js";
import { SEASON_TINT_TOKENS, seasonTints } from "./season-tint.js";
import { refusalOf } from "./refusal.js";
import { t } from "./strings.js";
import "./period-delete-dialog.js";

type Department = OpeningHoursModel["departments"][number];
type Period = Department["periods"][number];
export type PeriodRow =
  | ({ kind: "department" } & Department)
  | ({ kind: "period"; departmentId: string; departmentName: string } & Period);

type Deletion = {
  period: Period;
  /** The latest impact read; an answer to an earlier one is ignored. */
  generation: number;
  /** The latest impact read started after every watch read numbered below this. */
  readAfter: number;
  /** The delete sends this impact's clock revision. */
  impact?: PeriodDeleteImpact;
  readError: string;
  busy: boolean;
};

const swatchColours = unsafeCSS(
  Object.entries(PERIOD_COLOUR_TOKENS)
    .map(([colour, { fill }]) => `wt-data-table::part(colour-${colour}) { background: ${fill}; }`)
    .join("\n"),
);
const chipTints = unsafeCSS(
  Object.entries(SEASON_TINT_TOKENS)
    .map(
      ([tint, { tint: fill, onTint, line }]) =>
        `wt-data-table::part(tint-${tint}) { background: ${fill}; color: ${onTint}; border-color: ${line}; }`,
    )
    .join("\n"),
);

/** Every active department's periods, grouped under it. Cell markup lives in the table's shadow
 *  root, so each colour and season tint is its own part. */
@customElement("dashboard-periods-screen")
export class PeriodsScreen extends LitElement {
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
      }
      wt-data-table::part(swatch) {
        display: inline-block;
        inline-size: var(--wt-space-4);
        block-size: var(--wt-space-4);
        margin-inline-end: var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        border: 1px solid transparent;
        vertical-align: middle;
      }
      ${swatchColours}
      wt-data-table::part(swatch-unpainted) {
        background: transparent;
        border: 1px dashed var(--wt-color-text-muted);
      }
      wt-data-table::part(unpainted),
      wt-data-table::part(unavailable) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(unavailable) {
        font-style: italic;
      }
      wt-data-table::part(not-painted) {
        color: var(--wt-color-warning);
      }
      wt-data-table::part(department-cell) {
        background: var(--wt-color-bg);
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(no-periods) {
        margin-inline-start: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-normal);
      }
      wt-data-table::part(chips) {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-1);
        max-inline-size: calc(1.25 * var(--wt-cell-name-max-width));
      }
      wt-data-table::part(chip) {
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-palette-purple);
        border-radius: var(--wt-radius-full);
        color: var(--wt-color-text);
        text-decoration: none;
        white-space: nowrap;
      }
      wt-data-table::part(chip):focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      ${chipTints}
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ type: Boolean }) readOnly = false;
  @state() private model?: OpeningHoursModel;
  @state() private painted?: Map<string, PaintedIn>;
  @state() private readError = "";
  @state() private paintedInError = "";
  private periods = new PeriodEditing(this, {
    api: () => this.api,
    model: () => this.model!,
    chose: () => {},
    chooseDepartment: true,
    paintedIn: (periodId) => this.painted?.get(periodId),
    paintedInLinks: true,
    readOnly: () => this.readOnly,
    onDelete: (_department, period) => this.askDelete(period),
  });
  @state() private deleting?: Deletion;
  private detach?: () => void;
  private paintedDetach?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this.detach = this.api.watchOpeningHours(
      (model) => {
        this.model = model;
        this.readError = "";
        this.followDeletion();
      },
      () => {
        this.readError = t("period.load_error");
      },
      () => {
        this.readError = "";
      },
    );
    this.paintedDetach = this.api.watchPaintedIn(
      (rows) => {
        this.painted = new Map(rows.map(({ periodId, ...painted }) => [periodId, painted]));
        this.paintedInError = "";
        this.rereadImpact(rows);
      },
      () => {
        this.paintedInError = t("period.painted_in_error");
      },
      () => {
        this.paintedInError = "";
      },
    );
  }
  override disconnectedCallback() {
    this.detach?.();
    this.paintedDetach?.();
    this.detach = undefined;
    this.paintedDetach = undefined;
    super.disconnectedCallback();
  }

  private lookups?: {
    model: OpeningHoursModel;
    tints: Map<string, string>;
    menuNames: Map<string, string>;
  };
  /** Season tints and menu names, worked out once per model rather than once per row. */
  private lookup() {
    const model = this.model!;
    if (this.lookups?.model !== model)
      this.lookups = {
        model,
        tints: seasonTints(model.seasons),
        menuNames: new Map(model.menus.map(({ id, name }) => [id, name])),
      };
    return this.lookups;
  }
  private menuName(id: string) {
    return this.lookup().menuNames.get(id) ?? id;
  }
  private unpainted(row: PeriodRow) {
    const painted = row.kind === "period" ? this.painted?.get(row.id) : undefined;
    return painted !== undefined && !painted.seasons.length && !painted.specialDays.length;
  }
  private paintedInCell(row: PeriodRow & { kind: "period" }) {
    const painted = this.painted?.get(row.id);
    if (!painted) return nothing;
    if (!painted.seasons.length && !painted.specialDays.length)
      return html`<span part="not-painted">${t("period.not_painted")}</span>`;
    const { tints } = this.lookup();
    return html`<span part="chips"
      >${painted.seasons.map(
        (season) =>
          html`<a
            part=${`chip tint-${tints.get(season.id) ?? "1"}`}
            href=${seasonPainterPath({ seasonId: season.id, departmentId: row.departmentId })}
            >${season.name}</a
          >`,
      )}${painted.specialDays.map(
        (day) =>
          html`<a part="chip special-day" href=${specialDayPainterPath({ specialDayId: day.id })}
            >${day.name}</a
          >`,
      )}</span
    >`;
  }
  private actions(row: PeriodRow) {
    if (row.kind !== "period") return nothing;
    return html`<wt-row-actions label=${format("menu.row_actions", { name: row.name })}
      ><wt-button
        variant="secondary"
        align="start"
        data-test="edit-period"
        @click=${() => this.edit(row)}
        >${t("menu.edit")}</wt-button
      ><a data-test="open-hours" href=${seasonPainterPath({ departmentId: row.departmentId })}
        >${t("period.open_hours")}</a
      ><wt-button
        variant="danger"
        align="start"
        data-test="delete-period"
        @click=${() => this.askDelete(row)}
        >${t("menu.delete")}</wt-button
      ></wt-row-actions
    >`;
  }

  private edit(row: PeriodRow & { kind: "period" }) {
    if (this.deleting) return;
    const department = this.model?.departments.find(({ id }) => id === row.departmentId);
    const period = department?.periods.find(({ id }) => id === row.id);
    if (period) this.periods.open(department!, period);
  }

  override render() {
    const model = this.model;
    const rows: PeriodRow[] = (model?.departments ?? [])
      .filter((department) => department.active)
      .flatMap((department) => [
        { ...department, kind: "department" as const },
        ...department.periods.map((period) => ({
          ...period,
          kind: "period" as const,
          departmentId: department.id,
          departmentName: department.name,
        })),
      ]);
    const columns: DataTableColumn<PeriodRow>[] = [
      {
        key: "period",
        label: t("period.column.period"),
        cell: (row) => {
          if (row.kind === "department")
            return row.periods.length
              ? row.name
              : html`${row.name}<span part="no-periods">${t("period.no_periods")}</span>`;
          const unpainted = this.unpainted(row);
          return html`<span
              part=${`swatch colour-${row.colour}${unpainted ? " swatch-unpainted" : ""}`}
              data-colour=${row.colour}
            ></span
            ><span part=${unpainted ? "name unpainted" : "name"}>${row.name}</span>`;
        },
      },
      {
        key: "customerMenu",
        label: t("period.customer_menu"),
        cell: (row) => (row.kind === "period" ? this.menuName(row.menuId) : nothing),
      },
      {
        key: "staffMenus",
        label: t("opening.staff_menus"),
        cell: (row) =>
          row.kind !== "period"
            ? nothing
            : row.staffMenuIds.length
              ? row.staffMenuIds.map((id) => this.menuName(id)).join(", ")
              : "—",
      },
      {
        key: "floorPlan",
        label: t("period.floor_plan"),
        cell: (row) => (row.kind === "period" ? html`<span part="unavailable">—</span>` : nothing),
      },
      {
        key: "paintedIn",
        label: t("period.painted_in"),
        cell: (row) => (row.kind === "period" ? this.paintedInCell(row) : nothing),
      },
      ...(this.readOnly
        ? []
        : [
            {
              key: "actions",
              label: t("menu.actions"),
              pinned: "end",
              cell: (row: PeriodRow) => this.actions(row),
            } satisfies DataTableColumn<PeriodRow>,
          ]),
    ];
    return html`<div class="toolbar">
        <h1>${t("period.title")}</h1>
        ${
          this.readOnly
            ? nothing
            : html`<wt-button
                data-test="add-period"
                ?disabled=${!model}
                @click=${() => this.model && !this.deleting && this.periods.open(null)}
                >${t("period.add_button")}</wt-button
              >`
        }
      </div>
      ${this.readError ? html`<p role="alert" data-test="read-error">${this.readError}</p>` : nothing}
      ${this.paintedInError ? html`<p role="alert" data-test="painted-in-error">${this.paintedInError}</p>` : nothing}
      ${
        !model
          ? nothing
          : rows.length === 0
            ? html`<p data-test="no-departments">${t("menu.no_departments")}</p>`
            : html`<wt-data-table
                aria-label=${t("period.title")}
                .columns=${columns}
                .rows=${rows}
                .rowKey=${(row: PeriodRow) => `${row.kind}:${row.id}`}
                .rowParent=${(row: PeriodRow) => (row.kind === "period" ? `department:${row.departmentId}` : null)}
                .rowCollapsible=${() => false}
                .rowCellParts=${(row: PeriodRow) => (row.kind === "department" ? "department-cell" : "")}
              ></wt-data-table>`
      }
      ${model && !this.readOnly ? this.periods.render() : nothing}
      ${model && !this.readOnly ? this.renderDeletion() : nothing}`;
  }

  /** Closes the delete dialog once its period is gone, else reads what deleting it changes again. */
  private followDeletion() {
    const deletion = this.deleting;
    if (!deletion) return;
    const period = this.model!.departments.filter(({ active }) => active)
      .flatMap(({ periods }) => periods)
      .find(({ id }) => id === deletion.period.id);
    if (!period) {
      this.deleting = undefined;
      return;
    }
    deletion.period = period;
    this.rereadImpact(this.model!);
  }
  /** Reads the impact again unless the latest impact read started after the watch read that
   *  produced `read`, so both watches answering one page re-read cost one impact read. */
  private rereadImpact(read: object) {
    const deletion = this.deleting;
    if (!deletion) return;
    const number = this.api.readNumberOf(read);
    if (number !== undefined && number < deletion.readAfter) return;
    void this.readImpact(deletion, true);
  }

  private askDelete(period: Period) {
    if (this.readOnly || !this.isConnected || !this.model || this.deleting || this.periods.editing)
      return;
    const deletion: Deletion = { period, generation: 0, readAfter: 0, readError: "", busy: false };
    this.deleting = deletion;
    void this.readImpact(deletion);
  }

  /** `automatic` for a read the person did not start, which is passive session activity. */
  private async readImpact(deletion: Deletion, automatic = false) {
    const generation = ++deletion.generation;
    deletion.readAfter = this.api.nextReadNumber();
    const current = () => this.deleting === deletion && deletion.generation === generation;
    let impact: PeriodDeleteImpact;
    try {
      impact = await this.api.readPeriodDeleteImpact(deletion.period.id, { passive: automatic });
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

  private async confirmDelete(
    event: CustomEvent<{ periodId: string; replacementPeriodId: string | null }>,
  ) {
    event.stopPropagation();
    const deletion = this.deleting;
    const component = event.currentTarget as PeriodDeleteDialog;
    if (
      !deletion?.impact ||
      deletion.busy ||
      this.readOnly ||
      !this.isConnected ||
      component !== this.renderRoot.querySelector("period-delete-dialog") ||
      event.detail.periodId !== deletion.period.id
    )
      return;
    deletion.busy = true;
    component.refusal = undefined;
    this.requestUpdate();
    try {
      await this.api.deletePeriod(
        deletion.period.id,
        event.detail.replacementPeriodId,
        deletion.impact.clockRevision,
      );
    } catch (error) {
      if (this.deleting !== deletion || !this.isConnected) return;
      component.refusal = refusalOf(error);
      if (component.refusal.code === "hours.clock_changed") {
        // Delete waits for an impact read begun after the refusal, and sends its revision.
        deletion.impact = undefined;
        deletion.readError = "";
        void this.readImpact(deletion, true);
      }
      return;
    } finally {
      deletion.busy = false;
      this.requestUpdate();
    }
    if (this.deleting === deletion) this.deleting = undefined;
    this.api.rereadWatches();
  }

  private renderDeletion(): unknown {
    const deletion = this.deleting;
    if (!deletion) return nothing;
    return keyed(
      deletion,
      html`<period-delete-dialog
        .open=${true}
        .period=${deletion.period}
        .impact=${deletion.impact}
        .readError=${deletion.readError}
        .busy=${deletion.busy}
        @period-delete-confirm=${(
          event: CustomEvent<{ periodId: string; replacementPeriodId: string | null }>,
        ) => void this.confirmDelete(event)}
        @period-delete-retry=${(event: Event) => {
          event.stopPropagation();
          if (this.deleting === deletion && !deletion.busy) void this.readImpact(deletion);
        }}
        @period-delete-close=${(event: Event) => {
          event.stopPropagation();
          if (this.deleting === deletion && !deletion.busy) this.deleting = undefined;
        }}
      ></period-delete-dialog>`,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-periods-screen": PeriodsScreen;
  }
}
