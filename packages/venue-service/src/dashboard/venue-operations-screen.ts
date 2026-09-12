import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { QueryController } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { codeOf } from "@waitron/dashboard-kit";
import {
  baseStyles,
  selectStyles,
  submitOnEnter,
  UrlStateController,
  type DataTableColumn,
} from "@waitron/ui";
import type {
  Department,
  FloorZone,
  HoursInterval,
  MenuOffer,
  NamedRow,
  PreparationRoute,
  ServiceMode,
  VenueReadinessIssue,
  VenueServiceApi,
  VenueServiceView,
} from "./client.js";
import { t } from "./strings.js";

const MODES: ServiceMode[] = ["table_tab", "prepay", "invoice_first", "ticket_then_pay"];
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const VIEWS = ["status", "departments", "menus", "zones", "routing"] as const;
type View = (typeof VIEWS)[number];
type Editor =
  | { kind: "department"; row?: Department }
  | { kind: "menu"; row?: NamedRow }
  | { kind: "offer"; menuId: string; row?: MenuOffer }
  | { kind: "hours"; row?: HoursInterval; index?: number }
  | { kind: "zone"; row: FloorZone }
  | { kind: "assignment"; zoneId: string; menuId?: string }
  | { kind: "route"; row?: PreparationRoute }
  | { kind: "delete"; name: string; action: () => Promise<unknown> };
type Action = { key: string; label: string; run: () => void; disabled?: boolean };

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
    `,
  ];
  @property({ attribute: false }) api!: VenueServiceApi;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.error = t("venue.load_error");
    },
  );
  #loaded = false;
  @state() private model?: VenueServiceView;
  @state() private error?: string;
  @state() private fieldErrors: Record<string, string> = {};
  @state() private busy = false;
  @state() private view: View = "status";
  @state() private editor?: Editor;
  @state() private menuId = "";
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
          this.error = undefined;
        },
      );
    } catch {
      this.error = t("venue.load_error");
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
    this.fieldErrors = {};
    this.error = undefined;
  }
  #close(): void {
    this.editor = undefined;
    this.fieldErrors = {};
    this.error = undefined;
    void this.updateComplete.then(() => {
      if (this.#opener?.isConnected) this.#opener.focus();
      else this.renderRoot.querySelector<HTMLElement>("wt-tabs")?.focus();
    });
  }
  #selectView(event: CustomEvent<{ value: View }>): void {
    // Panel content may emit its own change events; only the strip owns navigation.
    if (event.target !== event.currentTarget) return;
    this.view = event.detail.value;
    this.#url.write({ dashboard: "venue-operations", view: this.view });
  }
  async #save(action: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = undefined;
    const editor = this.editor;
    try {
      await action();
      if (this.editor === editor) this.#close();
      await this.#load();
    } catch (error) {
      const code = codeOf(error ?? {});
      this.error =
        code === "route.duplicate"
          ? t("venue.route_duplicate")
          : code === "department.has_active_zones"
            ? t("venue.department_has_zones")
            : t("venue.save_error");
    } finally {
      this.busy = false;
    }
  }
  #validate(fields: readonly { name: string; label: string }[]): boolean {
    this.fieldErrors = Object.fromEntries(
      fields
        .filter((field) => this.#value(field.name).trim() === "")
        .map((field) => [field.name, `${field.label}: ${t("venue.field_required")}`]),
    );
    this.error = undefined;
    return Object.keys(this.fieldErrors).length === 0;
  }
  #fieldError(name: string) {
    return this.fieldErrors[name]
      ? html`<p id=${`error-${name}`} class="field-error" data-field-error=${name}>
          ${this.fieldErrors[name]}
        </p>`
      : nothing;
  }
  #input(name: string, label: string, value = "", type = "text") {
    return html`<label
      ><span>${label} <span class="required">*</span></span
      ><input
        name=${name}
        type=${type}
        .value=${value}
        required
        aria-invalid=${!!this.fieldErrors[name]}
        aria-describedby=${this.fieldErrors[name] ? `error-${name}` : nothing}
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
    return html`<label
      ><span>${label}${required ? html` <span class="required">*</span>` : nothing}</span
      ><select
        name=${name}
        ?required=${required}
        ?disabled=${disabled}
        aria-invalid=${!!this.fieldErrors[name]}
        aria-describedby=${this.fieldErrors[name] ? `error-${name}` : nothing}
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
  #name(names: Record<string, string>): string {
    return names.en ?? names.es ?? Object.values(names)[0] ?? "";
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
              action.run();
            }}
            >${action.label}</wt-button
          >`,
      )}
    </wt-row-actions>`;
  }
  #table<T>(
    key: string,
    label: string,
    rows: readonly T[],
    columns: DataTableColumn<T>[],
    rowKey: (row: T) => string,
  ) {
    return html`<wt-data-table
      data-test=${key}
      aria-label=${label}
      .rows=${rows}
      .columns=${columns}
      .rowKey=${rowKey}
      .emptyMessage=${t("venue.no_rows")}
    ></wt-data-table>`;
  }
  #toolbar(label: string, actions: Action[]) {
    return html`<div class="toolbar">
      <h2>${label}</h2>
      ${this.#actions(label, actions)}
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
      ${this.#toolbar(t("venue.departments"), [{ key: "new-department", label: t("venue.add_department"), run: () => this.#open({ kind: "department" }) }])}
      ${this.#table(
        "departments",
        t("venue.departments"),
        model.departments,
        [
          {
            key: "name",
            label: t("venue.name"),
            cell: (row) => row.name,
            sortValue: (row) => row.name,
          },
          { key: "trading", label: t("venue.trading_name"), cell: (row) => row.tradingName },
          {
            key: "mode",
            label: t("venue.service_style"),
            cell: (row) => t(`venue.${row.defaultServiceMode}`),
          },
          {
            key: "state",
            label: t("venue.status"),
            cell: (row) => t(row.active ? "venue.active" : "venue.inactive"),
          },
          {
            key: "actions",
            label: t("venue.actions"),
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
      ${this.#toolbar(t("venue.hours"), [{ key: "new-hours", label: t("venue.add_hours"), disabled: model.departments.length === 0, run: () => this.#open({ kind: "hours" }) }])}
      ${this.#table(
        "hours",
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
            cell: (row) => t(`venue.day.${row.weekday as (typeof DAYS)[number]}`),
          },
          { key: "opens", label: t("venue.opens"), cell: (row) => row.opensAt.slice(0, 5) },
          { key: "closes", label: t("venue.closes"), cell: (row) => row.closesAt.slice(0, 5) },
          {
            key: "actions",
            label: t("venue.actions"),
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
  #menus() {
    const model = this.model!;
    const menu = model.menus.find((row) => row.id === this.menuId) ?? model.menus[0];
    return html`<section>
      ${this.#toolbar(t("venue.menus"), [{ key: "new-menu", label: t("venue.add_menu"), run: () => this.#open({ kind: "menu" }) }])}
      ${this.#table(
        "menus",
        t("venue.menus"),
        model.menus,
        [
          {
            key: "name",
            label: t("venue.menu_name"),
            cell: (row) => row.name,
            sortValue: (row) => row.name,
          },
          {
            key: "state",
            label: t("venue.status"),
            cell: (row) => t(row.active ? "venue.active" : "venue.inactive"),
          },
          {
            key: "actions",
            label: t("venue.actions"),
            cell: (row) =>
              this.#actions(row.name, [
                {
                  key: `edit-menu-${row.id}`,
                  label: t("venue.edit"),
                  run: () => this.#open({ kind: "menu", row }),
                },
                {
                  key: `products-${row.id}`,
                  label: t("venue.products"),
                  run: () => {
                    this.menuId = row.id;
                  },
                },
                {
                  key: `new-offer-${row.id}`,
                  label: t("venue.add_offer"),
                  run: () => this.#open({ kind: "offer", menuId: row.id }),
                },
              ]),
          },
        ],
        (row) => row.id,
      )}
      ${
        menu
          ? html` ${this.#toolbar(`${menu.name}: ${t("venue.products")}`, [{ key: "new-offer", label: t("venue.add_offer"), run: () => this.#open({ kind: "offer", menuId: menu.id }) }])}
            ${this.#table(
              `menu-offers-${menu.id}`,
              menu.name,
              model.offers.filter((row) => row.menuId === menu.id),
              [
                {
                  key: "section",
                  label: t("venue.section"),
                  cell: (row) => this.#name(row.sectionName),
                  sortValue: (row) => this.#name(row.sectionName),
                },
                {
                  key: "product",
                  label: t("venue.product"),
                  cell: (row) => this.#name(row.descriptions),
                  sortValue: (row) => this.#name(row.descriptions),
                },
                {
                  key: "price",
                  label: t("venue.price"),
                  align: "end",
                  cell: (row) => row.grossPrice,
                  sortValue: (row) => Number(row.grossPrice),
                },
                {
                  key: "actions",
                  label: t("venue.actions"),
                  cell: (row) =>
                    this.#actions(this.#name(row.descriptions), [
                      {
                        key: `edit-offer-${row.id}`,
                        label: t("venue.edit"),
                        run: () => this.#open({ kind: "offer", menuId: menu.id, row }),
                      },
                      {
                        key: `remove-offer-${row.id}`,
                        label: t("venue.remove_offer"),
                        run: () =>
                          this.#confirm(this.#name(row.descriptions), () =>
                            this.api.deactivateMenuItem(menu.id, row.id),
                          ),
                      },
                    ]),
                },
              ],
              (row) => row.id,
            )}`
          : nothing
      }
    </section>`;
  }
  #zones() {
    const model = this.model!;
    const zone = model.floorZones.find((row) => row.id === this.zoneId);
    return html`<section>
      <h2>${t("venue.zones")}</h2>
      ${this.#table(
        "zones",
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
            cell: (row) =>
              model.zones.find((z) => z.id === row.id)?.departmentName ?? t("venue.unconfigured"),
          },
          {
            key: "mode",
            label: t("venue.service_style"),
            cell: (row) => {
              const mode = model.zones.find((z) => z.id === row.id)?.serviceMode;
              return mode ? t(`venue.${mode}`) : t("venue.unconfigured");
            },
          },
          {
            key: "default",
            label: t("venue.default"),
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
          ? html` ${this.#toolbar(`${zone.name}: ${t("venue.menus")}`, [{ key: `new-assignment-${zone.id}`, label: t("venue.make_available"), disabled: !model.zones.some((z) => z.id === zone.id), run: () => this.#open({ kind: "assignment", zoneId: zone.id }) }])}
            ${this.#table(
              "zone-menus",
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
                  cell: (row) => t(row.isDefault ? "venue.yes" : "venue.no"),
                },
                {
                  key: "order",
                  label: t("venue.display_order"),
                  cell: (row) => String(row.displayOrder),
                },
                {
                  key: "actions",
                  label: t("venue.actions"),
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
      ${this.#toolbar(t("venue.routing"), [{ key: "new-route", label: t("venue.add_route"), run: () => this.#open({ kind: "route" }) }])}
      ${this.#table(
        "preparation-routes",
        t("venue.routing"),
        model.routes,
        [
          {
            key: "subject",
            label: t("venue.product_or_category"),
            cell: (row) =>
              row.productId === null
                ? (model.categories.find((c) => c.id === row.categoryId)?.name ?? row.categoryId)
                : this.#name(
                    model.products.find((p) => p.id === row.productId)?.descriptions ?? {},
                  ),
          },
          {
            key: "zone",
            label: t("venue.zone"),
            cell: (row) =>
              row.zoneId === null
                ? t("venue.all_zones")
                : model.floorZones.find((z) => z.id === row.zoneId)?.name,
          },
          {
            key: "station",
            label: t("venue.station"),
            cell: (row) =>
              row.noPreparation
                ? t("venue.no_preparation")
                : model.stations.find((s) => s.id === row.stationId)?.name,
          },
          {
            key: "actions",
            label: t("venue.actions"),
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
  #hours(departmentId: string, omit?: number) {
    return this.model!.hours.filter(
      (row, index) => row.departmentId === departmentId && index !== omit,
    ).map((row) => ({
      weekday: row.weekday,
      opensAt: row.opensAt.slice(0, 5),
      closesAt: row.closesAt.slice(0, 5),
    }));
  }
  #editorContent(editor: Editor): { heading: string; body: TemplateResult; save: () => void } {
    const model = this.model!;
    switch (editor.kind) {
      case "department":
        return {
          heading: t(editor.row ? "venue.edit_department" : "venue.add_department"),
          body: html`${this.#input("department-name", t("venue.name"), editor.row?.name)}${this.#input("trading-name", t("venue.trading_name"), editor.row?.tradingName)}${this.#select("department-mode", t("venue.service_style"), this.#modes(), editor.row?.defaultServiceMode ?? "prepay")}`,
          save: () => {
            if (
              !this.#validate([
                { name: "department-name", label: t("venue.name") },
                { name: "trading-name", label: t("venue.trading_name") },
                { name: "department-mode", label: t("venue.service_style") },
              ])
            )
              return;
            const input = {
              name: this.#value("department-name").trim(),
              tradingName: this.#value("trading-name").trim(),
              defaultServiceMode: this.#value("department-mode") as ServiceMode,
            };
            void this.#save(() =>
              editor.row
                ? this.api.updateDepartment(editor.row.id, input)
                : this.api.createDepartment(input),
            );
          },
        };
      case "menu":
        return {
          heading: t(editor.row ? "venue.edit_menu" : "venue.add_menu"),
          body: html`${this.#input("menu-name", t("venue.menu_name"), editor.row?.name)}`,
          save: () => {
            if (!this.#validate([{ name: "menu-name", label: t("venue.menu_name") }])) return;
            const name = this.#value("menu-name").trim();
            void this.#save(() =>
              editor.row ? this.api.updateMenu(editor.row.id, name) : this.api.createMenu(name),
            );
          },
        };
      case "offer": {
        const { menuId, row } = editor;
        const products = model.products.filter(
          (product) =>
            product.active &&
            !model.offers.some(
              (offer) => offer.menuId === menuId && offer.productId === product.id,
            ),
        );
        const priceName = `offer-price-${row?.id ?? menuId}`;
        return {
          heading: `${model.menus.find((menu) => menu.id === menuId)?.name}: ${t(row ? "venue.edit_offer" : "venue.add_offer")}`,
          body: html`${
            row
              ? html`<p>${this.#name(row.descriptions)} · ${this.#name(row.sectionName)}</p>`
              : html`${this.#select(
                  `offer-product-${menuId}`,
                  t("venue.product"),
                  products.map((product) => ({
                    id: product.id,
                    name: this.#name(product.descriptions),
                  })),
                )}${this.#input(`offer-section-${menuId}`, t("venue.section"))}`
          }${this.#input(priceName, t("venue.price"), row?.grossPrice)}`,
          save: () => {
            if (
              !this.#validate([
                { name: priceName, label: t("venue.price") },
                ...(row
                  ? []
                  : [
                      { name: `offer-product-${menuId}`, label: t("venue.product") },
                      { name: `offer-section-${menuId}`, label: t("venue.section") },
                    ]),
              ])
            )
              return;
            const grossPrice = this.#value(priceName).trim();
            if (!/^\d+(?:\.\d{1,2})?$/.test(grossPrice)) {
              this.fieldErrors = { [priceName]: t("venue.price_invalid") };
              return;
            }
            const productId = this.#value(`offer-product-${menuId}`);
            const sectionName = this.#value(`offer-section-${menuId}`).trim();
            void this.#save(async () => {
              if (row) return this.api.updateMenuItem(menuId, row.id, { grossPrice });
              const sectionId =
                model.offers.find(
                  (offer) =>
                    offer.menuId === menuId && this.#name(offer.sectionName) === sectionName,
                )?.sectionId ??
                (
                  await this.api.createMenuSection(menuId, {
                    name: { en: sectionName, es: sectionName },
                    displayOrder: 0,
                  })
                ).id;
              await this.api.createMenuItem(menuId, {
                sectionId,
                productId,
                grossPrice,
                displayOrder: 0,
              });
            });
          },
        };
      }
      case "hours":
        return {
          heading: t(editor.row ? "venue.edit_hours" : "venue.add_hours"),
          body: html`${this.#select("hours-department", t("venue.department"), model.departments, editor.row?.departmentId, true, !!editor.row)}${this.#select(
            "hours-weekday",
            t("venue.weekday"),
            DAYS.map((day) => ({ id: String(day), name: t(`venue.day.${day}`) })),
            String(editor.row?.weekday ?? 0),
          )}${this.#input("hours-opens", t("venue.opens"), editor.row?.opensAt.slice(0, 5), "time")}${this.#input("hours-closes", t("venue.closes"), editor.row?.closesAt.slice(0, 5), "time")}`,
          save: () => {
            if (
              !this.#validate([
                { name: "hours-department", label: t("venue.department") },
                { name: "hours-opens", label: t("venue.opens") },
                { name: "hours-closes", label: t("venue.closes") },
              ])
            )
              return;
            const departmentId = this.#value("hours-department");
            const opensAt = this.#value("hours-opens");
            const closesAt = this.#value("hours-closes");
            if (opensAt === closesAt) {
              this.fieldErrors = {
                "hours-opens": t("venue.time_distinct"),
                "hours-closes": t("venue.time_distinct"),
              };
              return;
            }
            const hours = [
              ...this.#hours(departmentId, editor.index),
              { weekday: Number(this.#value("hours-weekday")), opensAt, closesAt },
            ];
            void this.#save(() => this.api.replaceHours(departmentId, hours));
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
          save: () => {
            const name = `zone-department-${editor.row.id}`;
            if (!this.#validate([{ name, label: t("venue.department") }])) return;
            const serviceMode = this.#value(`zone-mode-${editor.row.id}`);
            const input = {
              departmentId: this.#value(name),
              serviceMode: serviceMode === "" ? null : (serviceMode as ServiceMode),
            };
            void this.#save(() => this.api.configureZone(editor.row.id, input));
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
          save: () => {
            if (
              !this.#validate([
                { name: "assignment-menu", label: t("venue.menu_name") },
                { name: "assignment-order", label: t("venue.display_order") },
              ])
            )
              return;
            const displayOrder = Number(this.#value("assignment-order"));
            if (!Number.isInteger(displayOrder) || displayOrder < 0) {
              this.fieldErrors = { "assignment-order": t("venue.order_invalid") };
              return;
            }
            const menuId = this.#value("assignment-menu");
            const makeDefault = this.renderRoot.querySelector<HTMLInputElement>(
              '[name="assignment-default"]',
            )!.checked;
            void this.#save(() =>
              this.api.allowMenu(editor.zoneId, menuId, { displayOrder, makeDefault }),
            );
          },
        };
      }
      case "route": {
        const row = editor.row;
        return {
          heading: t(row ? "venue.edit_route" : "venue.add_route"),
          body: html`${this.#select("route-subject", t("venue.product_or_category"), [...model.categories.map((category) => ({ id: `category:${category.id}`, name: `${t("venue.category")}: ${category.name}` })), ...model.products.map((product) => ({ id: `product:${product.id}`, name: `${t("venue.product")}: ${this.#name(product.descriptions)}` }))], row ? (row.productId === null ? `category:${row.categoryId}` : `product:${row.productId}`) : undefined)}${this.#select("route-zone", t("venue.zone"), [{ id: "", name: t("venue.all_zones") }, ...model.floorZones], row?.zoneId ?? "", false)}${this.#select("route-target", t("venue.station"), [...model.stations, { id: "none", name: t("venue.no_preparation") }], row?.noPreparation ? "none" : (row?.stationId ?? undefined))}`,
          save: () => {
            if (
              !this.#validate([
                { name: "route-subject", label: t("venue.product_or_category") },
                { name: "route-target", label: t("venue.station") },
              ])
            )
              return;
            const [kind, id] = this.#value("route-subject").split(":");
            const target = this.#value("route-target");
            const input = {
              ...(kind === "category" ? { categoryId: id } : { productId: id }),
              zoneId: this.#value("route-zone") || null,
              ...(target === "none" ? { noPreparation: true } : { stationId: target }),
            };
            void this.#save(() =>
              row ? this.api.updateRoute(row.id, input) : this.api.createRoute(input),
            );
          },
        };
      }
      case "delete":
        return {
          heading: t("venue.confirm_remove"),
          body: html`<p>${editor.name}</p>`,
          save: () => {
            void this.#save(editor.action);
          },
        };
    }
  }
  #summary() {
    return html`<wt-form-error-summary
      heading=${t("venue.form_error_heading")}
      .errors=${[...Object.values(this.fieldErrors), ...(this.error ? [this.error] : [])]}
    ></wt-form-error-summary>`;
  }
  #modal() {
    if (!this.editor) return nothing;
    const editor = this.editor;
    const content = this.#editorContent(editor);
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
        ${this.#summary()}
        <div class="form">${content.body}</div>
        <wt-form-actions slot="footer"
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
            ?disabled=${this.busy}
            @click=${content.save}
            >${t(editor.kind === "delete" ? "venue.confirm" : "venue.save")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>`,
    );
  }
  override render() {
    return html`<h1>${t("venue.title")}</h1>
      ${this.editor ? nothing : this.#summary()}
      ${
        this.model
          ? html`<wt-tabs
                label=${t("venue.title")}
                .value=${this.view}
                .items=${[
                  { key: "status", label: t("venue.status") },
                  { key: "departments", label: t("venue.departments") },
                  { key: "menus", label: t("venue.menus") },
                  { key: "zones", label: t("venue.zones") },
                  { key: "routing", label: t("venue.routing") },
                ]}
                @wt-change=${this.#selectView}
              >
                <div slot="status">${this.#readiness()}</div>
                <div slot="departments">${this.#departments()}</div>
                <div slot="menus">${this.#menus()}</div>
                <div slot="zones">${this.#zones()}</div>
                <div slot="routing">${this.#routing()}</div> </wt-tabs
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
