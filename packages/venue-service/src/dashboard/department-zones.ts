import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type PreviewTable,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-floor-plan-preview.js";
import "./service-settings-fields.js";
import {
  placedTables,
  type VenueServiceApi,
  type VenueServiceView,
  type ZoneFloorPlan,
  type ZoneServiceSettingsInput,
} from "./client.js";
import { t } from "./strings.js";
import { currentLocale } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
const copy = (value: ZoneServiceSettingsInput) => ({ ...value });
const equal = (a: ZoneServiceSettingsInput, b: ZoneServiceSettingsInput) =>
  a.orderStart === b.orderStart &&
  a.paidWhen === b.paidWhen &&
  a.collectionNumber === b.collectionNumber &&
  a.receiptPrintMode === b.receiptPrintMode;

@customElement("department-zones")
export class DepartmentZones extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .zones {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-5);
      }
      .zones wt-button::part(button) {
        overflow-wrap: anywhere;
      }
      .heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-block-end: var(--wt-space-4);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        overflow-wrap: anywhere;
        min-width: 0;
      }
      a {
        color: var(--wt-color-primary-text);
      }
      a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .floor-plan-link,
      wt-floor-plan-preview {
        margin-block-start: var(--wt-space-2);
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        max-width: var(--wt-form-max-width);
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api?: VenueServiceApi;
  @property({ attribute: false }) model?: VenueServiceView;
  @property() departmentId = "";
  @property() zone = "";
  @state() private hours?: OpeningHoursModel;
  @state() private hoursFailed = false;
  private hoursDetach?: () => void;
  private hoursApi?: VenueServiceApi;
  @state() private plan?: ZoneFloorPlan;
  private previewOf?: ZoneFloorPlan;
  private previewTables: PreviewTable[] = [];
  @state() private planFailed = false;
  private planDetach?: () => void;
  private planApi?: VenueServiceApi;
  private planZone?: string;
  @state() private draft?: ZoneServiceSettingsInput;
  @state() private busy = false;
  @state() private failure = "";
  @state() private refused: Partial<Record<keyof ZoneServiceSettingsInput, string>> = {};
  private opened = "";
  private baseline?: ZoneServiceSettingsInput;
  private source?: ZoneServiceSettingsInput;
  private scope?: DraftScope<ZoneServiceSettingsInput>;
  private leave?: LeaveCoordinator;
  private generation = {};
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.hoursDetach?.();
    this.hoursDetach = undefined;
    this.hoursApi = undefined;
    this.hours = undefined;
    this.hoursFailed = false;
    this.watchPlan(undefined, undefined);
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    this.busy = false;
    super.disconnectedCallback();
  }
  private get department() {
    return this.model?.departments.find((d) => d.id === this.departmentId);
  }
  private get zones() {
    return this.model?.zones.filter((z) => z.departmentId === this.departmentId) ?? [];
  }
  private get selected() {
    return this.zones.find((z) => z.id === this.zone) ?? this.zones[0];
  }
  private get readonly() {
    return !this.department?.active || this.selected?.active === false;
  }
  protected override willUpdate() {
    if (this.isConnected && this.api !== this.hoursApi) {
      this.hoursDetach?.();
      this.hoursApi = this.api;
      this.hours = undefined;
      this.hoursFailed = false;
      this.hoursDetach = this.api?.openingHours?.watchOpeningHours(
        (model) => {
          this.hours = model;
          this.hoursFailed = false;
        },
        () => {
          this.hoursFailed = true;
        },
        () => {
          this.hoursFailed = false;
        },
      );
    }
    const row = this.selected;
    if (this.isConnected) this.watchPlan(this.api, row?.active === false ? undefined : row?.id);
    if (!row) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = "";
      this.generation = {};
      this.busy = false;
      this.draft = undefined;
      return;
    }
    const policy = this.model!.salePolicies.zones.find((p) => p.zoneId === row.id);
    const source: ZoneServiceSettingsInput = {
      orderStart: policy?.orderStart ?? null,
      paidWhen: policy?.paidWhen ?? null,
      collectionNumber: policy?.collectionNumber ?? null,
      receiptPrintMode: policy?.receiptPrintMode ?? null,
    };
    if (this.opened !== row.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = row.id;
      this.generation = {};
      this.busy = false;
      this.failure = "";
      this.refused = {};
      this.source = copy(source);
      this.draft = copy(source);
      this.baseline = copy(source);
    }
    if (this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this,
        current: () => this.draft!,
        snapshot: copy,
        equal,
        restore: (value) => {
          this.draft = copy(value);
          this.failure = "";
          this.refused = {};
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
    if (this.scope && !this.scope.isDirty() && !this.busy && !equal(this.source!, source)) {
      this.source = copy(source);
      this.draft = copy(source);
      this.baseline = copy(source);
      this.scope.commit(this.baseline);
    }
  }
  /** Reads only the selected, active zone's plan. */
  private watchPlan(api: VenueServiceApi | undefined, zoneId: string | undefined) {
    if (api === this.planApi && zoneId === this.planZone) return;
    this.planDetach?.();
    this.planDetach = undefined;
    this.planApi = api;
    this.planZone = zoneId;
    this.plan = undefined;
    this.planFailed = false;
    if (!api || zoneId === undefined) return;
    this.planDetach = api.watchZoneFloorPlan?.(
      zoneId,
      (plan) => {
        this.plan = plan;
        this.planFailed = false;
      },
      () => {
        this.planFailed = true;
      },
      () => {
        this.planFailed = false;
      },
    );
  }
  private floorPlan(zone: { id: string; name: string }, departmentId: string) {
    if (this.plan !== this.previewOf) {
      this.previewOf = this.plan;
      this.previewTables = placedTables(this.plan?.tables ?? []);
    }
    const placed = this.previewTables;
    const empty = this.plan !== undefined && placed.length === 0;
    return html`${this.planFailed ? html`<p role="alert" data-test="floor-plan-error">${t("venue.floor_plan_load_error")}</p>` : nothing}
      ${placed.length ? html`<wt-floor-plan-preview .tables=${placed} label=${t("venue.zone_floor_plan_preview").replace("{zone}", zone.name)}></wt-floor-plan-preview>` : nothing}
      <p class="floor-plan-link">
        <a
          data-test="zone-floor-plan"
          href=${`/manage/floor-plan/zone/${encodeURIComponent(zone.id)}?back=${encodeURIComponent(`/manage/venue-operations/department/${encodeURIComponent(departmentId)}/view/zones/zone/${encodeURIComponent(zone.id)}`)}`}
          >${t(empty ? "venue.zone_add_floor_plan" : "venue.zone_floor_plan")}</a
        >
      </p>`;
  }
  private emit(name: string, detail: object) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private async action(name: string, detail: object) {
    if (this.busy) return;
    if ((name !== "move-zone" && name !== "disable-zone") || !this.leave || !this.scope) {
      this.emit(name, detail);
      return;
    }
    const id = this.selected!.id,
      generation = this.generation;
    const proceed = () => {
      if (this.current(id, generation) && !this.busy) this.emit(name, detail);
    };
    await this.leave.request({ scopes: [this.scope.id], reason: "navigation", proceed });
  }
  private current(id: string, generation: object) {
    return this.isConnected && this.selected?.id === id && this.generation === generation;
  }
  private async select(id: string) {
    if (this.busy || id === this.selected?.id) return;
    const old = this.selected?.id,
      generation = this.generation;
    const proceed = () => {
      if (this.isConnected && this.selected?.id === old && this.generation === generation)
        this.emit("zone-change", { zoneId: id });
    };
    if (this.leave && this.scope)
      await this.leave.request({ scopes: [this.scope.id], reason: "navigation", proceed });
    else proceed();
  }
  private async cancel() {
    if (this.busy || !this.scope) return;
    const id = this.selected!.id,
      generation = this.generation;
    const proceed = () => {
      if (this.current(id, generation)) {
        this.draft = copy(this.baseline!);
        this.failure = "";
        this.refused = {};
      }
    };
    if (this.leave)
      await this.leave.request({ scopes: [this.scope.id], reason: "cancel", proceed });
    else proceed();
  }
  private async save() {
    if (
      !this.api ||
      !this.isConnected ||
      this.busy ||
      this.readonly ||
      saveActionState(this.scope).unchanged
    )
      return;
    const id = this.selected!.id,
      generation = this.generation,
      submitted = copy(this.draft!);
    this.busy = true;
    this.failure = "";
    this.refused = {};
    try {
      await this.api.saveZoneServiceSettings(id, submitted);
      if (this.current(id, generation)) {
        this.baseline = copy(submitted);
        this.scope?.commit(submitted);
        this.emit("saved", { zoneId: id });
      }
    } catch (error) {
      if (this.current(id, generation)) {
        const { code, params } = (error ?? {}) as {
          code?: string;
          params?: { field?: keyof ZoneServiceSettingsInput };
        };
        if (
          code === "management.request_invalid" &&
          params?.field &&
          ["orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"].includes(params.field)
        ) {
          this.refused = { [params.field]: t("venue.field_refused") };
          void this.updateComplete.then(() => {
            if (this.current(id, generation)) return focusFirstInvalid(this.shadowRoot!);
          });
        } else this.failure = t("venue.save_error");
      }
    } finally {
      if (this.current(id, generation)) this.busy = false;
    }
  }
  private closedWeek() {
    const zone = this.hours?.departments
      ?.find((d) => d.id === this.departmentId)
      ?.zones.find((z) => z.id === this.selected?.id);
    if (!zone) return nothing;
    const groups = new Map<
      string,
      { ranges: readonly { startsAt: string; endsAt: string }[]; days: number[] }
    >();
    const cutover = this.hours!.dayCutover;
    const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const rank = (time: string) => (minute(time) - minute(cutover) + 1440) % 1440;
    for (const weekday of [1, 2, 3, 4, 5, 6, 0]) {
      const ranges = [...(zone.week.find((d) => d.weekday === weekday)?.ranges ?? [])].sort(
        (a, b) => rank(a.startsAt) - rank(b.startsAt),
      );
      if (!ranges.length) continue;
      const key = ranges.map((r) => `${r.startsAt}/${r.endsAt}`).join(",");
      const group = groups.get(key) ?? { ranges, days: [] };
      group.days.push(weekday);
      groups.set(key, group);
    }
    if (!groups.size) return t("venue.zone_open_with_department");
    if (groups.size > 2)
      return t("venue.zone_closed_days").replace(
        "{count}",
        String([...groups.values()].reduce((sum, g) => sum + g.days.length, 0)),
      );
    const list = new Intl.ListFormat(currentLocale(), { style: "long", type: "conjunction" });
    const day = (n: number) => t(`hours.day_in_sentence.${n}` as Parameters<typeof t>[0]);
    const days = (values: number[]) => {
      const labels: string[] = [];
      for (let start = 0; start < values.length;) {
        let end = start;
        while (end + 1 < values.length && values[end + 1] === (values[end]! + 1) % 7) end++;
        if (end - start >= 2)
          labels.push(
            t("venue.zone_day_range")
              .replace("{start}", day(values[start]!))
              .replace("{end}", day(values[end]!)),
          );
        else for (let i = start; i <= end; i++) labels.push(day(values[i]!));
        start = end + 1;
      }
      return list.format(labels);
    };
    return t("venue.zone_closed_summary").replace(
      "{groups}",
      [...groups.values()]
        .map(
          (g) =>
            `${list.format(g.ranges.map((r) => (r.endsAt === cutover ? t("venue.zone_closed_from").replace("{time}", r.startsAt) : `${r.startsAt}–${r.endsAt}`)))} ${days(g.days)}`,
        )
        .join("; "),
    );
  }
  override render() {
    const row = this.selected,
      department = this.department;
    if (!department) return nothing;
    const policy = this.model!.salePolicies.departments.find(
      (p) => p.departmentId === department.id,
    );
    const follows = policy ?? {
      orderStart: "counter" as const,
      paidWhen: "prepay" as const,
      collectionNumber: "none" as const,
      receiptPrintMode: "auto" as const,
    };
    const disabled = this.readonly,
      state = saveActionState(this.scope);
    return html`<div class="zones" aria-label=${t("venue.list_zones")}>
        ${this.zones.map((z) => html`<wt-button variant="secondary" data-zone=${z.id} data-test=${`zone-${z.id}`} aria-pressed=${String(z.id === row?.id)} ?disabled=${this.busy} @click=${() => void this.select(z.id)}>${z.name}${z.active === false ? html` <span class="muted">(${t("venue.zone_disabled")})</span>` : nothing}</wt-button>`)}
        <wt-button
          variant=${department.active ? "primary" : "secondary"}
          data-test="add-zone"
          ?disabled=${this.busy || !department.active}
          @click=${() => this.action("add-zone", { departmentId: department.id })}
          >+ ${t("venue.add_department_zone")}</wt-button
        >
      </div>
      ${
        row && this.draft
          ? html`<div class="form">
              <div class="heading">
                <h2>${row.name}</h2>
                <wt-row-actions
                  data-zone-id=${row.id}
                  label=${`${row.name}: ${t("venue.actions")}`}
                  align="end"
                >
                  <wt-button
                    variant="secondary"
                    align="start"
                    data-test="rename-zone"
                    ?disabled=${this.busy}
                    @click=${() => this.action("rename-zone", { zoneId: row.id })}
                    >${t("venue.rename")}</wt-button
                  >
                  ${this.model!.departments.some((d) => d.active && d.id !== department.id) ? html`<wt-button variant="secondary" align="start" data-test="move-zone" ?disabled=${this.busy} @click=${() => this.action("move-zone", { zoneId: row.id })}>${t("venue.move_to_department")}</wt-button>` : nothing}
                  ${row.active === false ? (department.active ? html`<wt-button variant="secondary" align="start" data-test="enable-zone" ?disabled=${this.busy} @click=${() => this.action("enable-zone", { zoneId: row.id })}>${t("venue.enable")}</wt-button>` : nothing) : html`<wt-button variant="danger" align="start" data-test="disable-zone" ?disabled=${this.busy} @click=${() => this.action("disable-zone", { zoneId: row.id })}>${t("venue.disable")}</wt-button>`}
                </wt-row-actions>
              </div>
              ${
                row.active === false
                  ? nothing
                  : html`<div>
                      ${this.hoursFailed ? html`<p role="alert">${t("opening.load_error")}</p>` : nothing}
                      <p class="muted" data-test="closed-week-summary">${this.closedWeek()}</p>
                      <p>
                        <a
                          data-test="zone-opening-hours"
                          href=${`/manage/opening-hours/view/week/department/${encodeURIComponent(department.id)}/zone/${encodeURIComponent(row.id)}`}
                          >${t("venue.zone_opening_hours")}</a
                        >
                      </p>
                      ${this.floorPlan(row, department.id)}
                    </div>`
              }
              <dashboard-service-settings-fields
                .value=${this.draft}
                .follows=${follows}
                .errors=${this.refused}
                ?disabled=${disabled}
                @service-settings-change=${(
                  e: CustomEvent<{ value: ZoneServiceSettingsInput }>,
                ) => {
                  e.stopPropagation();
                  if (disabled) return;
                  const refused = { ...this.refused };
                  for (const field of [
                    "orderStart",
                    "paidWhen",
                    "collectionNumber",
                    "receiptPrintMode",
                  ] as const)
                    if (this.draft![field] !== e.detail.value[field]) delete refused[field];
                  this.draft = copy(e.detail.value);
                  this.refused = refused;
                  this.scope?.changed();
                  if (saveActionState(this.scope).unchanged) this.failure = "";
                }}
              ></dashboard-service-settings-fields>
              <wt-form-actions
                .error=${this.failure || (Object.keys(this.refused).length ? t("venue.fix_fields") : "")}
              >
                <wt-button
                  slot="cancel"
                  variant="secondary"
                  data-test="cancel-zone"
                  ?disabled=${this.busy}
                  @click=${() => void this.cancel()}
                  >${t("venue.cancel")}</wt-button
                >
                <wt-button
                  variant=${state.variant}
                  data-test="save-zone"
                  ?disabled=${this.busy || disabled || state.unchanged}
                  .loading=${this.busy}
                  @click=${() => void this.save()}
                  >${t("venue.save")}</wt-button
                >
              </wt-form-actions>
            </div>`
          : html`<p>${t("venue.no_department_zones")}</p>`
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "department-zones": DepartmentZones;
  }
}
