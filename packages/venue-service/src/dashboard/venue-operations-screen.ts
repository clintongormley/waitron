import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { QueryController } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { codeOf } from "@waitron/dashboard-kit";
import {
  baseStyles,
  focusFirstInvalid,
  selectStyles,
  submitOnEnter,
  UrlStateController,
  type DataTableColumn,
} from "@waitron/ui";
import type {
  Department,
  FloorZone,
  HoursInterval,
  KitchenTicketGrouping,
  PreparationRoute,
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
const VIEWS = ["status", "departments", "zones", "routing"] as const;
type View = (typeof VIEWS)[number];
type Editor =
  | { kind: "department"; row?: Department }
  | { kind: "hours"; row?: HoursInterval; index?: number }
  | { kind: "zone"; row: FloorZone }
  | { kind: "assignment"; zoneId: string; menuId?: string }
  | { kind: "route"; row?: PreparationRoute }
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
    selectStyles,
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
      input {
        min-width: 0;
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }
      input[type="checkbox"] {
        width: var(--wt-tap-min);
      }
      .required,
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
    return code === "route.duplicate"
      ? t("venue.route_duplicate")
      : code === "department.has_active_zones"
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
    const invalid = !!this.#errors()[name];
    return html`<label
      ><span>${label} <span class="required">*</span></span
      ><input
        name=${name}
        type=${type}
        .value=${value}
        required
        aria-invalid=${invalid}
        aria-describedby=${invalid ? `error-${name}` : nothing}
      />${this.#fieldError(name)}</label
    >`;
  }
  #select(
    name: string,
    label: string,
    choices: readonly { id: string; name: string }[],
    value?: string,
    required = true,
    disabled = false,
  ) {
    const invalid = !!this.#errors()[name];
    return html`<label
      ><span>${label}${required ? html` <span class="required">*</span>` : nothing}</span
      ><select
        name=${name}
        ?required=${required}
        ?disabled=${disabled}
        aria-invalid=${invalid}
        aria-describedby=${invalid ? `error-${name}` : nothing}
      >
        ${choices.map((choice) => html`<option value=${choice.id} ?selected=${choice.id === value}>${choice.name}</option>`)}</select
      >${this.#fieldError(name)}</label
    >`;
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
    ></wt-data-table>`;
  }
  #toolbar(label: string) {
    return html`<div class="toolbar"><h2>${label}</h2></div>`;
  }
  #tabAction(action: Action) {
    return html`<wt-button
      variant="primary"
      data-test=${action.key}
      ?disabled=${this.busy || action.disabled === true}
      @click=${(event: Event) => {
        this.#opener = event.currentTarget as HTMLElement;
        action.run();
      }}
      >${action.label}</wt-button
    >`;
  }
  #tabActions() {
    const model = this.model!;
    const zone = model.floorZones.find((row) => row.id === this.zoneId);
    return html`<div slot="actions">
      ${
        this.view === "departments"
          ? html`${this.#tabAction({ key: "new-department", label: t("venue.add_department"), run: () => this.#open({ kind: "department" }) })}${this.#tabAction({ key: "new-hours", label: t("venue.add_hours"), disabled: model.departments.length === 0, run: () => this.#open({ kind: "hours" }) })}`
          : nothing
      }
      ${
        this.view === "routing"
          ? this.#tabAction({
              key: "new-route",
              label: t("venue.add_route"),
              run: () => this.#open({ kind: "route" }),
            })
          : nothing
      }
      ${
        this.view === "zones" && zone
          ? this.#tabAction({
              key: `new-assignment-${zone.id}`,
              label: t("venue.make_available"),
              run: () => this.#open({ kind: "assignment", zoneId: zone.id }),
            })
          : nothing
      }
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
      case "zone.route_missing":
        return `${issue.productName} ${t("venue.readiness.route_missing")} ${issue.zoneName}.`;
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
            )}`
          : nothing
      }
    </section>`;
  }
  #routing() {
    const model = this.model!;
    return html`<section>
      ${this.#toolbar(t("venue.routing"))}
      ${this.#table(
        "preparation-routes",
        "waitron.venue.routes.table",
        t("venue.routing"),
        model.routes,
        [
          {
            key: "subject",
            label: t("venue.product_or_category"),
            cell: (row) =>
              row.productId === null
                ? (model.categories.find((c) => c.id === row.categoryId)?.name ?? row.categoryId)
                : (model.products.find((p) => p.id === row.productId)?.name ?? row.productId),
          },
          {
            key: "zone",
            label: t("venue.zone"),
            choosable: "shown",
            cell: (row) =>
              row.zoneId === null
                ? t("venue.all_zones")
                : model.floorZones.find((z) => z.id === row.zoneId)?.name,
          },
          {
            key: "station",
            label: t("venue.station"),
            choosable: "shown",
            cell: (row) =>
              row.noPreparation
                ? t("venue.no_preparation")
                : model.stations.find((s) => s.id === row.stationId)?.name,
          },
          {
            key: "actions",
            label: t("venue.actions"),
            pinned: "end",
            cell: (row) =>
              this.#actions(t("venue.routing"), [
                {
                  key: `edit-route-${row.id}`,
                  label: t("venue.edit"),
                  run: () => this.#open({ kind: "route", row }),
                },
                {
                  key: `remove-route-${row.id}`,
                  label: t("venue.remove_route"),
                  run: () => this.#confirm(t("venue.routing"), () => this.api.deleteRoute(row.id)),
                },
              ]),
          },
        ],
        (row) => row.id,
      )}
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
   * so the select never shows another. */
  #releaseReminder() {
    const stored = this.model!.releaseReminderMinutes;
    const choices =
      stored === null || REMINDER_MINUTES.includes(stored)
        ? REMINDER_MINUTES
        : [...REMINDER_MINUTES, stored].sort((a, b) => a - b);
    const invalid = !!this.fieldErrors.releaseReminderMinutes;
    return html`<label class="setting"
        ><span>${t("venue.release_reminder")}</span
        ><select
          name="releaseReminderMinutes"
          ?disabled=${this.busy}
          aria-invalid=${invalid}
          aria-describedby=${
            invalid ? "release-reminder-hint error-releaseReminderMinutes" : "release-reminder-hint"
          }
          @change=${(event: Event) => {
            const value = (event.target as HTMLSelectElement).value;
            void this.#saveReleaseReminderMinutes(value === "" ? null : Number(value));
          }}
        >
          <option value="" .selected=${live(stored === null)}>
            ${t("venue.release_reminder.off")}
          </option>
          ${choices.map(
            (minutes) =>
              html`<option value=${minutes} .selected=${live(minutes === stored)}>
                ${t("venue.release_reminder.minutes").replace("{n}", String(minutes))}
              </option>`,
          )}
        </select></label
      >
      <p class="hint" id="release-reminder-hint" data-test="release-reminder-hint">
        ${t("venue.release_reminder_hint")}
      </p>
      ${this.#fieldError("releaseReminderMinutes")}`;
  }
  #kitchenTicketGrouping() {
    const stored = this.model!.kitchenTicketGrouping;
    const invalid = !!this.fieldErrors.kitchenTicketGrouping;
    return html`<label class="setting"
        ><span>${t("venue.kitchen_ticket_grouping")}</span
        ><select
          name="kitchenTicketGrouping"
          ?disabled=${this.busy}
          aria-invalid=${invalid}
          aria-describedby=${
            invalid
              ? "kitchen-ticket-grouping-hint error-kitchenTicketGrouping"
              : "kitchen-ticket-grouping-hint"
          }
          @change=${(event: Event) => {
            void this.#saveKitchenTicketGrouping(
              (event.target as HTMLSelectElement).value as KitchenTicketGrouping,
            );
          }}
        >
          ${GROUPINGS.map(
            (choice) =>
              html`<option value=${choice} .selected=${live(choice === stored)}>
                ${t(`venue.kitchen_ticket_grouping.${choice}`)}
              </option>`,
          )}
        </select></label
      >
      <p class="hint" id="kitchen-ticket-grouping-hint" data-test="kitchen-ticket-grouping-hint">
        ${t("venue.kitchen_ticket_grouping_hint")}
      </p>
      ${this.#fieldError("kitchenTicketGrouping")}`;
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
          body: html`${this.#select("assignment-menu", t("venue.menu_name"), menus, editor.menuId, true, !!assignment)}${this.#input("assignment-order", t("venue.display_order"), String(assignment?.displayOrder ?? model.zoneMenus.filter((row) => row.zoneId === editor.zoneId).length), "number")}<label
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
      case "route": {
        const row = editor.row;
        return {
          heading: t(row ? "venue.edit_route" : "venue.add_route"),
          body: html`${this.#select("route-subject", t("venue.product_or_category"), [...model.categories.map((category) => ({ id: `category:${category.id}`, name: `${t("venue.category")}: ${category.name}` })), ...model.products.map((product) => ({ id: `product:${product.id}`, name: `${t("venue.product")}: ${product.name}` }))], row ? (row.productId === null ? `category:${row.categoryId}` : `product:${row.productId}`) : undefined)}${this.#select("route-zone", t("venue.zone"), [{ id: "", name: t("venue.all_zones") }, ...model.floorZones], row?.zoneId ?? "", false)}${this.#select("route-target", t("venue.station"), [...model.stations, { id: "none", name: t("venue.no_preparation") }], row?.noPreparation ? "none" : (row?.stationId ?? undefined))}`,
          check: () => this.#required(["route-subject", "route-target"]),
          save: () => {
            const [kind, id] = this.#value("route-subject").split(":");
            const target = this.#value("route-target");
            const input = {
              ...(kind === "category" ? { categoryId: id } : { productId: id }),
              zoneId: this.#value("route-zone") || null,
              ...(target === "none" ? { noPreparation: true } : { stationId: target }),
            };
            void this.#save(
              () => (row ? this.api.updateRoute(row.id, input) : this.api.createRoute(input)),
              {
                fields: {
                  subject: "route-subject",
                  categoryId: "route-subject",
                  productId: "route-subject",
                  zoneId: "route-zone",
                  target: "route-target",
                  stationId: "route-target",
                },
                codes: {
                  "route.subject_not_found": "route-subject",
                  "service_zone.not_found": "route-zone",
                  "route.station_inactive": "route-target",
                },
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
      // A field that holds focus as the editor closes reports its change after the editor has gone.
      if (this.editor !== editor) return;
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
        <div class="form" @input=${recheck} @change=${recheck}>${content.body}</div>
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
                  { key: "routing", label: t("venue.routing") },
                ]}
                @wt-tab-change=${this.#selectView}
              >
                ${this.#tabActions()}
                <div slot="status">${this.#readiness()}</div>
                <div slot="departments">${this.#departments()}</div>
                <div slot="zones">${this.#zones()}</div>
                <div slot="routing">${this.#routing()}${this.#kitchenChanges()}</div> </wt-tabs
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
