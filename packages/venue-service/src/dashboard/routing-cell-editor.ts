import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { cellKey, parseTargetKey, targetKey, type RouteTarget } from "../routing.js";
import type { CellAddress, PeriodLine, RoutingPeriod } from "../routing-types.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

export interface RoutingCellEditorCell {
  address: CellAddress;
  label: string;
  /** The cell's own choice, or the inherited one; null when nothing decides it. */
  target: RouteTarget | null;
  periods?: readonly PeriodLine[];
  /** Where an inherited choice comes from; absent for a stored cell. */
  inheritedFrom?: string;
}

export type RoutingCellSave = { target: RouteTarget; periods: PeriodLine[] };

type Line = { id: number; periodIds: string[]; target: string };
type Draft = { target: string; lines: Line[] };
type OwnErrors = { target?: string; lines: Map<number, { periods?: string; target?: string }> };
type LeftOut = { period: RoutingPeriod; reason: "department" | "products" };

const NO_PREPARATION = targetKey({ kind: "no_preparation" });
const stationKey = (stationId: string) => targetKey({ kind: "station", stationId });

const copy = (draft: Draft): Draft => ({
  target: draft.target,
  lines: draft.lines.map((line) => ({ ...line, periodIds: [...line.periodIds] })),
});

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

const equal = (a: Draft, b: Draft) =>
  a.target === b.target &&
  a.lines.length === b.lines.length &&
  a.lines.every(
    (line, i) =>
      line.target === b.lines[i]!.target && sameSet(line.periodIds, b.lines[i]!.periodIds),
  );

@customElement("routing-cell-editor")
export class RoutingCellEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
      .line {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) auto;
        gap: var(--wt-space-3);
        align-items: start;
      }
      .line wt-button {
        margin-block-start: var(--wt-space-2);
      }
      @media (max-width: 40rem) {
        .line {
          grid-template-columns: minmax(0, 1fr) auto;
          padding-inline-start: var(--wt-space-3);
          border-inline-start: 2px solid var(--wt-color-border);
        }
        .line wt-combobox:first-child {
          grid-column: 1 / -1;
        }
      }
      .note {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .add {
        justify-self: start;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) cell?: RoutingCellEditorCell;
  @property({ attribute: false }) periods: readonly RoutingPeriod[] = [];
  @property({ attribute: false }) stations: readonly {
    id: string;
    name: string;
    active: boolean;
  }[] = [];
  /** The active products the row covers, variants by their parent. */
  @property({ attribute: false }) rowProductIds: readonly string[] = [];
  /** The zone column's department; null for Every zone. */
  @property({ attribute: false }) zoneDepartmentId: string | null = null;
  /** A zone column whose zone serves no department: routing there reads no period line. */
  @property({ type: Boolean }) zoneWithoutDepartment = false;
  @property({ type: Boolean }) isDefaultCell = false;
  /** `message`, when given, is shown at the bottom for a refusal no line takes. */
  @property({ attribute: false }) refusal?: {
    code: string;
    params?: Record<string, unknown>;
    message?: string;
  };

  @state() private draft: Draft = { target: "", lines: [] };
  @state() private attempted = false;
  /** Names of periods a live update deleted while this draft held them. */
  @state() private removed: string[] = [];
  private scope?: DraftScope<Draft>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private openedKey?: string;
  private baseline?: Draft;
  private leftOut: LeftOut[] = [];
  private nextLine = 0;
  private rowMemo?: {
    periods: readonly RoutingPeriod[];
    rowProductIds: readonly string[];
    meeting: ReadonlySet<RoutingPeriod>;
  };
  private generation = {};

  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    if (!this.open) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = undefined;
      this.baseline = undefined;
      this.generation = {};
      return;
    }
    const key = this.cell && cellKey(this.cell.address);
    if (!this.identity || this.openedKey !== key) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = {};
      this.openedKey = key;
      this.generation = {};
      this.draft = this.opening();
      this.baseline = copy(this.draft);
      this.attempted = false;
      this.refusal = undefined;
      this.removed = [];
    } else if (changed.has("periods")) {
      this.dropDeletedPeriods((changed.get("periods") as readonly RoutingPeriod[]) ?? []);
    }
    if (this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this.identity,
        current: () => this.draft,
        snapshot: copy,
        equal,
        restore: (value) => {
          this.draft = copy(value);
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
  }

  /**
   * A period deleted while the editor is open cannot be saved, so it leaves the draft and the
   * opened values alike: what stays changed is only what the person changed. A line left with no
   * period goes too.
   */
  private dropDeletedPeriods(previous: readonly RoutingPeriod[]) {
    const live = this.periodById();
    const prune = (draft: Draft): Draft => ({
      target: draft.target,
      lines: draft.lines.flatMap((line) => {
        const periodIds = line.periodIds.filter((id) => live.has(id));
        return periodIds.length === 0 && line.periodIds.length > 0 ? [] : [{ ...line, periodIds }];
      }),
    });
    const held = new Set(this.draft.lines.flatMap((line) => line.periodIds));
    const names = previous.map(({ name }) => name);
    const gone = previous
      .filter((period) => !live.has(period.id) && held.has(period.id))
      .map((period) =>
        names.indexOf(period.name) !== names.lastIndexOf(period.name)
          ? format("routing.period_in_department", {
              period: period.name,
              department: period.departmentName,
            })
          : period.name,
      );
    this.leftOut = this.leftOut.filter(({ period }) => live.has(period.id));
    const refused = this.refusal?.params?.periodId;
    if (this.refusal?.code === "route.period_invalid" && !live.has(refused as string))
      this.refusal = undefined;
    if (gone.length === 0) return;
    this.removed = [...this.removed, ...gone];
    this.draft = prune(this.draft);
    if (this.baseline !== undefined) {
      this.baseline = prune(this.baseline);
      this.scope?.commit(this.baseline);
    }
  }

  get dirty(): boolean {
    return this.baseline !== undefined && !equal(this.draft, this.baseline);
  }

  private get inherited(): boolean {
    return this.cell?.inheritedFrom !== undefined;
  }

  private periodById(): Map<string, RoutingPeriod> {
    return new Map(this.periods.map((period) => [period.id, period]));
  }

  private meetsRow(period: RoutingPeriod): boolean {
    const memo = this.rowMemo;
    if (memo?.periods === this.periods && memo.rowProductIds === this.rowProductIds)
      return memo.meeting.has(period);
    const row = new Set(this.rowProductIds);
    const meeting = new Set(
      this.periods.filter((candidate) => candidate.productIds.some((id) => row.has(id))),
    );
    this.rowMemo = { periods: this.periods, rowProductIds: this.rowProductIds, meeting };
    return meeting.has(period);
  }

  private inColumn(period: RoutingPeriod): boolean {
    if (this.zoneWithoutDepartment) return false;
    return this.zoneDepartmentId === null || period.departmentId === this.zoneDepartmentId;
  }

  /**
   * One line per target, in the model's period order. An inherited draft keeps only the periods a
   * cell at this address may store; the rest are listed as left out.
   */
  private opening(): Draft {
    const cell = this.cell;
    const byId = this.periodById();
    const order = new Map(this.periods.map((period, i) => [period.id, i]));
    this.leftOut = [];
    const kept: PeriodLine[] = [];
    // A period the model no longer lists has been deleted, and its lines with it.
    for (const line of (this.isDefaultCell ? [] : (cell?.periods ?? []))
      .filter(({ periodId }) => order.has(periodId))
      .sort((a, b) => order.get(a.periodId)! - order.get(b.periodId)!)) {
      const period = byId.get(line.periodId)!;
      if (this.inherited) {
        if (!this.inColumn(period)) {
          this.leftOut.push({ period, reason: "department" });
          continue;
        }
        if (!this.meetsRow(period)) {
          this.leftOut.push({ period, reason: "products" });
          continue;
        }
      }
      kept.push(line);
    }
    const lines = new Map<string, Line>();
    for (const { periodId, target } of kept) {
      const key = targetKey(target);
      const line = lines.get(key);
      if (line === undefined)
        lines.set(key, { id: this.nextLine++, periodIds: [periodId], target: key });
      else line.periodIds.push(periodId);
    }
    return { target: targetKey(cell?.target ?? null), lines: [...lines.values()] };
  }

  private get saveState() {
    return saveActionState(this.scope, { savableAtOpen: this.inherited });
  }

  private ownErrors(): OwnErrors {
    const lines = new Map<number, { periods?: string; target?: string }>();
    for (const line of this.draft.lines) {
      const errors = {
        ...(line.periodIds.length === 0 ? { periods: t("routing.periods_required") } : {}),
        ...(line.target === "" ? { target: t("routing.station_required") } : {}),
      };
      if (errors.periods || errors.target) lines.set(line.id, errors);
    }
    return {
      ...(this.draft.target === "" ? { target: t("routing.station_required") } : {}),
      lines,
    };
  }

  private hasOwnErrors(): boolean {
    const errors = this.ownErrors();
    return errors.target !== undefined || errors.lines.size > 0;
  }

  /** The line holding the period a `route.period_invalid` refusal names. */
  private refusedLine(): { id: number; message: string } | undefined {
    const refusal = this.refusal;
    if (refusal?.code !== "route.period_invalid") return undefined;
    const periodId = refusal.params?.periodId;
    const line = this.draft.lines.find((candidate) =>
      candidate.periodIds.includes(periodId as string),
    );
    if (line === undefined) return undefined;
    const period = this.periodById().get(periodId as string)?.name;
    if (period === undefined) return undefined;
    const key =
      refusal.params?.reason === "other_department"
        ? "routing.period_other_department"
        : refusal.params?.reason === "repeated"
          ? "routing.period_repeated"
          : "routing.period_not_offered";
    return { id: line.id, message: format(key, { period }) };
  }

  private changed(draft: Draft, lineId?: number) {
    this.draft = draft;
    if (lineId !== undefined && this.refusedLine()?.id === lineId) this.refusal = undefined;
    this.scope?.changed();
  }

  private setLine(id: number, change: Partial<Line>) {
    this.changed(
      {
        ...this.draft,
        lines: this.draft.lines.map((line) => (line.id === id ? { ...line, ...change } : line)),
      },
      id,
    );
  }

  private stationOptions() {
    const options: { value: string; label: string; disabled?: boolean }[] = this.stations
      .filter((station) => station.active)
      .map((station) => ({ value: stationKey(station.id), label: station.name }));
    if (!this.isDefaultCell)
      options.push({ value: NO_PREPARATION, label: t("prep.no_preparation") });
    return options;
  }

  /** The choices plus a stored switched-off station, shown disabled while a field holds it. */
  private targetOptions(value: string) {
    const options = this.stationOptions();
    if (value === "" || options.some((option) => option.value === value)) return options;
    const station = this.stations.find((candidate) => stationKey(candidate.id) === value);
    const label =
      station === undefined ? value : format("routing.disabled_station", { station: station.name });
    return [...options, { value, label, disabled: true }];
  }

  private storedTargets(): Map<string, string> {
    return new Map(
      this.inherited
        ? []
        : (this.cell?.periods ?? []).map(({ periodId, target }) => [periodId, targetKey(target)]),
    );
  }

  private offerable(period: RoutingPeriod): boolean {
    return period.departmentInactive !== true && this.inColumn(period) && this.meetsRow(period);
  }

  /** Names shared by two periods some line may show; each such period carries its department. */
  private repeatedNames(): Set<string> {
    const stored = this.storedTargets();
    const names = this.periods
      .filter(
        (period) =>
          this.offerable(period) ||
          stored.has(period.id) ||
          this.draft.lines.some((line) => line.periodIds.includes(period.id)),
      )
      .map(({ name }) => name);
    return new Set(names.filter((name, i) => names.indexOf(name) !== i));
  }

  /**
   * A line offers the periods this column may store that meet the row, plus a period the cell
   * stores with this line's target, plus whatever the line holds — never one another line holds.
   */
  private periodOptions(line: Line, repeated: Set<string>) {
    const elsewhere = new Set(
      this.draft.lines.filter((other) => other.id !== line.id).flatMap((other) => other.periodIds),
    );
    const stored = this.storedTargets();
    const grouped = this.zoneDepartmentId === null;
    return this.periods
      .filter(
        (period) =>
          line.periodIds.includes(period.id) ||
          (!elsewhere.has(period.id) &&
            (this.offerable(period) ||
              (line.target !== "" && stored.get(period.id) === line.target))),
      )
      .map((period) => ({
        value: period.id,
        label: period.name,
        ...(grouped ? { group: period.departmentName } : {}),
        ...(repeated.has(period.name)
          ? {
              valueLabel: format("routing.period_in_department", {
                period: period.name,
                department: period.departmentName,
              }),
            }
          : {}),
      }));
  }

  /** A line's periods named in the model's order, for the field's closed face. */
  private periodNames(line: Line, repeated: Set<string>): string {
    return this.periodOptions(line, repeated)
      .filter((option) => line.periodIds.includes(option.value))
      .map((option) => option.valueLabel ?? option.label)
      .join(", ");
  }

  private save() {
    if (!this.open || !this.isConnected || this.busy || this.saveState.unchanged) return;
    this.attempted = true;
    this.refusal = undefined;
    if (this.hasOwnErrors()) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const detail: RoutingCellSave = {
      target: parseTargetKey(this.draft.target)!,
      periods: this.draft.lines.flatMap((line) =>
        line.periodIds.map((periodId) => ({ periodId, target: parseTargetKey(line.target)! })),
      ),
    };
    this.dispatchEvent(
      new CustomEvent("routing-cell-save", { detail, bubbles: true, composed: true }),
    );
  }

  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.isConnected && generation === this.generation && outcome === "proceeded";
  };

  private leftOutText(): string {
    return format("routing.not_copied", {
      periods: this.leftOut
        .map(({ period, reason }) =>
          reason === "department"
            ? format("routing.not_copied_department", {
                period: period.name,
                department: period.departmentName,
              })
            : format("routing.not_copied_products", { period: period.name }),
        )
        .join("; "),
    });
  }

  override render(): unknown {
    if (!this.open || this.cell === undefined) return nothing;
    const s = this.saveState;
    const own: OwnErrors = this.attempted ? this.ownErrors() : { lines: new Map() };
    const refused = this.refusedLine();
    const marked = own.target !== undefined || own.lines.size > 0 || refused !== undefined;
    const unplaced =
      this.refusal && refused === undefined
        ? (this.refusal.message ??
          (this.refusal.code === "route.station_inactive"
            ? t("prep.station_disabled")
            : t("prep.save_error")))
        : "";
    const generation = this.generation;
    const current = () =>
      generation === this.generation && this.isConnected && this.open && !this.busy;
    const stored = !this.inherited && !this.isDefaultCell;
    const repeated = this.repeatedNames();
    return keyed(
      generation,
      html`<wt-modal
        open
        size="standard"
        heading=${this.cell.label}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (generation !== this.generation || !this.isConnected) return;
          this.open = false;
          this.dispatchEvent(
            new CustomEvent("routing-cell-close", { bubbles: true, composed: true }),
          );
        }}
      >
        <div class="form">
          ${
            this.inherited
              ? html`<p class="note" data-test="inherited-from">
                  ${format("routing.editor_from", { source: this.cell.inheritedFrom! })}
                </p>`
              : nothing
          }
          ${repeat(
            this.draft.lines,
            (line) => line.id,
            (line, index) =>
              html`<div class="line" data-test="period-line">
                <wt-combobox
                  name="line-periods"
                  label=${t("routing.line_periods")}
                  multiple
                  required
                  .values=${line.periodIds}
                  .options=${this.periodOptions(line, repeated)}
                  .countLabel=${() => this.periodNames(line, repeated)}
                  .error=${
                    own.lines.get(line.id)?.periods ??
                    (refused?.id === line.id ? refused.message : "")
                  }
                  ?disabled=${this.busy}
                  @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
                    event.stopPropagation();
                    if (current()) this.setLine(line.id, { periodIds: [...event.detail.values] });
                  }}
                ></wt-combobox>
                <wt-combobox
                  name="line-target"
                  label=${t("routing.line_station")}
                  required
                  search="never"
                  .value=${line.target}
                  .options=${this.targetOptions(line.target)}
                  .error=${own.lines.get(line.id)?.target ?? ""}
                  ?disabled=${this.busy}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    if (current()) this.setLine(line.id, { target: event.detail.value });
                  }}
                ></wt-combobox>
                <wt-button
                  data-test="remove-line"
                  variant="ghost"
                  aria-label=${
                    line.periodIds.length > 0
                      ? format("routing.remove_line_periods", {
                          periods: this.periodNames(line, repeated),
                        })
                      : format("routing.remove_line_number", { number: String(index + 1) })
                  }
                  ?disabled=${this.busy}
                  @click=${() => {
                    if (current())
                      this.changed(
                        {
                          ...this.draft,
                          lines: this.draft.lines.filter((other) => other.id !== line.id),
                        },
                        line.id,
                      );
                  }}
                  >${t("routing.remove_line")}</wt-button
                >
              </div>`,
          )}
          <wt-combobox
            name="target"
            label=${t("routing.any_other_time")}
            required
            search="never"
            .value=${this.draft.target}
            .options=${this.targetOptions(this.draft.target)}
            .error=${own.target ?? ""}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current()) this.changed({ ...this.draft, target: event.detail.value });
            }}
          ></wt-combobox>
          ${
            this.isDefaultCell || this.zoneWithoutDepartment
              ? nothing
              : html`<wt-button
                  class="add"
                  data-test="add-line"
                  variant="ghost"
                  ?disabled=${this.busy}
                  @click=${() => {
                    if (current())
                      this.changed({
                        ...this.draft,
                        lines: [
                          ...this.draft.lines,
                          { id: this.nextLine++, periodIds: [], target: "" },
                        ],
                      });
                  }}
                  >${t("routing.add_line")}</wt-button
                >`
          }
          ${
            this.removed.length > 0
              ? html`<p class="note" data-test="periods-removed">
                  ${format("routing.periods_removed", { periods: this.removed.join(", ") })}
                </p>`
              : nothing
          }
          ${
            this.leftOut.length > 0
              ? html`<p class="note" data-test="not-copied">${this.leftOutText()}</p>`
              : nothing
          }
        </div>
        <wt-form-actions
          slot="footer"
          .error=${[unplaced, marked ? t("prep.fix_fields") : ""].filter(Boolean).join(" ")}
        >
          <wt-button
            slot="cancel"
            data-test="cancel-cell"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => {
              if (current())
                void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
            }}
            >${t("prep.cancel")}</wt-button
          >
          ${
            stored
              ? html`<wt-button
                  slot="secondary"
                  data-test="clear-cell"
                  variant="danger"
                  ?disabled=${this.busy}
                  @click=${() => {
                    if (current())
                      this.dispatchEvent(
                        new CustomEvent("routing-cell-clear", { bubbles: true, composed: true }),
                      );
                  }}
                  >${t("routing.clear")}</wt-button
                >`
              : nothing
          }
          <wt-button
            data-test="save-cell"
            variant=${s.variant}
            ?disabled=${s.unchanged || this.busy || (this.attempted && this.hasOwnErrors())}
            ?loading=${this.busy}
            @click=${() => {
              if (current()) this.save();
            }}
            >${t("prep.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "routing-cell-editor": RoutingCellEditor;
  }
}
