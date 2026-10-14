import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { PaintedIn } from "../period-delete.js";
import { format } from "./hours-view.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import { periodColourTokens } from "./period-colour-styles.js";
import { SEASON_TINTS, seasonTints, seasonTintTokens } from "./season-tint.js";
import { CALENDAR_COLOURS } from "../hours-types.js";
import { t } from "./strings.js";

type Department = OpeningHoursModel["departments"][number];
type Period = Department["periods"][number];
export type PeriodRow =
  | ({ kind: "department" } & Department)
  | ({ kind: "period"; departmentId: string; departmentName: string } & Period);

const at = encodeURIComponent;

const swatchColours = unsafeCSS(
  CALENDAR_COLOURS.map(
    (colour) =>
      `wt-data-table::part(colour-${colour}) { background: var(${periodColourTokens(colour).fill}); }`,
  ).join("\n"),
);
const chipTints = unsafeCSS(
  SEASON_TINTS.map((tint) => {
    const tokens = seasonTintTokens(tint);
    return `wt-data-table::part(tint-${tint}) { background: var(${tokens.tint}); color: var(${tokens.onTint}); border-color: var(${tokens.line}); }`;
  }).join("\n"),
);

/** The period list of mockup 6: every active department's periods, grouped under it. Cell markup
 *  lives in the table's shadow root, so each colour and season tint is its own part. */
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
      wt-data-table::part(chips) {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-1);
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
  private detach?: () => void;
  private paintedDetach?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this.detach = this.api.watchOpeningHours(
      (model) => {
        this.model = model;
        this.readError = "";
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

  private menuName(id: string) {
    return this.model!.menus.find((menu) => menu.id === id)?.name ?? id;
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
    const tints = seasonTints(this.model!.seasons);
    return html`<span part="chips"
      >${painted.seasons.map(
        (season) =>
          html`<a
            part=${`chip tint-${tints.get(season.id) ?? "1"}`}
            href=${`/manage/opening-hours/view/season/season/${at(season.id)}/department/${at(row.departmentId)}`}
            >${season.name}</a
          >`,
      )}${painted.specialDays.map(
        (day) =>
          html`<a
            part="chip special-day"
            href=${`/manage/opening-hours/view/special-day/special-day/${at(day.id)}`}
            >${day.name}</a
          >`,
      )}</span
    >`;
  }
  private actions(row: PeriodRow) {
    if (row.kind !== "period") return nothing;
    return html`<wt-row-actions label=${format("menu.row_actions", { name: row.name })} align="end"
      ><wt-button variant="secondary" data-test="edit-period">${t("menu.edit")}</wt-button
      ><a
        data-test="open-hours"
        href=${`/manage/opening-hours/view/season/department/${at(row.departmentId)}`}
        >${t("period.open_hours")}</a
      ><wt-button variant="danger" data-test="delete-period"
        >${t("menu.delete")}</wt-button
      ></wt-row-actions
    >`;
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
          if (row.kind === "department") return row.name;
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
        ${this.readOnly ? nothing : html`<wt-button data-test="add-period">${t("period.add_button")}</wt-button>`}
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
              ></wt-data-table>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-periods-screen": PeriodsScreen;
  }
}
