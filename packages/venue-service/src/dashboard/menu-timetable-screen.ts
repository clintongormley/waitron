import { codeOf } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  visuallyHiddenStyles,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { MenuUse } from "../errors.js";
import { repeatedTimes } from "../hours-occurrences.js";
import { isLocalDate, weekdayOf } from "../hours-rules.js";
import { WEEK_DISPLAY_ORDER } from "../hours-types.js";
import type {
  MenuPeriod,
  MenuPeriodUse,
  MenuSlot,
  MenuTimetableDepartment,
  MenuTimetableModel,
  MenuTimetableSpecialDate,
} from "../menu-timetable-types.js";
import { format, formatDate, unbrokenRanges } from "./hours-view.js";
import type { MenuTimetableApi } from "./menu-timetable-client.js";
import {
  slotChecks,
  slotDraftOf,
  weekSlotChecks,
  wireSlots,
  type MenuSlotEditor,
  type SlotDraft,
} from "./menu-slot-editor.js";
import "./menu-slot-editor.js";
import { t } from "./strings.js";

type Key = Parameters<typeof t>[0];
type Department = MenuTimetableDepartment;
type ReturnTo = () => HTMLElement | null | undefined;

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const DATE_PREFIX = "date";
const ALL_DAY = "all-day";

type Editor = { departmentId: string } & (
  | { kind: "list"; draft: string[]; adding: string; inUse?: { menuId: string; uses: MenuUse[] } }
  | { kind: "period"; id: string | null; name: string; menuId: string }
  | { kind: "delete-period"; period: MenuPeriod; uses?: MenuPeriodUse[] }
  | { kind: "day"; weekday: number; draft: SlotDraft }
  | { kind: "date"; special: MenuTimetableSpecialDate; draft: SlotDraft; hadOwn: boolean }
  | {
      kind: "normal-week";
      special: { id: string; date: string };
      /** The editor whose refusal offered this, opened again, draft kept, once this is done. */
      resume?: Editor;
    }
);

const dayName = (weekday: number) => t(`hours.day.${weekday}` as Key);

/** "08:00–12:00 Mañanas, 13:00–16:00 Mediodía", or the all-day menu's words for no slots. */
function slotsText(department: Department, slots: readonly MenuSlot[]): string {
  if (slots.length === 0) return t("menu.no_slots");
  return slots
    .map(
      (slot) =>
        `${slot.startsAt}–${slot.endsAt} ${
          department.periods.find((period) => period.id === slot.periodId)?.name ?? ""
        }`,
    )
    .join(", ");
}

@customElement("dashboard-menu-timetable-screen")
export class MenuTimetableScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin-top: 0;
      }
      section {
        display: grid;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-5);
        min-width: 0;
      }
      h2 {
        margin: 0;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      .chooser {
        max-width: var(--wt-form-max-width);
      }
      .note {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      [role="alert"],
      .refusal {
        color: var(--wt-color-danger);
      }
      .refusal p {
        margin: 0;
      }
      .refusal ul {
        margin-block: var(--wt-space-2) 0;
      }
      .refusal li,
      .dated {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      ol.menus {
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }
      .grid-box {
        overflow-x: auto;
        max-width: 100%;
      }
      table {
        border-collapse: collapse;
        min-width: 100%;
      }
      th,
      td {
        border: 1px solid var(--wt-color-border);
        padding: var(--wt-space-1);
        text-align: start;
        vertical-align: middle;
      }
      thead th {
        background: var(--wt-color-surface-raised);
        white-space: nowrap;
      }
      tbody th {
        white-space: nowrap;
      }
      tr[aria-current] > th {
        color: var(--wt-color-primary-text);
      }
      .today {
        font-size: var(--wt-font-size-sm);
        font-weight: normal;
      }
      .cell,
      .value {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--wt-space-1);
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-1) var(--wt-space-2);
      }
      .range {
        white-space: nowrap;
      }
      .cell {
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-primary-text);
        text-decoration: underline;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .cell:hover {
        background: var(--wt-color-surface-lifted);
      }
      .cell:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
      }
      .value[data-muted],
      .inherited {
        color: var(--wt-color-text-muted);
      }
      .choice {
        white-space: nowrap;
      }
      table[data-test="zone-menus"] th:first-child {
        position: sticky;
        inset-inline-start: 0;
        z-index: 1;
      }
      table[data-test="zone-menus"] tbody th {
        background: var(--wt-color-bg);
      }
      td wt-combobox {
        display: block;
        min-width: var(--wt-price-range-field-width);
      }
      .visually-hidden,
      wt-data-table::part(visually-hidden) {
        ${visuallyHiddenStyles}
      }
      wt-data-table::part(inherited) {
        color: var(--wt-color-text-muted);
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
      }
      ol.draft {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .menu-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        padding-block: var(--wt-space-1);
        border-bottom: 1px solid var(--wt-color-border);
      }
      .menu-name {
        flex: 1 1 var(--wt-price-field-width);
        min-width: 0;
      }
      .row-buttons {
        display: flex;
        flex-wrap: nowrap;
        gap: var(--wt-space-1);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      .add {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .add wt-combobox {
        flex: 1 1 var(--wt-price-range-field-width);
      }
    `,
  ];

  @property({ attribute: false }) api!: MenuTimetableApi;
  /** A venue viewer reads the timetable; nothing on the page changes it. */
  @property({ type: Boolean }) readOnly = false;
  @state() private model?: MenuTimetableModel;
  @state() private departmentId = "";
  /** A failed read's message. An action's failure is said in its own editor or cell. */
  @state() private readError = "";
  @state() private editor?: Editor;
  @state() private attempted = false;
  /** The server's refusal of a field, until the operator changes that field or saves again. */
  @state() private refused: Record<string, string> = {};
  /** A refusal that names no field the editor shows, until the operator saves again. */
  @state() private bottomRefusal = "";
  @state() private busy = false;
  /** A refused zone-table choice's sentence, by its field name, until that choice is made again. */
  @state() private cellErrors: Record<string, string> = {};
  /** The zone-table choices whose saves are out. */
  @state() private cellsBusy: ReadonlySet<string> = new Set();

  #detach?: () => void;
  /** Each editor opened or closed is a new generation, drawn as a modal of its own. */
  #generation = 0;
  #returnTo?: ReturnTo;

  readonly #followUrl = (): void => {
    const asked = new URL(location.href).searchParams.get("departmentId");
    if (asked !== null && this.model?.departments.some((entry) => entry.id === asked))
      this.departmentId = asked;
    else if (asked !== null && this.model === undefined) this.departmentId = asked;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.#followUrl();
    window.addEventListener("popstate", this.#followUrl);
    this.#detach = this.api.watchTimetable(
      (model) => {
        this.model = model;
        this.readError = "";
      },
      () => {
        this.readError = t("menu.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("popstate", this.#followUrl);
    this.#detach?.();
  }

  /** The department shown: the one chosen or linked, else the first active one. */
  #department(): Department | undefined {
    const departments = this.model?.departments ?? [];
    return (
      departments.find((entry) => entry.id === this.departmentId) ??
      departments.find((entry) => entry.active) ??
      departments[0]
    );
  }

  #choose(departmentId: string): void {
    this.departmentId = departmentId;
    this.cellErrors = {};
    const url = new URL(location.href);
    url.searchParams.set("departmentId", departmentId);
    history.replaceState(history.state, "", url);
  }

  #menuName(id: string | null): string {
    return this.model!.menus.find((menu) => menu.id === id)?.name ?? "";
  }

  #periodName(department: Department, id: string): string {
    return department.periods.find((period) => period.id === id)?.name ?? "";
  }

  #zoneName(department: Department, id: string): string {
    return department.zones.find((zone) => zone.id === id)?.name ?? "";
  }

  /** The days a period is placed on, Monday first, then its special dates. */
  #daysText(uses: readonly MenuPeriodUse[]): string {
    const weekdays = uses.flatMap((use) => (use.kind === "week" ? [use.weekday] : []));
    return [
      ...WEEK_DISPLAY_ORDER.filter((weekday) => weekdays.includes(weekday)).map(dayName),
      ...uses.flatMap((use) => (use.kind === "special_date" ? [formatDate(use.date)] : [])),
    ].join(", ");
  }

  // --- Editors -------------------------------------------------------------------------------

  #open(editor: Editor, returnTo: ReturnTo): void {
    this.#generation++;
    this.#returnTo = returnTo;
    this.editor = editor;
    this.attempted = false;
    this.refused = {};
    this.bottomRefusal = "";
    this.busy = false;
  }

  #close(): void {
    this.#generation++;
    this.editor = undefined;
    this.attempted = false;
    this.refused = {};
    this.bottomRefusal = "";
    this.busy = false;
    const returnTo = this.#returnTo;
    void this.updateComplete.then(() => returnTo?.()?.focus());
  }

  #byTest(test: string): ReturnTo {
    return () => this.renderRoot.querySelector<HTMLElement>(`[data-test="${test}"]`);
  }

  #menuTrigger(event: Event): ReturnTo {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
    menu.hide();
    const trigger = menu.shadowRoot!.querySelector<HTMLElement>("button");
    return () => trigger;
  }

  /** Every field the editor's own checks find wrong, by field name. */
  #check(editor: Editor): Record<string, string> {
    switch (editor.kind) {
      case "period": {
        const errors: Record<string, string> = {};
        if (editor.name.trim() === "") errors.name = t("menu.name_required");
        if (editor.menuId === "") errors.menuId = t("menu.menu_required");
        return errors;
      }
      case "day": {
        const department = this.model!.departments.find(
          (entry) => entry.id === editor.departmentId,
        );
        const prefix = DAY_KEYS[editor.weekday]!;
        const week = DAY_KEYS.map((_, weekday) =>
          weekday === editor.weekday
            ? editor.draft
            : slotDraftOf(department?.week[weekday]?.slots ?? []),
        );
        return {
          ...slotChecks(prefix, editor.draft),
          ...weekSlotChecks(week, prefix, editor.weekday),
        };
      }
      case "date":
        return editor.draft.mode === "inherit" ? {} : slotChecks(DATE_PREFIX, editor.draft);
      default:
        return {};
    }
  }

  #submit(): void {
    const editor = this.editor!;
    this.attempted = true;
    this.refused = {};
    this.bottomRefusal = "";
    if (editor.kind === "list" && editor.inUse !== undefined)
      this.editor = { ...editor, inUse: undefined };
    if (Object.keys(this.#check(editor)).length > 0) {
      void this.#focusInvalid();
      return;
    }
    void this.#write(this.editor!);
  }

  #send(editor: Editor): Promise<unknown> {
    const { departmentId } = editor;
    switch (editor.kind) {
      case "list":
        return this.api.setDepartmentMenus(departmentId, editor.draft);
      case "period": {
        const input = { name: editor.name.trim(), menuId: editor.menuId };
        return editor.id === null
          ? this.api.createPeriod(departmentId, input)
          : this.api.updatePeriod(editor.id, input);
      }
      case "delete-period":
        return this.api.deletePeriod(editor.period.id);
      case "day": {
        const department = this.model!.departments.find((entry) => entry.id === departmentId)!;
        return this.api.saveWeek(
          departmentId,
          DAY_KEYS.map((_, weekday) => ({
            weekday,
            slots:
              weekday === editor.weekday
                ? wireSlots(editor.draft)
                : department.week[weekday]!.slots,
          })),
        );
      }
      case "date":
        if (editor.draft.mode !== "inherit")
          return this.api.saveDateMenus(editor.special.id, departmentId, wireSlots(editor.draft));
        return editor.hadOwn
          ? this.api.clearDateMenus(editor.special.id, departmentId)
          : Promise.resolve();
      case "normal-week":
        return this.api.clearDateMenus(editor.special.id, departmentId);
    }
  }

  /** The editor cannot be closed or replaced while `busy`, so the answer always belongs to it. */
  async #write(editor: Editor): Promise<void> {
    this.busy = true;
    try {
      await this.#send(editor);
    } catch (error) {
      this.busy = false;
      this.#refuse(editor, error);
      return;
    }
    this.#finish(editor);
    this.api.rereadWatches();
  }

  #refuse(editor: Editor, error: unknown): void {
    const code = codeOf(error);
    const params = ((error as { params?: Record<string, unknown> }).params ?? {}) as {
      field?: string;
      date?: string;
      menuId?: string;
      uses?: unknown[];
    };
    if (editor.kind === "list" && code === "department_menu.in_use") {
      const inUse = { menuId: params.menuId!, uses: params.uses as MenuUse[] };
      this.editor = { ...editor, inUse };
      this.refused = {
        list: format("menu.in_use", { menu: this.#menuName(inUse.menuId) }),
      };
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLElement>('[data-test="list-refusal"]')?.focus(),
      );
      return;
    }
    if (editor.kind === "delete-period" && code === "menu_period.in_use") {
      const uses = params.uses as MenuPeriodUse[];
      this.editor = { ...editor, uses };
      this.bottomRefusal = format("menu.period_in_use", {
        name: editor.period.name,
        days: this.#daysText(uses),
      });
      return;
    }
    const placed = this.#place(editor, code, params);
    if (placed === undefined) {
      this.bottomRefusal = this.#sentence(code, params);
      return;
    }
    this.refused = { [placed.field]: placed.sentence };
    void this.#focusInvalid();
  }

  /** The shown field a refusal names, and what is said under it. */
  #place(
    editor: Editor,
    code: string,
    { field = "", date }: { field?: string; date?: string },
  ): { field: string; sentence: string } | undefined {
    if (editor.kind === "period") {
      if (code === "menu_timetable.invalid" && field === "name")
        return { field: "name", sentence: t("menu.name_taken") };
      if (code === "department_menu.not_found")
        return { field: "menuId", sentence: t("menu.not_on_list") };
      return undefined;
    }
    if (code !== "menu_timetable.invalid") return undefined;
    let prefix: string;
    let rest: string;
    if (editor.kind === "day") {
      prefix = DAY_KEYS[editor.weekday]!;
      if (field === "date" && date !== undefined)
        return {
          field: `${prefix}.mode`,
          sentence: format("menu.overlap_date", { date: formatDate(date) }),
        };
      const match = /^days\.(\d)\.(slots.*)$/.exec(field);
      if (match === null || Number(match[1]) !== editor.weekday) return undefined;
      rest = match[2]!;
    } else if (editor.kind === "date") {
      prefix = DATE_PREFIX;
      rest = field;
    } else return undefined;
    if (rest === "slots")
      return {
        field: `${prefix}.mode`,
        sentence:
          date === undefined
            ? t("menu.field_refused")
            : format("menu.overlap_date", { date: formatDate(date) }),
      };
    const slot = /^slots\.(\d+)(?:\.(startsAt|endsAt|periodId))?$/.exec(rest);
    if (slot === null) return undefined;
    const at = `${prefix}.periods.${slot[1]}`;
    if (slot[2] === undefined) return { field: `${at}.opensAt`, sentence: t("menu.slot_overlap") };
    if (slot[2] === "periodId")
      return { field: `${at}.periodId`, sentence: t("menu.field_refused") };
    const time = slot[2] === "startsAt" ? "opensAt" : "closesAt";
    return {
      field: `${at}.${time}`,
      sentence: t(editor.kind === "date" ? "menu.time_skipped" : "menu.field_refused"),
    };
  }

  /** The bottom message for a refusal that names no field the editor shows. */
  #sentence(code: string, { date }: { date?: string }): string {
    if (code === "menu_timetable.invalid" && date !== undefined)
      return format("menu.normal_week_clash", { date: formatDate(date) });
    const key: Partial<Record<string, Key>> = {
      "catalogue.not_found": "menu.menu_gone",
      "department.not_found": "menu.department_gone",
      "menu_period.not_found": "menu.period_gone",
      "special_date.not_found": "menu.date_gone",
    };
    return t(key[code] ?? "menu.save_error");
  }

  async #focusInvalid(): Promise<void> {
    await this.updateComplete;
    await focusFirstInvalid(this.renderRoot.querySelector("wt-modal")!);
  }

  /** A field changed: its refusal goes, and so does every refusal under a cell it holds. */
  #changed(name: string, editor: Editor): void {
    const refused = Object.fromEntries(
      Object.entries(this.refused).filter(
        ([field]) => field !== name && !field.startsWith(`${name}.`),
      ),
    );
    if (Object.keys(refused).length !== Object.keys(this.refused).length) this.refused = refused;
    this.editor = editor;
  }

  #slotChanged(event: CustomEvent<{ draft: SlotDraft }>): void {
    const editor = this.editor;
    if (editor?.kind !== "day" && editor?.kind !== "date") return;
    const prefix = (event.composedPath()[0] as MenuSlotEditor).fieldPrefix;
    this.#changed(prefix, { ...editor, draft: event.detail.draft });
  }

  #normalWeek(special: { id: string; date: string }, departmentId: string): void {
    const editor = this.editor;
    const resume =
      editor?.kind === "list"
        ? { ...editor, inUse: undefined }
        : editor?.kind === "delete-period"
          ? { ...editor, uses: undefined }
          : undefined;
    const returnTo = this.#returnTo ?? (() => null);
    this.#open({ kind: "normal-week", departmentId, special, resume }, returnTo);
  }

  /** Closes the editor, or goes back to the one a "Use normal week" was offered from. */
  #finish(editor: Editor): void {
    if (editor.kind === "normal-week" && editor.resume !== undefined)
      this.#open(editor.resume, this.#returnTo ?? (() => null));
    else this.#close();
  }

  /**
   * A button back to the normal week for each special date among `uses`, for a refusal that names
   * them; `dated` writes each date before its button.
   */
  #datedUses(uses: readonly MenuPeriodUse[], departmentId: string, dated = false) {
    return uses.flatMap((use) =>
      use.kind === "special_date"
        ? [
            html`${dated ? html`<span>${formatDate(use.date)}</span>` : nothing}<wt-button
                variant="secondary"
                data-test="use-normal-week"
                aria-label=${format("menu.use_normal_week_on", { date: formatDate(use.date) })}
                ?disabled=${this.busy}
                @click=${() =>
                  this.#normalWeek({ id: use.specialDateId, date: use.date }, departmentId)}
                >${t("menu.use_normal_week")}</wt-button
              >`,
          ]
        : [],
    );
  }

  #useText(department: Department, use: MenuUse): { text: string; periodId?: string } {
    switch (use.kind) {
      case "department_all_day":
        return { text: t("menu.use_all_day") };
      case "period":
        return { text: this.#periodName(department, use.periodId), periodId: use.periodId };
      case "zone_all_day":
        return {
          text: format("menu.use_zone", {
            zone: this.#zoneName(department, use.zoneId),
            period: t("menu.use_all_day"),
          }),
        };
      case "zone_period":
        return {
          text: format("menu.use_zone", {
            zone: this.#zoneName(department, use.zoneId),
            period: this.#periodName(department, use.periodId),
          }),
        };
    }
  }

  #listForm(editor: Extract<Editor, { kind: "list" }>, department: Department) {
    const set = (draft: string[]) => this.#changed("list", { ...editor, draft });
    const move = (from: number, to: number) => {
      const draft = [...editor.draft];
      const [moved] = draft.splice(from, 1);
      draft.splice(to, 0, moved!);
      set(draft);
    };
    const addable = this.model!.menus.filter(
      (menu) => menu.active && !editor.draft.includes(menu.id),
    );
    const refusal = this.refused.list;
    return html`<ol class="draft" aria-label=${t("menu.list_label")}>
        ${editor.draft.map((menuId, index) => {
          const name = this.#menuName(menuId);
          return html`<li class="menu-row" data-test="menu-row">
            <span class="menu-name">${name}</span>
            <span class="row-buttons">
              <wt-button
                variant="ghost"
                data-test="move-up"
                aria-label=${format("menu.move_up", { name })}
                ?disabled=${this.busy || index === 0}
                @click=${() => move(index, index - 1)}
                >${t("menu.up")}</wt-button
              >
              <wt-button
                variant="ghost"
                data-test="move-down"
                aria-label=${format("menu.move_down", { name })}
                ?disabled=${this.busy || index === editor.draft.length - 1}
                @click=${() => move(index, index + 1)}
                >${t("menu.down")}</wt-button
              >
              <wt-button
                variant="ghost"
                data-test="remove-menu"
                aria-label=${format("menu.remove_menu", { name })}
                ?disabled=${this.busy}
                @click=${() => set(editor.draft.filter((_, at) => at !== index))}
                >${t("menu.remove")}</wt-button
              >
            </span>
          </li>`;
        })}
      </ol>
      ${
        refusal !== undefined && editor.inUse !== undefined
          ? html`<div class="refusal" data-test="list-refusal" tabindex="-1">
              <p>${refusal}</p>
              <ul>
                ${editor.inUse.uses.map((use) => {
                  const { text, periodId } = this.#useText(department, use);
                  const placed =
                    periodId === undefined
                      ? []
                      : (department.periods.find((period) => period.id === periodId)?.uses ?? []);
                  return html`<li data-test="menu-use">
                    ${
                      placed.length === 0
                        ? text
                        : format("menu.use_on", { use: text, days: this.#daysText(placed) })
                    }
                    ${this.#datedUses(placed, department.id)}
                  </li>`;
                })}
              </ul>
            </div>`
          : nothing
      }
      ${
        addable.length === 0
          ? nothing
          : html`<div class="add">
              <wt-combobox
                name="addMenu"
                label=${t("menu.add_menu_field")}
                search="never"
                .options=${addable.map((menu) => ({ value: menu.id, label: menu.name }))}
                .value=${editor.adding}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.editor = { ...editor, adding: event.detail.value };
                }}
              ></wt-combobox>
              <wt-button
                variant="secondary"
                data-test="add-menu"
                ?disabled=${this.busy || editor.adding === ""}
                @click=${() =>
                  this.#changed("list", {
                    ...editor,
                    draft: [...editor.draft, editor.adding],
                    adding: "",
                  })}
                >${t("menu.add_menu")}</wt-button
              >
            </div>`
      }`;
  }

  #periodForm(
    editor: Extract<Editor, { kind: "period" }>,
    department: Department,
    errors: Record<string, string>,
  ) {
    return html`<wt-input
        name="name"
        required
        label=${t("menu.period_name")}
        .value=${editor.name}
        error=${errors.name ?? ""}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) =>
          this.#changed("name", { ...editor, name: event.detail.value })}
      ></wt-input>
      <wt-combobox
        name="menuId"
        required
        search="never"
        label=${t("menu.period_menu")}
        .options=${department.menuIds.map((id) => ({ value: id, label: this.#menuName(id) }))}
        .value=${editor.menuId}
        error=${errors.menuId ?? ""}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) =>
          this.#changed("menuId", { ...editor, menuId: event.detail.value })}
      ></wt-combobox>`;
  }

  #slotEditor(
    label: string,
    prefix: string,
    modes: SlotDraft["mode"][],
    draft: SlotDraft,
    department: Department,
    errors: Record<string, string>,
  ) {
    return html`<menu-slot-editor
      label=${label}
      field-prefix=${prefix}
      .modes=${modes}
      .draft=${draft}
      .periods=${department.periods.map((period) => ({
        ...period,
        menuName: this.#menuName(period.menuId),
      }))}
      .errors=${errors}
      ?disabled=${this.busy}
    ></menu-slot-editor>`;
  }

  /** A slot time the clock shows twice is explained, not refused: both occurrences follow it. */
  #repeatNotes(date: string, draft: SlotDraft) {
    const model = this.model!;
    if (draft.mode !== "periods" || !model.clockReadable || !isLocalDate(date)) return nothing;
    return repeatedTimes(
      date,
      draft.slots.map((slot) => ({ opensAt: slot.startsAt, closesAt: slot.endsAt })),
      model.timeZone,
    ).map(
      (time) =>
        html`<p class="note" data-test="repeat-note">${format("menu.time_repeats", { time })}</p>`,
    );
  }

  #content(editor: Editor, department: Department, errors: Record<string, string>) {
    const confirm = (key: Key, values: Record<string, string>) =>
      html`<p data-test="confirm-text">${format(key, values)}</p>`;
    switch (editor.kind) {
      case "list":
        return {
          heading: format("menu.list_heading", { department: department.name }),
          body: this.#listForm(editor, department),
          save: t("menu.save"),
        };
      case "period":
        return {
          heading:
            editor.id === null
              ? format("menu.add_period_heading", { department: department.name })
              : format("menu.edit_period_heading", {
                  name: this.#periodName(department, editor.id),
                }),
          body: this.#periodForm(editor, department, errors),
          save: t("menu.save"),
        };
      case "delete-period":
        return {
          heading: t("menu.delete_period_heading"),
          body: html`${confirm("menu.delete_period_confirm", { name: editor.period.name })}
            <div class="dated">${this.#datedUses(editor.uses ?? [], department.id, true)}</div>`,
          save: t("menu.delete"),
          danger: true,
          compact: true,
        };
      case "day":
        return {
          heading: format("menu.day_heading", {
            department: department.name,
            day: dayName(editor.weekday),
          }),
          body: this.#slotEditor(
            dayName(editor.weekday),
            DAY_KEYS[editor.weekday]!,
            ["all_day", "periods"],
            editor.draft,
            department,
            errors,
          ),
          save: t("menu.save"),
        };
      case "date":
        return {
          heading: format("menu.date_heading", {
            department: department.name,
            date: formatDate(editor.special.date),
          }),
          body: html`${this.#slotEditor(
            editor.special.name,
            DATE_PREFIX,
            ["inherit", "all_day", "periods"],
            editor.draft,
            department,
            errors,
          )}${this.#repeatNotes(editor.special.date, editor.draft)}`,
          save: t("menu.save"),
        };
      case "normal-week":
        return {
          heading: t("menu.normal_week_heading"),
          body: confirm("menu.normal_week_confirm", {
            department: department.name,
            date: formatDate(editor.special.date),
          }),
          save: t("menu.use_normal_week"),
          compact: true,
        };
    }
  }

  #modal() {
    const editor = this.editor;
    if (editor === undefined) return nothing;
    const department = this.model!.departments.find((entry) => entry.id === editor.departmentId);
    if (department === undefined) return nothing;
    const own = this.attempted ? this.#check(editor) : {};
    const errors = { ...this.refused, ...own };
    const content = this.#content(editor, department, errors);
    const fieldsMarked = Object.keys(errors).some((field) => field !== "list");
    return keyed(
      this.#generation,
      html`<wt-modal
        open
        size=${"compact" in content && content.compact ? "compact" : "standard"}
        heading=${content.heading}
        .dismissible=${!this.busy}
        @wt-close=${() => this.#finish(editor)}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-editor"]'))}
        @menu-slot-change=${this.#slotChanged}
      >
        <div class="form">${content.body}</div>
        <wt-form-actions
          slot="footer"
          .error=${[
            this.bottomRefusal,
            errors.list === undefined ? "" : t("menu.list_refused"),
            fieldsMarked ? t("menu.fix_fields") : "",
          ]
            .filter((message) => message !== "")
            .join(" ")}
        >
          <wt-button
            slot="cancel"
            variant="secondary"
            data-test="cancel-editor"
            ?disabled=${this.busy}
            @click=${() => {
              if (!this.busy) this.#finish(editor);
            }}
            >${t("menu.cancel")}</wt-button
          >
          <wt-button
            data-test="save-editor"
            variant=${"danger" in content && content.danger ? "danger" : "primary"}
            ?disabled=${this.busy || Object.keys(own).length > 0}
            @click=${() => this.#submit()}
            >${content.save}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }

  // --- The page ------------------------------------------------------------------------------

  /** A table that may scroll sideways; with nothing in it to focus, the box takes focus itself. */
  #gridBox(label: string, content: unknown) {
    const scrollStop = this.readOnly;
    return html`<div
      class="grid-box"
      role=${scrollStop ? "region" : nothing}
      aria-label=${scrollStop ? label : nothing}
      tabindex=${scrollStop ? 0 : nothing}
    >
      ${content}
    </div>`;
  }

  #menusSection(department: Department) {
    return html`<section data-test="menus">
      <h2>${t("menu.menus_heading")}</h2>
      <p class="note">${format("menu.menus_note", { department: department.name })}</p>
      ${
        department.menuIds.length === 0
          ? html`<p class="note" data-test="no-menus">${t("menu.no_menus")}</p>`
          : html`<ol class="menus" data-test="menu-list">
              ${department.menuIds.map((id) => html`<li>${this.#menuName(id)}</li>`)}
            </ol>`
      }
      ${
        this.readOnly
          ? nothing
          : html`<div>
              <wt-button
                variant="secondary"
                data-test="edit-menus"
                @click=${() =>
                  this.#open(
                    {
                      kind: "list",
                      departmentId: department.id,
                      draft: [...department.menuIds],
                      adding: "",
                    },
                    this.#byTest("edit-menus"),
                  )}
                >${t("menu.edit_menus")}</wt-button
              >
            </div>`
      }
    </section>`;
  }

  #periodsSection(department: Department) {
    type Row = Department["periods"][number];
    const action = (test: string, label: Key, run: (returnTo: ReturnTo) => void) =>
      html`<wt-button
        variant="secondary"
        data-test=${test}
        @click=${(event: Event) => run(this.#menuTrigger(event))}
        >${t(label)}</wt-button
      >`;
    const actions: DataTableColumn<Row> = {
      key: "actions",
      label: t("menu.actions"),
      pinned: "end",
      cell: (row) =>
        html`<wt-row-actions label=${format("menu.row_actions", { name: row.name })}>
          ${action("edit-period", "menu.edit", (returnTo) =>
            this.#open(
              {
                kind: "period",
                departmentId: department.id,
                id: row.id,
                name: row.name,
                menuId: row.menuId,
              },
              returnTo,
            ),
          )}
          ${action("delete-period", "menu.delete", (returnTo) =>
            this.#open(
              {
                kind: "delete-period",
                departmentId: department.id,
                period: { id: row.id, name: row.name, menuId: row.menuId },
              },
              returnTo,
            ),
          )}
        </wt-row-actions>`,
    };
    const columns: DataTableColumn<Row>[] = [
      { key: "name", label: t("menu.period_name"), cell: (row) => row.name },
      { key: "menu", label: t("menu.period_menu"), cell: (row) => this.#menuName(row.menuId) },
      {
        key: "uses",
        label: t("menu.period_uses"),
        cell: (row) =>
          row.uses.length === 0
            ? html`<span part="inherited">${t("menu.not_placed")}</span>`
            : this.#daysText(row.uses),
      },
      ...(this.readOnly ? [] : [actions]),
    ];
    return html`<section data-test="periods-section">
      <div class="toolbar">
        <h2>${t("menu.periods_heading")}</h2>
        ${
          this.readOnly
            ? nothing
            : html`<wt-button
                variant="secondary"
                data-test="new-period"
                @click=${() =>
                  this.#open(
                    { kind: "period", departmentId: department.id, id: null, name: "", menuId: "" },
                    this.#byTest("new-period"),
                  )}
                >${t("menu.add_period")}</wt-button
              >`
        }
      </div>
      <p class="note">${t("menu.periods_note")}</p>
      ${
        department.periods.length === 0
          ? html`<p class="note" data-test="no-periods">${t("menu.no_periods")}</p>`
          : html`<wt-data-table
              data-test="periods"
              aria-label=${t("menu.periods_heading")}
              .columns=${columns}
              .rows=${department.periods}
              .rowKey=${(row: Row) => row.id}
            ></wt-data-table>`
      }
    </section>`;
  }

  #weekSection(department: Department) {
    const civilDate = this.model!.civilDate;
    const today = civilDate === null ? null : weekdayOf(civilDate);
    return html`<section data-test="week-section">
      <h2>${t("menu.week_heading")}</h2>
      <p class="note" data-test="week-note">
        ${t("menu.week_note")}${this.readOnly ? nothing : ` ${t("menu.week_choose")}`}
      </p>
      ${this.#gridBox(
        t("menu.week_heading"),
        html`<table data-test="menu-week">
          <thead>
            <tr>
              <th scope="col">${t("menu.day_column")}</th>
              <th scope="col">${t("menu.slots_column")}</th>
            </tr>
          </thead>
          <tbody>
            ${WEEK_DISPLAY_ORDER.map((weekday) => {
              const slots = department.week[weekday]!.slots;
              const value = slotsText(department, slots);
              return html`<tr
                data-weekday=${weekday}
                aria-current=${weekday === today ? "date" : nothing}
              >
                <th scope="row">
                  ${dayName(weekday)}${
                    weekday === today
                      ? html` <span class="today">${t("menu.today")}</span>`
                      : nothing
                  }
                </th>
                <td>
                  ${
                    this.readOnly
                      ? html`<span class="value" ?data-muted=${slots.length === 0}
                          >${unbrokenRanges(value)}</span
                        >`
                      : html`<button
                          type="button"
                          class="cell"
                          aria-label=${format("menu.cell_label", { day: dayName(weekday), value })}
                          @click=${(event: Event) => {
                            const button = event.currentTarget as HTMLElement;
                            this.#open(
                              {
                                kind: "day",
                                departmentId: department.id,
                                weekday,
                                draft: slotDraftOf(slots),
                              },
                              () => button,
                            );
                          }}
                        >
                          ${unbrokenRanges(value)}
                        </button>`
                  }
                </td>
              </tr>`;
            })}
          </tbody>
        </table>`,
      )}
    </section>`;
  }

  #datesSection(department: Department) {
    type Row = MenuTimetableSpecialDate;
    const own = (row: Row) => row.timetables.find((entry) => entry.departmentId === department.id);
    const action = (test: string, label: Key, run: (returnTo: ReturnTo) => void) =>
      html`<wt-button
        variant="secondary"
        data-test=${test}
        @click=${(event: Event) => run(this.#menuTrigger(event))}
        >${t(label)}</wt-button
      >`;
    const actions: DataTableColumn<Row> = {
      key: "actions",
      label: t("menu.actions"),
      pinned: "end",
      cell: (row) =>
        html`<wt-row-actions label=${format("menu.row_actions", { name: row.name })}>
          ${action("edit-date-menus", "menu.edit", (returnTo) => {
            const timetable = own(row);
            this.#open(
              {
                kind: "date",
                departmentId: department.id,
                special: row,
                draft: slotDraftOf(timetable?.slots ?? null),
                hadOwn: timetable !== undefined,
              },
              returnTo,
            );
          })}
          ${
            own(row) === undefined
              ? nothing
              : action("use-normal-week", "menu.use_normal_week", (returnTo) =>
                  this.#open(
                    {
                      kind: "normal-week",
                      departmentId: department.id,
                      special: { id: row.id, date: row.date },
                    },
                    returnTo,
                  ),
                )
          }
        </wt-row-actions>`,
    };
    const columns: DataTableColumn<Row>[] = [
      { key: "date", label: t("menu.date"), cell: (row) => formatDate(row.date) },
      { key: "name", label: t("menu.date_name"), cell: (row) => row.name },
      {
        key: "menus",
        label: t("menu.date_menus"),
        cell: (row) => {
          const timetable = own(row);
          return timetable === undefined
            ? html`<span part="inherited">${t("menu.normal_week")}</span>`
            : slotsText(department, timetable.slots);
        },
      },
      ...(this.readOnly ? [] : [actions]),
    ];
    return html`<section data-test="dates-section">
      <h2>${t("menu.dates_heading")}</h2>
      <p class="note" data-test="dates-note">
        ${t("menu.dates_note")} <a href="/manage/hours/view/dates">${t("menu.open_hours")}</a>
      </p>
      <wt-data-table
        data-test="menu-dates"
        aria-label=${t("menu.dates_heading")}
        .columns=${columns}
        .rows=${this.model!.specialDates}
        .rowKey=${(row: Row) => row.id}
        .emptyMessage=${t("menu.no_dates")}
      ></wt-data-table>
    </section>`;
  }

  /** Saves one zone-table choice as it is made; a refusal stays under that choice. */
  async #saveCell(name: string, save: () => Promise<void>): Promise<void> {
    this.cellErrors = Object.fromEntries(
      Object.entries(this.cellErrors).filter(([field]) => field !== name),
    );
    this.cellsBusy = new Set([...this.cellsBusy, name]);
    try {
      await save();
      this.api.rereadWatches();
    } catch (error) {
      const key: Partial<Record<string, Key>> = {
        "department_menu.not_found": "menu.not_on_list",
        "menu_period.not_found": "menu.period_gone",
        "service_zone.not_found": "menu.zone_gone",
        "department.not_found": "menu.department_gone",
        "menu_timetable.invalid": "menu.field_refused",
      };
      this.cellErrors = { ...this.cellErrors, [name]: t(key[codeOf(error)] ?? "menu.save_error") };
    } finally {
      this.cellsBusy = new Set([...this.cellsBusy].filter((busy) => busy !== name));
    }
  }

  /**
   * One choice in the zone table. `fallback` is what a blank choice means: `option` is the blank
   * choice's own words, offered first, and `shown` the value it falls back to, in grey when read.
   * With no fallback the choice is required.
   */
  #choice(
    department: Department,
    name: string,
    label: string,
    stored: string | null,
    fallback: { option: string; shown: string } | null,
    save: (menuId: string | null) => Promise<void>,
  ) {
    const own = stored === null ? "" : this.#menuName(stored);
    if (this.readOnly)
      return stored === null && fallback !== null
        ? html`<span class="value choice inherited"
            ><span class="visually-hidden">${t("menu.inherited_prefix")} </span
            >${fallback.shown}</span
          >`
        : html`<span class="value choice">${own}</span>`;
    const options = department.menuIds.map((id) => ({ value: id, label: this.#menuName(id) }));
    return html`<wt-combobox
      name=${name}
      label=${label}
      hide-label
      search="never"
      ?required=${fallback === null}
      .options=${fallback === null ? options : [{ value: "", label: fallback.option }, ...options]}
      .value=${stored ?? ""}
      placeholder=${fallback?.option ?? ""}
      error=${this.cellErrors[name] ?? ""}
      ?disabled=${this.cellsBusy.has(name)}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        const value = event.detail.value === "" ? null : event.detail.value;
        if (value === stored) return;
        void this.#saveCell(name, () => save(value));
      }}
    ></wt-combobox>`;
  }

  #zonesSection(department: Department) {
    const allDay = department.allDayMenuId;
    const allDayName = allDay === null ? t("menu.no_all_day") : this.#menuName(allDay);
    const rows = [
      { id: ALL_DAY, name: t("menu.all_day"), menuId: allDay },
      ...department.periods.map((period) => ({
        id: period.id,
        name: period.name,
        menuId: period.menuId as string | null,
      })),
    ];
    return html`<section data-test="zones-section">
      <h2>${t("menu.zones_heading")}</h2>
      <p class="note">${t("menu.zones_note")}</p>
      ${
        department.zones.length === 0
          ? html`<p class="note" data-test="no-zones">${t("menu.no_zones")}</p>`
          : nothing
      }
      ${this.#gridBox(
        t("menu.zones_heading"),
        html`<table data-test="zone-menus">
          <thead>
            <tr>
              <th scope="col">${t("menu.period_column")}</th>
              <th scope="col">${t("menu.department_column")}</th>
              ${department.zones.map(
                (zone) =>
                  html`<th scope="col" data-zone=${zone.id}>
                    ${zone.name}${zone.active ? nothing : ` ${t("menu.inactive")}`}
                  </th>`,
              )}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const isAllDay = row.id === ALL_DAY;
              const inherited = isAllDay ? allDayName : this.#menuName(row.menuId);
              return html`<tr data-period=${row.id}>
                <th scope="row">${row.name}</th>
                <td data-zone="department">
                  ${
                    isAllDay
                      ? this.#choice(
                          department,
                          "department.allDayMenuId",
                          format("menu.zone_cell", {
                            zone: department.name,
                            period: row.name,
                          }),
                          allDay,
                          { option: t("menu.no_all_day"), shown: t("menu.no_all_day") },
                          (menuId) => this.api.setDepartmentAllDayMenu(department.id, menuId),
                        )
                      : this.#choice(
                          department,
                          `periods.${row.id}.menuId`,
                          format("menu.zone_cell", { zone: department.name, period: row.name }),
                          row.menuId,
                          null,
                          async (menuId) => {
                            await this.api.updatePeriod(row.id, { menuId: menuId! });
                          },
                        )
                  }
                </td>
                ${department.zones.map((zone) => {
                  const stored = isAllDay
                    ? zone.allDayMenuId
                    : (zone.periodMenus.find((entry) => entry.periodId === row.id)?.menuId ?? null);
                  const label = format("menu.zone_cell", { zone: zone.name, period: row.name });
                  const following = {
                    option: format("menu.follow_department", { menu: inherited }),
                    shown: inherited,
                  };
                  return html`<td data-zone=${zone.id}>
                    ${
                      isAllDay
                        ? this.#choice(
                            department,
                            `zones.${zone.id}.allDayMenuId`,
                            label,
                            stored,
                            following,
                            (menuId) => this.api.setZoneAllDayMenu(zone.id, menuId),
                          )
                        : this.#choice(
                            department,
                            `zones.${zone.id}.periods.${row.id}.menuId`,
                            label,
                            stored,
                            following,
                            (menuId) => this.api.setZonePeriodMenu(zone.id, row.id, menuId),
                          )
                    }
                  </td>`;
                })}
              </tr>`;
            })}
          </tbody>
        </table>`,
      )}
    </section>`;
  }

  override render() {
    const model = this.model;
    const department = this.#department();
    return html`<h1>${t("menu.title")}</h1>
      ${
        this.readError
          ? html`<p role="alert" data-test="page-alert">${this.readError}</p>`
          : nothing
      }
      ${
        model === undefined
          ? nothing
          : html`<p class="note" data-test="clock-note">
                ${
                  model.clockReadable
                    ? format("menu.clock_note", { timeZone: model.timeZone })
                    : t("menu.clock_unreadable")
                }
              </p>
              ${
                department === undefined
                  ? html`<p class="note" data-test="no-departments">${t("menu.no_departments")}</p>`
                  : html`<div class="chooser">
                        <wt-combobox
                          name="departmentId"
                          label=${t("menu.department")}
                          search="never"
                          .options=${model.departments.map((entry) => ({
                            value: entry.id,
                            label: entry.active
                              ? entry.name
                              : `${entry.name} ${t("menu.inactive")}`,
                          }))}
                          .value=${department.id}
                          @wt-change=${(event: CustomEvent<{ value: string }>) => {
                            event.stopPropagation();
                            this.#choose(event.detail.value);
                          }}
                        ></wt-combobox>
                      </div>
                      ${this.#menusSection(department)} ${this.#periodsSection(department)}
                      ${this.#weekSection(department)} ${this.#datesSection(department)}
                      ${this.#zonesSection(department)} ${this.#modal()}`
              }`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-timetable-screen": MenuTimetableScreen;
  }
}
