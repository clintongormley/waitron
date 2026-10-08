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
import { CALENDAR_COLOURS, type CalendarColour } from "../hours-types.js";
import type { MenuPeriodInput, OpeningHoursModel } from "../menu-timetable-types.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

type Draft = MenuPeriodInput & { colour: CalendarColour };
type Field = keyof Draft;
const copy = (value: Draft): Draft => ({ ...value, staffMenuIds: [...value.staffMenuIds] });
const empty = (usedColours: readonly CalendarColour[] = []): Draft => ({
  name: "",
  colour: CALENDAR_COLOURS.find((colour) => !usedColours.includes(colour)) ?? CALENDAR_COLOURS[0],
  menuId: "",
  staffMenuIds: [],
});
const fields: Field[] = ["name", "colour", "menuId", "staffMenuIds"];

@customElement("period-editor")
export class PeriodEditor extends LitElement {
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
  @property() departmentName = "";
  @property({ attribute: false })
  period?: OpeningHoursModel["departments"][number]["periods"][number];
  @property({ attribute: false }) menus: OpeningHoursModel["menus"] = [];
  @property({ attribute: false }) usedColours: readonly CalendarColour[] = [];
  @property({ attribute: false }) refusal?: { code: string; params?: Record<string, unknown> };
  @state() private draft: Draft = empty();
  @state() private attempted = false;
  private scope?: DraftScope<Draft>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private periodId?: string;
  private baseline?: Draft;
  private generation = {};
  private submittedGeneration?: object;
  private submitted?: Draft;

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
  protected override willUpdate() {
    if (!this.open) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = undefined;
      this.baseline = undefined;
      this.generation = {};
      return;
    }
    if (!this.identity || this.periodId !== this.period?.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = {};
      this.periodId = this.period?.id;
      this.generation = {};
      this.draft = this.period
        ? {
            name: this.period.name,
            colour: this.period.colour,
            menuId: this.period.menuId,
            staffMenuIds: [...this.period.staffMenuIds],
          }
        : empty(this.usedColours);
      this.baseline = copy(this.input);
      this.attempted = false;
      this.refusal = undefined;
      this.submitted = undefined;
    }
    if (this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this.identity,
        current: () => this.input,
        snapshot: copy,
        equal: (a, b) =>
          a.name === b.name &&
          a.colour === b.colour &&
          a.menuId === b.menuId &&
          a.staffMenuIds.length === b.staffMenuIds.length &&
          a.staffMenuIds.every((id) => b.staffMenuIds.includes(id)),
        restore: (value) => {
          this.draft = copy(value);
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
  private get ownErrors(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (!this.input.name) errors.name = t("menu.name_required");
    if (!this.input.menuId) errors.menuId = t("menu.menu_required");
    if (!CALENDAR_COLOURS.includes(this.input.colour)) errors.colour = t("hours.colour_required");
    return errors;
  }
  private refusalField(): Field | undefined {
    const refusal = this.refusal;
    if (!refusal) return undefined;
    if (refusal.code === "menu_period.name_taken") return "name";
    const field = refusal.params?.field;
    if (
      (refusal.code === "menu_period.invalid" ||
        refusal.code === "menu_timetable.invalid" ||
        refusal.code === "management.request_invalid") &&
      fields.includes(field as Field)
    )
      return field as Field;
    if (refusal.code === "catalogue.not_found") {
      const id = refusal.params?.catalogueId;
      const submitted = this.submitted ?? this.input;
      if (id === submitted.menuId) return "menuId";
      if (submitted.staffMenuIds.includes(id as string)) return "staffMenuIds";
    }
    return undefined;
  }
  private error(field: Field): string {
    if (this.refusalField() === field) {
      if (this.refusal?.code === "menu_period.name_taken") return t("menu.name_taken");
      if (this.refusal?.code === "catalogue.not_found") return t("opening.active_menus_required");
      return t("menu.field_refused");
    }
    return this.attempted ? (this.ownErrors[field] ?? "") : "";
  }
  private changed(field: Field, value: string | readonly string[]) {
    this.draft = { ...this.draft, [field]: value };
    if (field === "menuId")
      this.draft = {
        ...this.draft,
        staffMenuIds: this.draft.staffMenuIds.filter((id) => id !== value),
      };
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
    this.submitted = copy(this.input);
    this.dispatchEvent(
      new CustomEvent("period-save", {
        detail: { periodId: this.period?.id ?? null, input: copy(this.input) },
        bubbles: true,
        composed: true,
      }),
    );
  }
  commitSubmitted(input: MenuPeriodInput): boolean {
    if (!this.open || !this.isConnected || this.submittedGeneration !== this.generation)
      return false;
    const submitted = { ...input, colour: input.colour ?? this.submitted!.colour };
    this.baseline = copy(submitted);
    this.scope?.commit(submitted);
    return !this.scope?.isDirty();
  }
  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.isConnected && generation === this.generation && outcome === "proceeded";
  };
  private menuOptions(exclude?: string) {
    return this.menus
      .filter((menu) => menu.active && menu.id !== exclude)
      .map((menu) => ({
        value: menu.id,
        label: menu.includes.length
          ? format("opening.menu_includes", {
              name: menu.name,
              menus: menu.includes
                .map((id) => this.menus.find((item) => item.id === id)?.name ?? id)
                .join(", "),
            })
          : menu.name,
      }));
  }
  override render(): unknown {
    if (!this.open) return nothing;
    const s = saveActionState(this.scope);
    const marked = fields.some((field) => this.error(field));
    const bottom =
      this.refusal && this.refusalField() === undefined
        ? this.refusal.code === "menu_period.not_found"
          ? t("menu.period_gone")
          : this.refusal.code === "department.not_found"
            ? t("menu.department_gone")
            : t("menu.save_error")
        : "";
    const generation = this.generation;
    const current = () =>
      generation === this.generation && this.isConnected && this.open && !this.busy;
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${this.period ? format("menu.edit_period_heading", { name: this.period.name }) : format("menu.add_period_heading", { department: this.departmentName })}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!current()) return;
          this.open = false;
          this.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (current())
            submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-period]"));
        }}
      >
        <div class="form">
          <wt-input
            name="name"
            label=${t("menu.period_name")}
            required
            .value=${this.draft.name}
            .error=${this.error("name")}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current()) this.changed("name", event.detail.value);
            }}
          ></wt-input>
          <wt-combobox
            name="colour"
            label=${t("hours.colour")}
            search="never"
            .value=${this.draft.colour}
            .error=${this.error("colour")}
            ?disabled=${this.busy}
            .options=${CALENDAR_COLOURS.map((colour) => ({ value: colour, label: t(`hours.colour.${colour}`) }))}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current()) this.changed("colour", event.detail.value);
            }}
          ></wt-combobox>
          <wt-combobox
            name="menuId"
            label=${t("menu.period_menu")}
            required
            .value=${this.draft.menuId}
            .options=${this.menuOptions()}
            .error=${this.error("menuId")}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current()) this.changed("menuId", event.detail.value);
            }}
          ></wt-combobox>
          <wt-combobox
            name="staffMenuIds"
            label=${t("opening.staff_menus")}
            multiple
            .values=${this.draft.staffMenuIds}
            .options=${this.menuOptions(this.draft.menuId)}
            .error=${this.error("staffMenuIds")}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
              event.stopPropagation();
              if (current()) this.changed("staffMenuIds", [...event.detail.values]);
            }}
          ></wt-combobox>
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
            data-test="save-period"
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
    "period-editor": PeriodEditor;
  }
}
