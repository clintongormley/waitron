import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type {
  Department,
  DepartmentRemovalImpact,
  FloorZone,
  VenueServiceApi,
  VenueServiceView,
} from "./client.js";
import { t } from "./strings.js";
import { format } from "./hours-view.js";

export type DepartmentDialog =
  | { kind: "add-department" }
  | { kind: "rename-department" | "disable-department"; row: Department }
  | { kind: "add-zone"; departmentId: string }
  | { kind: "rename-zone" | "move-zone" | "add-to-department" | "disable-zone"; row: FloorZone };
type Draft = { name: string; departmentId: string };
type Clash = { kind: "department" | "zone"; id: string; name: string };
const copy = (value: Draft): Draft => ({ ...value });
const equal = (a: Draft, b: Draft) =>
  a.name.trim() === b.name.trim() && a.departmentId === b.departmentId;

@customElement("department-dialogs")
export class DepartmentDialogs extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
      .form wt-input,
      .form wt-combobox {
        width: 100%;
        max-width: var(--wt-form-max-width);
      }
      p {
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api!: VenueServiceApi;
  @property({ attribute: false }) model!: VenueServiceView;
  @property({ attribute: false }) dialog?: DepartmentDialog;
  @state() private draft: Draft = { name: "", departmentId: "" };
  @state() private busy = false;
  @state() private attempted = false;
  @state() private refused: Partial<Record<keyof Draft, string>> = {};
  @state() private failure = "";
  @state() private clash?: Clash;
  @state() private impact?: DepartmentRemovalImpact;
  private opened?: DepartmentDialog;
  private baseline?: Draft;
  private scope?: DraftScope<Draft>;
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
  protected override willUpdate() {
    if (this.opened !== this.dialog) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = this.dialog;
      this.generation = {};
      this.busy = false;
      this.attempted = false;
      this.refused = {};
      this.failure = "";
      this.clash = undefined;
      this.impact = undefined;
      const dialog = this.dialog;
      this.draft = {
        name: dialog && "row" in dialog ? dialog.row.name : "",
        departmentId: dialog?.kind === "add-zone" ? dialog.departmentId : "",
      };
      this.baseline = copy(this.draft);
      if (dialog && this.confirming) void this.loadImpact(dialog, this.generation);
    }
    if (this.dialog && !this.confirming && this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this.dialog,
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
  private get confirming() {
    return this.dialog?.kind.startsWith("disable") ?? false;
  }
  private get moving() {
    return this.dialog?.kind === "move-zone" || this.dialog?.kind === "add-to-department";
  }
  private get choices() {
    const dialog = this.dialog;
    const current =
      dialog && "row" in dialog
        ? this.model.zones.find((zone) => zone.id === dialog.row.id)?.departmentId
        : undefined;
    return this.model.departments
      .filter((row) => row.active && (!this.moving || row.id !== current))
      .map((row) => ({ value: row.id, label: row.name }));
  }
  private get errors(): Partial<Record<keyof Draft, string>> {
    if (this.confirming) return {};
    const field = this.moving ? "departmentId" : "name";
    if (
      field === "name"
        ? !this.draft.name.trim()
        : !this.choices.some((row) => row.value === this.draft.departmentId)
    )
      return { [field]: t("venue.field_required") };
    return {};
  }
  private current(dialog: DepartmentDialog, generation: object) {
    return this.isConnected && this.dialog === dialog && generation === this.generation;
  }
  private async loadImpact(dialog: DepartmentDialog, generation: object) {
    if (!("row" in dialog)) return;
    this.busy = true;
    try {
      const impact =
        dialog.kind === "disable-department"
          ? await this.api.departmentRemovalImpact(dialog.row.id)
          : await this.api.zoneRemovalImpact(dialog.row.id);
      if (this.current(dialog, generation)) this.impact = impact;
    } catch (error) {
      if (this.current(dialog, generation)) this.failure = this.refusal(error);
    } finally {
      if (this.current(dialog, generation)) this.busy = false;
    }
  }
  private refusal(error: unknown): string {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "zone.department_inactive") return t("venue.zone_department_inactive");
    if (code === "department.last_active") return t("venue.department_last_active");
    const table = (error as { params?: { tableName?: unknown } } | undefined)?.params?.tableName;
    if (code === "zone.table_in_use" && typeof table === "string")
      return format("venue.table_in_use", { table });
    return t("venue.save_error");
  }
  private fieldRefusal(error: unknown) {
    const { code, params } = (error ?? {}) as { code?: string; params?: Record<string, unknown> };
    let field: keyof Draft | undefined;
    if (
      code === "management.request_invalid" &&
      ((params?.field === "name" && !this.moving) ||
        (params?.field === "departmentId" && this.moving))
    )
      field = params.field as keyof Draft;
    if (code === "department.not_found" && this.moving) field = "departmentId";
    const kind = code?.startsWith("department.name_")
      ? "department"
      : code?.startsWith("zone.name_")
        ? "zone"
        : undefined;
    if (kind && !this.moving) {
      field = "name";
      this.refused = {
        name: t(
          code === `${kind}.name_disabled`
            ? `venue.${kind}_name_disabled`
            : `venue.${kind}_name_taken`,
        ),
      };
      if (
        code === `${kind}.name_disabled` &&
        typeof params?.[`${kind}Id`] === "string" &&
        typeof params.name === "string"
      )
        this.clash = { kind, id: params[`${kind}Id`] as string, name: params.name };
    } else if (field) this.refused = { [field]: t("venue.field_refused") };
    else this.failure = this.refusal(error);
    if (field)
      void this.updateComplete.then(() => {
        if (this.isConnected) focusFirstInvalid(this.shadowRoot!);
      });
  }
  private changed(field: keyof Draft, value: string) {
    this.draft = { ...this.draft, [field]: value };
    this.scope?.changed();
    const refused = { ...this.refused };
    delete refused[field];
    this.refused = refused;
    this.clash = undefined;
  }
  private emit(name: string, detail: object) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private async save(enable?: Clash) {
    const dialog = this.dialog,
      generation = this.generation;
    if (
      !dialog ||
      !this.isConnected ||
      this.busy ||
      (!enable && !this.confirming && saveActionState(this.scope).unchanged)
    )
      return;
    this.attempted = true;
    this.refused = {};
    this.failure = "";
    this.clash = undefined;
    if (!enable && Object.keys(this.errors).length) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    if (this.confirming && !this.impact) return;
    this.busy = true;
    const submitted = copy(this.draft);
    try {
      let detail: { departmentId: string } | { zoneId: string };
      if (enable) {
        if (enable.kind === "department")
          await this.api.updateDepartment(enable.id, { active: true });
        else await this.api.updateZone(enable.id, { active: true });
        detail = enable.kind === "department" ? { departmentId: enable.id } : { zoneId: enable.id };
      } else
        switch (dialog.kind) {
          case "add-department": {
            const row = await this.api.createDepartment({ name: submitted.name.trim() });
            detail = { departmentId: row.id };
            break;
          }
          case "rename-department":
            await this.api.updateDepartment(dialog.row.id, {
              name: submitted.name.trim(),
              tradingName: dialog.row.tradingName,
              defaultServiceMode: dialog.row.defaultServiceMode,
            });
            detail = { departmentId: dialog.row.id };
            break;
          case "add-zone": {
            const row = await this.api.createZone({
              name: submitted.name.trim(),
              departmentId: dialog.departmentId,
            });
            detail = { zoneId: row.id };
            break;
          }
          case "rename-zone":
            await this.api.updateZone(dialog.row.id, { name: submitted.name.trim() });
            detail = { zoneId: dialog.row.id };
            break;
          case "move-zone":
          case "add-to-department":
            await this.api.configureZone(dialog.row.id, {
              departmentId: submitted.departmentId,
              serviceMode:
                this.model.zones.find((zone) => zone.id === dialog.row.id)?.serviceModeOverride ??
                null,
            });
            detail = { zoneId: dialog.row.id };
            break;
          case "disable-department":
            await this.api.deactivateDepartment(dialog.row.id);
            detail = { departmentId: dialog.row.id };
            break;
          case "disable-zone":
            await this.api.deactivateZone(dialog.row.id);
            detail = { zoneId: dialog.row.id };
            break;
        }
      if (this.current(dialog, generation)) {
        this.scope?.commit(submitted);
        this.dialog = undefined;
        this.emit("saved", detail);
      }
    } catch (error) {
      if (this.current(dialog, generation)) {
        if (enable) {
          if (
            enable.kind === "zone" &&
            (error as { code?: string } | undefined)?.code === "zone.department_inactive"
          ) {
            this.refused = { name: t("venue.zone_name_department_inactive") };
          } else {
            this.clash = enable;
            this.failure = this.refusal(error);
          }
        } else this.fieldRefusal(error);
      }
    } finally {
      if (this.current(dialog, generation)) this.busy = false;
    }
  }
  private readonly beforeClose = async (reason: LeaveReason) => {
    const dialog = this.dialog,
      generation = this.generation;
    if (!dialog || !this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.current(dialog, generation) && outcome === "proceeded";
  };
  private heading(dialog: DepartmentDialog): string {
    switch (dialog.kind) {
      case "add-department":
        return t("venue.add_department");
      case "add-zone":
        return t("venue.add_zone");
      case "rename-department":
      case "rename-zone":
        return `${t("venue.rename")}: ${dialog.row.name}`;
      case "move-zone":
        return t("venue.move_to_department");
      case "add-to-department":
        return t("venue.add_to_department");
      case "disable-department":
      case "disable-zone":
        return format("venue.disable_confirm", { name: dialog.row.name });
    }
  }
  override render(): unknown {
    const dialog = this.dialog;
    if (!dialog) return nothing;
    const generation = this.generation,
      current = () => this.current(dialog, generation) && !this.busy;
    const errors = { ...(this.attempted ? this.errors : {}), ...this.refused };
    const marked = Object.keys(errors).length > 0;
    const state = saveActionState(this.scope);
    return keyed(
      dialog,
      html`<wt-modal
        open
        size=${this.confirming ? "compact" : "standard"}
        heading=${this.heading(dialog)}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) {
            this.dialog = undefined;
            this.emit("closed", {});
          }
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (current())
            submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-editor]"));
        }}
      >
        <div class="form">
          ${
            this.confirming
              ? html`<p>${"row" in dialog ? dialog.row.name : ""}</p>
                  ${this.impact?.zones.map((zone) => html`<p>${zone.name}: ${format("venue.active_tables", { count: String(zone.activeTableCount) })}</p>`)}`
              : this.moving
                ? html`<wt-combobox
                    name="departmentId"
                    label=${t("venue.department")}
                    required
                    search="never"
                    .value=${this.draft.departmentId}
                    .options=${this.choices}
                    .error=${errors.departmentId ?? ""}
                    ?disabled=${this.busy}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      if (current()) this.changed("departmentId", event.detail.value);
                    }}
                  ></wt-combobox>`
                : html`<wt-input
                    name="name"
                    label=${t(dialog.kind.endsWith("department") ? "venue.name" : "venue.zone_name")}
                    required
                    .value=${this.draft.name}
                    .error=${errors.name ?? ""}
                    ?disabled=${this.busy}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      if (current()) this.changed("name", event.detail.value);
                    }}
                  ></wt-input>`
          }
          ${
            this.clash
              ? html`<wt-button
                  variant="secondary"
                  data-test="enable-name-clash"
                  ?disabled=${this.busy}
                  @click=${() => {
                    if (current()) void this.save(this.clash);
                  }}
                  >${format("venue.enable_name", { name: this.clash.name })}</wt-button
                >`
              : nothing
          }
        </div>
        <wt-form-actions
          slot="footer"
          .error=${[this.failure, marked ? t("venue.fix_fields") : ""].filter(Boolean).join(" ")}
          ><wt-button
            slot="cancel"
            variant="secondary"
            data-test="cancel-editor"
            ?disabled=${this.busy}
            @click=${() => {
              if (current())
                void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
            }}
            >${t("venue.cancel")}</wt-button
          ><wt-button
            data-test="save-editor"
            variant=${this.confirming ? "danger" : state.variant}
            ?disabled=${this.busy || (this.confirming ? !this.impact : state.unchanged || (this.attempted && Object.keys(this.errors).length > 0))}
            @click=${() => {
              if (current()) void this.save();
            }}
            >${t(this.confirming ? "venue.disable" : "venue.save")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "department-dialogs": DepartmentDialogs;
  }
}
