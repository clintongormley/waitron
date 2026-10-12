import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type PreviewTable,
} from "@waitron/ui";
import {
  placedTables,
  type VenueServiceApi,
  type VenueServiceView,
  type ZoneEditInput,
  type ZoneFloorPlan,
} from "./client.js";
import type { ServiceSettingsValue } from "./service-settings-fields.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { zoneClosedWeek } from "./zone-closed-week.js";
import { t } from "./strings.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import "./service-settings-fields.js";
import "@waitron/ui/src/components/wt-floor-plan-preview.js";

const copy = (value: ZoneEditInput): ZoneEditInput => ({ ...value });
const equal = (a: ZoneEditInput, b: ZoneEditInput) =>
  a.name.trim() === b.name.trim() &&
  a.orderStart === b.orderStart &&
  a.paidWhen === b.paidWhen &&
  a.collectionNumber === b.collectionNumber &&
  a.receiptPrintMode === b.receiptPrintMode;
type Field = keyof ZoneEditInput;
const policyFields = ["orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"] as const;

@customElement("zone-edit-dialog")
export class ZoneEditDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      a {
        color: var(--wt-color-primary-text);
      }
      a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        min-width: 0;
      }
    `,
  ];
  @property({ attribute: false }) api!: VenueServiceApi;
  @property({ attribute: false }) model!: VenueServiceView;
  @property() zoneId = "";
  @state() private draft?: ZoneEditInput;
  @state() private busy = false;
  @state() private attempted = false;
  @state() private dismissed = false;
  @state() private refused: Partial<Record<Field, string>> = {};
  @state() private failure = "";
  @state() private plan?: ZoneFloorPlan;
  @state() private planFailed = false;
  @state() private hours?: OpeningHoursModel;
  @state() private hoursFailed = false;
  private planDetach?: () => void;
  private planApi?: VenueServiceApi;
  private planZone?: string;
  private previewOf?: ZoneFloorPlan;
  private previewTables: PreviewTable[] = [];
  private hoursDetach?: () => void;
  private hoursApi?: VenueServiceApi;
  private opened = "";
  private source?: ZoneEditInput;
  private baseline?: ZoneEditInput;
  private scope?: DraftScope<ZoneEditInput>;
  private leave?: LeaveCoordinator;
  private generation = {};
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.watchPlan(undefined, undefined);
    this.hoursDetach?.();
    this.hoursDetach = undefined;
    this.hoursApi = undefined;
    this.hours = undefined;
    this.hoursFailed = false;
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    this.busy = false;
    super.disconnectedCallback();
  }
  private get zone() {
    return this.model?.zones.find(
      (row) =>
        row.id === this.zoneId &&
        row.active !== false &&
        this.model?.floorZones.find((floor) => floor.id === row.id)?.active !== false &&
        this.model?.departments.some(
          (department) => department.id === row.departmentId && department.active,
        ),
    );
  }
  protected override willUpdate() {
    const row = this.zone;
    if (this.isConnected) {
      this.watchPlan(this.api, row?.id);
      if (this.api !== this.hoursApi) {
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
    }
    if (!row) {
      const gone = this.opened === this.zoneId && !this.dismissed;
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = "";
      this.draft = undefined;
      this.generation = {};
      this.busy = false;
      if (gone) {
        this.dismissed = true;
        this.emit("gone", this.zoneId);
      }
      return;
    }
    const policy = this.model.salePolicies.zones.find((value) => value.zoneId === row.id);
    const source: ZoneEditInput = {
      name: row.name,
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
      this.attempted = false;
      this.dismissed = false;
      this.refused = {};
      this.failure = "";
      this.source = copy(source);
      this.baseline = copy(source);
      this.draft = copy(source);
    }
    if (this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this,
        current: () => this.draft!,
        snapshot: copy,
        equal,
        restore: (value) => {
          this.draft = copy(value);
          this.attempted = false;
          this.refused = {};
          this.failure = "";
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
    if (this.scope && !this.scope.isDirty() && !this.busy && !equal(this.source!, source)) {
      this.source = copy(source);
      this.baseline = copy(source);
      this.draft = copy(source);
      this.scope.commit(source);
    }
  }
  private watchPlan(api: VenueServiceApi | undefined, zoneId: string | undefined) {
    if (api === this.planApi && zoneId === this.planZone) return;
    this.planDetach?.();
    this.planDetach = undefined;
    this.planApi = api;
    this.planZone = zoneId;
    this.plan = undefined;
    this.planFailed = false;
    if (!api || zoneId === undefined) return;
    this.planDetach = api.watchZoneFloorPlan(
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
  private floorPlan(zone: { id: string; name: string }) {
    if (this.plan !== this.previewOf) {
      this.previewOf = this.plan;
      this.previewTables = placedTables(this.plan?.tables ?? []);
    }
    const empty = this.plan !== undefined && this.previewTables.length === 0;
    return html`${this.planFailed ? html`<p role="alert" data-test="floor-plan-error">${t("venue.floor_plan_load_error")}</p>` : nothing}
      ${this.previewTables.length ? html`<wt-floor-plan-preview .tables=${this.previewTables} label=${t("venue.zone_floor_plan_preview").replace("{zone}", zone.name)}></wt-floor-plan-preview>` : nothing}
      <p>
        <a
          data-test="zone-floor-plan"
          href=${`/manage/floor-plan/zone/${encodeURIComponent(zone.id)}?back=${encodeURIComponent("/manage/venue-operations")}`}
          >${t(empty ? "venue.zone_add_floor_plan" : "venue.zone_floor_plan")}</a
        >
      </p>`;
  }
  private current(id: string, generation: object) {
    return this.isConnected && this.zone?.id === id && this.generation === generation;
  }
  private emit(name: string, id: string) {
    this.dispatchEvent(
      new CustomEvent(name, { detail: { zoneId: id }, bubbles: true, composed: true }),
    );
  }
  private changed(field: Field, value: ZoneEditInput[Field]) {
    if (!this.zone) return;
    this.draft = { ...this.draft!, [field]: value };
    const refused = { ...this.refused };
    delete refused[field];
    this.refused = refused;
    this.scope?.changed();
    if (saveActionState(this.scope).unchanged) this.failure = "";
  }
  private get errors(): Partial<Record<Field, string>> {
    return this.draft?.name.trim() ? {} : { name: t("venue.field_required") };
  }
  private readonly beforeClose = async (reason: LeaveReason) => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const id = this.zoneId,
      generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.current(id, generation) && outcome === "proceeded";
  };
  private async save() {
    if (
      !this.isConnected ||
      !this.zone ||
      !this.api ||
      this.busy ||
      saveActionState(this.scope).unchanged
    )
      return;
    const id = this.zoneId,
      generation = this.generation;
    this.attempted = true;
    this.refused = {};
    this.failure = "";
    if (Object.keys(this.errors).length) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const submitted = { ...this.draft!, name: this.draft!.name.trim() };
    this.busy = true;
    try {
      await this.api.saveZoneSettings(id, submitted);
      if (!this.current(id, generation)) return;
      this.baseline = copy(submitted);
      this.scope?.commit(submitted);
      if (this.scope?.isDirty()) {
        this.emit("written", id);
        return;
      }
      const modal = this.shadowRoot!.querySelector("wt-modal")!;
      this.dismissed = true;
      modal.closeAfter("saved");
      await modal.updateComplete;
      if (this.current(id, generation)) this.emit("saved", id);
    } catch (error) {
      if (!this.current(id, generation)) return;
      const { code, params } = (error ?? {}) as { code?: string; params?: { field?: Field } };
      const field =
        code === "zone.name_taken"
          ? "name"
          : code === "management.request_invalid" &&
              ["name", ...policyFields].includes(params?.field ?? "")
            ? params!.field
            : undefined;
      if (field) {
        this.refused = {
          [field]: t(code === "zone.name_taken" ? "venue.zone_name_taken" : "venue.field_refused"),
        };
        void this.updateComplete.then(() => {
          if (this.current(id, generation)) focusFirstInvalid(this.shadowRoot!);
        });
      } else this.failure = t("venue.save_error");
    } finally {
      if (this.current(id, generation)) this.busy = false;
    }
  }
  override render(): unknown {
    const zone = this.zone;
    if (!zone || !this.draft) return nothing;
    const department = this.model.salePolicies.departments.find(
      (policy) => policy.departmentId === zone.departmentId,
    );
    const follows: ServiceSettingsValue = {
      orderStart: department?.orderStart ?? "counter",
      paidWhen: department?.paidWhen ?? "prepay",
      collectionNumber: department?.collectionNumber ?? "none",
      receiptPrintMode: department?.receiptPrintMode ?? "auto",
    };
    const errors = { ...(this.attempted ? this.errors : {}), ...this.refused },
      action = saveActionState(this.scope);
    return keyed(
      zone.id,
      html`<wt-modal
        .open=${this.isConnected && !this.dismissed}
        size="standard"
        heading=${`${t("venue.edit_zone")}: ${zone.name}`}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (
            (event.currentTarget as HTMLElement).isConnected &&
            this.zoneId === zone.id &&
            !this.dismissed
          ) {
            this.dismissed = true;
            this.scope?.dispose();
            this.scope = undefined;
            this.emit("closed", zone.id);
          }
        }}
      >
        <div
          class="form"
          @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-editor]"))}
        >
          <wt-input
            name="name"
            label=${t("venue.zone_name")}
            required
            .value=${this.draft.name}
            .error=${errors.name ?? ""}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.changed("name", event.detail.value);
            }}
          ></wt-input>
          <div>
            ${this.hoursFailed ? html`<p role="alert">${t("opening.load_error")}</p>` : nothing}
            <p class="muted" data-test="closed-week-summary">
              ${zoneClosedWeek(this.hours, zone.departmentId, zone.id)}
            </p>
            <p>
              <a
                data-test="zone-opening-hours"
                href=${`/manage/opening-hours/view/week/department/${encodeURIComponent(zone.departmentId)}/zone/${encodeURIComponent(zone.id)}`}
                >${t("venue.zone_opening_hours")}</a
              >
            </p>
            ${this.floorPlan(zone)}
          </div>
          <dashboard-service-settings-fields
            .value=${this.draft}
            .follows=${follows}
            .errors=${errors}
            @service-settings-change=${(event: CustomEvent<{ value: ServiceSettingsValue }>) => {
              event.stopPropagation();
              for (const field of policyFields)
                if (this.draft![field] !== event.detail.value[field])
                  this.changed(field, event.detail.value[field]);
            }}
          ></dashboard-service-settings-fields>
          <wt-form-actions
            .error=${[this.failure, Object.keys(errors).length ? t("venue.fix_fields") : ""].filter(Boolean).join(" ")}
          >
            <wt-button
              slot="cancel"
              variant="secondary"
              ?disabled=${this.busy}
              @click=${() => void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")}
              >${t("venue.cancel")}</wt-button
            >
            <wt-button
              data-test="save-editor"
              .loading=${this.busy}
              variant=${action.variant}
              ?disabled=${this.busy || action.unchanged || (this.attempted && Object.keys(this.errors).length > 0)}
              @click=${() => void this.save()}
              >${t("venue.save")}</wt-button
            >
          </wt-form-actions>
        </div>
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "zone-edit-dialog": ZoneEditDialog;
  }
}
