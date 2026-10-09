import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./service-settings-fields.js";
import type { VenueServiceApi, VenueServiceView, ZoneServiceSettingsInput } from "./client.js";
import { t } from "./strings.js";
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
      .muted {
        color: var(--wt-color-text-muted);
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
    const row = this.selected;
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
