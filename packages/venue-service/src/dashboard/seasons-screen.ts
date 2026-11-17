import { t as tableText } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  leftToBrowser,
  pageTitleStyles,
  UrlStateController,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursApi, SeasonDeleteImpact } from "./opening-hours-client.js";
import { draftOf, runsUntil, seasonReceivers, type SeasonRow } from "./season-draft.js";
import { format, formatMonthDay } from "./hours-view.js";
import { seasonsPath } from "./opening-hours-paths.js";
import { SEASON_TINT_TOKENS } from "./season-tint.js";
import { listOf } from "./painter-labels.js";
import { seasonRefusalText } from "./season-refusal.js";
import { clockChangeConflictText } from "./clock-change-conflict.js";
import { refusalOf } from "./refusal.js";
import "@waitron/ui/src/components/wt-modal.js";
import { t } from "./strings.js";
import "./seasons-window.js";

const swatches = unsafeCSS(
  Object.entries(SEASON_TINT_TOKENS)
    .map(
      ([colour, { tint, line }]) =>
        `wt-data-table::part(colour-${colour}) { background: ${tint}; border-color: ${line}; }`,
    )
    .join("\n"),
);

@customElement("dashboard-seasons-screen")
export class SeasonsScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--wt-space-3);
        margin-block-end: var(--wt-space-4);
        flex-wrap: wrap;
      }
      h1 {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .toolbar > div {
        min-width: 0;
        max-width: 100%;
      }
      nav {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        color: var(--wt-color-primary-text);
      }
      .parent {
        color: var(--wt-color-primary-text);
      }
      wt-data-table::part(swatch) {
        display: inline-block;
        inline-size: var(--wt-space-4);
        block-size: var(--wt-space-4);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-sm);
        margin-inline-end: var(--wt-space-2);
      }
      ${swatches}
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ type: Boolean }) readOnly = false;
  @state() private model?: OpeningHoursModel;
  @state() private readError = "";
  @state() private address: string | null = null;
  @state() private deleting?: {
    season: SeasonRow;
    revision: number;
    receivers: string[];
    impact?: SeasonDeleteImpact;
    loading: boolean;
    busy: boolean;
    error: string;
  };
  @state() private actionError = "";
  private detach?: () => void;
  private askDelete(season: SeasonRow) {
    if (
      this.readOnly ||
      !this.model ||
      this.deleting ||
      this.model.seasons.length < 2 ||
      this.address
    )
      return;
    const stored = draftOf(this.model.seasons).rows;
    const deletion = {
      season,
      revision: this.model.clockRevision,
      receivers: seasonReceivers(season, stored),
      loading: true,
      busy: false,
      error: "",
    };
    this.deleting = deletion;
    this.actionError = "";
    void this.readImpact(deletion);
  }
  private async readImpact(deletion: NonNullable<SeasonsScreen["deleting"]>, refresh = false) {
    try {
      if (refresh) {
        const model = await this.api.readOpeningHours();
        if (this.deleting !== deletion) return;
        deletion.revision = model.clockRevision;
        deletion.receivers = seasonReceivers(deletion.season, draftOf(model.seasons).rows);
      }
      const impact = await this.api.readSeasonDeleteImpact(deletion.season.key);
      if (this.deleting === deletion) deletion.impact = impact;
    } catch {
      /* A failed impact read leaves deletion available with explicit unknown-loss wording. */
    } finally {
      deletion.loading = false;
      this.requestUpdate();
    }
  }
  private async confirmDelete() {
    const deletion = this.deleting;
    if (!deletion || deletion.busy || this.readOnly || !this.isConnected) return;
    deletion.busy = true;
    deletion.error = "";
    this.requestUpdate();
    try {
      await this.api.saveSeasons({ save: [], delete: [deletion.season.key] }, deletion.revision);
    } catch (error) {
      if (this.deleting !== deletion || !this.isConnected) return;
      const refusal = refusalOf(error);
      if (refusal.code === "hours.clock_changed") {
        deletion.error = t("season.delete_clock_changed");
        deletion.loading = true;
        deletion.impact = undefined;
        void this.readImpact(deletion, true);
      } else deletion.error = clockChangeConflictText(refusal) ?? seasonRefusalText(refusal);
      if (refusal.code === "season.not_found") {
        this.actionError = deletion.error;
        this.deleting = undefined;
        this.api.rereadWatches();
      }
      return;
    } finally {
      deletion.busy = false;
      this.requestUpdate();
    }
    if (this.deleting === deletion) {
      this.deleting = undefined;
      await this.updateComplete;
      this.shadowRoot!.querySelector<HTMLElement>("[data-test=add-season]")?.focus();
    }
    this.api.rereadWatches();
  }
  private renderDeletion() {
    const deletion = this.deleting;
    if (!deletion) return nothing;
    const losses = deletion.loading
      ? t("prep.delete_loading")
      : !deletion.impact
        ? t("season.delete_loses_unknown")
        : deletion.impact.departments.length
          ? format("season.delete_loses", {
              departments: listOf(deletion.impact.departments.map((d) => d.name)),
            })
          : t("season.delete_loses_none");
    return keyed(
      deletion,
      html`<wt-modal
        open
        size="compact"
        heading=${format("season.delete_heading", { name: deletion.season.name })}
        .dismissible=${!deletion.busy}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!deletion.busy && this.deleting === deletion) this.deleting = undefined;
        }}
      >
        <p data-test="delete-impact" role="status">
          ${format("season.delete_days", { previous: listOf(deletion.receivers) })} ${losses}
        </p>
        <wt-form-actions slot="footer" .error=${deletion.error}>
          <wt-button
            slot="cancel"
            variant="secondary"
            ?disabled=${deletion.busy}
            @click=${() => void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")}
            >${t("prep.cancel")}</wt-button
          >
          <wt-button
            data-test="confirm-delete"
            variant="danger"
            ?disabled=${deletion.busy}
            ?loading=${deletion.busy}
            @click=${() => void this.confirmDelete()}
            >${format("season.delete_named", { name: deletion.season.name })}</wt-button
          >
        </wt-form-actions></wt-modal
      >`,
    );
  }

  private readonly url = new UrlStateController(this, () => this.restoreAddress(), {
    basePath: "",
    primary: "dashboard",
    children: { seasons: { view: "view", season: "season" } },
  });
  private navigate(id: string | null, replace = false) {
    void Promise.resolve(
      this.url.write(
        {
          dashboard: "seasons",
          view: id === "new" ? "new" : null,
          season: id === "new" ? null : id,
        },
        replace,
      ),
    ).then(() => this.restoreAddress());
  }
  private restoreAddress() {
    if (this.url.read("dashboard") !== "seasons" || !this.model) return;
    const id = this.url.read("season") ?? (this.url.read("view") === "new" ? "new" : null);
    if (
      id &&
      (this.readOnly ||
        (id !== "new" && !this.model.seasons.some((s) => s.id === id) && id !== this.address))
    ) {
      this.address = null;
      this.url.write({ season: null, view: null }, true);
      return;
    }
    this.address = id;
  }
  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("readOnly") && this.readOnly) this.restoreAddress();
  }
  override connectedCallback() {
    super.connectedCallback();
    this.detach = this.api.watchOpeningHours(
      (model) => {
        this.model = model;
        this.readError = "";
        this.restoreAddress();
      },
      () => {
        this.readError = t("opening.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }
  override disconnectedCallback() {
    this.detach?.();
    super.disconnectedCallback();
  }
  override render() {
    const rows = draftOf(this.model?.seasons ?? []).rows;
    const id = this.address;
    const columns: DataTableColumn<SeasonRow>[] = [
      {
        key: "name",
        label: t("season.column_name"),
        cell: (row) =>
          html`<span
              part=${`swatch colour-${row.colour}`}
              role="img"
              aria-label=${t(`hours.colour.${row.colour}`)}
              title=${t(`hours.colour.${row.colour}`)}
            ></span
            >${row.name}`,
      },
      {
        key: "startsOn",
        choosable: "shown",
        label: t("season.starts"),
        cell: (row) => formatMonthDay(`${row.month}-${row.day.padStart(2, "0")}`),
      },
      {
        key: "runsUntil",
        choosable: "shown",
        label: t("season.runs_until"),
        cell: (row) => formatMonthDay(runsUntil(rows, row.key)!),
      },
      ...(this.readOnly
        ? []
        : [
            {
              key: "actions",
              label: t("menu.actions"),
              pinned: "end",
              cell: (row: SeasonRow) =>
                html`<wt-row-actions label=${`${row.name}: ${t("menu.actions")}`} align="end">
                  <wt-button data-test="edit-season" @click=${() => this.navigate(row.key)}
                    >${t("venue.edit")}</wt-button
                  >
                  <wt-button
                    data-test="delete-season"
                    variant="danger"
                    ?disabled=${rows.length === 1}
                    @click=${() => this.askDelete(row)}
                    >${t("prep.delete")}</wt-button
                  >
                </wt-row-actions>`,
            } satisfies DataTableColumn<SeasonRow>,
          ]),
    ];
    return html`<div class="toolbar">
        <div>
          ${
            id
              ? html`<nav aria-label=${t("season.seasons")}>
                  <a
                    class="parent"
                    href=${seasonsPath}
                    @click=${(event: MouseEvent) => {
                      if (leftToBrowser(event)) return;
                      event.preventDefault();
                      void this.shadowRoot!.querySelector("seasons-window")!.requestClose();
                    }}
                    >${t("season.seasons")}</a
                  ><span aria-hidden="true"> ›</span>
                </nav>`
              : nothing
          }
          <h1>
            ${id ? (id === "new" ? t("season.add") : (this.model?.seasons.find((s) => s.id === id)?.name ?? t("season.not_found"))) : t("season.seasons")}
          </h1>
        </div>
        ${this.readOnly || id ? nothing : html`<wt-button data-test="add-season" ?disabled=${!this.model} @click=${() => this.navigate("new")}>${t("season.add")}</wt-button>`}
      </div>
      ${this.actionError ? html`<p role="alert" data-test="action-error">${this.actionError}</p>` : nothing}
      ${this.readError ? html`<p role="alert" data-test="read-error">${this.readError}</p>` : nothing}
      ${
        !this.model
          ? nothing
          : id
            ? keyed(
                id,
                html`<seasons-window
                  .api=${this.api}
                  .seasonId=${id === "new" ? "" : id}
                  .seasons=${this.model.seasons}
                  .clockRevision=${this.model.clockRevision}
                  @season-cancel=${(event: Event) => {
                    event.stopPropagation();
                    this.navigate(null, true);
                  }}
                  @seasons-saved=${(event: Event) => {
                    event.stopPropagation();
                    this.navigate(null, true);
                    this.api.rereadWatches();
                  }}
                ></seasons-window>`,
              )
            : html`<wt-data-table
                wrap-to-fit
                aria-label=${t("season.seasons")}
                viewKey="waitron.seasons.table"
                customiseColumnsLabel=${tableText("table.customise_columns")}
                customiseLabel=${tableText("table.customise")}
                restoreColumnsLabel=${tableText("table.restore_columns")}
                doneLabel=${tableText("table.done")}
                moveColumnLabel=${tableText("table.move_column")}
                showColumnLabel=${tableText("table.show_column")}
                hideColumnLabel=${tableText("table.hide_column")}
                alwaysShownColumnLabel=${tableText("table.column_always_shown")}
                lastShownColumnLabel=${tableText("table.column_last_shown")}
                columnPositionLabel=${tableText("table.column_position")}
                .columns=${columns}
                .rows=${rows}
                .rowKey=${(row: SeasonRow) => row.key}
                .rowClick=${this.readOnly ? undefined : (row: SeasonRow) => this.navigate(row.key)}
                .rowClickLabel=${(row: SeasonRow) => row.name}
              ></wt-data-table>`
      }${this.renderDeletion()}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-seasons-screen": SeasonsScreen;
  }
}
