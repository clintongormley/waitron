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
import type { Department, FloorZone, VenueServiceApi, VenueServiceView } from "./client.js";
import { t } from "./strings.js";
import { format } from "./hours-view.js";
import type { DeleteImpact } from "@waitron/shared";
import { serviceDeleteCopy, serviceDeleteError } from "./service-delete-copy.js";
import "@waitron/ui/src/components/wt-delete-dialog.js";

export type DepartmentDialog =
  | { kind: "add-department" }
  | { kind: "delete-department"; row: Department }
  | { kind: "add-zone"; departmentId: string }
  | { kind: "add-to-department" | "delete-zone"; row: FloorZone };
type Draft = { name: string; departmentId: string };
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
  @property({ attribute: false }) refreshing = false;
  @state() private draft: Draft = { name: "", departmentId: "" };
  @state() private busy = false;
  @state() private attempted = false;
  @state() private refused: Partial<Record<keyof Draft, string>> = {};
  @state() private failure = "";
  @state() private impactFailure = "";
  @state() private impact: DeleteImpact | null = null;
  @state() private impactLoading = false;
  @property({ attribute: false }) opener: HTMLElement | null = null;
  @property({ type: Boolean }) readonly = false;
  private impactDetach?: () => void;
  private opened?: DepartmentDialog;
  private baseline?: Draft;
  private scope?: DraftScope<Draft>;
  private leave?: LeaveCoordinator;
  private generation = {};
  override connectedCallback() {
    super.connectedCallback();
    if (this.dialog && this.opened === this.dialog && this.confirming)
      this.loadImpact(this.dialog, this.generation);
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.impactDetach?.();
    this.impactDetach = undefined;
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    this.busy = false;
    this.impact = null;
    this.impactLoading = false;
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
      this.impactFailure = "";
      this.impactDetach?.();
      this.impactDetach = undefined;
      this.impact = null;
      this.impactLoading = false;
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
    return this.dialog?.kind.startsWith("delete") ?? false;
  }
  private get moving() {
    return this.dialog?.kind === "add-to-department";
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
  private loadImpact(dialog: DepartmentDialog, generation: object) {
    if (
      !this.current(dialog, generation) ||
      !("row" in dialog) ||
      !this.confirming ||
      this.busy ||
      this.readonly ||
      this.refreshing
    )
      return;
    this.impactDetach?.();
    this.impactDetach = undefined;
    this.impactLoading = true;
    this.impactFailure = "";
    const readIdentity = {};
    this.readIdentity = readIdentity;
    const current = () => this.current(dialog, generation) && this.readIdentity === readIdentity;
    let accepted = false;
    const failed = (error: unknown) => {
      if (!current() || this.busy) return;
      accepted = false;
      if (
        ["department.not_found", "service_zone.not_found", "zone.not_found"].includes(
          (error as { code?: string })?.code ?? "",
        )
      ) {
        this.closeDelete(dialog, generation);
        this.emit("gone", {});
        return;
      }
      this.impactLoading = false;
      this.impactFailure = t("venue.delete_load_error");
    };
    const apply = (impact: DeleteImpact) => {
      if (!current() || this.busy) return;
      if (impact?.target?.id !== dialog.row.id) {
        failed(new Error("Unexpected deletion target"));
        return;
      }
      accepted = true;
      this.impact = impact;
      this.impactLoading = false;
      this.impactFailure = "";
    };
    const recovered = () => {
      if (current() && accepted) this.impactFailure = "";
    };
    const department = dialog.kind === "delete-department";
    const api = this.api;
    const watch = department ? api.watchDepartmentDeleteImpact : api.watchZoneDeleteImpact;
    if (watch) {
      const detach = watch.call(api, dialog.row.id, apply, failed, recovered);
      if (current()) this.impactDetach = detach;
      else detach();
    } else
      void (
        department
          ? api.getDepartmentDeleteImpact(dialog.row.id)
          : api.getZoneDeleteImpact(dialog.row.id)
      ).then(apply, failed);
  }
  private readIdentity = {};
  private closeDelete(dialog: DepartmentDialog, generation: object) {
    if (!this.current(dialog, generation)) return;
    this.impactDetach?.();
    this.impactDetach = undefined;
    this.generation = {};
    this.busy = false;
    this.dialog = undefined;
  }
  private async deleteTarget(id: string, dialog: DepartmentDialog, generation: object) {
    if (
      !this.current(dialog, generation) ||
      !this.confirming ||
      !("row" in dialog) ||
      dialog.row.id !== id ||
      this.busy ||
      this.refreshing ||
      this.readonly ||
      this.impactLoading ||
      this.impactFailure ||
      !this.impact ||
      this.impact.target.id !== id ||
      this.impact.refusals.length
    )
      return;
    this.busy = true;
    this.failure = "";
    try {
      if (dialog.kind === "delete-department") await this.api.deleteDepartment(id);
      else await this.api.deleteZone(id);
    } catch (error) {
      if (!this.current(dialog, generation)) return;
      this.busy = false;
      if (
        ["department.not_found", "service_zone.not_found", "zone.not_found"].includes(
          (error as { code?: string })?.code ?? "",
        )
      ) {
        this.closeDelete(dialog, generation);
        this.emit("gone", {});
        return;
      }
      this.failure = serviceDeleteError(
        dialog.kind === "delete-department" ? "department" : "zone",
        error,
      );
      this.loadImpact(dialog, generation);
      return;
    }
    if (!this.current(dialog, generation)) return;
    this.closeDelete(dialog, generation);
    this.emit("saved", dialog.kind === "delete-department" ? { departmentId: id } : { zoneId: id });
  }
  private refusal(error: unknown): string {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "department.last_active") return t("venue.department_last_active");
    const table = (error as { params?: { tableName?: unknown } } | undefined)?.params?.tableName;
    if (code === "zone.table_in_use" && typeof table === "string")
      return format("venue.table_in_use", { table });
    return t("venue.save_error");
  }
  private fieldRefusal(error: unknown, submitted: Draft) {
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
      if (this.draft.name.trim() !== submitted.name.trim()) return;
      this.refused = { name: t(`venue.${kind}_name_taken`) };
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
  }
  private emit(name: string, detail: object) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private async save() {
    const dialog = this.dialog,
      generation = this.generation;
    if (
      !dialog ||
      !this.isConnected ||
      this.busy ||
      this.refreshing ||
      this.confirming ||
      saveActionState(this.scope).unchanged
    )
      return;
    this.attempted = true;
    this.refused = {};
    this.failure = "";
    if (Object.keys(this.errors).length) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.busy = true;
    const submitted = copy(this.draft);
    try {
      let detail: { departmentId: string } | { zoneId: string };
      switch (dialog.kind) {
        case "add-department": {
          const row = await this.api.createDepartment({ name: submitted.name.trim() });
          detail = { departmentId: row.id };
          break;
        }
        case "add-zone": {
          const row = await this.api.createZone({
            name: submitted.name.trim(),
            departmentId: dialog.departmentId,
          });
          detail = { zoneId: row.id };
          break;
        }
        case "add-to-department":
          await this.api.configureZone(dialog.row.id, {
            departmentId: submitted.departmentId,
          });
          detail = { zoneId: dialog.row.id };
          break;
        case "delete-department":
        case "delete-zone":
          return;
      }
      if (this.current(dialog, generation)) {
        this.scope?.commit(submitted);
        if (this.scope?.isDirty()) this.emit("written", detail);
        else {
          this.dialog = undefined;
          this.emit("saved", detail);
        }
      }
    } catch (error) {
      if (this.current(dialog, generation)) {
        this.fieldRefusal(error, submitted);
      }
    } finally {
      if (this.current(dialog, generation)) this.busy = false;
    }
  }
  private readonly beforeClose = async (reason: LeaveReason) => {
    const dialog = this.dialog,
      generation = this.generation;
    if (!dialog || !this.isConnected || this.busy || this.refreshing) return false;
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
      case "add-to-department":
        return t("venue.add_to_department");
      case "delete-department":
      case "delete-zone":
        return serviceDeleteCopy(dialog.kind === "delete-department" ? "department" : "zone")
          .heading;
    }
  }
  override render(): unknown {
    const dialog = this.dialog;
    if (!dialog) return nothing;
    const generation = this.generation,
      current = () => this.current(dialog, generation) && !this.busy && !this.refreshing;
    if (this.confirming)
      return keyed(
        generation,
        html`<wt-delete-dialog
          .open=${true}
          .impact=${this.impact}
          .loading=${this.impactLoading || this.refreshing || this.readonly}
          .submitting=${this.busy}
          .readError=${this.impactFailure}
          .actionError=${this.failure}
          .copy=${serviceDeleteCopy(dialog.kind === "delete-department" ? "department" : "zone")}
          .opener=${this.opener}
          @wt-delete-confirm=${(event: CustomEvent<{ id: string }>) => {
            event.stopPropagation();
            void this.deleteTarget(event.detail.id, dialog, generation);
          }}
          @wt-delete-retry=${(event: Event) => {
            event.stopPropagation();
            this.loadImpact(dialog, generation);
          }}
          @wt-close=${(event: Event) => {
            event.stopPropagation();
            if (this.current(dialog, generation) && !this.busy && !this.refreshing) {
              this.closeDelete(dialog, generation);
              this.emit("closed", {});
            }
          }}
        ></wt-delete-dialog>`,
      );
    const errors = { ...(this.attempted ? this.errors : {}), ...this.refused };
    const marked = Object.keys(errors).length > 0;
    const state = saveActionState(this.scope);
    return keyed(
      dialog,
      html`<wt-modal
        open
        size=${"standard"}
        heading=${this.heading(dialog)}
        .dismissible=${!this.busy && !this.refreshing}
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
            this.moving
              ? html`<wt-combobox
                  name="departmentId"
                  label=${t("venue.department")}
                  required
                  search="never"
                  searchPlaceholder=${t("venue.combobox_search")}
                  noResultsLabel=${t("venue.combobox_no_results")}
                  .value=${this.draft.departmentId}
                  .options=${this.choices}
                  .error=${errors.departmentId ?? ""}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    if (this.current(dialog, generation))
                      this.changed("departmentId", event.detail.value);
                  }}
                ></wt-combobox>`
              : html`<wt-input
                  name="name"
                  label=${t(dialog.kind.endsWith("department") ? "venue.name" : "venue.zone_name")}
                  required
                  .value=${this.draft.name}
                  .error=${errors.name ?? ""}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    if (this.current(dialog, generation)) this.changed("name", event.detail.value);
                  }}
                ></wt-input>`
          }
        </div>
        <wt-form-actions
          slot="footer"
          .error=${[this.failure || this.impactFailure, marked ? t("venue.fix_fields") : ""].filter(Boolean).join(" ")}
          ><wt-button
            slot="cancel"
            variant="secondary"
            data-test="cancel-editor"
            ?disabled=${this.busy || this.refreshing}
            @click=${() => {
              if (current())
                void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
            }}
            >${t("venue.cancel")}</wt-button
          ><wt-button
            data-test="save-editor"
            variant=${state.variant}
            ?disabled=${this.busy || this.refreshing || (this.confirming ? !this.impact : state.unchanged || (this.attempted && Object.keys(this.errors).length > 0))}
            @click=${() => {
              if (current()) void this.save();
            }}
            >${t("venue.save")}</wt-button
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
