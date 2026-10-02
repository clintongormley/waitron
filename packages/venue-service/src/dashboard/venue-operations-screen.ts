import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { QueryController } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { codeOf } from "@waitron/dashboard-kit";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  UrlStateController,
  type DataTableColumn,
} from "@waitron/ui";
import type {
  Department,
  FloorZone,
  HoursInterval,
  KitchenTicketGrouping,
  ServiceMode,
  VenueReadinessIssue,
  VenueServiceApi,
  VenueServiceView,
} from "./client.js";
import { t } from "./strings.js";

const MODES: ServiceMode[] = ["table_tab", "prepay", "invoice_first", "ticket_then_pay"];
const GROUPINGS: KitchenTicketGrouping[] = ["combined", "separate"];
const REMINDER_MINUTES = [5, 10, 15, 20, 30];
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const VIEWS = ["status", "departments", "zones", "kitchen"] as const;
type View = (typeof VIEWS)[number];
type Editor =
  | { kind: "department"; row?: Department }
  | { kind: "hours"; row?: HoursInterval; index?: number }
  | { kind: "zone"; row: FloorZone }
  | { kind: "assignment"; zoneId: string; menuId?: string }
  | { kind: "delete"; name: string; action: () => Promise<unknown> };
type Action = { key: string; label: string; run: () => void; disabled?: boolean };
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
      wt-data-table::part(till-zone) {
        font-size: var(--wt-font-size-sm);
      }
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
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
      .setting {
        margin-top: var(--wt-space-4);
      }
      .hint {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
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
  /** The open editor's check results, or with none open, the instant settings' refusals. */
  @state() private fieldErrors: Record<string, string> = {};
  /** The server's refusal of an editor field, until the operator changes that field or saves again. */
  @state() private refusedFields: Record<string, string> = {};
  /** A refusal that names no field the editor shows, until the operator saves again. */
  @state() private editorError?: string;
  /** Save has been pressed in the open editor, so it re-checks its fields on every change. */
  @state() private attempted = false;
  @state() private busy = false;
  @state() private view: View = "status";
  @state() private editor?: Editor;
  @state() private zoneId = "";
  #opener?: HTMLElement;

  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "venue-operations") return;
      const value = this.#url.read("view");
      this.view = VIEWS.includes(value as View) ? (value as View) : "status";
      this.#url.write({ dashboard: "venue-operations", view: this.view }, true);
    },
    { basePath: "/manage", primary: "dashboard", children: { "*": { view: "view" } } },
  );

  override connectedCallback(): void {
    super.connectedCallback();
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
    this.editor = editor;
    this.actionError = undefined;
    this.#restart();
  }
  #close(): void {
    this.editor = undefined;
    this.#restart();
    void this.updateComplete.then(() => {
      if (this.#opener?.isConnected) this.#opener.focus();
      else this.renderRoot.querySelector<HTMLElement>("wt-tabs")?.focus();
    });
  }
  #selectView(event: CustomEvent<{ value: View }>): void {
    this.view = event.detail.value;
    this.#url.write({ dashboard: "venue-operations", view: this.view });
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
    if (editor === undefined) this.actionError = undefined;
    try {
      await action();
      if (this.editor === editor) this.#close();
      await this.#load();
    } catch (error) {
      if (editor === undefined) this.actionError = this.#refusal(codeOf(error ?? {}));
      else this.#refused(error, fields);
    } finally {
      this.busy = false;
    }
  }
  #refusal(code: string): string {
    return code === "department.has_active_zones"
      ? t("venue.department_has_zones")
      : t("venue.save_error");
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
      this.editorError = this.#refusal(code);
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
  async #saveEditSentLines(editSentLines: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.actionError = undefined;
    this.fieldErrors = {};
    try {
      await this.api.saveSettings({ editSentLines });
      this.model = { ...this.model!, settings: { editSentLines } };
      await this.#load();
    } catch {
      this.fieldErrors = { editSentLines: t("venue.save_error") };
    } finally {
      this.busy = false;
    }
  }
  async #saveKitchenTicketGrouping(kitchenTicketGrouping: KitchenTicketGrouping): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.actionError = undefined;
    this.fieldErrors = {};
    try {
      await this.api.saveKitchenTicketGrouping(kitchenTicketGrouping);
      this.model = { ...this.model!, kitchenTicketGrouping };
      await this.#load();
    } catch {
      this.fieldErrors = { kitchenTicketGrouping: t("venue.save_error") };
    } finally {
      this.busy = false;
    }
  }
  async #saveReleaseReminderMinutes(releaseReminderMinutes: number | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.actionError = undefined;
    this.fieldErrors = {};
    try {
      await this.api.saveReleaseReminderMinutes(releaseReminderMinutes);
      this.model = { ...this.model!, releaseReminderMinutes };
      await this.#load();
    } catch {
      this.fieldErrors = { releaseReminderMinutes: t("venue.save_error") };
    } finally {
      this.busy = false;
    }
  }
  async #savePrintHeldWork(printHeldWork: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.actionError = undefined;
    this.fieldErrors = {};
    try {
      await this.api.savePrintHeldWork(printHeldWork);
      this.model = { ...this.model!, printHeldWork };
      await this.#load();
    } catch {
      this.fieldErrors = { printHeldWork: t("venue.save_error") };
    } finally {
      this.busy = false;
    }
  }
  #required(names: readonly string[]): Record<string, string> {
    return Object.fromEntries(
      names
        .filter((name) => this.#value(name).trim() === "")
        .map((name) => [name, t("venue.field_required")]),
    );
  }
  #fieldError(name: string) {
    const message = this.#errors()[name];
    return message
      ? html`<p id=${`error-${name}`} class="field-error" data-field-error=${name}>${message}</p>`
      : nothing;
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
              // An action that saves at once disables every action before the menu sees this click,
              // and the menu stays open for a click on a disabled action.
              menu.hide();
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
    rows: readonly T[],
    columns: DataTableColumn<T>[],
    rowKey: (row: T) => string,
    add?: Action,
  ) {
    return html`<wt-data-table
      data-test=${key}
      viewKey=${viewKey}
      columnsLabel=${t("venue.columns")}
      aria-label=${label}
      .rows=${rows}
      .columns=${columns}
      .rowKey=${rowKey}
      .emptyMessage=${t("venue.no_rows")}
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
  #addHours(): Action {
    return {
      key: "new-hours",
      label: t("venue.add_hours"),
      disabled: this.model!.departments.length === 0,
      run: () => this.#open({ kind: "hours" }),
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
  #tabActions() {
    const model = this.model!;
    const zone = model.floorZones.find((row) => row.id === this.zoneId);
    return html`<div slot="actions">
      ${
        this.view === "departments"
          ? html`${this.#tabAction(this.#addDepartment())}${this.#tabAction(this.#addHours())}`
          : nothing
      }
      ${this.view === "zones" && zone ? this.#tabAction(this.#addAssignment(zone.id)) : nothing}
    </div>`;
  }
  #confirm(name: string, action: () => Promise<unknown>): void {
    this.#open({ kind: "delete", name, action });
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

  #departments() {
    const model = this.model!;
    return html`<section>
      ${this.#toolbar(t("venue.departments"))}
      ${this.#table(
        "departments",
        "waitron.venue.departments.table",
        t("venue.departments"),
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
            cell: (row) => t(row.active ? "venue.active" : "venue.inactive"),
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
                {
                  key: `deactivate-department-${row.id}`,
                  label: t("venue.deactivate_department"),
                  disabled: !row.active,
                  run: () => this.#confirm(row.name, () => this.api.deactivateDepartment(row.id)),
                },
              ]),
          },
        ],
        (row) => row.id,
        this.#addDepartment(),
      )}
      ${this.#toolbar(t("venue.hours"))}
      ${this.#table(
        "hours",
        "waitron.venue.hours.table",
        t("venue.hours"),
        model.hours,
        [
          {
            key: "department",
            label: t("venue.department"),
            cell: (row) => model.departments.find((d) => d.id === row.departmentId)?.name,
          },
          {
            key: "day",
            label: t("venue.weekday"),
            choosable: "shown",
            cell: (row) => t(`venue.day.${row.weekday as (typeof DAYS)[number]}`),
          },
          {
            key: "opens",
            label: t("venue.opens"),
            choosable: "shown",
            cell: (row) => row.opensAt.slice(0, 5),
          },
          {
            key: "closes",
            label: t("venue.closes"),
            choosable: "shown",
            cell: (row) => row.closesAt.slice(0, 5),
          },
          {
            key: "actions",
            label: t("venue.actions"),
            pinned: "end",
            cell: (row) =>
              this.#actions(t("venue.hours"), [
                {
                  key: `edit-hours-${model.hours.indexOf(row)}`,
                  label: t("venue.edit"),
                  run: () => this.#open({ kind: "hours", row, index: model.hours.indexOf(row) }),
                },
                {
                  key: `delete-hours-${model.hours.indexOf(row)}`,
                  label: t("venue.delete"),
                  run: () =>
                    this.#confirm(t("venue.hours"), () =>
                      this.api.replaceHours(
                        row.departmentId,
                        this.#hours(row.departmentId, model.hours.indexOf(row)),
                      ),
                    ),
                },
              ]),
          },
        ],
        (row) => String(model.hours.indexOf(row)),
        this.#addHours(),
      )}
    </section>`;
  }
  #zones() {
    const model = this.model!;
    const zone = model.floorZones.find((row) => row.id === this.zoneId);
    return html`<section>
      <h2>${t("venue.zones")}</h2>
      ${this.#table(
        "zones",
        "waitron.venue.zones.table",
        t("venue.zones"),
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
                {
                  key: `zone-menus-${row.id}`,
                  label: t("venue.menus"),
                  run: () => {
                    this.zoneId = row.id;
                  },
                },
              ]),
          },
        ],
        (row) => row.id,
      )}
      <h2>${t("venue.tills")}</h2>
      ${this.#table(
        "tills",
        "waitron.venue.tills.table",
        t("venue.tills"),
        model.devices.filter((device) => device.active && device.kind !== "kds_station"),
        [
          {
            key: "name",
            label: t("venue.tills"),
            cell: (device) => device.label,
            sortValue: (device) => device.label,
          },
          {
            key: "startsIn",
            label: t("venue.starts_in"),
            cell: (device) => {
              const stored = model.deviceZones.find((row) => row.deviceId === device.id)?.zoneId;
              return html`<wt-combobox
                part="till-zone"
                name=${`till-${device.id}-starts-in`}
                label=${`${device.label}: ${t("venue.starts_in")}`}
                hide-label
                search="auto"
                placeholder=${t("venue.counter_zone")}
                searchPlaceholder=${t("venue.combobox_search")}
                noResultsLabel=${t("venue.combobox_no_results")}
                .options=${[
                  { value: "", label: t("venue.counter_zone") },
                  ...model.zones.map((zone) => ({ value: zone.id, label: zone.name })),
                ]}
                .value=${live(stored ?? "")}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  const zoneId = event.detail.value;
                  if (zoneId === (stored ?? "")) return;
                  void this.#save(() =>
                    zoneId
                      ? this.api.setDeviceDefaultZone(device.id, zoneId)
                      : this.api.clearDeviceDefaultZone(device.id),
                  );
                }}
              ></wt-combobox>`;
            },
          },
        ],
        (device) => device.id,
      )}
      ${
        zone
          ? html` ${this.#toolbar(`${zone.name}: ${t("venue.menus")}`)}
            ${this.#table(
              "zone-menus",
              "waitron.venue.zone-menus.table",
              t("venue.menus"),
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
                            this.#open({ kind: "assignment", zoneId: zone.id, menuId: row.menuId }),
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
  #kitchenChanges() {
    return html`<section data-test="kitchen-changes">
      <h2>${t("venue.kitchen_changes")}</h2>
      <wt-switch
        name="editSentLines"
        label=${t("venue.edit_sent_lines")}
        .checked=${live(this.model!.settings.editSentLines)}
        .disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
          event.stopPropagation();
          void this.#saveEditSentLines(event.detail.checked);
        }}
      ></wt-switch>
      <p class="hint" data-test="edit-sent-lines-hint">${t("venue.edit_sent_lines_hint")}</p>
      ${this.#fieldError("editSentLines")} ${this.#kitchenTicketGrouping()}
      <wt-switch
        class="setting"
        name="printHeldWork"
        label=${t("venue.print_held_work")}
        .checked=${live(this.model!.printHeldWork)}
        .disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
          event.stopPropagation();
          void this.#savePrintHeldWork(event.detail.checked);
        }}
      ></wt-switch>
      <p class="hint" data-test="print-held-work-hint">${t("venue.print_held_work_hint")}</p>
      ${this.#fieldError("printHeldWork")} ${this.#releaseReminder()}
    </section>`;
  }
  /** Blank is off. A stored value the list does not offer, which setup can bring in, is offered too
   * so the dropdown never shows another. */
  #releaseReminder() {
    const stored = this.model!.releaseReminderMinutes;
    const choices =
      stored === null || REMINDER_MINUTES.includes(stored)
        ? REMINDER_MINUTES
        : [...REMINDER_MINUTES, stored].sort((a, b) => a - b);
    const shown = stored === null ? "" : String(stored);
    return html`<wt-combobox
      class="setting"
      name="releaseReminderMinutes"
      label=${t("venue.release_reminder")}
      hint=${t("venue.release_reminder_hint")}
      search="auto"
      placeholder=${t("venue.release_reminder.off")}
      searchPlaceholder=${t("venue.combobox_search")}
      noResultsLabel=${t("venue.combobox_no_results")}
      .options=${[
        { value: "", label: t("venue.release_reminder.off") },
        ...choices.map((minutes) => ({
          value: String(minutes),
          label: t("venue.release_reminder.minutes").replace("{n}", String(minutes)),
        })),
      ]}
      .value=${live(shown)}
      ?disabled=${this.busy}
      error=${this.fieldErrors.releaseReminderMinutes ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        const value = event.detail.value;
        if (value === shown) return;
        void this.#saveReleaseReminderMinutes(value === "" ? null : Number(value));
      }}
    ></wt-combobox>`;
  }
  #kitchenTicketGrouping() {
    const stored = this.model!.kitchenTicketGrouping;
    return html`<wt-combobox
      class="setting"
      name="kitchenTicketGrouping"
      label=${t("venue.kitchen_ticket_grouping")}
      hint=${t("venue.kitchen_ticket_grouping_hint")}
      search="auto"
      searchPlaceholder=${t("venue.combobox_search")}
      noResultsLabel=${t("venue.combobox_no_results")}
      .options=${GROUPINGS.map((choice) => ({
        value: choice,
        label: t(`venue.kitchen_ticket_grouping.${choice}`),
      }))}
      .value=${live(stored)}
      ?disabled=${this.busy}
      error=${this.fieldErrors.kitchenTicketGrouping ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (event.detail.value === stored) return;
        void this.#saveKitchenTicketGrouping(event.detail.value as KitchenTicketGrouping);
      }}
    ></wt-combobox>`;
  }
  #hours(departmentId: string, omit?: number) {
    return this.model!.hours.filter(
      (row, index) => row.departmentId === departmentId && index !== omit,
    ).map((row) => ({
      weekday: row.weekday,
      opensAt: row.opensAt.slice(0, 5),
      closesAt: row.closesAt.slice(0, 5),
    }));
  }
  #editorContent(editor: Editor): EditorContent {
    const model = this.model!;
    switch (editor.kind) {
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
      case "hours":
        return {
          heading: t(editor.row ? "venue.edit_hours" : "venue.add_hours"),
          body: html`${this.#select("hours-department", t("venue.department"), model.departments, editor.row?.departmentId, true, !!editor.row)}${this.#select(
            "hours-weekday",
            t("venue.weekday"),
            DAYS.map((day) => ({ id: String(day), name: t(`venue.day.${day}`) })),
            String(editor.row?.weekday ?? 0),
          )}${this.#input("hours-opens", t("venue.opens"), editor.row?.opensAt.slice(0, 5), "time")}${this.#input("hours-closes", t("venue.closes"), editor.row?.closesAt.slice(0, 5), "time")}`,
          check: () => {
            const missing = this.#required(["hours-department", "hours-opens", "hours-closes"]);
            if (Object.keys(missing).length > 0) return missing;
            return this.#value("hours-opens") === this.#value("hours-closes")
              ? {
                  "hours-opens": t("venue.time_distinct"),
                  "hours-closes": t("venue.time_distinct"),
                }
              : {};
          },
          save: () => {
            const departmentId = this.#value("hours-department");
            const opensAt = this.#value("hours-opens");
            const closesAt = this.#value("hours-closes");
            const hours = [
              ...this.#hours(departmentId, editor.index),
              { weekday: Number(this.#value("hours-weekday")), opensAt, closesAt },
            ];
            // A `request_invalid` names the list sent (`hours`) or an interval of it (`hours.N`),
            // never one of these controls.
            void this.#save(() => this.api.replaceHours(departmentId, hours), {
              codes: { "department.not_found": "hours-department" },
            });
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
      case "delete":
        return {
          heading: t("venue.confirm_remove"),
          body: html`<p>${editor.name}</p>`,
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
      ...(this.editor
        ? []
        : [...Object.values(this.fieldErrors), ...(this.actionError ? [this.actionError] : [])]),
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
      const name = (event.target as HTMLInputElement).name;
      if (Object.hasOwn(this.refusedFields, name)) {
        const refused = { ...this.refusedFields };
        delete refused[name];
        this.refusedFields = refused;
      }
      if (this.attempted) this.fieldErrors = content.check();
    };
    return keyed(
      editor,
      html`<wt-modal
        open
        heading=${content.heading}
        @wt-close=${() => {
          if (this.editor === editor) this.#close();
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Escape" && this.busy) {
            event.preventDefault();
            event.stopPropagation();
          }
          submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-editor"]'));
        }}
      >
        <div class="form" @wt-change=${recheck}>${content.body}</div>
        <wt-form-actions
          slot="footer"
          .error=${[...(this.editorError ? [this.editorError] : []), ...(marked ? [t("venue.fix_fields")] : [])].join(" ")}
          ><wt-button
            slot="cancel"
            variant="secondary"
            data-test="cancel-editor"
            ?disabled=${this.busy}
            @click=${() => this.#close()}
            >${t("venue.cancel")}</wt-button
          ><wt-button
            data-test="save-editor"
            variant=${editor.kind === "delete" ? "danger" : "primary"}
            ?disabled=${this.busy || invalid}
            @click=${() => this.#submit(content)}
            >${t(editor.kind === "delete" ? "venue.confirm" : "venue.save")}</wt-button
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
          ? html`<wt-tabs
                label=${t("venue.title")}
                .value=${this.view}
                .items=${[
                  { key: "status", label: t("venue.status") },
                  { key: "departments", label: t("venue.departments") },
                  { key: "zones", label: t("venue.zones") },
                  { key: "kitchen", label: t("venue.kitchen_changes") },
                ]}
                @wt-tab-change=${this.#selectView}
              >
                ${this.#tabActions()}
                <div slot="status">${this.#readiness()}</div>
                <div slot="departments">${this.#departments()}</div>
                <div slot="zones">${this.#zones()}</div>
                <div slot="kitchen">${this.#kitchenChanges()}</div> </wt-tabs
              >${this.#modal()}`
          : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-operations-screen": VenueOperationsScreen;
  }
}
