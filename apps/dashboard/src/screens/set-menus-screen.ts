import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { keyed } from "lit/directives/keyed.js";
import { ref } from "lit/directives/ref.js";
import { tableNoMatches, type DashboardPermissionContinuation } from "@waitron/dashboard-kit";
import { formatMoney, type VatClass } from "@waitron/shared";
import {
  baseStyles,
  ContentLanguageController,
  currentContentLanguages,
  navigationGuardFor,
  pageTitleStyles,
  rowActionTail,
  setContentLanguages,
  UrlStateController,
  encodePathSegment,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-tabs.js";
import type { DashboardApi, DashboardMenuSummary, MenuSummary } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { guideHref } from "../help-guide.js";
import { currentLocale, t } from "../i18n/t.js";
import { dashboardPath, leftToBrowser } from "../navigation.js";
import "../widgets/menu-copy-dialog.js";
import "../widgets/menu-delete-dialog.js";
import "../widgets/set-menu-editor.js";
import { MenuListLayout, menuListStyles, type ListLayout } from "./menu-list-layout.js";

@customElement("dashboard-set-menus-screen")
export class SetMenusScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    menuListStyles,
    css`
      :host {
        display: block;
      }
      .heading {
        margin-bottom: var(--wt-space-4);
      }
      nav a {
        display: inline-flex;
        align-items: center;
        min-block-size: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
      }
      .title {
        display: flex;
        align-items: baseline;
        gap: var(--wt-space-2);
      }
      .title h1 {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .sep {
        color: var(--wt-color-primary-text);
        margin-inline-start: var(--wt-space-1);
      }
      wt-data-table::part(price),
      wt-data-table::part(holders) {
        display: block;
      }
      wt-data-table.wide::part(price),
      wt-data-table.wide::part(holders) {
        padding-block-start: calc((var(--wt-tap-min) - 1lh) / 2);
      }
      wt-data-table::part(holder-list) {
        list-style: none;
        margin: 0;
        padding: 0;
        overflow-wrap: anywhere;
      }
      wt-data-table::part(holder-label) {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(holder-link) {
        display: inline-block;
        min-block-size: var(--wt-space-5);
        color: var(--wt-color-primary-text);
      }
      nav a:focus-visible,
      wt-data-table::part(holder-link):focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) permissionContinuation?: DashboardPermissionContinuation;
  @state() private menus: DashboardMenuSummary[] = [];
  @state() private rows: DashboardMenuSummary[] = [];
  @state() private menuId: string | null = null;
  @state() private loading = true;
  @state() private loadError = false;
  @state() private layout: ListLayout = "wide";
  @state() private creating = false;
  @state() private copying: MenuSummary | null = null;
  @state() private deleting: MenuSummary | null = null;
  @state() private defaultVatClass: VatClass = "general";

  readonly #listLayout = new MenuListLayout(this, (layout) => (this.layout = layout));
  readonly #url = new UrlStateController(this, () => this.#restore(), dashboardPath);
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadError = true;
    },
    () => {
      this.loadError = false;
    },
  );
  readonly #columns = {
    wide: this.#buildColumns(false),
    narrow: this.#buildColumns(true),
  };

  constructor() {
    super();
    new ContentLanguageController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.loadError = false;
    try {
      await Promise.all([
        this.#watchMenus(),
        this.#queries.watch("getMenuSettings", [], ({ defaultProductVatClass }) => {
          this.defaultVatClass = defaultProductVatClass;
        }),
        this.#queries.watch("getContentLanguages", [], setContentLanguages),
      ]);
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
      this.#checkAddress();
    }
  }

  #watchMenus(): Promise<void> {
    return this.#queries
      .watch("listMenus", [], (menus) => {
        this.menus = menus;
        this.rows = menus.filter(({ active, kind }) => active && kind === "set_menu");
        this.#checkAddress();
      })
      .catch(() => undefined);
  }

  #restore(): void {
    if (this.#url.read("dashboard") !== "set-menus") return;
    this.menuId = this.#url.read("setMenu");
    if (this.menuId !== null) this.creating = false;
    this.#checkAddress();
  }

  #checkAddress(): void {
    if (
      this.#url.read("dashboard") === "set-menus" &&
      this.menuId !== null &&
      !this.loading &&
      !this.#queries.failing("listMenus") &&
      !this.rows.some(({ id }) => id === this.menuId)
    )
      this.#open(null, true);
  }

  #open(id: string | null, replace = false): void {
    if (!navigationGuardFor(window)) this.menuId = id;
    void this.#url.write({ dashboard: "set-menus", setMenu: id }, replace);
  }

  #price(menu: DashboardMenuSummary) {
    return html`<span part="price"
      >${menu.setPrice === null ? "" : formatMoney(menu.setPrice, currentLocale())}</span
    >`;
  }

  #offeredOn(menu: DashboardMenuSummary, stacked = false) {
    const holders = menu.heldBy ?? [];
    if (!holders.length) return html`<span part="holders muted">${t("set_menus.no_holder")}</span>`;
    return html`<div part="holders">
      ${stacked ? html`<span part="holder-label">${t("set_menus.offered_on")}</span>` : nothing}
      <ul part="holder-list">
        ${holders.map(
          ({ id, name }) =>
            html`<li>
              <a
                part="holder-link"
                href=${`/menus/menu/${encodePathSegment(id)}/view/structure`}
                @click=${(event: MouseEvent) => {
                  if (leftToBrowser(event)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  void this.#url.write({ dashboard: "menus", menu: id, view: "structure" });
                }}
                >${name}</a
              >
            </li>`,
        )}
      </ul>
    </div>`;
  }

  #buildColumns(narrow: boolean): DataTableColumn<DashboardMenuSummary>[] {
    return [
      {
        key: "name",
        label: t("menus.name"),
        sortValue: (menu) => menu.name,
        searchValue: (menu) => menu.name,
        ...(narrow ? { activatesRow: false as const } : {}),
        cell: (menu) =>
          html`<wt-button
              variant="ghost"
              part="name"
              align="start"
              data-test=${`open-${menu.id}`}
              @click=${() => this.#open(menu.id)}
              ><span part="name-text">${menu.name}</span></wt-button
            >
            ${narrow ? html`<div part="stacked">${this.#price(menu)} ${this.#offeredOn(menu, true)}</div>` : nothing}`,
      },
      ...(narrow
        ? []
        : [
            {
              key: "price",
              label: t("set_menus.price"),
              choosable: "shown" as const,
              sortValue: (menu: DashboardMenuSummary) =>
                menu.setPrice === null ? null : Number(menu.setPrice),
              cell: (menu: DashboardMenuSummary) => this.#price(menu),
            },
            {
              key: "offered-on",
              label: t("set_menus.offered_on"),
              choosable: "shown" as const,
              activatesRow: false as const,
              cell: (menu: DashboardMenuSummary) => this.#offeredOn(menu),
            },
          ]),
      {
        key: "actions",
        label: t("menus.actions"),
        pinned: "end",
        cell: (menu) =>
          html`<wt-row-actions label=${`${t("menus.actions")}: ${menu.name}`}>
            <wt-button
              icon="menu-open"
              data-test=${`edit-${menu.id}`}
              @click=${() => this.#open(menu.id)}
              >${t("menus.open")}</wt-button
            >
            <wt-button
              icon="menu-copy"
              data-test=${`duplicate-${menu.id}`}
              ?disabled=${this.copying?.id === menu.id}
              @click=${() => {
                if (!this.copying) this.copying = menu;
              }}
              >${t("menus.copy")}</wt-button
            >
            ${rowActionTail(true, [
              html`<wt-button
                icon="menu-delete"
                variant="danger"
                data-test=${`delete-${menu.id}`}
                @click=${() => {
                  this.deleting = menu;
                }}
                >${t("action.delete_dialog")}</wt-button
              >`,
            ])}
          </wt-row-actions>`,
      } satisfies DataTableColumn<DashboardMenuSummary>,
    ];
  }

  #add(slot?: "empty-action") {
    return html`<wt-button
      data-test="add-menu"
      slot=${ifDefined(slot)}
      variant="primary"
      @click=${() => {
        this.creating = true;
      }}
      >${t("menus.add_set_menu")}</wt-button
    >`;
  }

  #create(menu: MenuSummary): void {
    this.creating = false;
    if (!this.rows.some(({ id }) => id === menu.id))
      this.rows = [...this.rows, { ...menu, heldBy: [] }];
    this.#open(menu.id);
    void this.#watchMenus();
  }

  #renderList() {
    const loaded = !this.loading && !this.loadError;
    return html`<div class="header">
        <h1>${t("nav.set_menus")}</h1>
        ${loaded && this.rows.length ? this.#add() : nothing}
      </div>
      ${this.#renderLoadState()}
      ${
        loaded
          ? html`<div class="list">
              <wt-data-table
                data-test="set-menus"
                class=${this.layout}
                wrap-to-fit
                top-aligned
                searchable
                aria-label=${t("nav.set_menus")}
                searchLabel=${t("set_menus.search")}
                noMatchesMessage=${tableNoMatches()}
                emptyMessage=${t("set_menus.empty")}
                viewKey="waitron.set-menus.list.table"
                customiseColumnsLabel=${t("table.customise_columns")}
                customiseLabel=${t("table.customise")}
                restoreColumnsLabel=${t("table.restore_columns")}
                doneLabel=${t("table.done")}
                moveColumnLabel=${t("table.move_column")}
                showColumnLabel=${t("table.show_column")}
                hideColumnLabel=${t("table.hide_column")}
                alwaysShownColumnLabel=${t("table.column_always_shown")}
                lastShownColumnLabel=${t("table.column_last_shown")}
                columnPositionLabel=${t("table.column_position")}
                sortKey="name"
                sortDirection="ascending"
                .rows=${this.rows}
                .columns=${this.#columns[this.layout]}
                .rowKey=${(menu: DashboardMenuSummary) => menu.id}
                .rowClick=${(menu: DashboardMenuSummary) => this.#open(menu.id)}
                .rowClickLabel=${(menu: DashboardMenuSummary) => `${t("menus.open")}: ${menu.name}`}
                >${this.rows.length ? nothing : this.#add("empty-action")}</wt-data-table
              >
            </div>`
          : nothing
      }
      ${
        this.creating
          ? html`<dashboard-set-menu-terms-form
              creating
              .api=${this.api}
              .languages=${currentContentLanguages()}
              .defaultVatClass=${this.defaultVatClass}
              @set-menu-terms-cancelled=${() => {
                this.creating = false;
              }}
              @set-menu-terms-saved=${(event: CustomEvent<{ created: MenuSummary }>) => this.#create(event.detail.created)}
            ></dashboard-set-menu-terms-form>`
          : nothing
      }
      <dashboard-menu-copy-dialog
        .open=${this.copying !== null}
        .menu=${this.copying}
        .menus=${this.menus}
        .api=${this.api}
        @menu-copy-close=${() => {
          this.copying = null;
        }}
        @menu-copied=${() => {
          this.copying = null;
          void this.#watchMenus();
        }}
      ></dashboard-menu-copy-dialog>
      ${
        this.deleting
          ? html`<dashboard-menu-delete-dialog
              .menu=${this.deleting}
              .api=${this.api}
              .permissionContinuation=${this.permissionContinuation}
              @menu-delete-close=${() => {
                this.deleting = null;
              }}
              @menu-deleted=${() => {
                this.deleting = null;
                void this.#watchMenus();
              }}
            ></dashboard-menu-delete-dialog>`
          : nothing
      }`;
  }

  #renderLoadState() {
    if (this.loading) return html`<p role="status" data-test="loading">${t("menus.loading")}</p>`;
    if (!this.loadError) return nothing;
    return html`<p class="error" role="alert" data-test="load-error">${t("menus.load_error")}</p>
      <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
        >${t("menus.retry")}</wt-button
      >`;
  }

  #renderEditor(id: string) {
    const menu = this.rows.find((row) => row.id === id);
    return html`<div class="heading">
        <nav aria-label=${t("menus.menu_trail")} data-test="menu-breadcrumb">
          <a
            href="/set-menus"
            data-test="back"
            @click=${(event: MouseEvent) => {
              if (leftToBrowser(event)) return;
              event.preventDefault();
              this.#open(null);
            }}
            >${t("nav.set_menus")}</a
          ><span class="sep" aria-hidden="true">›</span>
        </nav>
        <div class="title">
          <h1>${menu?.name ?? t("nav.set_menus")}</h1>
          ${
            menu
              ? html`<wt-help-tooltip
                  mode="help-mode"
                  aria-label=${t("menus.set_menu_help_label")}
                  guide-href=${guideHref("products.set-menus")}
                  guide-label=${t("menus.set_menu_help_guide")}
                  >${t("menus.set_menu_help")}</wt-help-tooltip
                >`
              : nothing
          }
        </div>
      </div>
      ${this.#renderLoadState()}
      ${
        menu
          ? html`<wt-tabs
              data-test="menu-tabs"
              label=${menu.name}
              value="set-menu"
              .items=${[{ key: "set-menu", label: t("menus.set_menu_kind") }]}
            >
              <div slot="set-menu">
                ${keyed(
                  id,
                  html`<dashboard-set-menu-editor
                    .api=${this.api}
                    .menuId=${id}
                    @set-menu-terms-saved=${() => void this.#watchMenus()}
                  ></dashboard-set-menu-editor>`,
                )}
              </div>
            </wt-tabs>`
          : nothing
      }`;
  }

  override render() {
    return html`<div class="sizer" aria-hidden="true">
        <span class="narrow-probe" ${ref(this.#listLayout.observe)}></span>
      </div>
      ${this.menuId === null ? this.#renderList() : this.#renderEditor(this.menuId)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-set-menus-screen": SetMenusScreen;
  }
}
