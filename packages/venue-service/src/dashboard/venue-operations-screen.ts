import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { QueryController } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { codeOf, tableNoMatches } from "@waitron/dashboard-kit";
import {
  baseStyles,
  focusFirstInvalid,
  leaveCoordinatorFor,
  navigationGuardFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  submitOnEnter,
  UrlStateController,
  type DataTableColumn,
} from "@waitron/ui";
import type {
  Department,
  DepartmentRemovalImpact,
  FloorZone,
  ServiceMode,
  VenueReadinessIssue,
  VenueServiceApi,
  VenueServiceView,
} from "./client.js";
import { t } from "./strings.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";

const format = (key: Parameters<typeof t>[0], values: Record<string, string>) =>
  Object.entries(values).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement),
    t(key) as string,
  );

function openHoursPage(departmentId: string): void {
  const url = `/manage/hours/department/${encodeURIComponent(departmentId)}`;
  const guard = navigationGuardFor(window);
  if (guard) void guard.write(url);
  else {
    history.pushState(history.state, "", url);
    dispatchEvent(new PopStateEvent("popstate"));
  }
}

const MODES: ServiceMode[] = ["table_tab", "prepay", "ticket_then_pay"];
type View = "departments" | "zones";
type Editor =
  | { kind: "department"; row?: Department }
  | { kind: "new-zone" }
  | { kind: "zone"; row: FloorZone }
  | { kind: "assignment"; zoneId: string; menuId?: string }
  | {
      kind: "disable";
      name: string;
      action: () => Promise<unknown>;
      impact?: DepartmentRemovalImpact;
    };
type NameCell = "department" | "zone" | "trading";
type NameDraft = {
  id: object;
  rowId: string;
  baseline: string;
  row?: Department | FloorZone;
  scope?: DraftScope<string>;
};
type EditorValues = Record<string, string | boolean>;
type Action = { key: string; label: string; run: () => void; disabled?: boolean };
type PolicyRow =
  | { kind: "department"; department: Department }
  | { kind: "zone"; zone: FloorZone; departmentId: string | null };
/** `check` reads the fields and returns a message per invalid one; `save` runs only once `check`
 * returns none. */
type EditorContent = {
  heading: string;
  body: TemplateResult;
  check: () => Record<string, string>;
  save: () => void;
};
/** A `management.request_invalid` refusal's `field`, or a refusal's code that can only mean one
 * control, onto the control that holds it. */
type ServerFields = { fields?: Record<string, string>; codes?: Record<string, string> };

@customElement("dashboard-venue-operations-screen")
export class VenueOperationsScreen extends LitElement {
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
        margin-block: var(--wt-space-3);
      }
      wt-data-table::part(edit-paid),
      wt-data-table::part(edit-collection),
      wt-data-table::part(edit-receipt),
      wt-data-table::part(edit-department-name),
      wt-data-table::part(edit-zone-name),
      wt-data-table::part(edit-trading-name),
      wt-data-table::part(zone-readiness-action) {
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
      }
      wt-data-table::part(collection-cell) {
        display: inline-flex;
        align-items: center;
      }
      wt-data-table::part(trading-name-cell) {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      wt-data-table::part(inactive-department-label),
      wt-data-table::part(inactive-zone-label),
      wt-data-table::part(unconfigured-zone-label) {
        margin-inline-start: var(--wt-space-2);
      }
      wt-data-table::part(unconfigured-zone-label) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(inherited-value) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(zone-readiness) {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      .toolbar[data-test="policy-tree-actions"] > div {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
      }
      label {
        display: grid;
        gap: var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
        max-width: var(--wt-field-max-width);
      }
      input[type="checkbox"] {
        width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
      }
      .field-error,
      [role="alert"] {
        color: var(--wt-color-danger);
      }
      .field-error {
        margin: 0;
        font-weight: normal;
      }
      wt-form-actions {
        width: 100%;
      }
    `,
  ];
  @property({ attribute: false }) api!: VenueServiceApi;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.loadError = t("venue.load_error");
    },
  );
  #loaded = false;
  @state() private model?: VenueServiceView;
  @state() private loadError?: string;
  /** A refusal of a list action that saved at once, with no editor open. */
  @state() private actionError?: string;
  /** The open editor's check results. */
  @state() private fieldErrors: Record<string, string> = {};
  /** The server's refusal of an editor field, until the operator changes that field or saves again. */
  @state() private refusedFields: Record<string, string> = {};
  /** A refusal that names no field the editor shows, until the operator saves again. */
  @state() private editorError?: string;
  /** Save has been pressed in the open editor, so it re-checks its fields on every change. */
  @state() private attempted = false;
  @state() private busy = false;
  @state() private printTradingNameDrafts: Record<string, boolean> = {};
  @state() private departmentNameEditor?: string;
  @state() private departmentNameDraft = "";
  @state() private departmentNameError = "";
  @state() private zoneNameEditor?: string;
  @state() private zoneNameDraft = "";
  @state() private zoneNameError = "";
  @state() private tradingNameEditor?: string;
  @state() private tradingNameDraft = "";
  @state() private tradingNameError = "";
  @state() private paidEditor?: string;
  @state() private paidDrafts: Record<string, string> = {};
  @state() private collectionEditor?: string;
  @state() private collectionDrafts: Record<string, string> = {};
  @state() private receiptEditor?: string;
  @state() private receiptDrafts: Record<string, string> = {};
  @state() private view: View = "departments";
  @state() private editor?: Editor;
  @state() private zoneId = "";
  #editorScope?: DraftScope<EditorValues>;
  #editorIdentity?: Editor;
  #editorBaseline?: EditorValues;
  #editorModel?: VenueServiceView;
  #leave?: LeaveCoordinator;
  readonly #nameDrafts = new Map<NameCell, NameDraft>();
  #nameValue(kind: NameCell): string {
    return kind === "department"
      ? this.departmentNameDraft
      : kind === "zone"
        ? this.zoneNameDraft
        : this.tradingNameDraft;
  }
  #setNameValue(kind: NameCell, value: string): void {
    if (kind === "department") this.departmentNameDraft = value;
    else if (kind === "zone") this.zoneNameDraft = value;
    else this.tradingNameDraft = value;
  }
  #setNameEditor(kind: NameCell, rowId?: string): void {
    if (kind === "department") this.departmentNameEditor = rowId;
    else if (kind === "zone") this.zoneNameEditor = rowId;
    else this.tradingNameEditor = rowId;
  }
  #clearNameError(kind: NameCell, message = ""): void {
    if (kind === "department") this.departmentNameError = message;
    else if (kind === "zone") this.zoneNameError = message;
    else this.tradingNameError = message;
  }
  #registerName(kind: NameCell, draft: NameDraft): void {
    this.#leave ??= leaveCoordinatorFor(this);
    let registering = true;
    draft.scope = this.#leave?.register({
      id: draft.id,
      current: () => (registering ? draft.baseline : this.#nameValue(kind).trim()),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => this.#setNameValue(kind, value),
    });
    registering = false;
    draft.scope?.changed();
  }
  #currentName(kind: NameCell, draft?: NameDraft): boolean {
    return this.isConnected && draft !== undefined && this.#nameDrafts.get(kind) === draft;
  }
  #leaveName(
    kind: NameCell,
    draft: NameDraft | undefined,
    reason: LeaveReason,
    proceed: () => void,
  ): void {
    if (!this.#currentName(kind, draft) || this.busy) return;
    if (!draft!.scope) proceed();
    else
      void this.#leave!.request({
        scopes: [draft!.id],
        reason,
        proceed: () => {
          if (this.#currentName(kind, draft) && !this.busy) proceed();
        },
      });
  }
  #openName(kind: NameCell, rowId: string, value: string): void {
    if (this.busy) return;
    const open = () => {
      this.#nameDrafts.get(kind)?.scope?.dispose();
      const draft: NameDraft = {
        id: {},
        rowId,
        baseline: value.trim(),
        row:
          kind === "zone"
            ? this.model?.floorZones.find((row) => row.id === rowId)
            : this.model?.departments.find((row) => row.id === rowId),
      };
      this.#nameDrafts.set(kind, draft);
      this.#setNameValue(kind, value);
      this.#clearNameError(kind);
      this.#setNameEditor(kind, rowId);
      this.#registerName(kind, draft);
    };
    const previous = this.#nameDrafts.get(kind);
    if (previous) this.#leaveName(kind, previous, "navigation", open);
    else open();
  }
  #closeName(kind: NameCell, draft: NameDraft): void {
    if (!this.#currentName(kind, draft)) return;
    draft.scope?.dispose();
    this.#nameDrafts.delete(kind);
    this.#setNameEditor(kind);
    this.#clearNameError(kind);
    void this.updateComplete.then(async () => {
      const table = this.renderRoot.querySelector<LitElement>(
        "wt-data-table[data-test=policy-tree]",
      );
      await table?.updateComplete;
      if (!this.isConnected || this.#nameDrafts.has(kind)) return;
      const row = `${kind === "zone" ? "zone" : "department"}-${draft.rowId}`;
      const action = kind === "trading" ? "trading-name" : `${kind}-name`;
      table?.shadowRoot
        ?.querySelector<HTMLElement>(
          `[data-row-key="${CSS.escape(row)}"] [data-test="edit-${action}"]`,
        )
        ?.focus();
    });
  }
  #changeName(kind: NameCell, draft: NameDraft | undefined, value: string): void {
    if (!this.#currentName(kind, draft)) return;
    this.#setNameValue(kind, value);
    this.#clearNameError(kind);
    draft!.scope?.changed();
  }
  #nameKey(event: KeyboardEvent, kind: NameCell, draft: NameDraft | undefined): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.#leaveName(kind, draft, "escape", () => this.#closeName(kind, draft!));
  }
  async #saveName(
    kind: NameCell,
    draft: NameDraft | undefined,
    write: (value: string) => Promise<unknown>,
  ): Promise<void> {
    if (!this.#currentName(kind, draft) || this.busy) return;
    const submitted = this.#nameValue(kind).trim();
    if (!submitted) {
      this.#clearNameError(kind, t("venue.field_required"));
      return;
    }
    this.busy = true;
    this.actionError = undefined;
    try {
      await write(submitted);
      if (this.#currentName(kind, draft)) {
        draft!.baseline = submitted;
        draft!.scope?.commit(submitted);
        if (this.#nameValue(kind).trim() === submitted) this.#closeName(kind, draft!);
      }
      if (this.isConnected) await this.#load();
    } catch (error) {
      if (this.#currentName(kind, draft))
        this.actionError = this.#refusal(codeOf(error ?? {}), error);
    } finally {
      this.busy = false;
    }
  }
  #opener?: HTMLElement;
  #openerAction?: { element: HTMLElement; key: string };

  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "venue-operations") return;
      this.#url.write({ dashboard: "venue-operations", view: null }, true);
    },
    { basePath: "/manage", primary: "dashboard", children: { "*": { view: "view" } } },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    for (const [kind, previous] of this.#nameDrafts) {
      const draft = { ...previous, id: {}, scope: undefined };
      this.#nameDrafts.set(kind, draft);
      this.#registerName(kind, draft);
    }
    this.requestUpdate();
    void this.#load();
  }
  async #load(): Promise<void> {
    try {
      let initial = !this.#loaded;
      this.#loaded = true;
      await this.#queries.watch(
        "venue",
        {
          key: "venue-service:operations",
          dependencies: QUERY_DEPENDENCIES.operations.map((type) => ({ type })),
          refreshMs: 60_000,
          read: () => {
            const api = initial ? this.api : (this.api.background ?? this.api);
            initial = false;
            return api.load();
          },
        },
        (value) => {
          this.model = value;
          this.loadError = undefined;
        },
      );
    } catch {
      this.loadError = t("venue.load_error");
    }
  }
  #value(name: string): string {
    return (
      this.renderRoot.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)
        ?.value ?? ""
    );
  }
  #open(editor: Editor): void {
    this.#editorBaseline = undefined;
    this.#editorModel = this.model;
    this.editor = editor;
    this.actionError = undefined;
    this.#restart();
  }
  #close(): void {
    this.#editorBaseline = undefined;
    this.#editorScope?.dispose();
    this.#editorScope = undefined;
    this.#editorIdentity = undefined;
    this.#editorModel = undefined;
    this.editor = undefined;
    this.#restart();
    this.#returnFocus();
  }
  #editorValues(modal: HTMLElement): EditorValues {
    return Object.fromEntries(
      [...modal.querySelectorAll<HTMLInputElement>("[name]")].map((field) => [
        field.name,
        field.type === "checkbox" ? field.checked : field.value,
      ]),
    );
  }
  #sameEditorValues(a: EditorValues, b: EditorValues): boolean {
    const normalized = (name: string, value: string | boolean) => {
      if (typeof value !== "string") return value;
      if (["department-name", "trading-name", "new-zone-name"].includes(name)) return value.trim();
      if (
        name === "assignment-order" &&
        value.trim() !== "" &&
        Number.isInteger(Number(value)) &&
        Number(value) >= 0
      )
        return Number(value);
      return value;
    };
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((name) =>
        Object.is(normalized(name, a[name]!), normalized(name, b[name]!)),
      )
    );
  }
  protected override updated(): void {
    if (this.#editorIdentity !== this.editor) {
      this.#editorScope?.dispose();
      this.#editorScope = undefined;
      this.#editorIdentity = this.editor;
      if (this.editor && this.editor.kind !== "disable") {
        const modal = this.renderRoot.querySelector("wt-modal")!;
        this.#leave ??= leaveCoordinatorFor(this);
        const baseline = (this.#editorBaseline ??= this.#editorValues(modal));
        let registering = true;
        this.#editorScope = this.#leave?.register({
          id: this.editor,
          current: () => (registering ? baseline : this.#editorValues(modal)),
          snapshot: (value) => ({ ...value }),
          equal: (a, b) => this.#sameEditorValues(a, b),
          restore: (value) => {
            for (const field of modal.querySelectorAll<HTMLInputElement>("[name]")) {
              const saved = value[field.name];
              if (typeof saved === "boolean") field.checked = saved;
              else if (saved !== undefined) field.value = saved;
            }
          },
        });
        registering = false;
        this.#editorScope?.changed();
      }
    }
  }
  readonly #beforeEditorClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy || !this.isConnected) return false;
    const editor = this.editor;
    if (!this.#editorScope) return true;
    const outcome = await this.#leave!.request({
      scopes: [this.#editorScope.id],
      reason,
      proceed() {},
    });
    return this.isConnected && this.editor === editor && outcome === "proceeded";
  };
  override disconnectedCallback(): void {
    this.#editorScope?.dispose();
    this.#editorScope = undefined;
    this.#editorIdentity = undefined;
    for (const draft of this.#nameDrafts.values()) {
      draft.scope?.dispose();
      draft.scope = undefined;
    }
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  /** Once an empty table gains a row, focus returns to its persistent Add button. */
  #returnFocus(): void {
    void this.updateComplete.then(() => {
      const opener = this.#opener;
      const openerAction = this.#openerAction;
      const twin =
        opener?.slot === "empty-action"
          ? this.renderRoot.querySelector<HTMLElement>(
              opener.dataset.test?.startsWith("new-assignment-")
                ? `[data-test="zone-menu-actions"] [data-test="${opener.dataset.test}"]`
                : `[data-test="policy-tree-actions"] [data-test="${opener.dataset.test}"]`,
            )
          : null;
      (opener?.isConnected &&
      (!openerAction ||
        (openerAction.element.isConnected &&
          openerAction.element.dataset.test === openerAction.key))
        ? opener
        : (twin ??
          this.renderRoot.querySelector<HTMLElement>(
            '[data-test="policy-tree-actions"] [data-test="new-department"]',
          ))
      )?.focus();
    });
  }
  #selectView(event: CustomEvent<{ value: View }>): void {
    this.view = event.detail.value;
  }
  #restart(): void {
    this.attempted = false;
    this.fieldErrors = {};
    this.refusedFields = {};
    this.editorError = undefined;
  }
  async #save(action: () => Promise<unknown>, fields: ServerFields = {}): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const editor = this.editor;
    const scope = this.#editorScope;
    const submitted =
      scope && this.renderRoot.querySelector("wt-modal")
        ? this.#editorValues(this.renderRoot.querySelector("wt-modal")!)
        : undefined;
    if (editor === undefined) this.actionError = undefined;
    let closed = false;
    try {
      await action();
      if (this.isConnected && this.editor === editor) {
        if (submitted) {
          this.#editorBaseline = { ...submitted };
          scope?.commit(submitted);
        }
        if (!scope?.isDirty()) {
          this.editor = undefined;
          scope?.dispose();
          this.#editorScope = undefined;
          this.#editorIdentity = undefined;
          this.#editorModel = undefined;
          this.#editorBaseline = undefined;
          this.#restart();
          closed = editor !== undefined;
        }
      }
      await this.#load();
    } catch (error) {
      if (editor === undefined) this.actionError = this.#refusal(codeOf(error ?? {}), error);
      else if (this.isConnected && this.editor === editor) this.#refused(error, fields);
    } finally {
      this.busy = false;
    }
    // Every Add button is disabled while busy, and focus does not take on a disabled one.
    if (closed) this.#returnFocus();
  }
  #refusal(code: string, error?: unknown): string {
    if (code === "department.last_active") return t("venue.department_last_active");
    if (code === "zone.table_in_use") {
      const tableName = (error as { params?: { tableName?: unknown } } | undefined)?.params
        ?.tableName;
      if (typeof tableName === "string") return format("venue.table_in_use", { table: tableName });
    }
    return t("venue.save_error");
  }
  #refused(error: unknown, { fields = {}, codes = {} }: ServerFields): void {
    const code = codeOf(error ?? {});
    const field = (error as { params?: { field?: unknown } } | undefined)?.params?.field;
    const control =
      code === "management.request_invalid"
        ? typeof field === "string" && Object.hasOwn(fields, field)
          ? fields[field]
          : undefined
        : Object.hasOwn(codes, code)
          ? codes[code]
          : undefined;
    if (control !== undefined) {
      this.refusedFields = { [control]: t("venue.field_refused") };
      this.#focusInvalid();
    } else {
      this.editorError = this.#refusal(code, error);
    }
  }
  /** The screen's shadow root also holds the lists, so only the editor is searched. */
  #focusInvalid(): void {
    void this.updateComplete.then(() => {
      const modal = this.renderRoot.querySelector("wt-modal");
      if (modal) void focusFirstInvalid(modal);
    });
  }
  /** What each editor field shows: its refusal, unless the field's own check finds something. */
  #errors(): Record<string, string> {
    return { ...this.refusedFields, ...this.fieldErrors };
  }
  #required(names: readonly string[]): Record<string, string> {
    return Object.fromEntries(
      names
        .filter((name) => this.#value(name).trim() === "")
        .map((name) => [name, t("venue.field_required")]),
    );
  }
  #input(name: string, label: string, value = "", type = "text") {
    return html`<wt-input
      name=${name}
      type=${type}
      label=${label}
      .value=${value}
      required
      error=${this.#errors()[name] ?? ""}
    ></wt-input>`;
  }
  #stepper(name: string, label: string, value: string) {
    return html`<wt-number-stepper
      name=${name}
      label=${label}
      .value=${value}
      min="0"
      required
      error=${this.#errors()[name] ?? ""}
      .decreaseLabel=${(text: string) => t("venue.decrease").replace("{label}", text)}
      .increaseLabel=${(text: string) => t("venue.increase").replace("{label}", text)}
    ></wt-number-stepper>`;
  }
  /** A value the choices do not hold starts on the first choice; the save reads what is shown. An
   * empty first choice is also the text shown while it is chosen. */
  #select(
    name: string,
    label: string,
    choices: readonly { id: string; name: string }[],
    value?: string,
    required = true,
    disabled = false,
  ) {
    const first = choices[0];
    const shown = choices.some((choice) => choice.id === value) ? value : (first?.id ?? "");
    return html`<wt-combobox
      name=${name}
      label=${label}
      search="auto"
      placeholder=${first?.id === "" ? first.name : ""}
      searchPlaceholder=${t("venue.combobox_search")}
      noResultsLabel=${t("venue.combobox_no_results")}
      .options=${choices.map((choice) => ({ value: choice.id, label: choice.name }))}
      .value=${shown}
      ?required=${required}
      ?disabled=${disabled}
      error=${this.#errors()[name] ?? ""}
    ></wt-combobox>`;
  }
  #modes(inherited = false) {
    return [
      ...(inherited ? [{ id: "", name: t("venue.inherit") }] : []),
      ...MODES.map((id) => ({ id, name: t(`venue.${id}`) })),
    ];
  }
  #actions(label: string, actions: Action[]) {
    return html`<wt-row-actions label=${`${t("venue.actions")}: ${label}`}>
      ${actions.map(
        (action) =>
          html`<wt-button
            variant="secondary"
            align="start"
            data-test=${action.key}
            ?disabled=${this.busy || action.disabled === true}
            @click=${(event: Event) => {
              const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
              this.#opener = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
              this.#openerAction = { element: event.currentTarget as HTMLElement, key: action.key };
              // An action that saves at once disables every action before the menu sees this click,
              // and the menu stays open for a click on a disabled action. Hiding it leaves focus
              // on the page, not on the menu's button.
              menu.hide();
              this.#opener.focus();
              action.run();
            }}
            >${action.label}</wt-button
          >`,
      )}
    </wt-row-actions>`;
  }
  #table<T>(
    key: string,
    viewKey: string,
    label: string,
    empty: string,
    rows: readonly T[],
    columns: DataTableColumn<T>[],
    rowKey: (row: T) => string,
    add?: Action,
  ) {
    return html`<wt-data-table
      data-test=${key}
      viewKey=${viewKey}
      customiseColumnsLabel=${t("venue.customise_columns")}
      customiseLabel=${t("venue.customise")}
      restoreColumnsLabel=${t("venue.restore_columns")}
      doneLabel=${t("venue.done")}
      moveColumnLabel=${t("venue.move_column")}
      showColumnLabel=${t("venue.show_column")}
      hideColumnLabel=${t("venue.hide_column")}
      alwaysShownColumnLabel=${t("venue.column_always_shown")}
      lastShownColumnLabel=${t("venue.column_last_shown")}
      columnPositionLabel=${t("venue.column_position")}
      aria-label=${label}
      .rows=${rows}
      .columns=${columns}
      .rowKey=${rowKey}
      .emptyMessage=${empty}
      .noMatchesMessage=${tableNoMatches()}
      >${add && rows.length === 0 ? this.#tabAction(add, "empty-action") : nothing}</wt-data-table
    >`;
  }
  #toolbar(label: string) {
    return html`<div class="toolbar"><h2>${label}</h2></div>`;
  }
  #tabAction(action: Action, slot?: "empty-action") {
    return html`<wt-button
      variant="primary"
      data-test=${action.key}
      slot=${ifDefined(slot)}
      ?disabled=${this.busy || action.disabled === true}
      @click=${(event: Event) => {
        this.#opener = event.currentTarget as HTMLElement;
        this.#openerAction = undefined;
        action.run();
      }}
      >${action.label}</wt-button
    >`;
  }
  #addDepartment(): Action {
    return {
      key: "new-department",
      label: t("venue.add_department"),
      run: () => this.#open({ kind: "department" }),
    };
  }
  #addZone(): Action {
    return {
      key: "new-zone",
      label: t("venue.add_zone"),
      disabled: !this.model!.departments.some((department) => department.active),
      run: () => this.#open({ kind: "new-zone" }),
    };
  }
  #addAssignment(zoneId: string): Action {
    return {
      key: `new-assignment-${zoneId}`,
      label: t("venue.make_available"),
      disabled: !this.model!.zones.some((row) => row.id === zoneId),
      run: () => this.#open({ kind: "assignment", zoneId }),
    };
  }
  #enableDepartment(key: string, row: Department): Action {
    return {
      key,
      label: t("venue.enable"),
      run: () => void this.#save(() => this.api.updateDepartment(row.id, { active: true })),
    };
  }
  async #confirmDepartment(row: Department): Promise<void> {
    try {
      const impact = await this.api.departmentRemovalImpact(row.id);
      this.#open({
        kind: "disable",
        name: row.name,
        action: () => this.api.deactivateDepartment(row.id),
        impact,
      });
    } catch (error) {
      this.actionError = this.#refusal(codeOf(error ?? {}), error);
    }
  }
  async #confirmZone(row: FloorZone, departmentId: string | null): Promise<void> {
    try {
      const impact =
        departmentId === null
          ? await this.api.zoneRemovalImpact(row.id)
          : await this.api.departmentRemovalImpact(departmentId);
      this.#open({
        kind: "disable",
        name: row.name,
        action: () => this.api.deactivateZone(row.id),
        impact: { zones: impact.zones.filter((zone) => zone.id === row.id) },
      });
    } catch (error) {
      this.actionError = this.#refusal(codeOf(error ?? {}), error);
    }
  }
  #readinessMessage(issue: VenueReadinessIssue): string {
    switch (issue.code) {
      case "venue.department_missing":
        return t("venue.readiness.department_missing");
      case "zone.department_missing":
        return `${issue.zoneName} ${t("venue.readiness.zone_department_missing")}`;
      case "zone.menu_missing":
        return `${issue.zoneName} ${t("venue.readiness.zone_menu_missing")}`;
      case "zone.menu_unpublished":
        return `${issue.zoneName} ${t("venue.readiness.zone_menu_unpublished")}`;
      case "zone.menu_empty":
        return `${issue.menuName} ${t("venue.readiness.menu_empty")} ${issue.zoneName}.`;
      case "venue.default_station_missing":
        return t("venue.readiness.default_station_missing");
    }
  }

  #readiness() {
    const issues = this.model!.readiness;
    return html`<section class="panel" data-test="readiness">
      <h2>${t("venue.readiness")}</h2>
      ${
        issues.length === 0
          ? html`<p>${t("venue.readiness.ok")}</p>`
          : html`<div role="alert">
              <ul>
                ${issues.map(
                  (issue, index) =>
                    html`<li data-test=${`readiness-issue-${index}`}>
                      ${this.#readinessMessage(issue)}
                    </li>`,
                )}
              </ul>
            </div>`
      }
    </section>`;
  }

  #policyTree() {
    const model = this.model!;
    const departments = [...model.departments];
    const floorZones = [...model.floorZones];
    for (const [kind, draft] of this.#nameDrafts) {
      if (!draft.row || this.#nameValue(kind).trim() === draft.baseline) continue;
      if (kind === "zone") {
        if (!floorZones.some((row) => row.id === draft.rowId))
          floorZones.push(draft.row as FloorZone);
      } else if (!departments.some((row) => row.id === draft.rowId))
        departments.push(draft.row as Department);
    }
    const activeDepartmentCount = model.departments.filter(
      (department) => department.active,
    ).length;
    const rows: PolicyRow[] = departments.flatMap((department) => [
      { kind: "department" as const, department },
      ...model.zones
        .filter((zone) => zone.departmentId === department.id)
        .flatMap((zone) => {
          const floorZone = floorZones.find((row) => row.id === zone.id);
          return floorZone
            ? [{ kind: "zone" as const, zone: floorZone, departmentId: department.id }]
            : [];
        }),
    ]);
    rows.push(
      ...floorZones
        .filter((zone) => !model.zones.some((configured) => configured.id === zone.id))
        .map((zone) => ({ kind: "zone" as const, zone, departmentId: null })),
    );
    const zoneDraft = this.#nameDrafts.get("zone");
    if (
      zoneDraft?.row &&
      this.zoneNameDraft.trim() !== zoneDraft.baseline &&
      !rows.some((row) => row.kind === "zone" && row.zone.id === zoneDraft.rowId)
    ) {
      rows.push({ kind: "zone", zone: zoneDraft.row as FloorZone, departmentId: null });
    }
    const policyFor = (row: PolicyRow) =>
      row.kind === "department"
        ? model.salePolicies.departments.find((policy) => policy.departmentId === row.department.id)
        : model.salePolicies.zones.find((policy) => policy.zoneId === row.zone.id)?.effective;
    const columns: DataTableColumn<PolicyRow>[] = [
      {
        key: "name",
        label: t("venue.name"),
        cell: (row) => {
          const zoneDraft = this.#nameDrafts.get("zone");
          const departmentDraft = this.#nameDrafts.get("department");
          if (row.kind !== "department")
            return html`${
              this.zoneNameEditor === row.zone.id
                ? html`<wt-input
                      name="zoneName"
                      @keydown=${(event: KeyboardEvent) => this.#nameKey(event, "zone", zoneDraft)}
                      label=${t("venue.name")}
                      hide-label
                      required
                      .value=${live(this.zoneNameDraft)}
                      error=${this.zoneNameError}
                      @wt-change=${(event: CustomEvent<{ value: string }>) => {
                        event.stopPropagation();
                        this.#changeName("zone", zoneDraft, event.detail.value);
                      }}
                    ></wt-input>
                    <button
                      type="button"
                      data-test="save-zone-name"
                      ?disabled=${this.busy}
                      @click=${() => void this.#saveName("zone", zoneDraft, (value) => this.api.updateZone(row.zone.id, { name: value }))}
                    >
                      ${t("venue.save")}
                    </button>
                    <button
                      type="button"
                      data-test="cancel-zone-name"
                      @click=${() => this.#leaveName("zone", zoneDraft, "cancel", () => this.#closeName("zone", zoneDraft!))}
                    >
                      ${t("venue.cancel")}
                    </button>`
                : html`<button
                    type="button"
                    part="edit-zone-name"
                    data-test="edit-zone-name"
                    aria-label=${`${row.zone.name}: ${t("venue.name")}`}
                    @click=${() => {
                      this.#openName("zone", row.zone.id, row.zone.name);
                    }}
                  >
                    ${row.zone.name}
                  </button>`
            }${row.zone.active === false ? html`<span part="inactive-zone-label">${t("venue.zone_disabled")}</span>` : row.departmentId === null ? html`<span part="unconfigured-zone-label">${t("venue.unconfigured")}</span>` : nothing}${model.readiness
              .filter((issue) => "zoneId" in issue && issue.zoneId === row.zone.id)
              .map(
                (issue) =>
                  html`<div part="zone-readiness" data-test="zone-readiness">
                    ${this.#readinessMessage(issue)}
                    ${
                      issue.code === "zone.menu_missing"
                        ? html`<button
                            type="button"
                            part="zone-readiness-action"
                            data-test="zone-readiness-action"
                            @click=${(event: Event) => {
                              this.#opener = event.currentTarget as HTMLElement;
                              this.#openerAction = undefined;
                              this.#open({ kind: "assignment", zoneId: row.zone.id });
                            }}
                          >
                            ${t("venue.make_available")}
                          </button>`
                        : nothing
                    }
                  </div>`,
              )}`;
          const displayName = row.department.name;
          if (this.departmentNameEditor !== row.department.id)
            return html`<button
                type="button"
                part="edit-department-name"
                data-test="edit-department-name"
                aria-label=${`${row.department.name}: ${t("venue.name")}`}
                @click=${() => {
                  this.#openName("department", row.department.id, row.department.name);
                }}
              >
                ${displayName}</button
              >${
                row.department.active
                  ? nothing
                  : html`<span part="inactive-department-label"
                      >${t("venue.department_disabled")}</span
                    >`
              }`;
          return html`<wt-input
              name="departmentName"
              @keydown=${(event: KeyboardEvent) => this.#nameKey(event, "department", departmentDraft)}
              label=${t("venue.name")}
              hide-label
              required
              .value=${live(this.departmentNameDraft)}
              error=${this.departmentNameError}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.#changeName("department", departmentDraft, event.detail.value);
              }}
            ></wt-input>
            <button
              type="button"
              data-test="save-department-name"
              ?disabled=${this.busy}
              @click=${() => void this.#saveName("department", departmentDraft, (value) => this.api.updateDepartment(row.department.id, { name: value, tradingName: row.department.tradingName, defaultServiceMode: row.department.defaultServiceMode }))}
            >
              ${t("venue.save")}
            </button>
            <button
              type="button"
              data-test="cancel-department-name"
              @click=${() => this.#leaveName("department", departmentDraft, "cancel", () => this.#closeName("department", departmentDraft!))}
            >
              ${t("venue.cancel")}
            </button>`;
        },
      },
      {
        key: "trading",
        label: t("venue.trading_name"),
        group: t("venue.on_receipt"),
        cell: (row) => {
          const tradingDraft = this.#nameDrafts.get("trading");
          if (row.kind !== "department") return nothing;
          if (this.tradingNameEditor !== row.department.id)
            return html`<span part="trading-name-cell"
              ><button
                type="button"
                part="edit-trading-name"
                data-test="edit-trading-name"
                aria-label=${`${row.department.name}: ${t("venue.trading_name")}, ${row.department.tradingName}`}
                @click=${() => {
                  this.#openName("trading", row.department.id, row.department.tradingName);
                }}
              >
                ${row.department.tradingName}
              </button>
              <a
                href=${`/manage/venue-settings/view/receipts?departmentId=${encodeURIComponent(row.department.id)}`}
                >${t("venue.preview")}</a
              ></span
            >`;
          return html`<wt-input
              name="tradingName"
              @keydown=${(event: KeyboardEvent) => this.#nameKey(event, "trading", tradingDraft)}
              label=${`${row.department.name}: ${t("venue.trading_name")}`}
              hide-label
              required
              .value=${live(this.tradingNameDraft)}
              error=${this.tradingNameError}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.#changeName("trading", tradingDraft, event.detail.value);
              }}
            ></wt-input>
            <button
              type="button"
              data-test="save-trading-name"
              ?disabled=${this.busy}
              @click=${() => void this.#saveName("trading", tradingDraft, (value) => this.api.updateDepartment(row.department.id, { name: row.department.name, tradingName: value, defaultServiceMode: row.department.defaultServiceMode }))}
            >
              ${t("venue.save")}
            </button>
            <button
              type="button"
              data-test="cancel-trading-name"
              @click=${() => this.#leaveName("trading", tradingDraft, "cancel", () => this.#closeName("trading", tradingDraft!))}
            >
              ${t("venue.cancel")}
            </button>`;
        },
      },
      {
        key: "printTradingName",
        label: t("venue.print_it"),
        group: t("venue.on_receipt"),
        cell: (row) => {
          if (row.kind !== "department") return nothing;
          const checked =
            this.printTradingNameDrafts[row.department.id] ??
            policyFor(row)?.printTradingName ??
            false;
          return html`<wt-switch
            name="printTradingName"
            label=${t("venue.print_it")}
            .checked=${live(checked)}
            .disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
              event.stopPropagation();
              this.printTradingNameDrafts = {
                ...this.printTradingNameDrafts,
                [row.department.id]: event.detail.checked,
              };
              void this.#save(async () => {
                await this.api.setDepartmentSalePolicyField(
                  row.department.id,
                  "printTradingName",
                  event.detail.checked,
                );
                const drafts = { ...this.printTradingNameDrafts };
                delete drafts[row.department.id];
                this.printTradingNameDrafts = drafts;
              });
            }}
          ></wt-switch>`;
        },
      },
      {
        key: "paid",
        label: t("venue.paid"),
        group: t("venue.quick_sales"),
        cell: (row) => {
          const key =
            row.kind === "department" ? `department-${row.department.id}` : `zone-${row.zone.id}`;
          const paidWhen = policyFor(row)?.paidWhen;
          if (paidWhen === undefined) return nothing;
          const stored =
            row.kind === "department"
              ? paidWhen
              : model.salePolicies.zones.find((policy) => policy.zoneId === row.zone.id)?.paidWhen;
          const effectiveLabel =
            paidWhen === "ticket_then_pay" ? t("venue.pay_on_collection") : t("venue.prepay");
          if (this.paidEditor !== key) {
            return html`<button
              type="button"
              part=${row.kind === "zone" && stored == null ? "edit-paid inherited-value" : "edit-paid"}
              data-test="edit-paid"
              aria-label=${`${row.kind === "department" ? row.department.name : row.zone.name}: ${t("venue.paid")}, ${effectiveLabel}`}
              @click=${() => (this.paidEditor = key)}
            >
              ${effectiveLabel}
            </button>`;
          }
          return html`<wt-combobox
            name="paidWhen"
            label=${`${row.kind === "department" ? row.department.name : row.zone.name}: ${t("venue.paid")}`}
            hide-label
            .options=${[
              ...(row.kind === "zone"
                ? [{ value: "", label: `${t("venue.inherit")} (${effectiveLabel})` }]
                : []),
              { value: "prepay", label: t("venue.prepay") },
              { value: "ticket_then_pay", label: t("venue.pay_on_collection") },
            ]}
            .value=${live(this.paidDrafts[key] ?? stored ?? "")}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              const value = event.detail.value;
              if (value === (stored ?? "")) {
                const drafts = { ...this.paidDrafts };
                delete drafts[key];
                this.paidDrafts = drafts;
                this.paidEditor = undefined;
                this.actionError = undefined;
                return;
              }
              this.paidDrafts = { ...this.paidDrafts, [key]: value };
              void this.#save(async () => {
                if (row.kind === "department")
                  await this.api.setDepartmentSalePolicyField(
                    row.department.id,
                    "paidWhen",
                    value as "prepay" | "ticket_then_pay",
                  );
                else
                  await this.api.setZoneSalePolicyOverride(
                    row.zone.id,
                    "paidWhen",
                    value ? (value as "prepay" | "ticket_then_pay") : null,
                  );
                const drafts = { ...this.paidDrafts };
                delete drafts[key];
                this.paidDrafts = drafts;
                this.paidEditor = undefined;
              });
            }}
          ></wt-combobox>`;
        },
      },
      {
        key: "collection",
        label: t("venue.collection_number"),
        group: t("venue.quick_sales"),
        cell: (row) => {
          const key =
            row.kind === "department" ? `department-${row.department.id}` : `zone-${row.zone.id}`;
          const collectionNumber = policyFor(row)?.collectionNumber;
          if (collectionNumber === undefined) return nothing;
          const stored =
            row.kind === "department"
              ? collectionNumber
              : model.salePolicies.zones.find((policy) => policy.zoneId === row.zone.id)
                  ?.collectionNumber;
          const effectiveLabel =
            collectionNumber === "numbered" ? t("venue.numbered") : t("venue.none");
          const help = (slot?: string) =>
            html`<wt-help-tooltip
              slot=${ifDefined(slot)}
              aria-label=${t("venue.collection_number_help_label")}
              >${t("venue.collection_number_help")}</wt-help-tooltip
            >`;
          if (this.collectionEditor !== key)
            return html`<span part="collection-cell"
              ><button
                type="button"
                part=${row.kind === "zone" && stored == null ? "edit-collection inherited-value" : "edit-collection"}
                data-test="edit-collection"
                aria-label=${`${row.kind === "department" ? row.department.name : row.zone.name}: ${t("venue.collection_number")}, ${effectiveLabel}`}
                @click=${() => (this.collectionEditor = key)}
              >
                ${effectiveLabel}</button
              >${help()}</span
            >`;
          return html`<wt-combobox
            name="collectionNumber"
            label=${`${row.kind === "department" ? row.department.name : row.zone.name}: ${t("venue.collection_number")}`}
            hide-label
            .options=${[
              ...(row.kind === "zone"
                ? [{ value: "", label: `${t("venue.inherit")} (${effectiveLabel})` }]
                : []),
              { value: "none", label: t("venue.none") },
              { value: "numbered", label: t("venue.numbered") },
            ]}
            .value=${live(this.collectionDrafts[key] ?? stored ?? "")}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              const value = event.detail.value;
              if (value === (stored ?? "")) {
                const drafts = { ...this.collectionDrafts };
                delete drafts[key];
                this.collectionDrafts = drafts;
                this.collectionEditor = undefined;
                this.actionError = undefined;
                return;
              }
              this.collectionDrafts = { ...this.collectionDrafts, [key]: value };
              void this.#save(async () => {
                if (row.kind === "department")
                  await this.api.setDepartmentSalePolicyField(
                    row.department.id,
                    "collectionNumber",
                    value as "none" | "numbered",
                  );
                else
                  await this.api.setZoneSalePolicyOverride(
                    row.zone.id,
                    "collectionNumber",
                    value ? (value as "none" | "numbered") : null,
                  );
                const drafts = { ...this.collectionDrafts };
                delete drafts[key];
                this.collectionDrafts = drafts;
                this.collectionEditor = undefined;
              });
            }}
            >${help("help")}</wt-combobox
          >`;
        },
      },
      {
        key: "receipt",
        label: t("venue.receipt"),
        group: t("venue.every_sale"),
        cell: (row) => {
          const key =
            row.kind === "department" ? `department-${row.department.id}` : `zone-${row.zone.id}`;
          const receiptPrintMode = policyFor(row)?.receiptPrintMode;
          if (receiptPrintMode === undefined) return nothing;
          const stored =
            row.kind === "department"
              ? receiptPrintMode
              : model.salePolicies.zones.find((policy) => policy.zoneId === row.zone.id)
                  ?.receiptPrintMode;
          const effectiveLabel =
            receiptPrintMode === "auto"
              ? t("venue.always")
              : receiptPrintMode === "on_request"
                ? t("venue.on_request")
                : receiptPrintMode === "never"
                  ? t("venue.never")
                  : "";
          const inheritedMode =
            row.kind === "zone"
              ? model.salePolicies.departments.find(
                  (policy) => policy.departmentId === row.departmentId,
                )?.receiptPrintMode
              : undefined;
          const inheritedLabel =
            inheritedMode === "auto"
              ? t("venue.always")
              : inheritedMode === "on_request"
                ? t("venue.on_request")
                : t("venue.never");
          if (this.receiptEditor !== key)
            return html`<button
              type="button"
              part=${row.kind === "zone" && stored == null ? "edit-receipt inherited-value" : "edit-receipt"}
              data-test="edit-receipt"
              aria-label=${`${row.kind === "department" ? row.department.name : row.zone.name}: ${t("venue.receipt")}, ${effectiveLabel}`}
              @click=${() => (this.receiptEditor = key)}
            >
              ${effectiveLabel}
            </button>`;
          return html`<wt-combobox
            name="receiptPrintMode"
            searchPlaceholder=${t("venue.combobox_search")}
            noResultsLabel=${t("venue.combobox_no_results")}
            label=${`${row.kind === "department" ? row.department.name : row.zone.name}: ${t("venue.receipt")}`}
            hide-label
            .options=${[
              ...(row.kind === "zone"
                ? [{ value: "", label: `${t("venue.inherit")} (${inheritedLabel})` }]
                : []),
              { value: "auto", label: t("venue.always") },
              { value: "on_request", label: t("venue.on_request") },
              { value: "never", label: t("venue.never") },
            ]}
            .value=${live(this.receiptDrafts[key] ?? stored ?? "")}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              const value = event.detail.value;
              if (value === (stored ?? "")) {
                const drafts = { ...this.receiptDrafts };
                delete drafts[key];
                this.receiptDrafts = drafts;
                this.receiptEditor = undefined;
                this.actionError = undefined;
                return;
              }
              this.receiptDrafts = { ...this.receiptDrafts, [key]: value };
              void this.#save(async () => {
                if (row.kind === "department")
                  await this.api.setDepartmentSalePolicyField(
                    row.department.id,
                    "receiptPrintMode",
                    value as "auto" | "on_request" | "never",
                  );
                else
                  await this.api.setZoneSalePolicyOverride(
                    row.zone.id,
                    "receiptPrintMode",
                    value ? (value as "auto" | "on_request" | "never") : null,
                  );
                const drafts = { ...this.receiptDrafts };
                delete drafts[key];
                this.receiptDrafts = drafts;
                this.receiptEditor = undefined;
              });
            }}
          ></wt-combobox>`;
        },
      },
      {
        key: "actions",
        label: t("venue.actions"),
        pinned: "end",
        cell: (row) =>
          row.kind === "department"
            ? this.#actions(row.department.name, [
                {
                  key: `edit-tree-department-${row.department.id}`,
                  label: t("venue.edit"),
                  run: () => this.#open({ kind: "department", row: row.department }),
                },
                {
                  key: `rename-tree-department-${row.department.id}`,
                  label: t("venue.rename"),
                  run: () => {
                    this.#openName("department", row.department.id, row.department.name);
                  },
                },
                {
                  key: `hours-tree-department-${row.department.id}`,
                  label: t("venue.hours"),
                  run: () => openHoursPage(row.department.id),
                },
                row.department.active
                  ? {
                      key: `remove-tree-department-${row.department.id}`,
                      label: t("venue.disable"),
                      run: () => void this.#confirmDepartment(row.department),
                    }
                  : this.#enableDepartment(
                      `enable-tree-department-${row.department.id}`,
                      row.department,
                    ),
              ])
            : this.#actions(row.zone.name, [
                {
                  key: `rename-tree-zone-${row.zone.id}`,
                  label: t("venue.rename"),
                  run: () => {
                    this.#openName("zone", row.zone.id, row.zone.name);
                  },
                },
                ...(row.departmentId === null || activeDepartmentCount > 1
                  ? [
                      {
                        key: `${row.departmentId === null ? "configure" : "move"}-tree-zone-${row.zone.id}`,
                        label:
                          row.departmentId === null
                            ? t("venue.edit")
                            : t("venue.move_to_department"),
                        run: () => this.#open({ kind: "zone", row: row.zone }),
                      },
                    ]
                  : []),
                {
                  key: `menus-tree-zone-${row.zone.id}`,
                  label: t("venue.menus"),
                  run: () => {
                    this.zoneId = row.zone.id;
                  },
                },
                ...(row.zone.active !== false
                  ? [
                      {
                        key: `remove-tree-zone-${row.zone.id}`,
                        label: t("venue.disable"),
                        run: () => void this.#confirmZone(row.zone, row.departmentId),
                      },
                    ]
                  : // `listServiceZones` leaves out an active zone of a disabled department, so
                    // enabling one there would not put it back in service.
                    row.departmentId === null ||
                      departments.some(
                        (department) => department.id === row.departmentId && department.active,
                      )
                    ? [
                        {
                          key: `enable-tree-zone-${row.zone.id}`,
                          label: t("venue.enable"),
                          run: () =>
                            void this.#save(() =>
                              this.api.updateZone(row.zone.id, { active: true }),
                            ),
                        },
                      ]
                    : []),
              ]),
      },
    ];
    return html`<section>
      <div class="toolbar" data-test="policy-tree-actions">
        <h2>${t("venue.title")}</h2>
        <div>${this.#tabAction(this.#addDepartment())} ${this.#tabAction(this.#addZone())}</div>
      </div>
      <wt-data-table
        data-test="policy-tree"
        viewKey="waitron.venue.policy-tree"
        aria-label=${t("venue.title")}
        .rows=${rows}
        .columns=${columns}
        .rowKey=${(row: PolicyRow) =>
          row.kind === "department" ? `department-${row.department.id}` : `zone-${row.zone.id}`}
        .rowParent=${(row: PolicyRow) =>
          row.kind === "department" || row.departmentId === null
            ? null
            : `department-${row.departmentId}`}
        .rowCollapsible=${(row: PolicyRow) => row.kind === "department"}
        .rowToggleLabel=${(row: PolicyRow, expanded: boolean) =>
          t(expanded ? "venue.collapse_department" : "venue.expand_department").replace(
            "{name}",
            row.kind === "department" ? row.department.name : row.zone.name,
          )}
        .rowActivation=${() => "none" as const}
        .emptyMessage=${t("venue.no_departments")}
        .noMatchesMessage=${tableNoMatches()}
      ></wt-data-table>
    </section>`;
  }

  #departments() {
    const model = this.model!;
    return html`<section>
      ${this.#toolbar(t("venue.departments"))}
      ${this.#table(
        "departments",
        "waitron.venue.departments.table",
        t("venue.departments"),
        t("venue.no_departments"),
        model.departments,
        [
          {
            key: "name",
            label: t("venue.name"),
            cell: (row) => row.name,
            sortValue: (row) => row.name,
          },
          {
            key: "trading",
            label: t("venue.trading_name"),
            choosable: "shown",
            cell: (row) => row.tradingName,
          },
          {
            key: "mode",
            label: t("venue.service_style"),
            choosable: "shown",
            cell: (row) => t(`venue.${row.defaultServiceMode}`),
          },
          {
            key: "state",
            label: t("venue.status"),
            choosable: "shown",
            cell: (row) => t(row.active ? "venue.active" : "venue.department_disabled"),
          },
          {
            key: "actions",
            label: t("venue.actions"),
            pinned: "end",
            cell: (row) =>
              this.#actions(row.name, [
                {
                  key: `edit-department-${row.id}`,
                  label: t("venue.edit"),
                  run: () => this.#open({ kind: "department", row }),
                },
                row.active
                  ? {
                      key: `deactivate-department-${row.id}`,
                      label: t("venue.disable_department"),
                      run: () => void this.#confirmDepartment(row),
                    }
                  : this.#enableDepartment(`enable-department-${row.id}`, row),
              ]),
          },
        ],
        (row) => row.id,
        this.#addDepartment(),
      )}
    </section>`;
  }
  #zones() {
    const model = this.model!;
    return html`<section>
      <h2>${t("venue.zones")}</h2>
      ${this.#table(
        "zones",
        "waitron.venue.zones.table",
        t("venue.zones"),
        t("venue.no_zones"),
        model.floorZones,
        [
          {
            key: "name",
            label: t("venue.zone"),
            cell: (row) => row.name,
            sortValue: (row) => row.name,
          },
          {
            key: "department",
            label: t("venue.department"),
            choosable: "shown",
            cell: (row) =>
              model.zones.find((z) => z.id === row.id)?.departmentName ?? t("venue.unconfigured"),
          },
          {
            key: "mode",
            label: t("venue.service_style"),
            choosable: "shown",
            cell: (row) => {
              const mode = model.zones.find((z) => z.id === row.id)?.serviceMode;
              return mode ? t(`venue.${mode}`) : t("venue.unconfigured");
            },
          },
          {
            key: "default",
            label: t("venue.default"),
            choosable: "shown",
            cell: (row) =>
              model.menus.find(
                (menu) =>
                  menu.id ===
                  model.zoneMenus.find((z) => z.zoneId === row.id && z.isDefault)?.menuId,
              )?.name ?? t("venue.unconfigured"),
          },
          {
            key: "actions",
            label: t("venue.actions"),
            pinned: "end",
            cell: (row) =>
              this.#actions(row.name, [
                {
                  key: `edit-zone-${row.id}`,
                  label: t("venue.edit"),
                  run: () => this.#open({ kind: "zone", row }),
                },
              ]),
          },
        ],
        (row) => row.id,
      )}
    </section>`;
  }
  #zoneMenus() {
    const model = this.model!;
    const zone = model.floorZones.find((row) => row.id === this.zoneId);
    return html`<section>
      ${
        zone
          ? html`<div class="toolbar" data-test="zone-menu-actions">
                <h2>${zone.name}: ${t("venue.menus")}</h2>
                ${this.#tabAction(this.#addAssignment(zone.id))}
              </div>
              ${this.#table(
                "zone-menus",
                "waitron.venue.zone-menus.table",
                t("venue.menus"),
                t("venue.no_zone_menus"),
                model.zoneMenus.filter((row) => row.zoneId === zone.id),
                [
                  {
                    key: "menu",
                    label: t("venue.menu_name"),
                    cell: (row) => model.menus.find((menu) => menu.id === row.menuId)?.name,
                  },
                  {
                    key: "default",
                    label: t("venue.default"),
                    choosable: "shown",
                    cell: (row) => t(row.isDefault ? "venue.yes" : "venue.no"),
                  },
                  {
                    key: "order",
                    label: t("venue.display_order"),
                    choosable: "shown",
                    cell: (row) => String(row.displayOrder),
                  },
                  {
                    key: "actions",
                    label: t("venue.actions"),
                    pinned: "end",
                    cell: (row) =>
                      this.#actions(
                        model.menus.find((menu) => menu.id === row.menuId)?.name ?? row.menuId,
                        [
                          {
                            key: `edit-assignment-${row.menuId}`,
                            label: t("venue.edit"),
                            run: () =>
                              this.#open({
                                kind: "assignment",
                                zoneId: zone.id,
                                menuId: row.menuId,
                              }),
                          },
                          {
                            key: `default-assignment-${row.menuId}`,
                            label: t("venue.make_default"),
                            disabled: row.isDefault,
                            run: () => {
                              void this.#save(() =>
                                this.api.allowMenu(zone.id, row.menuId, {
                                  displayOrder: row.displayOrder,
                                  makeDefault: true,
                                }),
                              );
                            },
                          },
                        ],
                      ),
                  },
                ],
                (row) => row.menuId,
                this.#addAssignment(zone.id),
              )}`
          : nothing
      }
    </section>`;
  }
  #editorContent(editor: Editor): EditorContent {
    const model = this.#editorModel ?? this.model!;
    switch (editor.kind) {
      case "new-zone":
        return {
          heading: t("venue.add_zone"),
          body: html`${this.#input("new-zone-name", t("venue.zone_name"))}${this.#select(
            "new-zone-department",
            t("venue.department"),
            model.departments.filter((department) => department.active),
            undefined,
            true,
          )}`,
          check: () => this.#required(["new-zone-name", "new-zone-department"]),
          save: () => {
            void this.#save(
              () =>
                this.api.createZone({
                  name: this.#value("new-zone-name").trim(),
                  departmentId: this.#value("new-zone-department"),
                }),
              {
                fields: { name: "new-zone-name", departmentId: "new-zone-department" },
                codes: {
                  "zone.name_taken": "new-zone-name",
                  "department.not_found": "new-zone-department",
                },
              },
            );
          },
        };
      case "department":
        return {
          heading: t(editor.row ? "venue.edit_department" : "venue.add_department"),
          body: html`${this.#input("department-name", t("venue.name"), editor.row?.name)}${this.#input("trading-name", t("venue.trading_name"), editor.row?.tradingName)}${this.#select("department-mode", t("venue.service_style"), this.#modes(), editor.row?.defaultServiceMode ?? "prepay")}`,
          check: () => this.#required(["department-name", "trading-name", "department-mode"]),
          save: () => {
            const input = {
              name: this.#value("department-name").trim(),
              tradingName: this.#value("trading-name").trim(),
              defaultServiceMode: this.#value("department-mode") as ServiceMode,
            };
            void this.#save(
              () =>
                editor.row
                  ? this.api.updateDepartment(editor.row.id, input)
                  : this.api.createDepartment(input),
              {
                fields: {
                  name: "department-name",
                  tradingName: "trading-name",
                  defaultServiceMode: "department-mode",
                },
              },
            );
          },
        };
      case "zone": {
        const configured = model.zones.find((zone) => zone.id === editor.row.id);
        return {
          heading: `${t("venue.edit")}: ${editor.row.name}`,
          body: html`${this.#select(
            `zone-department-${editor.row.id}`,
            t("venue.department"),
            model.departments.filter((row) => row.active),
            configured?.departmentId,
          )}${this.#select(`zone-mode-${editor.row.id}`, t("venue.service_style"), this.#modes(true), configured?.serviceModeOverride ?? "", false)}`,
          check: () => this.#required([`zone-department-${editor.row.id}`]),
          save: () => {
            const serviceMode = this.#value(`zone-mode-${editor.row.id}`);
            const input = {
              departmentId: this.#value(`zone-department-${editor.row.id}`),
              serviceMode: serviceMode === "" ? null : (serviceMode as ServiceMode),
            };
            void this.#save(() => this.api.configureZone(editor.row.id, input), {
              fields: {
                departmentId: `zone-department-${editor.row.id}`,
                serviceMode: `zone-mode-${editor.row.id}`,
              },
              codes: { "department.not_found": `zone-department-${editor.row.id}` },
            });
          },
        };
      }
      case "assignment": {
        const assignment = model.zoneMenus.find(
          (row) => row.zoneId === editor.zoneId && row.menuId === editor.menuId,
        );
        const menus = model.menus.filter(
          (menu) =>
            menu.id === editor.menuId ||
            (menu.active &&
              !model.zoneMenus.some(
                (row) => row.zoneId === editor.zoneId && row.menuId === menu.id,
              )),
        );
        return {
          heading: t(assignment ? "venue.edit_assignment" : "venue.make_available"),
          body: html`${this.#select("assignment-menu", t("venue.menu_name"), menus, editor.menuId, true, !!assignment)}${this.#stepper("assignment-order", t("venue.display_order"), String(assignment?.displayOrder ?? model.zoneMenus.filter((row) => row.zoneId === editor.zoneId).length))}<label
              >${t("venue.default")}<input
                type="checkbox"
                name="assignment-default"
                .checked=${assignment?.isDefault ?? false}
                ?disabled=${assignment?.isDefault === true}
            /></label>`,
          check: () => {
            const missing = this.#required(["assignment-menu", "assignment-order"]);
            if (Object.keys(missing).length > 0) return missing;
            const displayOrder = Number(this.#value("assignment-order"));
            return Number.isInteger(displayOrder) && displayOrder >= 0
              ? {}
              : { "assignment-order": t("venue.order_invalid") };
          },
          save: () => {
            const displayOrder = Number(this.#value("assignment-order"));
            const menuId = this.#value("assignment-menu");
            const makeDefault = this.renderRoot.querySelector<HTMLInputElement>(
              '[name="assignment-default"]',
            )!.checked;
            void this.#save(
              () => this.api.allowMenu(editor.zoneId, menuId, { displayOrder, makeDefault }),
              {
                fields: { displayOrder: "assignment-order" },
                codes: { "catalogue.not_found": "assignment-menu" },
              },
            );
          },
        };
      }
      case "disable":
        return {
          heading: format("venue.disable_confirm", { name: editor.name }),
          body: html`<p>${editor.name}</p>
            ${editor.impact?.zones.map(
              (zone) =>
                html`<p>
                  ${zone.name}:
                  ${format("venue.active_tables", { count: String(zone.activeTableCount) })}
                </p>`,
            )}`,
          check: () => ({}),
          save: () => {
            void this.#save(editor.action);
          },
        };
    }
  }
  /** A load failure, and with no editor open, a refusal of something saved at once. An open editor
   * says its own refusals at the end of its body. */
  #pageAlert() {
    const messages = [
      ...(this.loadError ? [this.loadError] : []),
      ...(this.editor ? [] : this.actionError ? [this.actionError] : []),
    ];
    return html`<div role="alert" data-test="page-alert">
      ${messages.map((message) => html`<p>${message}</p>`)}
    </div>`;
  }
  #submit(content: EditorContent): void {
    this.attempted = true;
    this.refusedFields = {};
    this.editorError = undefined;
    this.fieldErrors = content.check();
    if (Object.keys(this.fieldErrors).length === 0) {
      content.save();
      return;
    }
    this.#focusInvalid();
  }
  #modal() {
    if (!this.editor) return nothing;
    const editor = this.editor;
    const content = this.#editorContent(editor);
    const marked = Object.keys(this.#errors()).length > 0;
    const invalid = Object.keys(this.fieldErrors).length > 0;
    const recheck = (event: Event) => {
      if (!this.isConnected || this.editor !== editor) return;
      this.#editorScope?.changed();
      const name = (event.target as HTMLInputElement).name;
      if (Object.hasOwn(this.refusedFields, name)) {
        const refused = { ...this.refusedFields };
        delete refused[name];
        this.refusedFields = refused;
      }
      if (this.attempted) this.fieldErrors = content.check();
    };
    const confirming = editor.kind === "disable";
    return keyed(
      editor,
      html`<wt-modal
        size=${confirming ? "compact" : "standard"}
        open
        heading=${content.heading}
        .beforeClose=${this.#beforeEditorClose}
        @wt-close=${() => {
          if (this.editor === editor) this.#close();
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (!this.isConnected || this.editor !== editor) return;
          if (event.key === "Escape" && this.busy) {
            event.preventDefault();
            event.stopPropagation();
          }
          submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-editor"]'));
        }}
      >
        <div class="form" @wt-change=${recheck} @change=${recheck}>${content.body}</div>
        <wt-form-actions
          slot="footer"
          .error=${[...(this.editorError ? [this.editorError] : []), ...(marked ? [t("venue.fix_fields")] : [])].join(" ")}
          ><wt-button
            slot="cancel"
            variant="secondary"
            data-test="cancel-editor"
            ?disabled=${this.busy}
            @click=${(event: Event) => {
              if (this.editor === editor && this.isConnected)
                void (event.currentTarget as HTMLElement)
                  .closest("wt-modal")!
                  .requestClose("cancel");
            }}
            >${t("venue.cancel")}</wt-button
          ><wt-button
            data-test="save-editor"
            variant=${confirming ? "danger" : "primary"}
            ?disabled=${this.busy || invalid}
            @click=${() => {
              if (this.editor === editor && this.isConnected) this.#submit(content);
            }}
            >${t(confirming ? "venue.confirm" : "venue.save")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>`,
    );
  }
  override render() {
    return html`<h1>${t("venue.title")}</h1>
      ${this.#pageAlert()}
      ${
        this.model
          ? html`${this.#policyTree()} ${this.#readiness()} ${this.#zoneMenus()}
              <wt-tabs
                label=${t("venue.title")}
                .value=${this.view}
                .items=${[
                  { key: "departments", label: t("venue.departments") },
                  { key: "zones", label: t("venue.zones") },
                ]}
                @wt-tab-change=${this.#selectView}
              >
                <div slot="departments">${this.#departments()}</div>
                <div slot="zones">${this.#zones()}</div>
              </wt-tabs>
              ${this.#modal()}`
          : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-operations-screen": VenueOperationsScreen;
  }
}
