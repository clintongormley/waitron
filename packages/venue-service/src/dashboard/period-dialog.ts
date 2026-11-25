import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  bottomMessage,
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
import "@waitron/ui/src/components/wt-colour-chooser.js";
import { CALENDAR_COLOURS, type CalendarColour } from "../hours-types.js";
import { LAST_ORDER_MINUTES } from "../menu-timetable-rules.js";
import type {
  LastOrderAdjustment,
  LastOrderChoice,
  MenuPeriodInput,
  OpeningHoursModel,
} from "../menu-timetable-types.js";
import { parseTargetKey, targetKey } from "../routing.js";
import type { PaintedIn } from "../period-delete.js";
import type { PeriodFloorPlans } from "../floor-plan-set-types.js";
import {
  firstUnusedCalendarColour,
  NO_COLOUR_USERS,
  rememberedColourChoices,
  type ColourUser,
} from "./calendar-colours.js";
import { format } from "./hours-view.js";
import { periodsPath, seasonPainterPath, specialDayPainterPath } from "./opening-hours-paths.js";
import { seasonTints, seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";

type Draft = Omit<MenuPeriodInput, "floorPlanSetId" | "lastOrders"> & {
  lastOrders: readonly LastOrderAdjustment[];
  colour: CalendarColour;
  /** Empty inherits the department's current default. */
  floorPlanSetId: string;
  /** Empty unless the dialog asks for the department. */
  departmentId: string;
};
type Department = { id: string; name: string; colourUsers: readonly ColourUser[] };
type Field = keyof Draft;
const copy = (value: Draft): Draft => ({ ...value, staffMenuIds: [...value.staffMenuIds] });
const sameLastOrders = (a: Draft["lastOrders"], b: Draft["lastOrders"]) =>
  a.length === b.length &&
  a.every((left) =>
    b.some((right) => targetKey(left) === targetKey(right) && left.minutes === right.minutes),
  );
function adjustmentLabel(minutes: number): string {
  if (minutes === 0) return t("period.last_orders_at_end");
  const magnitude = Math.abs(minutes);
  const duration =
    magnitude < 60
      ? format("period.last_orders_minutes", { minutes: String(magnitude) })
      : t(
          magnitude === 60
            ? "period.last_orders_hour"
            : magnitude === 90
              ? "period.last_orders_hour_half"
              : "period.last_orders_two_hours",
        );
  return format(minutes < 0 ? "period.last_orders_before" : "period.last_orders_after", {
    duration,
  });
}
const empty = (users: readonly ColourUser[] = NO_COLOUR_USERS): Draft => ({
  name: "",
  colour: firstUnusedCalendarColour(users),
  menuId: "",
  staffMenuIds: [],
  lastOrders: [],
  floorPlanSetId: "",
  departmentId: "",
});
const fields: Field[] = [
  "departmentId",
  "name",
  "colour",
  "menuId",
  "staffMenuIds",
  "floorPlanSetId",
];

@customElement("period-dialog")
export class PeriodDialog extends LitElement {
  static override styles = [
    baseStyles,
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
      .last-orders {
        display: grid;
        gap: var(--wt-space-3);
      }
      .last-orders-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      .last-orders h3 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-normal);
      }
      .last-orders a {
        color: var(--wt-color-primary-text);
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
        text-decoration: none;
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
  @property({ type: Boolean }) page = false;
  @property({ type: Boolean }) busy = false;
  @property() departmentName = "";
  /** The submit button's text; Save when empty. */
  @property() submitLabel = "";
  @property({ attribute: false }) draftParent?: object;
  @property({ attribute: false })
  period?: OpeningHoursModel["departments"][number]["periods"][number];
  @property({ attribute: false }) menus: OpeningHoursModel["menus"] = [];
  /** The department's other periods; their colours are marked as used. */
  @property({ attribute: false }) colourUsers: readonly ColourUser[] = [];
  @property({ attribute: false }) refusal?: { code: string; params?: Record<string, unknown> };
  /** Where the period is painted; absent draws no Painted in. */
  @property({ attribute: false }) paintedIn?: PaintedIn;
  @property({ attribute: false }) seasons: readonly { id: string; colour: string }[] = [];
  @property() departmentId = "";
  @property({ type: Boolean }) paintedInLinks = false;
  /** Given when adding without a fixed department, so the dialog asks for one. */
  @property({ attribute: false }) departments?: readonly Department[];
  /** The departments that offer a Floor plan field, with their sets; absent draws none. */
  @property({ attribute: false }) floorPlans?: PeriodFloorPlans["departments"];
  @property({ attribute: false }) watchLastOrderChoices?: OpeningHoursApi["watchLastOrderChoices"];
  @state() private lastOrderChoices?: readonly LastOrderChoice[];
  @state() private lastOrderReadFailed = false;
  private lastOrderRead?: {
    key: string;
    watch: NonNullable<PeriodDialog["watchLastOrderChoices"]>;
    stop?: () => void;
  };
  @state() private draft: Draft = empty();
  private colourPicked = false;
  private readonly feedback = new FormFeedback(this);
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
    this.stopLastOrderRead();
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    if (!this.open) {
      this.stopLastOrderRead();
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
            lastOrders: this.period.lastOrders ?? [],
            floorPlanSetId: this.period.floorPlanSetId ?? "",
            departmentId: "",
          }
        : this.departments?.length === 1
          ? { ...empty(this.departments[0]!.colourUsers), departmentId: this.departments[0]!.id }
          : empty(this.colourUsers);
      this.colourPicked = false;
      this.baseline = copy(this.input);
      this.feedback.reset();
      this.refusal = undefined;
      this.submitted = undefined;
    }
    if (this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this.identity,
        parent: this.draftParent,
        current: () => this.input,
        snapshot: copy,
        equal: (a, b) => this.samePeriodFields(a, b) && sameLastOrders(a.lastOrders, b.lastOrders),
        restore: (value) => {
          this.draft = copy(value);
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
    this.syncLastOrderRead();
  }
  private stopLastOrderRead() {
    const read = this.lastOrderRead;
    this.lastOrderRead = undefined;
    read?.stop?.();
    this.lastOrderChoices = undefined;
    this.lastOrderReadFailed = false;
  }
  private syncLastOrderRead() {
    const watch = this.watchLastOrderChoices;
    const departmentId = this.choosesDepartment ? this.draft.departmentId : this.departmentId;
    const { menuId, staffMenuIds } = this.draft;
    if (!this.isConnected || !this.open || !watch || !departmentId || !menuId) {
      this.stopLastOrderRead();
      return;
    }
    const periodId = this.period?.id;
    const sortedStaffMenus = [...staffMenuIds].sort();
    const key = JSON.stringify([departmentId, periodId, menuId, sortedStaffMenus]);
    if (this.lastOrderRead?.key === key && this.lastOrderRead.watch === watch) return;
    this.stopLastOrderRead();
    const read: NonNullable<PeriodDialog["lastOrderRead"]> = { key, watch };
    this.lastOrderRead = read;
    read.stop = watch(
      { departmentId, periodId, menuId, staffMenuIds: sortedStaffMenus },
      (choices) => {
        if (this.lastOrderRead !== read) return;
        this.lastOrderChoices = choices;
        this.lastOrderReadFailed = false;
      },
      () => {
        if (this.lastOrderRead !== read) return;
        this.lastOrderChoices = undefined;
        this.lastOrderReadFailed = true;
      },
    );
  }
  private samePeriodFields(a: Draft, b: Draft): boolean {
    return (
      a.name === b.name &&
      a.colour === b.colour &&
      a.menuId === b.menuId &&
      a.floorPlanSetId === b.floorPlanSetId &&
      a.departmentId === b.departmentId &&
      a.staffMenuIds.length === b.staffMenuIds.length &&
      a.staffMenuIds.every((id) => b.staffMenuIds.includes(id))
    );
  }
  private get onlyWaitingLastOrders(): boolean {
    const saved = this.baseline;
    const draft = this.input;
    return (
      saved !== undefined &&
      this.lastOrderChoices === undefined &&
      this.samePeriodFields(saved, draft) &&
      !sameLastOrders(saved.lastOrders, draft.lastOrders)
    );
  }
  private get saveState() {
    return saveActionState(this.onlyWaitingLastOrders ? undefined : this.scope);
  }
  private get input(): Draft {
    return { ...this.draft, name: this.draft.name.trim() };
  }
  private get shownColourUsers(): readonly ColourUser[] {
    if (!this.choosesDepartment) return this.colourUsers;
    return (
      this.departments!.find(({ id }) => id === this.draft.departmentId)?.colourUsers ??
      NO_COLOUR_USERS
    );
  }
  private readonly colourChoices = rememberedColourChoices((colour) => t(`hours.colour.${colour}`));
  private readonly usedByLabel = (colour: string, names: string) =>
    format("hours.colour_used_by", { colour, names });
  private get floorPlanSets() {
    const departmentId = this.choosesDepartment ? this.draft.departmentId : this.departmentId;
    const sets = this.floorPlans?.find(({ id }) => id === departmentId)?.sets ?? [];
    const fallback = sets.find(({ isDefault }) => isDefault);
    if (!fallback) return undefined;
    return { fallback, sets };
  }
  private get choosesDepartment() {
    return !this.period && this.departments !== undefined;
  }
  private get ownErrors(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (
      this.choosesDepartment &&
      !this.departments!.some(({ id }) => id === this.input.departmentId)
    )
      errors.departmentId = t("period.department_required");
    if (!this.input.name) errors.name = t("menu.name_required");
    if (!this.input.menuId) errors.menuId = t("menu.menu_required");
    if (!CALENDAR_COLOURS.includes(this.input.colour)) errors.colour = t("hours.colour_required");
    return errors;
  }
  private refusalField(): Field | undefined {
    const refusal = this.refusal;
    if (!refusal) return undefined;
    if (refusal.code === "menu_period.name_taken") return "name";
    if (
      refusal.code === "department.not_found" &&
      refusal.params?.departmentId === (this.submitted ?? this.input).departmentId
    )
      return "departmentId";
    const field = refusal.params?.field;
    if (
      (refusal.code === "menu_period.invalid" ||
        refusal.code === "menu_timetable.invalid" ||
        refusal.code === "management.request_invalid") &&
      fields.includes(field as Field) &&
      (field !== "floorPlanSetId" || this.floorPlanSets !== undefined)
    )
      return field as Field;
    if (refusal.code === "menu.not_found") {
      const id = refusal.params?.menuId;
      const submitted = this.submitted ?? this.input;
      if (id === submitted.menuId) return "menuId";
      if (submitted.staffMenuIds.includes(id as string)) return "staffMenuIds";
    }
    return undefined;
  }
  private error(field: Field): string {
    if (this.refusalField() === field) {
      if (this.refusal?.code === "menu_period.name_taken") return t("menu.name_taken");
      if (this.refusal?.code === "menu.not_found") return t("opening.active_menus_required");
      if (this.refusal?.code === "department.not_found") return t("menu.department_gone");
      if (field === "floorPlanSetId") return t("floor_plans.set_gone");
      return t("menu.field_refused");
    }
    return this.feedback.attempted ? (this.ownErrors[field] ?? "") : "";
  }
  private changed(field: Field, value: string | readonly string[]) {
    this.draft = { ...this.draft, [field]: value };
    if (field === "menuId")
      this.draft = {
        ...this.draft,
        staffMenuIds: this.draft.staffMenuIds.filter((id) => id !== value),
      };
    if (field === "colour") this.colourPicked = true;
    if (field === "departmentId") this.draft = { ...this.draft, floorPlanSetId: "" };
    if (field === "departmentId" && !this.colourPicked)
      this.draft = { ...this.draft, colour: firstUnusedCalendarColour(this.shownColourUsers) };
    if (field === "departmentId" || field === "menuId" || field === "staffMenuIds")
      this.syncLastOrderRead();
    if (this.refusalField() === field) this.refusal = undefined;
    this.scope?.changed();
  }
  private save() {
    if (!this.open || !this.isConnected || this.busy || this.saveState.unchanged) return;
    this.feedback.press();
    this.refusal = undefined;
    if (Object.keys(this.ownErrors).length) {
      void this.feedback.focus(this.shadowRoot!);
      return;
    }
    this.submittedGeneration = this.generation;
    this.submitted = copy(this.input);
    const { departmentId, floorPlanSetId, lastOrders, ...input } = this.submitted;
    const savedLastOrders = this.baseline!.lastOrders;
    const shown =
      !sameLastOrders(lastOrders, savedLastOrders) &&
      this.lastOrderChoices &&
      new Set(this.lastOrderChoices.map(targetKey));
    const selected = shown
      ? [
          ...lastOrders.filter((entry) => shown.has(targetKey(entry))),
          ...savedLastOrders.filter((entry) => !shown.has(targetKey(entry))),
        ]
      : undefined;
    this.dispatchEvent(
      new CustomEvent("period-save", {
        detail: {
          periodId: this.period?.id ?? null,
          input: {
            ...input,
            ...(selected === undefined ? {} : { lastOrders: selected }),
            ...(this.floorPlanSets ? { floorPlanSetId: floorPlanSetId || null } : {}),
          },
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
    const lastOrders = input.lastOrders ?? this.baseline!.lastOrders;
    // Close Add with a clean draft after the POST, even when it could not send the times.
    if (
      !this.period ||
      (input.lastOrders !== undefined &&
        sameLastOrders(this.draft.lastOrders, this.submitted!.lastOrders))
    )
      this.draft = { ...this.draft, lastOrders };
    const submitted: Draft = {
      ...input,
      lastOrders,
      colour: input.colour ?? this.submitted!.colour,
      floorPlanSetId:
        input.floorPlanSetId === undefined
          ? this.submitted!.floorPlanSetId
          : (input.floorPlanSetId ?? ""),
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
  async requestClose(): Promise<boolean> {
    if (!this.page) {
      return this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    }
    if (!(await this.beforeClose("navigation"))) return false;
    this.dispatchEvent(new CustomEvent("period-close", { bubbles: true, composed: true }));
    return true;
  }
  private paintedInSection() {
    const painted = this.paintedIn;
    if (!this.period || !painted) return nothing;
    const tints = seasonTints(this.seasons);
    const links = this.paintedInLinks && this.departmentId !== "";
    const chip = (text: string, href: string, special: boolean, tint?: string) =>
      links
        ? html`<a
            class="chip"
            data-painted-in
            href=${`${href}?back=${periodsPath}`}
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
                  seasonPainterPath({ seasonId: season.id, departmentId: this.departmentId }),
                  false,
                  tints.get(season.id),
                ),
              )}
              ${painted.specialDays.map((day) =>
                chip(day.name, specialDayPainterPath({ specialDayId: day.id }), true),
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
  private floorPlanField(current: () => boolean) {
    const sets = this.floorPlanSets;
    if (!sets) return nothing;
    return html`<wt-combobox
      name="floorPlanSetId"
      label=${t("period.floor_plan")}
      search="never"
      inherited-suffix=${t("routing.inherited")}
      .value=${this.draft.floorPlanSetId}
      .options=${[
        {
          value: "",
          label: format("inherit.value", { value: sets.fallback.name }),
          valueLabel: sets.fallback.name,
          inherited: true as const,
        },
        ...sets.sets.map(({ id, name }) => ({ value: id, label: name })),
      ]}
      .error=${this.error("floorPlanSetId")}
      ?disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (current()) this.changed("floorPlanSetId", event.detail.value);
      }}
    ></wt-combobox>`;
  }
  private lastOrdersSection(current: () => boolean) {
    if (!this.lastOrderChoices?.length) return nothing;
    const options = LAST_ORDER_MINUTES.map((minutes) => ({
      value: String(minutes),
      label: adjustmentLabel(minutes),
    }));
    return html`<section class="last-orders" aria-labelledby="last-orders-heading">
      <div class="last-orders-heading">
        <h3 id="last-orders-heading">${t("period.last_orders")}</h3>
        <a href="/prep-stations/view/routing">${t("nav.prep_stations")}</a>
      </div>
      ${repeat(this.lastOrderChoices, targetKey, (choice) => {
        const key = targetKey(choice);
        const field = choice.kind === "station" ? choice.stationId : "noPreparation";
        const entry = this.draft.lastOrders.find((entry) => targetKey(entry) === key);
        return html`<wt-combobox
          name=${`lastOrders.${field}`}
          label=${choice.name ?? t("prep.no_preparation")}
          search="never"
          preserve-order
          .options=${options}
          .value=${String(entry?.minutes ?? 0)}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (!current() || !this.lastOrderChoices?.includes(choice)) return;
            const minutes = Number(event.detail.value);
            if (!LAST_ORDER_MINUTES.includes(minutes)) return;
            const lastOrders = this.draft.lastOrders.filter((entry) => targetKey(entry) !== key);
            if (minutes !== 0) lastOrders.push({ ...parseTargetKey(key)!, minutes });
            this.draft = { ...this.draft, lastOrders };
            this.scope?.changed();
          }}
        ></wt-combobox>`;
      })}
    </section>`;
  }
  override render(): unknown {
    if (!this.open) return nothing;
    const s = this.saveState;
    const marked = fields.some((field) => this.error(field));
    const bottom =
      this.refusal && this.refusalField() === undefined
        ? this.refusal.code === "menu_period.not_found"
          ? t("menu.period_gone")
          : this.refusal.code === "department.not_found"
            ? t("menu.department_gone")
            : t("menu.save_error")
        : "";
    const includes = this.menus.find((menu) => menu.id === this.draft.menuId)?.includes ?? [];
    const generation = this.generation;
    const current = () =>
      generation === this.generation && this.isConnected && this.open && !this.busy;
    const form = html`
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
        <wt-colour-chooser
          name="colour"
          label=${t("hours.colour")}
          required
          .value=${this.draft.colour}
          .choices=${this.colourChoices(this.shownColourUsers)}
          .usedByLabel=${this.usedByLabel}
          .error=${this.error("colour")}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (current()) this.changed("colour", event.detail.value);
          }}
        ></wt-colour-chooser>
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
        ${this.floorPlanField(current)} ${this.lastOrdersSection(current)}
        ${this.paintedInSection()}
      </div>
      <wt-form-actions
        slot=${this.page ? nothing : "footer"}
        .error=${bottomMessage(
          bottom,
          marked ? t("menu.fix_fields") : "",
          this.lastOrderReadFailed ? t("period.last_orders_read_failed") : "",
        )}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => {
            if (current()) void this.requestClose();
          }}
          >${t("menu.cancel")}</wt-button
        >

        <wt-button
          data-test="save-period"
          variant=${s.variant}
          ?disabled=${s.unchanged || this.busy || (this.feedback.attempted && Object.keys(this.ownErrors).length > 0)}
          ?loading=${this.busy}
          @click=${() => {
            if (current()) this.save();
          }}
          >${this.submitLabel || t("menu.save")}</wt-button
        >
      </wt-form-actions>
    `;
    if (this.page)
      return keyed(
        generation,
        html`<div
          @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-period]"))}
        >
          ${form}
        </div>`,
      );
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
        ${form}
      </wt-modal>`,
    );
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "period-dialog": PeriodDialog;
  }
}
