import type { DashboardPanelRenderer } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  FormFeedback,
  bottomMessage,
  draftScopeFor,
  focusFirstInvalid,
  leftToBrowser,
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
import "@waitron/ui/src/components/wt-segmented-control.js";
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
  VenueServiceModel,
  VenueServiceView,
} from "./client.js";
import { t } from "./strings.js";
import {
  stepsEqual,
  toStepDrafts,
  toStepInputs,
  withSavedIds,
  type ServiceStepDraft,
} from "./service-step-draft.js";

export type DepartmentTab = "details" | "service" | "tables" | "receipt" | "transfers";
export function offeredDepartmentTabs(model?: VenueServiceView, receipts = false): DepartmentTab[] {
  const transfers = (model?.departments.filter((d) => d.active).length ?? 0) >= 2;
  return [
    "details",
    "service",
    "tables",
    ...(receipts ? (["receipt"] as const) : []),
    ...(transfers ? (["transfers"] as const) : []),
  ];
}
export type ReceiptEditorPanel = ReturnType<DashboardPanelRenderer> | undefined;
export const offersReceiptEditor = (editor: ReceiptEditorPanel) => editor != null;
interface ReceiptEditor {
  externalActions?: boolean;
  renderFooter?: (slot?: "footer") => unknown;
  saveButton?: HTMLElement | null;
  leaveScope?: object;
  hasUnsavedChanges?: boolean;
  saving?: boolean;
  invalid?: boolean;
  savedOperationDescription?: string;
  descriptionProblem?(value: string): string;
  saveOperationDescription?(value: string): Promise<string | undefined>;
}
/** `operationDescription` is the receipt record's, present while the receipt editor offers it; it
 * is saved through that editor, never with the department's settings. */
type DepartmentDraft = Omit<DepartmentSettingsInput, "serviceSteps"> &
  Required<
    Pick<DepartmentSettingsInput, "needsClearing" | "lateSendNeedsManager" | "courseSettings">
  > & {
    serviceSteps: ServiceStepDraft[];
    operationDescription?: string;
  };
const REMINDER_MINUTES = [0, 5, 10, 15, 20, 30];
const POLICY_FIELDS = ["orderStart", "paidWhen", "collectionNumber"] as const;
const DINING_FIELDS = ["dining", "diningStartsAs"] as const;
const SERVICE_FIELDS = [...POLICY_FIELDS, ...DINING_FIELDS] as const;
type Field = keyof DepartmentDraft | "receivingProfileId" | "destinationDepartmentIds";
const fieldTab: Record<Field, DepartmentTab> = {
  name: "details",
  tradingName: "details",
  estimatedMargin: "details",
  operationDescription: "details",
  orderStart: "service",
  paidWhen: "service",
  collectionNumber: "service",
  dining: "service",
  diningStartsAs: "service",
  needsClearing: "tables",
  lateSendNeedsManager: "service",
  courseSettings: "tables",
  serviceSteps: "tables",
  transfers: "transfers",
  receivingProfileId: "transfers",
  destinationDepartmentIds: "transfers",
};
export const departmentSettingFields = (
  [
    ["name", "venue.name"],
    ["tradingName", "venue.trading_name"],
    ["operationDescription", "venue.operation_description"],
    ["orderStart", "venue.order_start"],
    ["paidWhen", "venue.counter_paid_when"],
    ["collectionNumber", "venue.print_collection_ticket"],
    ["dining", "venue.dining"],
    ["diningStartsAs", "venue.dining_starts_as"],
    ["courseSettings", "venue.release_reminder"],
    ["lateSendNeedsManager", "venue.late_send_needs_manager"],
    ["needsClearing", "venue.needs_clearing"],
    ["serviceSteps", "venue.service_steps"],
    ["destinationDepartmentIds", "venue.transfer_destinations"],
    ["receivingProfileId", "venue.receiving_profile"],
  ] as const satisfies readonly (readonly [Field, Parameters<typeof t>[0]])[]
).map(([name, labelKey]) => ({
  name,
  labelKey,
  tab: fieldTab[name],
  requiresDescription: name === "operationDescription",
  requiresTakeawayVat: name === "dining" || name === "diningStartsAs",
}));
const copy = (value: DepartmentDraft): DepartmentDraft => ({
  ...value,
  courseSettings: value.courseSettings.map((row) => ({ ...row })),
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
  a.operationDescription === b.operationDescription && settingsEqual(a, b);
const settingsEqual = (a: DepartmentDraft, b: DepartmentDraft) =>
  a.name.trim() === b.name.trim() &&
  a.tradingName.trim() === b.tradingName.trim() &&
  a.orderStart === b.orderStart &&
  a.paidWhen === b.paidWhen &&
  a.collectionNumber === b.collectionNumber &&
  a.dining === b.dining &&
  (a.dining !== "till_choice" || a.diningStartsAs === b.diningStartsAs) &&
  a.needsClearing === b.needsClearing &&
  a.lateSendNeedsManager === b.lateSendNeedsManager &&
  a.courseSettings.length === b.courseSettings.length &&
  a.courseSettings.every((row) =>
    b.courseSettings.some(
      (other) =>
        row.courseId === other.courseId &&
        row.heldUntilFired === other.heldUntilFired &&
        row.reminderMinutes === other.reminderMinutes,
    ),
  ) &&
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
      .meal-fixed,
      .meal-course {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-text-muted);
        background: var(--wt-color-surface-sunken);
      }
      .meal-course {
        border-color: var(--wt-color-warning);
        background: var(--wt-color-surface);
      }
      .meal-course wt-combobox {
        flex-basis: 100%;
        min-width: 0;
      }
      .meal-course wt-icon {
        color: var(--wt-color-warning);
      }
      .meal-fixed wt-icon {
        color: var(--wt-color-text-muted);
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
  @property({ attribute: false }) publishSaved?: (model: VenueServiceModel) => void;
  @property() departmentId = "";
  @property({ type: Boolean }) refreshing = false;
  @property() tab: DepartmentTab = "details";
  @property({ attribute: false }) receiptEditor: ReceiptEditorPanel;
  @property({ attribute: false }) externalActions = false;
  private readonly saveRef = createRef<HTMLElementTagNameMap["wt-button"]>();
  get saveButton() {
    return this.saveRef.value ?? null;
  }
  @state() private draft?: DepartmentDraft;
  @state() private busy = false;
  private readonly feedback = new FormFeedback(this);
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
  private descriptionFocusDue = false;
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
    return { ...(this.feedback.attempted ? this.fieldErrors(this.receipt) : {}), ...this.refused };
  }
  /** Focuses the description on Details once the receipt editor offers it; a tab change, a click or
   * edit on Details, or another department cancels the request. */
  focusDescription() {
    this.descriptionFocusDue = true;
    this.requestUpdate();
  }
  private selectTab(tab: DepartmentTab, replace: boolean) {
    this.descriptionFocusDue = false;
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
    submitOnEnter(event, this.saveButton);
  }
  private receiptInvalid(event: CustomEvent<{ departmentId?: string; invalid?: boolean }>) {
    event.stopPropagation();
    if (event.detail?.departmentId !== this.departmentId) return;
    this.requestUpdate();
    if (event.detail.invalid && this.tab !== "receipt") this.showFirstInvalid(new Set(["receipt"]));
  }
  private receiptDescription(event: CustomEvent<{ departmentId?: string }>) {
    event.stopPropagation();
    if (event.detail?.departmentId === this.departmentId) this.requestUpdate();
  }
  /** Takes the receipt editor's saved description into baseline, and into the draft while the
   * draft's copy is untouched. */
  private followDescription() {
    const saved = this.receipt?.savedOperationDescription;
    if (saved === this.baseline!.operationDescription || this.busy) return;
    const draft = { ...this.draft! },
      baseline = { ...this.baseline! };
    if (saved === undefined) {
      delete draft.operationDescription;
      delete baseline.operationDescription;
    } else {
      if (draft.operationDescription === baseline.operationDescription)
        draft.operationDescription = saved;
      baseline.operationDescription = saved;
    }
    this.draft = draft;
    this.baseline = baseline;
    this.scope?.commit(baseline);
  }
  private async receiptRefused(event: CustomEvent<{ departmentId?: string }>) {
    event.stopPropagation();
    if (event.detail?.departmentId !== this.departmentId) return;
    const editor = event.target as HTMLElement;
    if (this.tab !== "receipt") this.selectTab("receipt", true);
    await this.updateComplete;
    await this.footerRendered();
    (editor as HTMLElement & ReceiptEditor).saveButton?.focus();
  }
  private footerRendered(): Promise<unknown> {
    const detail: { rendered?: Promise<unknown> } = {};
    this.dispatchEvent(new CustomEvent("footer-change", { detail, bubbles: true, composed: true }));
    return detail.rendered ?? Promise.resolve();
  }
  protected override updated() {
    if (this.receipt) this.receipt.externalActions = this.externalActions;
    if (this.externalActions) void this.footerRendered();
    if (!this.descriptionFocusDue) return;
    const field = this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "[slot=details] [name=operationDescription]",
    );
    if (!field) return;
    this.descriptionFocusDue = false;
    void field.updateComplete.then(() => {
      if (this.tab === "details" && field.isConnected) field.focus();
    });
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
      dining: policy?.dining ?? "eat_in",
      diningStartsAs: policy?.diningStartsAs ?? "eat_in",
      needsClearing: this.model!.needsClearingDepartmentIds.includes(row.id),
      lateSendNeedsManager: this.model!.lateSendManagerDepartmentIds.includes(row.id),
      courseSettings: this.model!.courses.map((course) => ({
        courseId: course.id,
        heldUntilFired: true,
        reminderMinutes: 10,
        ...this.model!.courseSettingsByDepartment[row.id]?.find(
          (setting) => setting.courseId === course.id,
        ),
      })),
      serviceSteps: this.modelSteps(row.id),
    };
    if (this.opened !== row.id) {
      this.descriptionFocusDue = false;
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = row.id;
      this.generation = {};
      this.transferGeneration = {};
      this.busy = false;
      this.feedback.reset();
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
          this.feedback.reset();
          this.refused = {};
          this.refusedSteps = {};
          this.failure = "";
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
    if (this.scope && !this.busy) {
      this.followSteps(source.serviceSteps);
      const draft = copy(this.draft!),
        baseline = copy(this.baseline!);
      for (const field of [
        "name",
        "tradingName",
        "orderStart",
        "paidWhen",
        "collectionNumber",
        "dining",
        "diningStartsAs",
        "needsClearing",
        "lateSendNeedsManager",
      ] as const) {
        const untouched =
          field === "name" || field === "tradingName"
            ? draft[field].trim() === baseline[field].trim()
            : draft[field] === baseline[field];
        if (untouched) {
          Object.assign(draft, { [field]: source[field] });
          Object.assign(baseline, { [field]: source[field] });
        }
      }
      const courses = source.courseSettings.map((row) => {
        const saved = baseline.courseSettings.find((other) => other.courseId === row.courseId);
        const edited = draft.courseSettings.find((other) => other.courseId === row.courseId);
        const heldTouched = saved && edited && edited.heldUntilFired !== saved.heldUntilFired;
        const reminderTouched = saved && edited && edited.reminderMinutes !== saved.reminderMinutes;
        return {
          draft: {
            ...row,
            ...(heldTouched ? { heldUntilFired: edited.heldUntilFired } : {}),
            ...(reminderTouched ? { reminderMinutes: edited.reminderMinutes } : {}),
          },
          baseline: {
            ...row,
            ...(heldTouched ? { heldUntilFired: saved.heldUntilFired } : {}),
            ...(reminderTouched ? { reminderMinutes: saved.reminderMinutes } : {}),
          },
        };
      });
      draft.courseSettings = courses.map(({ draft }) => draft);
      baseline.courseSettings = courses.map(({ baseline }) => baseline);
      if (!equal(this.draft!, draft) || !equal(this.baseline!, baseline)) {
        this.draft = draft;
        this.baseline = baseline;
        this.scope.commit(baseline);
      }
    }
    this.followDescription();
    if (
      this.isConnected &&
      this.showsTransfers &&
      !this.transfersLoaded &&
      !this.transferLoading &&
      this.api
    )
      void this.loadTransfers(row.id, this.transferGeneration);
  }
  private modelSteps(id: string) {
    return toStepDrafts(this.model!.serviceSteps.filter((step) => step.departmentId === id));
  }
  /** A dirty draft follows a model whose steps differ from the last steps the form recorded as
   * seen, where no edit of the user's is at stake: an unchanged list takes the model's, and rows a
   * save added take the ids the model gave them. */
  private followSteps(steps: ServiceStepDraft[]) {
    const draft = this.draft!,
      baseline = this.baseline!;
    if (stepsEqual(steps, this.source!.serviceSteps)) return;
    if (!stepsEqual(steps, baseline.serviceSteps)) {
      if (stepsEqual(draft.serviceSteps, baseline.serviceSteps)) {
        this.draft = { ...draft, serviceSteps: steps.map((step) => ({ ...step })) };
        this.baseline = { ...baseline, serviceSteps: steps.map((step) => ({ ...step })) };
      } else {
        const saved = withSavedIds(baseline.serviceSteps, steps);
        if (!saved) return;
        const ids = new Map(saved.map((step) => [step.key, step.id]));
        this.draft = {
          ...draft,
          serviceSteps: draft.serviceSteps.map((step) => ({
            ...step,
            id: ids.get(step.key) ?? step.id,
          })),
        };
        this.baseline = { ...baseline, serviceSteps: saved };
      }
      this.scope!.commit(this.baseline);
    }
    this.source = { ...this.source!, serviceSteps: steps.map((step) => ({ ...step })) };
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
    this.descriptionFocusDue = false;
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
  /** The latest saved value and the draft value are offered even when the list lacks them, so the
   * dropdown never shows a value it does not list. */
  private releaseReminder(
    courseId: string,
    saved: number | null,
    minutes: number | null,
    error: string | undefined,
    disabled: boolean,
  ) {
    const choices = [
      ...new Set([...REMINDER_MINUTES, ...[saved, minutes].filter((m) => m !== null)]),
    ].sort((a, b) => a - b);
    return html`<wt-combobox
      ?preserve-order=${true /* Preserve off/at once/minute sequence. */}
      name=${`course-${courseId}-reminder`}
      label=${t("venue.release_reminder")}
      hint=${t("venue.release_reminder_hint")}
      search="auto"
      show-empty-option
      searchPlaceholder=${t("venue.combobox_search")}
      noResultsLabel=${t("venue.combobox_no_results")}
      .options=${[
        { value: "", label: t("venue.release_reminder.off") },
        ...choices.map((choice) => ({
          value: String(choice),
          label:
            choice === 0
              ? t("venue.release_reminder.at_once")
              : t("venue.release_reminder.minutes").replace("{n}", String(choice)),
        })),
      ]}
      .value=${minutes === null ? "" : String(minutes)}
      error=${error ?? ""}
      ?disabled=${disabled}
      @wt-change=${(e: CustomEvent<{ value: string }>) => {
        e.stopPropagation();
        const value = e.detail.value;
        this.courseChanged(courseId, { reminderMinutes: value === "" ? null : Number(value) });
      }}
    ></wt-combobox>`;
  }
  private courseChanged(
    courseId: string,
    patch: Partial<DepartmentDraft["courseSettings"][number]>,
  ) {
    this.changed(
      "courseSettings",
      this.draft!.courseSettings.map((row) =>
        row.courseId === courseId ? { ...row, ...patch } : row,
      ),
    );
  }
  private stepsChanged(steps: ServiceStepDraft[]) {
    const before = new Map(this.draft!.serviceSteps.map((step) => [step.key, step]));
    const kept: ServiceStepErrors = {};
    for (const step of steps) {
      const was = before.get(step.key),
        row = { ...this.refusedSteps[step.key] };
      if (!was) continue;
      if (was.name !== step.name) delete row.name;
      if (
        was.start !== step.start ||
        was.courseId !== step.courseId ||
        was.afterStepKey !== step.afterStepKey
      )
        delete row.start;
      if (was.minutes !== step.minutes) delete row.minutes;
      if (Object.keys(row).length) kept[step.key] = row;
    }
    this.refusedSteps = kept;
    this.changed("serviceSteps", steps);
    if (Object.keys(kept).length) this.refused = { ...this.refused, serviceSteps: "" };
  }
  /** A list equal to the baseline is not sent, so it is not judged: it may be a copy the form could
   * not follow, such as one a save left that another manager has since changed back. */
  private get stepErrors(): ServiceStepErrors {
    const found: ServiceStepErrors = {};
    if (!this.draft || stepsEqual(this.draft.serviceSteps, this.baseline!.serviceSteps))
      return found;
    const courses = new Set(this.model?.courses.map((course) => course.id));
    this.draft.serviceSteps.forEach((step) => {
      const row: Partial<Record<ServiceStepField, string>> = {};
      if (!step.name.trim()) row.name = t("venue.field_required");
      if (
        step.start === "after_step" &&
        !this.draft!.serviceSteps.some((parent) => parent.key === step.afterStepKey)
      )
        row.start = t("venue.service_step_start_invalid");
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
    const shown: ServiceStepErrors = this.feedback.attempted ? { ...this.stepErrors } : {};
    for (const [key, row] of Object.entries(this.refusedSteps))
      shown[key] = { ...shown[key], ...row };
    return shown;
  }
  private fieldErrors(receipt: ReceiptEditor | undefined): Partial<Record<Field, string>> {
    const value = this.draft?.operationDescription;
    // A description equal to the saved one is not sent, so it is not judged.
    const description =
      value === undefined || value === this.baseline?.operationDescription
        ? ""
        : (receipt?.descriptionProblem?.(value) ?? "");
    return {
      ...(this.draft?.name.trim() ? {} : { name: t("venue.field_required") }),
      ...(description ? { operationDescription: description } : {}),
      ...(this.draft?.tradingName.trim() ? {} : { tradingName: t("venue.field_required") }),
      ...(Object.keys(this.stepErrors).length ? { serviceSteps: "" } : {}),
    };
  }
  /** Marks the steps a refusal names: a field by the draft key of the submitted row it points at,
   * a deleted course on each row that still starts from it now the answer has come. */
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
        list = t("venue.service_steps_refused");
    } else if (code === "service_step.not_found") list = t("venue.service_step_changed_elsewhere");
    else if (code === "course.not_found")
      for (const step of this.draft!.serviceSteps)
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
      ...(this.model?.takeawayVat ? DINING_FIELDS : []),
      "needsClearing",
      "lateSendNeedsManager",
      "courseSettings",
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
    this.feedback.press();
    this.refused = {};
    this.refusedSteps = {};
    this.failure = "";
    if (Object.keys(this.fieldErrors(this.receipt)).length) {
      this.showFirstInvalid();
      return;
    }
    if (!this.api) return;
    const kept = copy(this.draft!);
    kept.name = kept.name.trim();
    kept.tradingName = kept.tradingName.trim();
    if (!this.showsTransfers) delete kept.transfers;
    const { serviceSteps, operationDescription, ...unchanged } = kept;
    if (!this.model?.takeawayVat) delete unchanged.dining;
    if (!this.model?.takeawayVat || unchanged.dining !== "till_choice")
      delete unchanged.diningStartsAs;
    const description =
      operationDescription !== undefined &&
      operationDescription !== this.baseline!.operationDescription
        ? operationDescription
        : undefined;
    const submitted: DepartmentSettingsInput = stepsEqual(serviceSteps, this.baseline!.serviceSteps)
      ? unchanged
      : { ...unchanged, serviceSteps: toStepInputs(serviceSteps) };
    for (const field of ["needsClearing", "lateSendNeedsManager"] as const)
      if (kept[field] === this.baseline![field]) delete submitted[field];
    if (settingsEqual({ ...kept, courseSettings: this.baseline!.courseSettings }, kept))
      delete submitted.courseSettings;
    if (settingsEqual({ ...kept, transfers: this.baseline!.transfers }, kept))
      delete submitted.transfers;
    const publish = this.publishSaved;
    this.busy = true;
    let written = false;
    try {
      if (!settingsEqual(kept, this.baseline!)) {
        try {
          const answer = await this.api.saveDepartmentSettings(id, submitted);
          publish?.(answer);
          if (!this.current(id, generation)) return;
          const committed = {
            ...copy(kept),
            operationDescription: this.baseline!.operationDescription,
          };
          if (!kept.transfers && this.showsTransfers)
            committed.transfers = copy(this.baseline!).transfers;
          if (!this.showsTransfers) delete committed.transfers;
          this.baseline = committed;
          this.model = { ...this.model!, ...answer };
          this.scope?.commit(committed);
          written = true;
        } catch (error) {
          if (this.current(id, generation)) this.fieldRefusal(error, submitted, serviceSteps);
          return;
        }
      }
      const receipt = this.receipt;
      if (description !== undefined && receipt?.saveOperationDescription) {
        const refusal = await receipt.saveOperationDescription(description);
        if (!this.current(id, generation)) return;
        if (refusal === undefined) {
          this.baseline = { ...this.baseline!, operationDescription: description };
          this.scope?.commit(this.baseline);
          written = true;
        } else {
          this.refused = { operationDescription: refusal };
          this.showFirstInvalid();
        }
      }
      if (written) this.emit("saved", { departmentId: id });
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
        this.feedback.reset();
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
    const fields = ["orderStart", "paidWhen", "collectionNumber"] as const;
    return (this.model?.zones ?? [])
      .filter((z) => z.departmentId === this.departmentId)
      .flatMap((zone) => {
        const overrides = this.model!.salePolicies.zones.find((p) => p.zoneId === zone.id);
        if (!overrides) return [];
        const labels = fields
          .filter((field) => overrides[field] !== null && overrides[field] !== draft[field])
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
            }
          });
        return labels.length ? [{ zone, labels }] : [];
      });
  }
  renderFooter(slot?: "footer"): unknown {
    if (!this.department?.active || !this.draft) return nothing;
    if (this.tab === "receipt") return this.receipt?.renderFooter?.(slot) ?? nothing;
    const state = saveActionState(this.scope);
    const highlighted =
      Object.keys(this.shownErrors).some((field) => field !== "serviceSteps") ||
      Object.keys(this.shownStepErrors).length > 0;
    return html`<wt-form-actions
      slot=${slot ?? nothing}
      .showError=${slot !== "footer"}
      .error=${bottomMessage(
        this.failure,
        this.refused.serviceSteps ?? "",
        highlighted ? t("venue.fix_fields") : "",
      )}
      ><wt-button
        slot="cancel"
        variant="secondary"
        data-test="cancel-editor"
        ?disabled=${this.busy || this.refreshing}
        @click=${() => void this.cancel()}
        >${t("venue.cancel")}</wt-button
      ><wt-button
        ${ref(this.saveRef)}
        data-test="save-editor"
        variant=${this.refreshing ? "secondary" : state.variant}
        ?disabled=${this.busy || this.refreshing || state.unchanged || (this.feedback.attempted && Object.keys(this.fieldErrors(this.receipt)).length > 0)}
        @click=${() => void this.save()}
        >${t("venue.save")}</wt-button
      ></wt-form-actions
    >`;
  }
  override render() {
    const row = this.department,
      draft = this.draft;
    if (!row || !row.active || !draft) return nothing;
    const errors = this.shownErrors,
      disabled = !row.active;
    const serviceErrors: Partial<Record<keyof ServiceSettingsValue, string>> = {};
    for (const field of SERVICE_FIELDS) if (errors[field]) serviceErrors[field] = errors[field];
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
        ?sticky=${this.externalActions}
        label=${t("venue.department")}
        .items=${tabs}
        .value=${this.tab}
        @wt-tab-change=${(e: CustomEvent<{ value: DepartmentTab }>) => {
          if (e.target !== e.currentTarget) return;
          e.stopPropagation();
          this.selectTab(e.detail.value, false);
        }}
      >
        <div
          class="panel"
          slot="details"
          @keydown=${this.submitOnEnter}
          @pointerdown=${() => (this.descriptionFocusDue = false)}
        >
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
          ${
            draft.operationDescription === undefined
              ? nothing
              : html`<wt-input
                  name="operationDescription"
                  label=${t("venue.operation_description")}
                  hint=${t("venue.operation_description_hint")}
                  required
                  .value=${draft.operationDescription}
                  error=${errors.operationDescription ?? ""}
                  ?disabled=${disabled}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => {
                    e.stopPropagation();
                    this.changed("operationDescription", e.detail.value);
                  }}
                ></wt-input>`
          }
        </div>
        <div class="panel" slot="service" @keydown=${this.submitOnEnter}>
          <section aria-label=${t("venue.orders_and_payment")}>
            <h3>${t("venue.orders_and_payment")}</h3>
            <dashboard-service-settings-fields
              .value=${{ ...draft }}
              .errors=${serviceErrors}
              .takeawayVat=${this.model?.takeawayVat ?? false}
              ?disabled=${disabled}
              @service-settings-change=${(e: CustomEvent<{ value: ServiceSettingsValue }>) => {
                e.stopPropagation();
                for (const field of this.model?.takeawayVat ? SERVICE_FIELDS : POLICY_FIELDS)
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
                            href=${`/venue-operations/department/${encodeURIComponent(row.id)}/view/zones/zone/${encodeURIComponent(zone.id)}`}
                            @click=${(e: MouseEvent) => {
                              if (leftToBrowser(e)) return;
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
          <section aria-label=${t("venue.courses_and_kitchen")}>
            <h3>${t("venue.courses_and_kitchen")}</h3>
            <div>
              <wt-switch
                name="lateSendNeedsManager"
                label=${t("venue.late_send_needs_manager")}
                .description=${errors.lateSendNeedsManager ? `${errors.lateSendNeedsManager} ${t("venue.late_send_needs_manager_hint")}` : t("venue.late_send_needs_manager_hint")}
                .checked=${draft.lateSendNeedsManager}
                ?disabled=${disabled}
                aria-invalid=${errors.lateSendNeedsManager ? "true" : nothing}
                @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                  e.stopPropagation();
                  this.changed("lateSendNeedsManager", e.detail.checked);
                }}
              ></wt-switch>
              <p class="hint" aria-hidden="true">${t("venue.late_send_needs_manager_hint")}</p>
              ${errors.lateSendNeedsManager ? html`<p class="error" data-field-error="lateSendNeedsManager">${errors.lateSendNeedsManager}</p>` : nothing}
            </div>
          </section>
        </div>
        <div class="panel" slot="tables" @keydown=${this.submitOnEnter}>
          <section aria-label=${t("venue.table_states")}>
            <h3>${t("venue.table_states")}</h3>
            <p class="meal-fixed" data-moment="seated">
              <wt-icon name="table-rect"></wt-icon>${t("venue.meal_seated")}
            </p>
            <department-service-steps
              .steps=${draft.serviceSteps}
              .courses=${this.model!.courses}
              .errors=${this.shownStepErrors}
              ?disabled=${disabled}
              @steps-change=${(e: CustomEvent<{ steps: ServiceStepDraft[] }>) => {
                e.stopPropagation();
                this.stepsChanged(e.detail.steps);
              }}
            ></department-service-steps>
            ${this.model!.courses.map((course) => {
              const setting = draft.courseSettings.find((row) => row.courseId === course.id)!;
              const saved = this.model!.courseSettingsByDepartment[row.id]?.find(
                (setting) => setting.courseId === course.id,
              );
              return html`<div class="meal-course" data-course=${course.id}>
                <wt-icon name="section-service"></wt-icon><strong>${course.name}</strong>
                <wt-segmented-control
                  hide-label
                  name=${`course-${course.id}-held`}
                  label=${course.name}
                  .options=${[
                    { value: "false", label: t("venue.meal_fire") },
                    { value: "true", label: t("venue.meal_hold") },
                  ]}
                  .value=${String(setting.heldUntilFired)}
                  ?disabled=${disabled}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.courseChanged(course.id, {
                      heldUntilFired: event.detail.value === "true",
                    });
                  }}
                ></wt-segmented-control>
                ${setting.heldUntilFired ? this.releaseReminder(course.id, saved?.reminderMinutes ?? 10, setting.reminderMinutes, errors.courseSettings, disabled) : nothing}
              </div>`;
            })}
            ${errors.courseSettings ? html`<p class="error" data-field-error="courseSettings">${errors.courseSettings}</p>` : nothing}
            <p class="meal-fixed" data-moment="bill">
              <wt-icon name="floor-bill"></wt-icon>${t("venue.meal_bill")}
            </p>
            <p class="meal-fixed" data-moment="leaves">
              <wt-icon name="person"></wt-icon>${t("venue.meal_leaves")}
            </p>
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
              <p class="hint" aria-hidden="true">${t("venue.needs_clearing_hint")}</p>
              ${errors.needsClearing ? html`<p class="error" data-field-error="needsClearing">${errors.needsClearing}</p>` : nothing}
            </div>
          </section>
        </div>
        ${
          offered.includes("receipt")
            ? html`<div
                class="panel receipt"
                slot="receipt"
                @department-receipt-invalid=${this.receiptInvalid}
                @department-receipt-refused=${this.receiptRefused}
                @department-receipt-description=${this.receiptDescription}
              >
                ${this.receiptEditor}
              </div>`
            : nothing
        }
        ${
          this.showsTransfers
            ? html`<div class="panel" slot="transfers" @keydown=${this.submitOnEnter}>
                <section data-test="transfers-section" aria-label=${t("venue.tab_transfers")}>
                  <h3>${t("venue.tab_transfers")}</h3>
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
                              .options=${[{ value: "", label: t("venue.none") }, ...this.profiles.map((p) => ({ value: p.id, label: p.name })), ...(draft.transfers.receivingProfileId && !this.profiles.some((p) => p.id === draft.transfers!.receivingProfileId) ? [{ value: draft.transfers.receivingProfileId, fixed: true, label: t("venue.transfer_profile_unavailable") }] : [])]}
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
      ${this.externalActions ? nothing : this.renderFooter()}
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "department-settings": DepartmentSettings;
  }
}
