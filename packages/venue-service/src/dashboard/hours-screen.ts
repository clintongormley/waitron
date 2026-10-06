import { codeOf } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, focusFirstInvalid, submitOnEnter, UrlStateController } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-tabs.js";
import {
  CALENDAR_COLOURS,
  HOURS_RANGE_MAX_DAYS,
  WEEK_DISPLAY_ORDER,
  type CalendarColour,
  type DateHoursCell,
  type HoursModel,
  type HoursModelSubject,
  type HoursSubject,
  type LocalDate,
  type SpecialDate,
  type WeekCell,
  type WeekDay,
} from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import type { HoursApi } from "./hours-client.js";
import {
  cellChecks,
  weekChecks,
  type CellDraft,
  type CellMode,
  type HoursCellEditor,
} from "./hours-cell-editor.js";
import "./hours-cell-editor.js";
import type { CalendarAction } from "./hours-calendar.js";
import "./hours-calendar.js";
import { datesListStyles, renderDatesList } from "./hours-dates-list.js";
import {
  browserToday,
  format,
  formatDate,
  isDefaultStation,
  keyOf,
  standardText,
  storedCells,
  weekCellOf,
} from "./hours-view.js";
import { t } from "./strings.js";

export { formatDate } from "./hours-view.js";

type View = "week" | "dates" | "calendar";
type Subject = HoursModelSubject;
type Key = Parameters<typeof t>[0];

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const WEEK_MODES: CellMode[] = ["closed", "all_day", "periods"];
const DATE_MODES: CellMode[] = ["inherit", "closed", "all_day", "periods"];

interface DateDraft {
  date: string;
  name: string;
  colour: string;
  closeWholeVenue: boolean;
  /** One per subject the editor shows, in the page's order; `prefix` names its fields. */
  cells: { subject: Subject; prefix: string; cell: CellDraft }[];
}

type Editor =
  | { kind: "cell"; subject: Subject; weekday: number; draft: CellDraft }
  | { kind: "configure"; subject: Subject; drafts: CellDraft[]; confirming: boolean }
  | { kind: "clear"; subject: Subject }
  | {
      kind: "date";
      id: string | null;
      heading: Key;
      draft: DateDraft;
      /** The date's stored cells, the default station's apart, as the editor opened. */
      stored: DateHoursCell[];
      /** Cells of subjects the editor does not show, sent back as they were. */
      hidden: DateHoursCell[];
    }
  | { kind: "duplicate"; source: SpecialDate; dates: string[] }
  | { kind: "delete"; source: SpecialDate };

const dayName = (weekday: number) => t(`hours.day.${weekday}` as Key);
const draftOf = (cell: { mode: string; periods: readonly { id: string }[] }): CellDraft =>
  structuredClone(cell) as CellDraft;
const wire = (draft: CellDraft) =>
  draft.mode === "periods"
    ? { mode: "periods" as const, periods: draft.periods }
    : { mode: draft.mode, periods: [] as [] };

@customElement("dashboard-hours-screen")
export class HoursScreen extends LitElement {
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
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      .toolbar > div {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .note {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      [role="alert"] {
        color: var(--wt-color-danger);
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
      thead th > div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-1);
      }
      tbody th {
        white-space: nowrap;
      }
      [data-separator] {
        border-inline-start: var(--wt-field-line-width-active) solid var(--wt-color-text-muted);
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
      .part {
        white-space: nowrap;
      }
      .cell {
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: inherit;
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
      .value[data-muted] {
        color: var(--wt-color-text-muted);
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
      }
      .targets {
        display: grid;
        gap: var(--wt-space-2);
      }
      .target {
        display: flex;
        align-items: flex-start;
        gap: var(--wt-space-2);
      }
      .target wt-input {
        flex: 1;
      }
    `,
    datesListStyles,
  ];

  @property({ attribute: false }) api!: HoursApi;
  /** A venue viewer reads the hours; nothing on the page changes them. */
  @property({ type: Boolean }) readOnly = false;
  @state() private model?: HoursModel;
  @state() private view: View = "week";
  @state() private showInactive = false;
  /** A failed read's message. An action's failure is said in its own editor. */
  @state() private readError = "";
  @state() private editor?: Editor;
  @state() private attempted = false;
  /** The server's refusal of a field, until the operator changes that field or saves again. */
  @state() private refused: Record<string, string> = {};
  /** A refusal that names no field the editor shows, until the operator saves again. */
  @state() private bottomRefusal = "";
  @state() private busy = false;
  /** The one cell the grid's Tab stop is on, `${subjectKey}|${weekday}`. */
  @state() private focusCell = "";

  readonly #from = addDays(browserToday(), -1);
  readonly #to = addDays(this.#from, HOURS_RANGE_MAX_DAYS - 1);
  #detach?: () => void;
  /** Each editor opened or closed is a new generation; a save answers only its own. */
  #generation = 0;
  #returnTo?: () => HTMLElement | null | undefined;
  /** The cells the last date save sent, to name the subject a `cells.N` refusal is about. */
  #sentCells: DateHoursCell[] = [];
  /** The subject a link asked for, focused once the hours are read. */
  #linked?: string;

  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "hours") return;
      const view = this.#url.read("view");
      this.view = view === "dates" || view === "calendar" ? view : "week";
      const department = this.#url.read("department");
      const station = this.#url.read("station");
      this.#linked =
        department !== null
          ? `department:${department}`
          : station !== null
            ? `station:${station}`
            : undefined;
      void this.#focusLinked();
    },
    {
      basePath: "/manage",
      primary: "dashboard",
      children: { hours: { view: "view", department: "department", station: "station" } },
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    this.#detach = this.api.watchHours(
      this.#from,
      this.#to,
      (model) => this.#apply(model),
      () => {
        this.readError = t("hours.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#detach?.();
  }

  #apply(model: HoursModel): void {
    this.model = model;
    this.readError = "";
    void this.#focusLinked();
  }

  async #reload(): Promise<void> {
    if (this.api.rereadWatches()) return;
    void this.renderRoot.querySelector("hours-calendar")?.reload();
    try {
      this.#apply(await this.api.load(this.#from, this.#to));
    } catch {
      this.readError = t("hours.load_error");
    }
  }

  async #focusLinked(): Promise<void> {
    if (this.#linked === undefined || this.model === undefined) return;
    const key = this.#linked;
    this.#linked = undefined;
    if (!this.#subjects().some((subject) => keyOf(subject) === key)) return;
    this.view = "week";
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(`thead th[data-subject="${key}"]`)?.focus();
  }

  /** The model's subjects, departments first; inactive ones only when asked for. */
  #subjects(): Subject[] {
    return this.model!.subjects.filter((subject) => subject.active || this.showInactive);
  }

  #editable(subject: Subject): boolean {
    return !this.readOnly && subject.active && !isDefaultStation(subject);
  }

  #weekCell(subject: HoursSubject, weekday: number): WeekCell {
    return weekCellOf(this.model!, subject, weekday);
  }

  #notSet(subject: Subject): boolean {
    return this.#weekCell(subject, 1).mode === "not_set";
  }

  #standardText(subject: Subject, weekday: number): string {
    return standardText(this.model!, subject, weekday);
  }

  // --- Editors -------------------------------------------------------------------------------

  #open(editor: Editor, returnTo: () => HTMLElement | null | undefined): void {
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

  #cellButton(key: string, weekday: number): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(
      `td[data-subject="${key}"][data-weekday="${weekday}"] button`,
    );
  }

  #menuTrigger(event: Event): () => HTMLElement | null {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
    menu.hide();
    const trigger = menu.shadowRoot!.querySelector<HTMLElement>("button");
    return () => trigger;
  }

  #openCell(subject: Subject, weekday: number): void {
    const returnTo = () => this.#cellButton(keyOf(subject), weekday);
    if (this.#notSet(subject)) this.#openConfigure(subject, returnTo);
    else
      this.#open(
        { kind: "cell", subject, weekday, draft: draftOf(this.#weekCell(subject, weekday)) },
        returnTo,
      );
  }

  #openConfigure(subject: Subject, returnTo: () => HTMLElement | null): void {
    this.#open(
      {
        kind: "configure",
        subject,
        drafts: DAY_KEYS.map(() => ({ mode: "closed", periods: [] })),
        confirming: false,
      },
      returnTo,
    );
  }

  /**
   * `options.cells` are the date's stored cells when the caller read them itself, as the calendar
   * does for a month outside the page's own range; `options.date` fills in a new date.
   */
  #openDate(
    special: SpecialDate | null,
    heading: Key,
    returnTo: () => HTMLElement | null,
    options: { closeWholeVenue?: boolean; cells?: DateHoursCell[]; date?: LocalDate } = {},
  ): void {
    const stored = special === null ? [] : (options.cells ?? storedCells(this.model!, special.id));
    const shown = this.model!.subjects.filter(
      (subject) => subject.active && !isDefaultStation(subject),
    );
    const shownKeys = new Set(shown.map(keyOf));
    const cells = shown.map((subject) => {
      const own = stored.find((entry) => keyOf(entry.subject) === keyOf(subject));
      return {
        subject,
        prefix: `${subject.kind}.${subject.id}`,
        cell: own ? draftOf(own.cell) : ({ mode: "inherit", periods: [] } as CellDraft),
      };
    });
    const defaults = new Set(this.model!.subjects.filter(isDefaultStation).map(keyOf));
    const kept = stored.filter((entry) => !defaults.has(keyOf(entry.subject)));
    this.#open(
      {
        kind: "date",
        id: special?.id ?? null,
        heading,
        draft: {
          date: special?.date ?? options.date ?? "",
          name: special?.name ?? "",
          colour: special?.colour ?? "",
          closeWholeVenue: special?.closeWholeVenue ?? options.closeWholeVenue ?? false,
          cells,
        },
        stored: kept,
        hidden: kept.filter((entry) => !shownKeys.has(keyOf(entry.subject))),
      },
      returnTo,
    );
  }

  /** Every field the editor's own checks find wrong, by field name. */
  #check(editor: Editor): Record<string, string> {
    switch (editor.kind) {
      case "cell": {
        const prefix = DAY_KEYS[editor.weekday]!;
        const week = DAY_KEYS.map((_, weekday) =>
          weekday === editor.weekday
            ? editor.draft
            : draftOf(this.#weekCell(editor.subject, weekday)),
        );
        return {
          ...cellChecks(prefix, editor.draft),
          ...weekChecks(week, () => prefix, editor.weekday),
        };
      }
      case "configure":
        return Object.assign(
          {},
          ...editor.drafts.map((draft, weekday) => cellChecks(DAY_KEYS[weekday]!, draft)),
          weekChecks(editor.drafts, (weekday) => DAY_KEYS[weekday]!),
        ) as Record<string, string>;
      case "date": {
        const { draft } = editor;
        const errors: Record<string, string> = draft.closeWholeVenue
          ? {}
          : Object.assign({}, ...draft.cells.map(({ prefix, cell }) => cellChecks(prefix, cell)));
        if (draft.date === "") errors.date = t("hours.date_required");
        if (draft.name.trim() === "") errors.name = t("hours.name_required");
        if (draft.colour === "") errors.colour = t("hours.colour_required");
        return errors;
      }
      case "duplicate": {
        const errors: Record<string, string> = {};
        editor.dates.forEach((date, index) => {
          if (date === "") errors[`dates.${index}`] = t("hours.date_required");
          else if (editor.dates.indexOf(date) < index)
            errors[`dates.${index}`] = t("hours.date_twice");
        });
        return errors;
      }
      default:
        return {};
    }
  }

  #submit(): void {
    const editor = this.editor!;
    this.attempted = true;
    this.refused = {};
    this.bottomRefusal = "";
    if (Object.keys(this.#check(editor)).length > 0) {
      void this.#focusInvalid();
      return;
    }
    if (editor.kind === "configure" && !editor.confirming) {
      this.editor = { ...editor, confirming: true };
      return;
    }
    void this.#write(editor);
  }

  #send(editor: Editor): Promise<unknown> {
    switch (editor.kind) {
      case "cell":
      case "configure":
      case "clear": {
        const days: WeekDay[] = DAY_KEYS.map((_, weekday) => ({
          weekday,
          cell:
            editor.kind === "clear"
              ? { mode: "not_set", periods: [] }
              : editor.kind === "configure"
                ? wire(editor.drafts[weekday]!)
                : weekday === editor.weekday
                  ? wire(editor.draft)
                  : this.#weekCell(editor.subject, weekday),
        })) as WeekDay[];
        return this.api.saveWeek({ kind: editor.subject.kind, id: editor.subject.id }, days);
      }
      case "date": {
        const { draft } = editor;
        const shown = draft.cells
          .filter(({ cell }) => cell.mode !== "inherit")
          .map(({ subject, cell }) => ({
            subject: { kind: subject.kind, id: subject.id },
            cell: wire(cell),
          }));
        this.#sentCells = [...shown, ...editor.hidden] as DateHoursCell[];
        return this.api.saveDate(editor.id, {
          date: draft.date,
          name: draft.name.trim(),
          colour: draft.colour as CalendarColour,
          closeWholeVenue: draft.closeWholeVenue,
          cells: this.#sentCells,
        });
      }
      case "duplicate":
        return this.api.duplicateDate(editor.source.id, editor.dates);
      case "delete":
        return this.api.deleteDate(editor.source.id);
    }
  }

  async #write(editor: Editor): Promise<void> {
    const generation = this.#generation;
    this.busy = true;
    try {
      await this.#send(editor);
    } catch (error) {
      if (generation === this.#generation) {
        this.busy = false;
        this.#refuse(editor, error);
      }
      return;
    }
    if (generation === this.#generation) this.#close();
    await this.#reload();
  }

  #refuse(editor: Editor, error: unknown): void {
    const code = codeOf(error);
    const params = ((error as { params?: Record<string, unknown> }).params ?? {}) as {
      field?: string;
      date?: string;
      subjectId?: string;
    };
    const placed = this.#place(editor, code, params);
    if (placed === undefined) {
      this.bottomRefusal = this.#sentence(editor, code, params);
      return;
    }
    this.refused = { [placed]: this.#fieldSentence(editor, code, params, placed) };
    void this.#focusInvalid();
  }

  /** The shown field a refusal names, if any. */
  #place(
    editor: Editor,
    code: string,
    { field = "", date, subjectId }: { field?: string; date?: string; subjectId?: string },
  ): string | undefined {
    if (editor.kind === "cell" || editor.kind === "configure") {
      const match = /^days\.(\d)\.cell(?:\.(.+))?$/.exec(field);
      if (code !== "hours.invalid" || match === null) return undefined;
      const weekday = Number(match[1]);
      if (editor.kind === "cell" && weekday !== editor.weekday) return undefined;
      return this.#cellField(DAY_KEYS[weekday]!, match[2]);
    }
    if (editor.kind === "date") {
      if (code === "special_date.date_taken") return "date";
      if (code !== "hours.invalid") return undefined;
      if (["date", "name", "colour"].includes(field)) return field;
      const match = /^cells\.(\d+)\.cell(?:\.(.+))?$/.exec(field);
      const sent = match === null ? undefined : this.#sentCells[Number(match[1])]!;
      const entry = editor.draft.cells.find(({ subject }) =>
        sent ? keyOf(subject) === keyOf(sent.subject) : subject.id === subjectId,
      );
      if (entry === undefined) return undefined;
      return this.#cellField(entry.prefix, match?.[2]);
    }
    if (editor.kind === "duplicate") {
      if (code === "special_date.date_taken") {
        const index = editor.dates.indexOf(date!);
        return index === -1 ? undefined : `dates.${index}`;
      }
      return code === "hours.invalid" && /^dates\.\d+$/.test(field) ? field : undefined;
    }
    return undefined;
  }

  /** The drawn field a refusal of one cell names: a period's time, or else its Hours choice. */
  #cellField(prefix: string, rest: string | undefined): string | undefined {
    if (rest?.startsWith("periods.") !== true) return `${prefix}.mode`;
    return /^periods\.\d+\.(opensAt|closesAt)$/.test(rest) ? `${prefix}.${rest}` : undefined;
  }

  /**
   * The sentence under a refused field. A duplicate's refusal names its target date when the
   * clock skips a time there, and the neighbouring date when the hours clash with it.
   */
  #fieldSentence(editor: Editor, code: string, { date }: { date?: string }, name: string): string {
    if (code === "special_date.date_taken")
      return format("hours.date_taken", { date: formatDate(date!) });
    if (name.includes(".periods."))
      return t(editor.kind === "date" ? "hours.time_skipped" : "hours.field_refused");
    if (date === undefined)
      return t(name.endsWith(".mode") ? "hours.invalid" : "hours.field_refused");
    if (editor.kind === "duplicate" && editor.dates[Number(name.split(".")[1])] === date)
      return t("hours.duplicate_skipped");
    return format(name === "date" ? "hours.date_moved_clash" : "hours.invalid_clash", {
      date: formatDate(date),
    });
  }

  /** The bottom message for a refusal that names no field the editor shows. */
  #sentence(
    editor: Editor,
    code: string,
    { field = "", date }: { field?: string; date?: string },
  ): string {
    if (code === "special_date.not_found") return t("hours.date_not_found");
    if (code === "station.always_open") return t("hours.always_open");
    if (code === "special_date.date_taken")
      return format("hours.date_taken", { date: formatDate(date!) });
    if (code !== "hours.invalid") return t("hours.save_error");
    if (date === undefined) {
      if (/\.periods\.\d+\.id$/.test(field)) return t("hours.period_unsaved");
      if (/^(cells\.\d+\.)?subject$/.test(field)) return t("hours.subject_gone");
      if (/^days\.\d\.cell\.mode$/.test(field)) return t("hours.week_mixed");
      return t("hours.invalid");
    }
    return format(editor.kind === "delete" ? "hours.delete_clash" : "hours.invalid_clash", {
      date: formatDate(date),
    });
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

  #cellChanged(event: CustomEvent<{ cell: CellDraft }>): void {
    const editor = this.editor!;
    const prefix = (event.composedPath()[0] as HoursCellEditor).fieldPrefix;
    const cell = event.detail.cell;
    if (editor.kind === "cell") this.#changed(prefix, { ...editor, draft: cell });
    else if (editor.kind === "configure") {
      const drafts = [...editor.drafts];
      drafts[DAY_KEYS.indexOf(prefix as (typeof DAY_KEYS)[number])] = cell;
      this.#changed(prefix, { ...editor, drafts });
    } else {
      const date = editor as Extract<Editor, { kind: "date" }>;
      this.#changed(prefix, {
        ...date,
        draft: {
          ...date.draft,
          cells: date.draft.cells.map((entry) =>
            entry.prefix === prefix ? { ...entry, cell } : entry,
          ),
        },
      });
    }
  }

  /**
   * Switching the closure on locks the cells, so a cell its own checks refuse goes back to its
   * stored hours, where it can be seen; a cell they accept keeps the edit.
   */
  #setClosure(checked: boolean): void {
    const editor = this.editor as Extract<Editor, { kind: "date" }>;
    const cells = editor.draft.cells.map((entry) => {
      if (!checked || Object.keys(cellChecks(entry.prefix, entry.cell)).length === 0) return entry;
      const stored = editor.stored.find(({ subject }) => keyOf(subject) === keyOf(entry.subject));
      return {
        ...entry,
        cell: stored ? draftOf(stored.cell) : ({ mode: "inherit", periods: [] } as CellDraft),
      };
    });
    this.#setDate({ closeWholeVenue: checked, cells }, "closeWholeVenue");
  }

  #setDate(patch: Partial<DateDraft>, name: string): void {
    const editor = this.editor as Extract<Editor, { kind: "date" }>;
    this.#changed(name, { ...editor, draft: { ...editor.draft, ...patch } });
  }

  #content(editor: Editor, errors: Record<string, string>) {
    const cellEditor = (
      label: string,
      prefix: string,
      modes: CellMode[],
      cell: CellDraft,
      inherited = "",
      disabled = false,
    ) =>
      html`<hours-cell-editor
        label=${label}
        field-prefix=${prefix}
        .modes=${modes}
        .cell=${cell}
        inherited=${inherited}
        .errors=${errors}
        ?disabled=${this.busy || disabled}
      ></hours-cell-editor>`;
    switch (editor.kind) {
      case "cell":
        return {
          heading: format("hours.cell_heading", {
            subject: editor.subject.name,
            day: dayName(editor.weekday),
          }),
          body: cellEditor(
            dayName(editor.weekday),
            DAY_KEYS[editor.weekday]!,
            WEEK_MODES,
            editor.draft,
          ),
          save: t("hours.save"),
        };
      case "configure":
        return {
          heading: format("hours.configure_heading", { subject: editor.subject.name }),
          body: editor.confirming
            ? html`<p data-test="confirm-text">
                ${format("hours.configure_confirm", { subject: editor.subject.name })}
              </p>`
            : html`<p class="note" data-test="configure-note">${t("hours.configure_note")}</p>
                ${WEEK_DISPLAY_ORDER.map((weekday) =>
                  cellEditor(
                    dayName(weekday),
                    DAY_KEYS[weekday],
                    WEEK_MODES,
                    editor.drafts[weekday]!,
                  ),
                )}`,
          save: t(editor.confirming ? "hours.save_hours" : "hours.save"),
          cancel: editor.confirming ? t("hours.back") : undefined,
        };
      case "clear":
        return {
          heading: format("hours.clear_heading", { subject: editor.subject.name }),
          body: html`<p data-test="confirm-text">
            ${format(
              editor.subject.kind === "department"
                ? "hours.clear_department"
                : "hours.clear_station",
              { subject: editor.subject.name },
            )}
          </p>`,
          save: t("hours.clear"),
          danger: true,
        };
      case "date":
        return {
          heading: t(editor.heading),
          body: this.#dateForm(editor, errors, cellEditor),
          save: t("hours.save"),
        };
      case "duplicate":
        return {
          heading: format("hours.duplicate_heading", { name: editor.source.name }),
          body: this.#duplicateForm(editor, errors),
          save: t("hours.duplicate"),
        };
      case "delete":
        return {
          heading: t("hours.delete_heading"),
          body: html`<p data-test="confirm-text">
            ${format("hours.delete_confirm", {
              name: editor.source.name,
              date: formatDate(editor.source.date),
            })}
          </p>`,
          save: t("hours.delete"),
          danger: true,
        };
    }
  }

  #dateForm(
    editor: Extract<Editor, { kind: "date" }>,
    errors: Record<string, string>,
    cellEditor: (
      label: string,
      prefix: string,
      modes: CellMode[],
      cell: CellDraft,
      inherited?: string,
      disabled?: boolean,
    ) => TemplateResult,
  ) {
    const { draft } = editor;
    const weekday = draft.date === "" ? null : weekdayOf(draft.date);
    const defaults = this.model!.subjects.filter(
      (subject) => subject.active && isDefaultStation(subject),
    );
    return html`<wt-input
        type="date"
        name="date"
        required
        label=${t("hours.date")}
        .value=${draft.date}
        error=${errors.date ?? ""}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) =>
          this.#setDate({ date: event.detail.value }, "date")}
      ></wt-input>
      <wt-input
        name="name"
        required
        label=${t("hours.name")}
        .value=${draft.name}
        error=${errors.name ?? ""}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) =>
          this.#setDate({ name: event.detail.value }, "name")}
      ></wt-input>
      <wt-combobox
        name="colour"
        required
        search="never"
        label=${t("hours.colour")}
        .options=${CALENDAR_COLOURS.map((colour) => ({
          value: colour,
          label: t(`hours.colour.${colour}` as Key),
        }))}
        .value=${draft.colour}
        error=${errors.colour ?? ""}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) =>
          this.#setDate({ colour: event.detail.value }, "colour")}
      ></wt-combobox>
      <wt-switch
        name="closeWholeVenue"
        label=${t("hours.close_whole_venue")}
        ?checked=${draft.closeWholeVenue}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) =>
          this.#setClosure(event.detail.checked)}
      ></wt-switch>
      ${
        draft.closeWholeVenue
          ? html`<p class="note" data-test="whole-venue-note">${t("hours.whole_venue_note")}</p>`
          : nothing
      }
      ${draft.cells.map(({ subject, prefix, cell }) =>
        cellEditor(
          subject.name,
          prefix,
          DATE_MODES,
          cell,
          weekday === null ? "" : this.#standardText(subject, weekday),
          draft.closeWholeVenue,
        ),
      )}
      ${defaults.map(
        (subject) =>
          html`<p class="note" data-test="default-station">
            ${format("hours.default_station", { name: subject.name })}
          </p>`,
      )}`;
  }

  #duplicateForm(editor: Extract<Editor, { kind: "duplicate" }>, errors: Record<string, string>) {
    const set = (dates: string[], name: string) => this.#changed(name, { ...editor, dates });
    return html`<p class="note" data-test="duplicate-note">${t("hours.duplicate_note")}</p>
      <div class="targets">
        ${editor.dates.map(
          (date, index) =>
            html`<div class="target">
              <wt-input
                type="date"
                required
                name=${`dates.${index}`}
                label=${format("hours.target_date", { n: String(index + 1) })}
                .value=${date}
                error=${errors[`dates.${index}`] ?? ""}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) =>
                  set(
                    editor.dates.map((value, at) => (at === index ? event.detail.value : value)),
                    `dates.${index}`,
                  )}
              ></wt-input>
              ${
                editor.dates.length > 1
                  ? html`<wt-button
                      variant="ghost"
                      data-test=${`remove-target-${index}`}
                      aria-label=${format("hours.remove_target", { n: String(index + 1) })}
                      ?disabled=${this.busy}
                      @click=${() => {
                        this.refused = {};
                        set(
                          editor.dates.filter((_, at) => at !== index),
                          "dates",
                        );
                      }}
                      >${t("hours.remove")}</wt-button
                    >`
                  : nothing
              }
            </div>`,
        )}
        <div>
          <wt-button
            variant="secondary"
            data-test="add-target"
            ?disabled=${this.busy}
            @click=${() => set([...editor.dates, ""], "dates")}
            >${t("hours.add_target")}</wt-button
          >
        </div>
      </div>`;
  }

  #modal() {
    const editor = this.editor;
    if (editor === undefined) return nothing;
    const own = this.attempted ? this.#check(editor) : {};
    const errors = { ...this.refused, ...own };
    const content = this.#content(editor, errors);
    const marked = Object.keys(errors).length > 0;
    return keyed(
      this.#generation,
      html`<wt-modal
        open
        size=${
          editor.kind === "clear" ||
          editor.kind === "delete" ||
          (editor.kind === "configure" && editor.confirming)
            ? "compact"
            : "standard"
        }
        heading=${content.heading}
        @wt-close=${() => this.#close()}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-editor"]'))}
        @hours-cell-change=${this.#cellChanged}
      >
        <div class="form">${content.body}</div>
        <wt-form-actions
          slot="footer"
          .error=${[this.bottomRefusal, marked ? t("hours.fix_fields") : ""]
            .filter((message) => message !== "")
            .join(" ")}
        >
          <wt-button
            slot="cancel"
            variant="secondary"
            data-test="cancel-editor"
            @click=${() =>
              editor.kind === "configure" && editor.confirming
                ? (this.editor = { ...editor, confirming: false })
                : this.#close()}
            >${content.cancel ?? t("hours.cancel")}</wt-button
          >
          <wt-button
            data-test="save-editor"
            variant=${content.danger ? "danger" : "primary"}
            ?disabled=${this.busy || Object.keys(own).length > 0}
            @click=${() => this.#submit()}
            >${content.save}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }

  // --- The standard week ---------------------------------------------------------------------

  #gridKeydown(event: KeyboardEvent): void {
    const button = event.composedPath()[0] as HTMLElement;
    if (!button.matches("td > button.cell")) return;
    const td = button.parentElement as HTMLTableCellElement;
    const row = td.parentElement as HTMLTableRowElement;
    const rows = [...(row.parentElement as HTMLTableSectionElement).rows];
    const across = [...row.querySelectorAll<HTMLElement>("button.cell")];
    const down = (step: number) =>
      rows[rows.indexOf(row) + step]?.querySelector<HTMLElement>(
        `td[data-subject="${td.dataset.subject}"] button`,
      );
    const target =
      event.key === "ArrowRight"
        ? across[across.indexOf(button) + 1]
        : event.key === "ArrowLeft"
          ? across[across.indexOf(button) - 1]
          : event.key === "ArrowDown"
            ? down(1)
            : event.key === "ArrowUp"
              ? down(-1)
              : undefined;
    if (target === undefined && !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    target?.focus();
  }

  #subjectMenu(subject: Subject) {
    if (!this.#editable(subject)) return nothing;
    const notSet = this.#notSet(subject);
    return html`<wt-row-actions
      align="end"
      label=${format("hours.subject_actions", { name: subject.name })}
    >
      <wt-button
        variant="secondary"
        data-test=${notSet ? "configure" : "clear"}
        @click=${(event: Event) => {
          const returnTo = this.#menuTrigger(event);
          if (notSet) this.#openConfigure(subject, returnTo);
          else this.#open({ kind: "clear", subject }, returnTo);
        }}
        >${t(notSet ? "hours.configure" : "hours.clear")}</wt-button
      >
    </wt-row-actions>`;
  }

  #week() {
    const subjects = this.#subjects();
    const firstStation = subjects.find((subject) => subject.kind === "station");
    const today = this.model!.civilDate === null ? null : weekdayOf(this.model!.civilDate);
    const editableKeys = WEEK_DISPLAY_ORDER.flatMap((weekday) =>
      subjects
        .filter((subject) => this.#editable(subject))
        .map((subject) => `${keyOf(subject)}|${weekday}`),
    );
    const stop = editableKeys.includes(this.focusCell) ? this.focusCell : editableKeys[0];
    // With no cell to open, the box itself takes focus so a keyboard can scroll it sideways.
    const scrollStop = editableKeys.length === 0;
    return html`<div
      class="grid-box"
      role=${scrollStop ? "region" : nothing}
      aria-label=${scrollStop ? t("hours.tab.week") : nothing}
      tabindex=${scrollStop ? 0 : nothing}
    >
      <table
        data-test="week-grid"
        @keydown=${this.#gridKeydown}
        @focusin=${(event: FocusEvent) => {
          const td = (event.target as HTMLElement).closest("td");
          if (td !== null) this.focusCell = `${td.dataset.subject}|${td.dataset.weekday}`;
        }}
      >
        <thead>
          <tr>
            <th scope="col">${t("hours.day_column")}</th>
            ${subjects.map(
              (subject) =>
                html`<th
                  scope="col"
                  tabindex="-1"
                  data-subject=${keyOf(subject)}
                  ?data-separator=${subject === firstStation}
                >
                  <div>
                    <span
                      ><span class="subject-name">${subject.name}</span>${
                        subject.active ? nothing : ` ${t("hours.inactive")}`
                      }</span
                    >${this.#subjectMenu(subject)}
                  </div>
                </th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${WEEK_DISPLAY_ORDER.map(
            (weekday) =>
              html`<tr data-weekday=${weekday} aria-current=${weekday === today ? "date" : nothing}>
                <th scope="row">
                  ${dayName(weekday)}${
                    weekday === today
                      ? html` <span class="today">${t("hours.today")}</span>`
                      : nothing
                  }
                </th>
                ${subjects.map((subject) => {
                  const key = keyOf(subject);
                  const value = this.#standardText(subject, weekday);
                  // Each period stays on one line; a cell wraps only between periods.
                  const parts = value.split(", ");
                  const shown = parts.map(
                    (part, index) =>
                      html`<span class="part"
                        >${part}${index < parts.length - 1 ? ", " : ""}</span
                      >`,
                  );
                  return html`<td
                    data-subject=${key}
                    data-weekday=${weekday}
                    ?data-separator=${subject === firstStation}
                  >
                    ${
                      this.#editable(subject)
                        ? html`<button
                            type="button"
                            class="cell"
                            tabindex=${`${key}|${weekday}` === stop ? 0 : -1}
                            aria-label=${format("hours.cell_label", {
                              subject: subject.name,
                              day: dayName(weekday),
                              value,
                            })}
                            @click=${() => this.#openCell(subject, weekday)}
                          >
                            ${shown}
                          </button>`
                        : html`<span class="value" ?data-muted=${!subject.active}>${shown}</span>`
                    }
                  </td>`;
                })}
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  // --- Special dates and the calendar ------------------------------------------------------

  #dates() {
    return renderDatesList({
      model: this.model!,
      readOnly: this.readOnly,
      subjects: this.#subjects(),
      root: this.renderRoot,
      menuTrigger: (event) => this.#menuTrigger(event),
      add: (returnTo, closeWholeVenue) =>
        this.#openDate(
          null,
          closeWholeVenue ? "hours.close_heading" : "hours.add_heading",
          returnTo,
          { closeWholeVenue },
        ),
      edit: (special, returnTo) => this.#openDate(special, "hours.edit_heading", returnTo),
      duplicate: (source, returnTo) =>
        this.#open({ kind: "duplicate", source, dates: [""] }, returnTo),
      remove: (source, returnTo) => this.#open({ kind: "delete", source }, returnTo),
    });
  }

  #calendarAction(event: CustomEvent<CalendarAction>): void {
    const { kind, special, cells, date, returnTo } = event.detail;
    if (kind === "make_special") this.#openDate(null, "hours.add_heading", returnTo, { date });
    else if (kind === "edit") this.#openDate(special!, "hours.edit_heading", returnTo, { cells });
    else if (kind === "duplicate")
      this.#open({ kind: "duplicate", source: special!, dates: [""] }, returnTo);
    else this.#open({ kind: "delete", source: special! }, returnTo);
  }

  override render() {
    const model = this.model;
    return html`<h1>${t("hours.title")}</h1>
      ${
        this.readError
          ? html`<p role="alert" data-test="page-alert">${this.readError}</p>`
          : nothing
      }
      ${
        model === undefined
          ? nothing
          : html`<div class="toolbar">
                <p class="note" data-test="clock-note">
                  ${
                    model.clockReadable
                      ? format("hours.clock_note", { timeZone: model.timeZone })
                      : t("hours.clock_unreadable")
                  }
                </p>
                <wt-switch
                  name="showInactive"
                  label=${t("hours.show_inactive")}
                  ?checked=${this.showInactive}
                  @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                    this.showInactive = event.detail.checked;
                  }}
                ></wt-switch>
              </div>
              <wt-tabs
                label=${t("hours.title")}
                .value=${this.view}
                .items=${[
                  { key: "week", label: t("hours.tab.week") },
                  { key: "dates", label: t("hours.tab.dates") },
                  { key: "calendar", label: t("hours.tab.calendar") },
                ]}
                @wt-tab-change=${(event: CustomEvent<{ value: View }>) => {
                  this.view = event.detail.value;
                  this.#url.write({ dashboard: "hours", view: this.view });
                }}
              >
                <div slot="week">${this.view === "week" ? this.#week() : nothing}</div>
                <div slot="dates">${this.view === "dates" ? this.#dates() : nothing}</div>
                <div slot="calendar">
                  ${
                    this.view === "calendar"
                      ? html`<hours-calendar
                          .api=${this.api}
                          ?readOnly=${this.readOnly}
                          .today=${model.civilDate}
                          @hours-calendar-action=${this.#calendarAction}
                        ></hours-calendar>`
                      : nothing
                  }
                </div>
              </wt-tabs>
              ${this.#modal()}`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-hours-screen": HoursScreen;
  }
}
