import type { DashboardPanelRenderer } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing } from "lit";
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
  type TabItem,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "./service-settings-fields.js";
import "./department-service-steps.js";
import type { ServiceStepErrors, ServiceStepField } from "./department-service-steps.js";
import { MAX_SERVICE_STEP_MINUTES } from "../service-step-limits.js";
import type { ServiceSettingsValue } from "./service-settings-fields.js";
import type {
  DepartmentSettingsInput,
  DepartmentTransfersView,
  VenueServiceApi,
  VenueServiceView,
} from "./client.js";
import { t } from "./strings.js";
import {
  stepsEqual,
  toStepDrafts,
  toStepInputs,
  type ServiceStepDraft,
} from "./service-step-draft.js";

export type DepartmentTab = "details" | "service" | "receipt" | "transfers";
export function offeredDepartmentTabs(model?: VenueServiceView, receipts = false): DepartmentTab[] {
  const transfers = (model?.departments.filter((d) => d.active).length ?? 0) >= 2;
  return [
    "details",
    "service",
    ...(receipts ? (["receipt"] as const) : []),
    ...(transfers ? (["transfers"] as const) : []),
  ];
}
export type ReceiptEditorPanel = ReturnType<DashboardPanelRenderer> | undefined;
export const offersReceiptEditor = (editor: ReceiptEditorPanel) => editor != null;
interface ReceiptEditor {
  leaveScope?: object;
  hasUnsavedChanges?: boolean;
  saving?: boolean;
  invalid?: boolean;
}
type DepartmentDraft = Omit<DepartmentSettingsInput, "serviceSteps"> & {
  serviceSteps: ServiceStepDraft[];
};
type Field = keyof DepartmentDraft | "receivingProfileId" | "destinationDepartmentIds";
const fieldTab: Record<Field, DepartmentTab> = {
  name: "details",
  tradingName: "details",
  orderStart: "service",
  paidWhen: "service",
  collectionNumber: "service",
  needsClearing: "service",
  serviceSteps: "service",
  transfers: "transfers",
  receivingProfileId: "transfers",
  destinationDepartmentIds: "transfers",
};
const copy = (value: DepartmentDraft): DepartmentDraft => ({
  ...value,
  serviceSteps: value.serviceSteps.map((step) => ({ ...step })),
  ...(value.transfers
    ? {
        transfers: {
          ...value.transfers,
          destinationDepartmentIds: [...value.transfers.destinationDepartmentIds],
        },
      }
    : {}),
});
const equal = (a: DepartmentDraft, b: DepartmentDraft) =>
  a.name.trim() === b.name.trim() &&
  a.tradingName.trim() === b.tradingName.trim() &&
  a.orderStart === b.orderStart &&
  a.paidWhen === b.paidWhen &&
  a.collectionNumber === b.collectionNumber &&
  a.needsClearing === b.needsClearing &&
  stepsEqual(a.serviceSteps, b.serviceSteps) &&
  a.transfers?.receivingProfileId === b.transfers?.receivingProfileId &&
  (a.transfers?.destinationDepartmentIds.length ?? 0) ===
    (b.transfers?.destinationDepartmentIds.length ?? 0) &&
  (a.transfers?.destinationDepartmentIds ?? []).every((id) =>
    b.transfers?.destinationDepartmentIds.includes(id),
  );

@customElement("department-settings")
export class DepartmentSettings extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .form,
      .panel:not(.receipt) {
        display: grid;
        gap: var(--wt-space-5);
        max-width: var(--wt-form-max-width);
      }
      .form.wide {
        max-width: none;
      }
      .form.wide > :not(wt-tabs) {
        max-width: var(--wt-form-max-width);
      }
      section {
        display: grid;
        gap: var(--wt-space-4);
        min-width: 0;
      }
      h2,
      h3,
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      h2,
      h3 {
        font-size: var(--wt-font-size-lg);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      fieldset {
        margin: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3);
        min-width: 0;
      }
      legend {
        padding-inline: var(--wt-space-1);
      }
      .destination {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        overflow-wrap: anywhere;
      }
      input {
        accent-color: var(--wt-color-primary);
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .readonly,
      .hint {
        color: var(--wt-color-text-muted);
      }
      .hint {
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];
  @property({ attribute: false }) api?: VenueServiceApi;
  @property({ attribute: false }) model?: VenueServiceView;
  @property() departmentId = "";
  @property({ type: Boolean }) refreshing = false;
  @property() tab: DepartmentTab = "details";
  @property({ attribute: false }) receiptEditor: ReceiptEditorPanel;
  @state() private draft?: DepartmentDraft;
  @state() private busy = false;
  @state() private attempted = false;
  @state() private refused: Partial<Record<Field, string>> = {};
  @state() private refusedSteps: ServiceStepErrors = {};
  @state() private failure = "";
  @state() private transferFailure = "";
  @state() private profiles: DepartmentTransfersView["profiles"] = [];
  private opened = "";
  private baseline?: DepartmentDraft;
  private scope?: DraftScope<DepartmentDraft>;
  private leave?: LeaveCoordinator;
  private generation = {};
  private transferGeneration = {};
  private source?: DepartmentDraft;
  private transferLoading = false;
  private transfersLoaded = false;
  private transfersShown = false;
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    this.transferGeneration = {};
    this.busy = false;
    this.transferLoading = false;
    super.disconnectedCallback();
  }
  private get department() {
    return this.model?.departments.find((d) => d.id === this.departmentId);
  }
  private get showsTransfers() {
    return offeredDepartmentTabs(this.model).includes("transfers");
  }
  get offeredTabs(): DepartmentTab[] {
    return offeredDepartmentTabs(this.model, offersReceiptEditor(this.receiptEditor));
  }
  private get receiptPanel() {
    return this.shadowRoot?.querySelector<HTMLElement>("[slot=receipt]") ?? null;
  }
  private get receipt(): ReceiptEditor | undefined {
    return (this.receiptPanel?.firstElementChild ?? undefined) as ReceiptEditor | undefined;
  }
  private get scopes() {
    return [this.scope?.id, this.receipt?.leaveScope].filter((id): id is object => !!id);
  }
  private get pending() {
    return this.busy || this.refreshing || !!this.receipt?.saving;
  }
  private get shownErrors(): Partial<Record<Field, string>> {
    return { ...(this.attempted ? this.errors : {}), ...this.refused };
  }
  private selectTab(tab: DepartmentTab, replace: boolean) {
    this.tab = tab;
    this.emit("department-tab-change", { tab, replace });
  }
  private showFirstInvalid(
    marked = new Set(Object.keys(this.shownErrors).map((field) => fieldTab[field as Field])),
  ) {
    const first = this.offeredTabs.find((tab) => marked.has(tab));
    if (first && first !== this.tab) this.selectTab(first, true);
    void this.updateComplete.then(() => {
      if (this.isConnected) void focusFirstInvalid(this.shadowRoot!);
    });
  }
  private submitOnEnter(event: KeyboardEvent) {
    submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-editor]"));
  }
  private receiptInvalid(event: CustomEvent<{ departmentId?: string; invalid?: boolean }>) {
    event.stopPropagation();
    if (event.detail?.departmentId !== this.departmentId) return;
    this.requestUpdate();
    if (event.detail.invalid && this.tab !== "receipt") this.showFirstInvalid(new Set(["receipt"]));
  }
  protected override willUpdate() {
    if (!this.offeredTabs.includes(this.tab)) this.tab = "details";
    const row = this.department;
    if (!row || !row.active) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = "";
      this.generation = {};
      this.transferGeneration = {};
      this.transferLoading = false;
      this.busy = false;
      this.draft = undefined;
      return;
    }
    const policy = this.model!.salePolicies.departments.find((p) => p.departmentId === row.id);
    const source: DepartmentDraft = {
      name: row.name,
      tradingName: row.tradingName,
      orderStart: policy?.orderStart ?? "counter",
      paidWhen: policy?.paidWhen ?? "prepay",
      collectionNumber: policy?.collectionNumber ?? "none",
      needsClearing: this.model!.needsClearingDepartmentIds.includes(row.id),
      serviceSteps: toStepDrafts(
        this.model!.serviceSteps.filter((step) => step.departmentId === row.id),
      ),
    };
    if (this.opened !== row.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = row.id;
      this.generation = {};
      this.transferGeneration = {};
      this.busy = false;
      this.attempted = false;
      this.refused = {};
      this.refusedSteps = {};
      this.failure = "";
      this.transferFailure = "";
      this.profiles = [];
      this.transferLoading = false;
      this.transfersLoaded = false;
      this.transfersShown = false;
      this.draft = copy(source);
      this.source = copy(source);
      this.baseline = copy(this.draft);
    }
    if (this.transfersShown !== this.showsTransfers) {
      this.transfersShown = this.showsTransfers;
      this.transfersLoaded = false;
      this.transferLoading = false;
      this.transferFailure = "";
      this.profiles = [];
      this.transferGeneration = {};
      if (!this.showsTransfers) {
        delete this.draft!.transfers;
        delete this.baseline!.transfers;
        this.scope?.commit(this.baseline!);
      }
    }
    const availableDestinations = new Set(
      this.model!.departments.filter(
        (department) => department.active && department.id !== row.id,
      ).map((department) => department.id),
    );
    if (
      [this.draft!, this.baseline!].some((value) =>
        value.transfers?.destinationDepartmentIds.some((id) => !availableDestinations.has(id)),
      )
    ) {
      this.draft = copy(this.draft!);
      this.baseline = copy(this.baseline!);
      for (const value of [this.draft, this.baseline])
        if (value.transfers)
          value.transfers.destinationDepartmentIds =
            value.transfers.destinationDepartmentIds.filter((id) => availableDestinations.has(id));
      this.scope?.commit(this.baseline);
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
          this.refusedSteps = {};
          this.failure = "";
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
    if (this.scope && !this.scope.isDirty() && !this.busy && !equal(this.source!, source)) {
      this.source = copy(source);
      this.draft = {
        ...source,
        ...(this.draft!.transfers ? { transfers: this.draft!.transfers } : {}),
      };
      this.baseline = copy(this.draft);
      this.scope.commit(this.baseline);
    }
    if (
      this.isConnected &&
      this.showsTransfers &&
      !this.transfersLoaded &&
      !this.transferLoading &&
      this.api
    )
      void this.loadTransfers(row.id, this.transferGeneration);
  }
  private current(id: string, generation: object) {
    return (
      this.isConnected &&
      this.department?.active &&
      this.departmentId === id &&
      this.generation === generation
    );
  }
  private async loadTransfers(id: string, generation: object) {
    this.transferLoading = true;
    try {
      const settings = await this.api!.background.loadDepartmentTransfers(id);
      if (
        this.isConnected &&
        this.department?.active &&
        this.departmentId === id &&
        this.transferGeneration === generation
      ) {
        const transfers = {
          receivingProfileId: settings.receivingProfileId,
          destinationDepartmentIds: [...settings.destinationDepartmentIds],
        };
        this.draft = { ...this.draft!, transfers };
        this.baseline = {
          ...this.baseline!,
          transfers: copy({ ...this.baseline!, transfers }).transfers,
        };
        this.scope?.commit(this.baseline);
        this.profiles = settings.profiles;
        this.transferFailure = "";
        this.transfersLoaded = true;
      }
    } catch {
      if (
        this.isConnected &&
        this.department?.active &&
        this.departmentId === id &&
        this.transferGeneration === generation
      ) {
        this.transferFailure = t("venue.transfers_load_error");
        this.transfersLoaded = true;
      }
    } finally {
      if (
        this.isConnected &&
        this.department?.active &&
        this.departmentId === id &&
        this.transferGeneration === generation
      ) {
        this.transferLoading = false;
        this.requestUpdate();
      }
    }
  }
  private emit(name: string, detail: object) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private changed(field: Field, value: unknown) {
    if (!this.department?.active) return;
    if (field === "receivingProfileId")
      this.draft = {
        ...this.draft!,
        transfers: { ...this.draft!.transfers!, receivingProfileId: (value as string) || null },
      };
    else if (field === "destinationDepartmentIds")
      this.draft = {
        ...this.draft!,
        transfers: { ...this.draft!.transfers!, destinationDepartmentIds: value as string[] },
      };
    else this.draft = { ...this.draft!, [field]: value };
    const refused = { ...this.refused };
    delete refused[field];
    this.refused = refused;
    this.scope?.changed();
    if (saveActionState(this.scope).unchanged) this.failure = "";
  }
  private stepsChanged(steps: ServiceStepDraft[]) {
    const before = new Map(this.draft!.serviceSteps.map((step) => [step.key, step]));
    const kept: ServiceStepErrors = {};
    for (const step of steps) {
      const was = before.get(step.key),
        row = { ...this.refusedSteps[step.key] };
      if (!was) continue;
      if (was.name !== step.name) delete row.name;
      if (was.start !== step.start || was.courseId !== step.courseId) delete row.start;
      if (was.minutes !== step.minutes) delete row.minutes;
      if (Object.keys(row).length) kept[step.key] = row;
    }
    this.refusedSteps = kept;
    this.changed("serviceSteps", steps);
    if (Object.keys(kept).length) this.refused = { ...this.refused, serviceSteps: "" };
  }
  private get stepErrors(): ServiceStepErrors {
    const courses = new Set(this.model?.courses.map((course) => course.id));
    const found: ServiceStepErrors = {};
    this.draft?.serviceSteps.forEach((step, index) => {
      const row: Partial<Record<ServiceStepField, string>> = {};
      if (!step.name.trim()) row.name = t("venue.field_required");
      if (index === 0 && step.start === "after_previous")
        row.start = t("venue.service_step_first_after_previous");
      else if (step.start === "course_served" && !courses.has(step.courseId!))
        row.start = t("venue.service_step_course_gone");
      const minutes = step.minutes.trim();
      if (!/^\d+$/.test(minutes) || Number(minutes) > MAX_SERVICE_STEP_MINUTES)
        row.minutes = t("venue.service_step_minutes_invalid");
      else if (step.start === "since_last_order" && Number(minutes) === 0)
        row.minutes = t("venue.service_step_minutes_repeat");
      if (Object.keys(row).length) found[step.key] = row;
    });
    return found;
  }
  private get shownStepErrors(): ServiceStepErrors {
    const shown: ServiceStepErrors = this.attempted ? { ...this.stepErrors } : {};
    for (const [key, row] of Object.entries(this.refusedSteps))
      shown[key] = { ...shown[key], ...row };
    return shown;
  }
  private get errors(): Partial<Record<Field, string>> {
    return {
      ...(this.draft?.name.trim() ? {} : { name: t("venue.field_required") }),
      ...(this.draft?.tradingName.trim() ? {} : { tradingName: t("venue.field_required") }),
      ...(Object.keys(this.stepErrors).length ? { serviceSteps: "" } : {}),
    };
  }
  /** Marks the steps a refusal names, by the draft key of the submitted row it points at. */
  private stepRefusal(error: unknown, steps: ServiceStepDraft[]) {
    const { code, params } = (error ?? {}) as { code?: string; params?: Record<string, unknown> };
    const named = typeof params?.field === "string" ? params.field : "";
    const rows: ServiceStepErrors = {};
    let list = "";
    if (code === "management.request_invalid") {
      const match = /^serviceSteps\.(\d+)\.(name|start|courseId|minutes)$/.exec(named);
      const key = match ? steps[Number(match[1])]?.key : undefined;
      if (key) {
        const field = match![2] === "courseId" ? "start" : (match![2] as ServiceStepField);
        rows[key] = { [field]: t("venue.field_refused") };
      } else if (named === "serviceSteps" || named.startsWith("serviceSteps."))
        list = t("venue.field_refused");
    } else if (code === "service_step.not_found") list = t("venue.service_step_changed_elsewhere");
    else if (code === "course.not_found")
      for (const step of steps)
        if (step.start === "course_served" && step.courseId === params?.courseId)
          rows[step.key] = { start: t("venue.service_step_course_gone") };
    if (!list && !Object.keys(rows).length) return false;
    this.refused = { serviceSteps: list };
    this.refusedSteps = rows;
    this.showFirstInvalid();
    return true;
  }
  private fieldRefusal(
    error: unknown,
    submitted: DepartmentSettingsInput,
    steps: ServiceStepDraft[],
  ) {
    if (submitted.serviceSteps && this.stepRefusal(error, steps)) return;
    const { code, params } = (error ?? {}) as { code?: string; params?: Record<string, unknown> };
    let field: Field | undefined;
    let message = t("venue.field_refused");
    const fields: Field[] = [
      "name",
      "tradingName",
      "orderStart",
      "paidWhen",
      "collectionNumber",
      "needsClearing",
      ...(this.draft?.transfers
        ? (["receivingProfileId", "destinationDepartmentIds"] as const)
        : []),
    ];
    if (code === "management.request_invalid" && fields.includes(params?.field as Field))
      field = params!.field as Field;
    if (code === "department.name_taken") {
      if (this.draft?.name.trim() !== submitted.name.trim()) return;
      field = "name";
      message = t("venue.department_name_taken");
    }
    if (
      code === "department_transfer.settings_invalid" &&
      this.draft?.transfers &&
      (params?.field === "receivingProfileId" || params?.field === "destinationDepartmentIds")
    ) {
      field = params.field;
      message = t(
        field === "receivingProfileId"
          ? "venue.transfer_profile_refused"
          : "venue.transfer_destinations_refused",
      );
    }
    if (field) {
      this.refused = { [field]: message };
      this.showFirstInvalid();
    } else this.failure = t("venue.save_error");
  }
  private async save() {
    const id = this.departmentId,
      generation = this.generation;
    if (
      !this.isConnected ||
      this.busy ||
      this.refreshing ||
      !this.department?.active ||
      saveActionState(this.scope).unchanged
    )
      return;
    this.attempted = true;
    this.refused = {};
    this.refusedSteps = {};
    this.failure = "";
    if (Object.keys(this.errors).length) {
      this.showFirstInvalid();
      return;
    }
    if (!this.api) return;
    const kept = copy(this.draft!);
    kept.name = kept.name.trim();
    kept.tradingName = kept.tradingName.trim();
    if (!this.showsTransfers) delete kept.transfers;
    const { serviceSteps, ...unchanged } = kept;
    const submitted: DepartmentSettingsInput = stepsEqual(serviceSteps, this.baseline!.serviceSteps)
      ? unchanged
      : { ...unchanged, serviceSteps: toStepInputs(serviceSteps) };
    this.busy = true;
    try {
      await this.api.saveDepartmentSettings(id, submitted);
      if (this.current(id, generation)) {
        const committed = copy(kept);
        if (!kept.transfers && this.showsTransfers)
          committed.transfers = copy(this.baseline!).transfers;
        if (!this.showsTransfers) delete committed.transfers;
        this.baseline = committed;
        this.scope?.commit(committed);
        this.emit("saved", { departmentId: id });
      }
    } catch (error) {
      if (this.current(id, generation)) this.fieldRefusal(error, submitted, serviceSteps);
    } finally {
      if (this.current(id, generation)) this.busy = false;
    }
  }
  private async cancel() {
    if (this.pending || !this.scope) return;
    const id = this.departmentId,
      generation = this.generation;
    const proceed = () => {
      if (this.current(id, generation)) {
        this.draft = copy(this.baseline!);
        this.attempted = false;
        this.refused = {};
        this.refusedSteps = {};
        this.failure = "";
        this.emit("cancelled", { departmentId: id });
      }
    };
    if (this.leave) await this.leave.request({ scopes: this.scopes, reason: "cancel", proceed });
    else proceed();
  }
  get hasUnsavedChanges() {
    return this.scope?.isDirty() ?? false;
  }
  get receiptHasUnsavedChanges() {
    return !!this.receipt?.hasUnsavedChanges;
  }
  async requestLeave(reason: LeaveReason): Promise<boolean> {
    if (!this.isConnected || this.pending) return false;
    if (!this.scope || !this.leave || !this.leave.isDirty(this.scopes)) return true;
    const id = this.departmentId,
      generation = this.generation;
    const outcome = await this.leave.request({ scopes: this.scopes, reason, proceed() {} });
    return !!this.current(id, generation) && outcome === "proceeded";
  }
  private get differing() {
    const draft = this.draft!;
    const fields = ["orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"] as const;
    return (this.model?.zones ?? [])
      .filter((z) => z.departmentId === this.departmentId)
      .flatMap((zone) => {
        const overrides = this.model!.salePolicies.zones.find((p) => p.zoneId === zone.id);
        if (!overrides) return [];
        const labels = fields
          .filter(
            (field) =>
              overrides[field] !== null &&
              overrides[field] !==
                (field === "receiptPrintMode"
                  ? (this.model!.salePolicies.departments.find(
                      (p) => p.departmentId === this.departmentId,
                    )?.receiptPrintMode ?? "auto")
                  : draft[field]),
          )
          .map((field) => {
            switch (field) {
              case "orderStart":
                return t(
                  overrides.orderStart === "counter"
                    ? "venue.counter_service"
                    : "venue.table_service",
                );
              case "paidWhen":
                return t(
                  overrides.paidWhen === "prepay"
                    ? "venue.paid_before_preparation"
                    : "venue.paid_at_collection",
                );
              case "collectionNumber":
                return t(
                  overrides.collectionNumber === "numbered" ? "venue.print" : "venue.dont_print",
                );
              case "receiptPrintMode":
                return t(
                  overrides.receiptPrintMode === "auto"
                    ? "venue.always"
                    : "venue.receipt_on_request",
                );
            }
          });
        return labels.length ? [{ zone, labels }] : [];
      });
  }
  override render() {
    const row = this.department,
      draft = this.draft;
    if (!row || !row.active || !draft) return nothing;
    const errors = this.shownErrors,
      disabled = !row.active,
      state = saveActionState(this.scope),
      highlighted =
        Object.keys(errors).some((field) => field !== "serviceSteps") ||
        Object.keys(this.shownStepErrors).length > 0;
    const serviceErrors: Partial<Record<keyof ServiceSettingsValue, string>> = {};
    for (const field of ["orderStart", "paidWhen", "collectionNumber"] as const)
      if (errors[field]) serviceErrors[field] = errors[field];
    const marked = new Set(Object.keys(errors).map((field) => fieldTab[field as Field]));
    if (this.receipt?.invalid) marked.add("receipt");
    const offered = this.offeredTabs;
    const tabs: TabItem[] = offered.map((key) => ({
      key,
      label: t(`venue.department_tab.${key}`),
      ...(marked.has(key) ? { marked: t("venue.tab_needs_fixing") } : {}),
    }));
    return html`<div class=${offered.includes("receipt") ? "form wide" : "form"}>
      ${
        !row.active
          ? html`<p class="readonly">${t("venue.enable_department_settings")}</p> `
          : nothing
      }
      <wt-tabs
        label=${t("venue.department")}
        .items=${tabs}
        .value=${this.tab}
        @wt-tab-change=${(e: CustomEvent<{ value: DepartmentTab }>) => {
          if (e.target !== e.currentTarget) return;
          e.stopPropagation();
          this.selectTab(e.detail.value, false);
        }}
      >
        <div class="panel" slot="details" @keydown=${this.submitOnEnter}>
          <wt-input
            name="name"
            label=${t("venue.name")}
            required
            .value=${draft.name}
            error=${errors.name ?? ""}
            ?disabled=${disabled}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.changed("name", e.detail.value);
            }}
          ></wt-input>

          <wt-input
            name="tradingName"
            label=${t("venue.trading_name")}
            required
            .value=${draft.tradingName}
            error=${errors.tradingName ?? ""}
            ?disabled=${disabled}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.changed("tradingName", e.detail.value);
            }}
          ></wt-input>
        </div>
        <div class="panel" slot="service" @keydown=${this.submitOnEnter}>
          <section aria-label=${t("venue.orders_and_payment")}>
            <h3>${t("venue.orders_and_payment")}</h3>
            <dashboard-service-settings-fields
              .value=${{ ...draft, receiptPrintMode: this.model!.salePolicies.departments.find((p) => p.departmentId === row.id)?.receiptPrintMode ?? "auto" }}
              .showReceiptMode=${false}
              .errors=${serviceErrors}
              ?disabled=${disabled}
              @service-settings-change=${(e: CustomEvent<{ value: ServiceSettingsValue }>) => {
                e.stopPropagation();
                for (const field of ["orderStart", "paidWhen", "collectionNumber"] as const)
                  if (this.draft![field] !== e.detail.value[field])
                    this.changed(field, e.detail.value[field]);
              }}
            ></dashboard-service-settings-fields>
            ${
              this.differing.length
                ? html`<p data-test="zones-that-differ">
                    ${t("venue.zones_that_differ")}:
                    ${this.differing.map(
                      ({ zone, labels }, index) =>
                        html`${index ? ", " : nothing}<a
                            data-own-click
                            data-zone=${zone.id}
                            href=${`/manage/venue-operations/department/${encodeURIComponent(row.id)}/view/zones/zone/${encodeURIComponent(zone.id)}`}
                            @click=${(e: MouseEvent) => {
                              if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
                                return;
                              e.preventDefault();
                              this.emit("zone-change", { zoneId: zone.id });
                            }}
                            >${zone.name} (${labels.join(", ")})</a
                          >`,
                    )}
                  </p>`
                : nothing
            }
          </section>
          <section aria-label=${t("venue.table_states")}>
            <h3>${t("venue.table_states")}</h3>
            <div>
              <wt-switch
                name="needsClearing"
                label=${t("venue.needs_clearing")}
                .description=${errors.needsClearing ? `${errors.needsClearing} ${t("venue.needs_clearing_hint")}` : t("venue.needs_clearing_hint")}
                .checked=${draft.needsClearing}
                ?disabled=${disabled}
                aria-invalid=${errors.needsClearing ? "true" : nothing}
                @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                  e.stopPropagation();
                  this.changed("needsClearing", e.detail.checked);
                }}
              ></wt-switch>
              <p class="hint">${t("venue.needs_clearing_hint")}</p>
              ${errors.needsClearing ? html`<p class="error" data-field-error="needsClearing">${errors.needsClearing}</p>` : nothing}
            </div>
            <department-service-steps
              .steps=${draft.serviceSteps}
              .courses=${this.model!.courses}
              .errors=${this.shownStepErrors}
              .listError=${errors.serviceSteps ?? ""}
              ?disabled=${disabled}
              @steps-change=${(e: CustomEvent<{ steps: ServiceStepDraft[] }>) => {
                e.stopPropagation();
                this.stepsChanged(e.detail.steps);
              }}
            ></department-service-steps>
          </section>
        </div>
        ${
          offered.includes("receipt")
            ? html`<div
                class="panel receipt"
                slot="receipt"
                @department-receipt-invalid=${this.receiptInvalid}
              >
                ${this.receiptEditor}
              </div>`
            : nothing
        }
        ${
          this.showsTransfers
            ? html`<div class="panel" slot="transfers" @keydown=${this.submitOnEnter}>
                <section data-test="transfers-section" aria-label=${t("venue.tab_transfers")}>
                  <h2>${t("venue.tab_transfers")}</h2>
                  ${
                    this.transferFailure
                      ? html`<p class="error" data-test="transfers-load-error" role="alert">
                          ${this.transferFailure}
                        </p>`
                      : draft.transfers
                        ? html` <fieldset ?disabled=${disabled}>
                              <legend>${t("venue.transfer_destinations")}</legend>
                              ${this.model!.departments.filter(
                                (d) => d.active && d.id !== row.id,
                              ).map(
                                (d) =>
                                  html`<label class="destination"
                                    ><input
                                      type="checkbox"
                                      name=${`transferDestination-${d.id}`}
                                      .checked=${draft.transfers!.destinationDepartmentIds.includes(d.id)}
                                      @change=${(e: Event) => {
                                        e.stopPropagation();
                                        const checked = (e.target as HTMLInputElement).checked;
                                        this.changed(
                                          "destinationDepartmentIds",
                                          checked
                                            ? [...draft.transfers!.destinationDepartmentIds, d.id]
                                            : draft.transfers!.destinationDepartmentIds.filter(
                                                (id) => id !== d.id,
                                              ),
                                        );
                                      }}
                                    />${d.name}</label
                                  >`,
                              )}${errors.destinationDepartmentIds ? html`<p class="error" data-field-error="destinationDepartmentIds">${errors.destinationDepartmentIds}</p>` : nothing}
                            </fieldset>
                            <wt-combobox
                              name="receivingProfileId"
                              label=${t("venue.receiving_profile")}
                              search="never"
                              .options=${[{ value: "", label: t("venue.none") }, ...this.profiles.map((p) => ({ value: p.id, label: p.name })), ...(draft.transfers.receivingProfileId && !this.profiles.some((p) => p.id === draft.transfers!.receivingProfileId) ? [{ value: draft.transfers.receivingProfileId, label: t("venue.transfer_profile_unavailable") }] : [])]}
                              .value=${draft.transfers.receivingProfileId ?? ""}
                              error=${errors.receivingProfileId ?? ""}
                              ?disabled=${disabled}
                              @wt-change=${(e: CustomEvent<{ value: string }>) => {
                                e.stopPropagation();
                                this.changed("receivingProfileId", e.detail.value);
                              }}
                            ></wt-combobox>`
                        : nothing
                  }
                </section>
              </div>`
            : nothing
        }
      </wt-tabs>
      ${row.active && this.tab !== "receipt" ? html`<wt-form-actions .error=${[this.failure, highlighted ? t("venue.fix_fields") : ""].filter(Boolean).join(" ")}><wt-button slot="cancel" variant="secondary" data-test="cancel-editor" ?disabled=${this.busy || this.refreshing} @click=${() => void this.cancel()}>${t("venue.cancel")}</wt-button><wt-button data-test="save-editor" variant=${this.refreshing ? "secondary" : state.variant} ?disabled=${this.busy || this.refreshing || state.unchanged || (this.attempted && Object.keys(this.errors).length > 0)} @click=${() => void this.save()}>${t("venue.save")}</wt-button></wt-form-actions>` : nothing}
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "department-settings": DepartmentSettings;
  }
}
