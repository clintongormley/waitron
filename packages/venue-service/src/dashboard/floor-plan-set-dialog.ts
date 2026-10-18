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
import type { FloorPlanSetsModel } from "../floor-plan-set-types.js";
import { format } from "./hours-view.js";
import type { Refusal } from "./refusal.js";
import { t } from "./strings.js";

export type FloorPlanSetMode = "add" | "rename" | "copy";
export type FloorPlanSetSave =
  | { mode: "add"; departmentId: string; name: string; fromSetId?: string }
  | { mode: "rename" | "copy"; setId: string; name: string };
type Department = Pick<FloorPlanSetsModel["departments"][number], "id" | "name"> & {
  sets: readonly { id: string; name: string; isDefault: boolean }[];
};
type Draft = { departmentId: string; name: string; fromSetId: string };
type Field = keyof Draft;

const fields: readonly Field[] = ["departmentId", "name", "fromSetId"];
const same = (a: Draft, b: Draft) =>
  a.departmentId === b.departmentId && a.name === b.name && a.fromSetId === b.fromSetId;
const defaultSetOf = (department?: Department) =>
  (department?.sets.find(({ isDefault }) => isDefault) ?? department?.sets[0])?.id ?? "";

/** Asks what a new set, a renamed set or a copy is called; a new set also asks its department
 *  and, once that department has a set, which one it starts as a copy of. Sends
 *  `floor-plan-set-save`; the page sends the request and hands any refusal back. */
@customElement("dashboard-floor-plan-set-dialog")
export class FloorPlanSetDialog extends LitElement {
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
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property() mode: FloorPlanSetMode = "add";
  @property({ attribute: false }) departments: readonly Department[] = [];
  /** The set a Rename or a Copy is of. */
  @property({ attribute: false }) set?: { id: string; name: string };
  @property({ attribute: false }) refusal?: Refusal;
  @property({ attribute: false }) draftParent?: object;
  @state() private draft: Draft = { departmentId: "", name: "", fromSetId: "" };
  @state() private attempted = false;
  private scope?: DraftScope<Draft>;
  private leave?: LeaveCoordinator;
  private opened?: string;
  private identity: object = {};
  private baseline?: Draft;
  private generation = {};
  private submittedGeneration?: object;
  private submitted?: Draft;

  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  protected override willUpdate() {
    if (!this.open) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = undefined;
      this.generation = {};
      return;
    }
    const opened = `${this.mode}:${this.set?.id ?? ""}`;
    if (this.opened !== opened) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.opened = opened;
      this.identity = {};
      this.generation = {};
      const only =
        this.mode === "add" && this.departments.length === 1 ? this.departments[0] : undefined;
      this.draft = {
        departmentId: only?.id ?? "",
        name: this.mode === "rename" ? (this.set?.name ?? "") : "",
        fromSetId: defaultSetOf(only),
      };
      this.baseline = { ...this.input };
      this.attempted = false;
      this.refusal = undefined;
      this.submitted = undefined;
    }
    if (this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this.identity,
        parent: this.draftParent,
        current: () => this.input,
        snapshot: (value) => ({ ...value }),
        equal: same,
        restore: (value) => {
          this.draft = { ...value };
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
  }
  private get input(): Draft {
    return { ...this.draft, name: this.draft.name.trim() };
  }
  private get department(): Department | undefined {
    return this.departments.find(({ id }) => id === this.draft.departmentId);
  }
  private get asksStartFrom(): boolean {
    return this.mode === "add" && (this.department?.sets.length ?? 0) > 0;
  }
  private get ownErrors(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (this.mode === "add" && !this.department)
      errors.departmentId = t("period.department_required");
    if (!this.input.name) errors.name = t("menu.name_required");
    if (this.asksStartFrom && !this.department!.sets.some(({ id }) => id === this.draft.fromSetId))
      errors.fromSetId = t("floor_plans.start_from_required");
    return errors;
  }
  private get shownFields(): readonly Field[] {
    if (this.mode !== "add") return ["name"];
    return this.asksStartFrom ? fields : ["departmentId", "name"];
  }
  private refusalField(): Field | undefined {
    const refusal = this.refusal;
    if (!refusal) return undefined;
    if (refusal.code === "floor_plan_set.name_taken") return "name";
    const field = refusal.params?.field as Field | undefined;
    if (
      (refusal.code === "floor_plan_set.invalid" ||
        refusal.code === "management.request_invalid") &&
      field !== undefined &&
      this.shownFields.includes(field)
    )
      return field;
    return undefined;
  }
  private error(field: Field): string {
    if (this.refusalField() === field)
      return this.refusal!.code === "floor_plan_set.name_taken"
        ? t("floor_plans.name_taken")
        : t("menu.field_refused");
    return this.attempted ? (this.ownErrors[field] ?? "") : "";
  }
  private changed(field: Field, value: string) {
    this.draft = { ...this.draft, [field]: value };
    if (field === "departmentId")
      this.draft = { ...this.draft, fromSetId: defaultSetOf(this.department) };
    if (this.refusalField() === field) this.refusal = undefined;
    this.scope?.changed();
  }
  private save() {
    if (!this.open || !this.isConnected || this.busy || saveActionState(this.scope).unchanged)
      return;
    this.attempted = true;
    this.refusal = undefined;
    if (Object.keys(this.ownErrors).length) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.submittedGeneration = this.generation;
    this.submitted = { ...this.input };
    const { departmentId, name, fromSetId } = this.submitted;
    const detail: FloorPlanSetSave =
      this.mode === "add"
        ? { mode: "add", departmentId, name, ...(this.asksStartFrom ? { fromSetId } : {}) }
        : { mode: this.mode, setId: this.set!.id, name };
    this.dispatchEvent(
      new CustomEvent("floor-plan-set-save", { detail, bubbles: true, composed: true }),
    );
  }
  /** Makes the last submission the saved values; true when nothing has changed since. */
  commitSubmitted(): boolean {
    if (!this.open || !this.isConnected || this.submittedGeneration !== this.generation)
      return false;
    this.baseline = { ...this.submitted! };
    this.scope?.commit(this.submitted!);
    return !this.scope?.isDirty();
  }
  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.isConnected && generation === this.generation && outcome === "proceeded";
  };
  private get heading(): string {
    if (this.mode === "add") return t("floor_plans.add_heading");
    return format(
      this.mode === "rename" ? "floor_plans.rename_heading" : "floor_plans.copy_heading",
      {
        set: this.set?.name ?? "",
      },
    );
  }
  private combobox(field: Field, label: string, options: { value: string; label: string }[]) {
    const generation = this.generation;
    return html`<wt-combobox
      name=${field}
      label=${label}
      required
      .value=${this.draft[field]}
      .options=${options}
      .error=${this.error(field)}
      ?disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (generation === this.generation && !this.busy) this.changed(field, event.detail.value);
      }}
    ></wt-combobox>`;
  }
  override render(): unknown {
    if (!this.open) return nothing;
    const s = saveActionState(this.scope);
    const marked = this.shownFields.some((field) => this.error(field));
    const bottom =
      this.refusal && this.refusalField() === undefined
        ? this.refusal.code === "floor_plan_set.not_found"
          ? t("floor_plans.set_gone")
          : t("menu.save_error")
        : "";
    const generation = this.generation;
    const current = () =>
      generation === this.generation && this.isConnected && this.open && !this.busy;
    const toOption = ({ id, name }: { id: string; name: string }) => ({ value: id, label: name });
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${this.heading}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!current()) return;
          this.open = false;
          this.dispatchEvent(
            new CustomEvent("floor-plan-set-close", { bubbles: true, composed: true }),
          );
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (current())
            submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-set]"));
        }}
      >
        <div class="form">
          ${
            this.mode === "add"
              ? this.combobox("departmentId", t("menu.department"), this.departments.map(toOption))
              : nothing
          }
          <wt-input
            name="name"
            label=${t("floor_plans.name")}
            required
            .value=${this.draft.name}
            .error=${this.error("name")}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current()) this.changed("name", event.detail.value);
            }}
          ></wt-input>
          ${
            this.asksStartFrom
              ? this.combobox(
                  "fromSetId",
                  t("floor_plans.start_from"),
                  this.department!.sets.map(toOption),
                )
              : nothing
          }
        </div>
        <wt-form-actions
          slot="footer"
          .error=${[bottom, marked ? t("menu.fix_fields") : ""].filter(Boolean).join(" ")}
        >
          <wt-button
            slot="cancel"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => {
              if (current())
                void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
            }}
            >${t("menu.cancel")}</wt-button
          >
          <wt-button
            data-test="save-set"
            variant=${s.variant}
            ?disabled=${s.unchanged || this.busy || (this.attempted && Object.keys(this.ownErrors).length > 0)}
            ?loading=${this.busy}
            @click=${() => {
              if (current()) this.save();
            }}
            >${t("menu.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-floor-plan-set-dialog": FloorPlanSetDialog;
  }
}
