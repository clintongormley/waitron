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
import { periodColourStyles } from "./period-colour-styles.js";
import { seasonTints, seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";

type Draft = Omit<MenuPeriodInput, "endOffsetMinutes"> & {
  colour: CalendarColour;
  endOffsetMinutes: string;
  /** Empty unless the dialog asks for the department. */
  departmentId: string;
};
type Department = { id: string; name: string; usedColours: readonly CalendarColour[] };
const offsetNumber = (text: string): number | undefined =>
  /^[+-]?\d+$/.test(text) ? Number(text) : undefined;
type Field = keyof Draft;
const copy = (value: Draft): Draft => ({ ...value, staffMenuIds: [...value.staffMenuIds] });
const unused = (usedColours: readonly CalendarColour[]) =>
  CALENDAR_COLOURS.find((colour) => !usedColours.includes(colour)) ?? CALENDAR_COLOURS[0];
const empty = (usedColours: readonly CalendarColour[] = []): Draft => ({
  name: "",
  colour: unused(usedColours),
  menuId: "",
  staffMenuIds: [],
  endOffsetMinutes: "0",
  departmentId: "",
});
const fields: Field[] = [
  "departmentId",
  "name",
  "colour",
  "menuId",
  "staffMenuIds",
  "endOffsetMinutes",
];

@customElement("period-dialog")
export class PeriodDialog extends LitElement {
  static override styles = [
    baseStyles,
    periodColourStyles,
    seasonTintStyles,
    css`
      :host {
        display: block;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
      fieldset {
        display: grid;
        gap: var(--wt-space-2);
        border: none;
        margin: 0;
        padding: 0;
      }
      legend {
        padding: 0;
      }
      [role="radiogroup"] {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .swatch {
        width: var(--wt-space-6);
        height: var(--wt-space-6);
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--period-fill);
        cursor: pointer;
      }
      .swatch[aria-checked="true"] {
        outline: var(--wt-selected-ring);
        outline-offset: var(--wt-focus-offset);
      }
      [data-test="colour-error"] {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .painted {
        display: grid;
        gap: var(--wt-space-2);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .chip {
        padding: var(--wt-space-1) var(--wt-space-3);
        border: 1px solid var(--wt-color-palette-purple);
        border-radius: var(--wt-radius-full);
        color: var(--wt-color-text);
      }
      .chip[data-tint] {
        background: var(--season-tint);
        color: var(--season-on-tint);
        border-color: var(--season-tint-line);
      }
      [data-test="not-painted"] {
        color: var(--wt-color-warning);
      }
      [data-test="menu-includes"] {
        margin: calc(-1 * var(--wt-space-3)) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property() departmentName = "";
  /** The submit button's text; Save when empty. */
  @property() submitLabel = "";
  @property({ attribute: false })
  period?: OpeningHoursModel["departments"][number]["periods"][number];
  @property({ attribute: false }) menus: OpeningHoursModel["menus"] = [];
  @property({ attribute: false }) usedColours: readonly CalendarColour[] = [];
  @property({ attribute: false }) refusal?: { code: string; params?: Record<string, unknown> };
  /** Where the period is painted; absent draws no Painted in. */
  @property({ attribute: false }) paintedIn?: {
    seasons: readonly { id: string; name: string }[];
    specialDays: readonly { id: string; name: string }[];
  };
  @property({ attribute: false }) seasons: readonly { id: string; startsOn: string }[] = [];
  @property() departmentId = "";
  @property({ type: Boolean }) paintedInLinks = false;
  @property({ type: Boolean }) deletable = false;
  /** Given when adding without a fixed department, so the dialog asks for one. */
  @property({ attribute: false }) departments?: readonly Department[];
  @state() private draft: Draft = empty();
  private colourPicked = false;
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
            endOffsetMinutes: String(this.period.endOffsetMinutes),
            departmentId: "",
          }
        : this.departments?.length === 1
          ? { ...empty(this.departments[0]!.usedColours), departmentId: this.departments[0]!.id }
          : empty(this.usedColours);
      this.colourPicked = false;
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
          a.endOffsetMinutes === b.endOffsetMinutes &&
          a.departmentId === b.departmentId &&
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
    const offset = offsetNumber(this.draft.endOffsetMinutes);
    return {
      ...this.draft,
      name: this.draft.name.trim(),
      endOffsetMinutes: offset === undefined ? this.draft.endOffsetMinutes : String(offset),
    };
  }
  private get choosesDepartment() {
    return !this.period && this.departments !== undefined;
  }
  private get ownErrors(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (this.choosesDepartment && !this.input.departmentId)
      errors.departmentId = t("period.department_required");
    if (!this.input.name) errors.name = t("menu.name_required");
    if (!this.input.menuId) errors.menuId = t("menu.menu_required");
    if (!CALENDAR_COLOURS.includes(this.input.colour)) errors.colour = t("hours.colour_required");
    const offset = offsetNumber(this.draft.endOffsetMinutes);
    if (offset === undefined || !Number.isSafeInteger(offset) || Math.abs(offset) > 1439)
      errors.endOffsetMinutes = t("menu.offset_invalid");
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
      if (field === "endOffsetMinutes" && this.refusal?.params?.reason === "placement")
        return t("menu.offset_placement");
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
    if (field === "colour") this.colourPicked = true;
    if (field === "departmentId" && !this.colourPicked) {
      const department = this.departments?.find((entry) => entry.id === value);
      this.draft = {
        ...this.draft,
        colour: unused(department ? department.usedColours : this.usedColours),
      };
    }
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
    const { departmentId, ...input } = copy(this.input);
    this.dispatchEvent(
      new CustomEvent("period-save", {
        detail: {
          periodId: this.period?.id ?? null,
          input: { ...input, endOffsetMinutes: offsetNumber(this.draft.endOffsetMinutes)! },
          ...(this.choosesDepartment ? { departmentId } : {}),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  commitSubmitted(input: MenuPeriodInput): boolean {
    if (!this.open || !this.isConnected || this.submittedGeneration !== this.generation)
      return false;
    const submitted: Draft = {
      ...input,
      colour: input.colour ?? this.submitted!.colour,
      endOffsetMinutes: String(input.endOffsetMinutes ?? this.submitted!.endOffsetMinutes),
      departmentId: this.submitted!.departmentId,
    };
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
  private async requestDelete(periodId: string) {
    const generation = this.generation;
    if (this.scope && this.leave) {
      const outcome = await this.leave.request({
        scopes: [this.scope.id],
        reason: "cancel",
        proceed() {},
      });
      if (outcome !== "proceeded") return;
    }
    if (!this.isConnected || !this.open || this.busy || generation !== this.generation) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
    this.dispatchEvent(
      new CustomEvent("period-delete", { detail: { periodId }, bubbles: true, composed: true }),
    );
  }
  private paintedInSection() {
    const painted = this.paintedIn;
    if (!this.period || !painted) return nothing;
    const tints = seasonTints(this.seasons);
    const chip = (text: string, href: string, special: boolean, tint?: string) =>
      this.paintedInLinks
        ? html`<a
            class="chip"
            href=${href}
            data-tint=${tint || nothing}
            ?data-special-day=${special}
            >${text}</a
          >`
        : html`<span class="chip" data-tint=${tint || nothing} ?data-special-day=${special}
            >${text}</span
          >`;
    return html`<div
      class="painted"
      data-test="painted-in"
      role="group"
      aria-labelledby="painted-in-label"
    >
      <span id="painted-in-label">${t("period.painted_in")}</span>
      ${
        painted.seasons.length || painted.specialDays.length
          ? html`<div class="chips">
              ${painted.seasons.map((season) =>
                chip(
                  season.name,
                  `/manage/opening-hours/view/season/season/${encodeURIComponent(season.id)}/department/${encodeURIComponent(this.departmentId)}`,
                  false,
                  tints.get(season.id),
                ),
              )}
              ${painted.specialDays.map((day) =>
                chip(
                  day.name,
                  `/manage/opening-hours/view/special-day/special-day/${encodeURIComponent(day.id)}`,
                  true,
                ),
              )}
            </div>`
          : html`<span data-test="not-painted">${t("period.not_painted")}</span>`
      }
    </div>`;
  }
  private menuOptions(exclude?: string) {
    return this.menus
      .filter((menu) => menu.active && menu.id !== exclude)
      .map((menu) => ({ value: menu.id, label: menu.name }));
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
    const colourError = this.error("colour");
    const includes = this.menus.find((menu) => menu.id === this.draft.menuId)?.includes ?? [];
    const generation = this.generation;
    const current = () =>
      generation === this.generation && this.isConnected && this.open && !this.busy;
    return keyed(
      generation,
      html`<wt-modal
        open
        size="compact"
        heading=${this.choosesDepartment ? t("period.add") : format(this.period ? "period.edit_heading" : "period.add_heading", { department: this.departmentName })}
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
          ${
            this.choosesDepartment
              ? html`<wt-combobox
                  name="departmentId"
                  label=${t("menu.department")}
                  required
                  .value=${this.draft.departmentId}
                  .options=${this.departments!.map((department) => ({ value: department.id, label: department.name }))}
                  .error=${this.error("departmentId")}
                  ?disabled=${this.busy}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    if (current()) this.changed("departmentId", event.detail.value);
                  }}
                ></wt-combobox>`
              : nothing
          }
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
          <fieldset name="colour">
            <legend>${t("hours.colour")}</legend>
            <div
              role="radiogroup"
              aria-label=${t("hours.colour")}
              aria-invalid=${colourError ? "true" : "false"}
              aria-describedby="colour-error"
            >
              ${CALENDAR_COLOURS.map(
                (colour, index) =>
                  html`<button
                    type="button"
                    class="swatch"
                    role="radio"
                    aria-checked=${this.draft.colour === colour ? "true" : "false"}
                    aria-label=${t(`hours.colour.${colour}`)}
                    aria-invalid=${colourError && index === 0 ? "true" : nothing}
                    data-colour=${colour}
                    ?disabled=${this.busy}
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      if (current()) this.changed("colour", colour);
                    }}
                  ></button>`,
              )}
            </div>
            <span id="colour-error" data-test="colour-error">${colourError}</span>
          </fieldset>
          <wt-combobox
            name="menuId"
            label=${t("period.customer_menu")}
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
          ${
            includes.length
              ? html`<p data-test="menu-includes">
                  ${format("period.includes", { menus: includes.join(", ") })}
                </p>`
              : nothing
          }
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
          <wt-input
            name="endOffsetMinutes"
            label=${t("menu.end_offset")}
            required
            .value=${this.draft.endOffsetMinutes}
            .error=${this.error("endOffsetMinutes")}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current()) this.changed("endOffsetMinutes", event.detail.value);
            }}
          ></wt-input>
          <p data-test="offset-explanation">${t("menu.offset_explanation")}</p>
          ${
            this.period || !this.submitLabel
              ? html`<wt-combobox
                  name="floorPlanId"
                  label=${t("period.floor_plan")}
                  placeholder=${t("period.floor_plan_later")}
                  disabled
                ></wt-combobox>`
              : nothing
          }
          ${this.paintedInSection()}
          ${
            this.period && this.deletable
              ? html`<div>
                  <wt-button
                    data-test="delete-period"
                    variant="secondary"
                    ?disabled=${this.busy}
                    @click=${() => {
                      if (current()) void this.requestDelete(this.period!.id);
                    }}
                    >${t("period.delete_ellipsis")}</wt-button
                  >
                </div>`
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
            data-test="save-period"
            variant=${s.variant}
            ?disabled=${s.unchanged || this.busy || (this.attempted && Object.keys(this.ownErrors).length > 0)}
            ?loading=${this.busy}
            @click=${() => {
              if (current()) this.save();
            }}
            >${this.submitLabel || t("menu.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "period-dialog": PeriodDialog;
  }
}
