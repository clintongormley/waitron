import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import type {
  MenuOffer,
  ServiceMode,
  VenueReadinessIssue,
  VenueServiceApi,
  VenueServiceView,
} from "./client.js";
import { t } from "./strings.js";

const MODES: ServiceMode[] = ["table_tab", "prepay", "invoice_first", "ticket_then_pay"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

@customElement("dashboard-venue-operations-screen")
export class VenueOperationsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin-top: 0;
      }
      section {
        margin-block: var(--wt-space-5);
      }
      .grid {
        display: grid;
        gap: var(--wt-space-3);
        grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
      }
      .panel {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-4);
      }
      .form-row {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      label {
        display: grid;
        gap: var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
      }
      input,
      select {
        min-width: 10rem;
      }
      ul {
        padding-inline-start: var(--wt-space-5);
      }
      .menu {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        padding-block: var(--wt-space-1);
      }
      .actions {
        display: flex;
        gap: var(--wt-space-2);
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      [role="alert"] {
        color: var(--wt-color-danger);
        margin-block: var(--wt-space-2);
      }
      .required {
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: VenueServiceApi;
  @state() private model?: VenueServiceView;
  @state() private error?: string;
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      this.model = await this.api.load();
      this.error = undefined;
    } catch {
      this.error = t("venue.load_error");
    }
  }

  #value(name: string, root: ParentNode = this.renderRoot): string {
    return (
      (root.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null)
        ?.value ?? ""
    );
  }

  async #save(action: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = undefined;
    try {
      await action();
      await this.#load();
    } catch {
      this.error = t("venue.save_error");
    } finally {
      this.busy = false;
    }
  }

  #addDepartment(): void {
    const name = this.#value("department-name").trim();
    const tradingName = this.#value("trading-name").trim();
    const defaultServiceMode = this.#value("department-mode") as ServiceMode;
    if (name === "" || tradingName === "" || !MODES.includes(defaultServiceMode)) {
      this.error = t("venue.required");
      return;
    }
    void this.#save(() => this.api.createDepartment({ name, tradingName, defaultServiceMode }));
  }

  #addMenu(): void {
    const name = this.#value("menu-name").trim();
    if (name === "") {
      this.error = t("venue.required");
      return;
    }
    void this.#save(() => this.api.createMenu(name));
  }

  #addOffer(menuId: string, root: ParentNode): void {
    const productId = this.#value(`offer-product-${menuId}`, root);
    const sectionName = this.#value(`offer-section-${menuId}`, root).trim();
    const grossPrice = this.#value(`offer-price-${menuId}`, root);
    if (productId === "" || sectionName === "" || grossPrice === "") {
      this.error = t("venue.required");
      return;
    }
    void this.#save(async () => {
      const section = await this.api.createMenuSection(menuId, {
        name: { en: sectionName, es: sectionName },
        displayOrder: 0,
      });
      await this.api.createMenuItem(menuId, {
        sectionId: section.id,
        productId,
        grossPrice,
        displayOrder: 0,
      });
    });
  }

  #saveOffer(menuId: string, menuItemId: string, root: ParentNode): void {
    const grossPrice = this.#value(`offer-price-${menuItemId}`, root);
    if (grossPrice === "") {
      this.error = t("venue.required");
      return;
    }
    void this.#save(() => this.api.updateMenuItem(menuId, menuItemId, { grossPrice }));
  }

  #offerColumns(menuId: string): DataTableColumn<MenuOffer>[] {
    return [
      {
        key: "section",
        label: t("venue.section"),
        cell: (offer) => this.#name(offer.sectionName),
        sortValue: (offer) => this.#name(offer.sectionName),
      },
      {
        key: "product",
        label: t("venue.product"),
        cell: (offer) => this.#name(offer.descriptions),
        sortValue: (offer) => this.#name(offer.descriptions),
      },
      {
        key: "price",
        label: t("venue.price"),
        align: "end",
        cell: (offer) =>
          html`<input
            name=${`offer-price-${offer.id}`}
            inputmode="decimal"
            .value=${offer.grossPrice}
            aria-label=${`${t("venue.price")}: ${this.#name(offer.descriptions)}`}
          />`,
        sortValue: (offer) => Number(offer.grossPrice),
      },
      {
        key: "actions",
        label: t("venue.actions"),
        cell: (offer) =>
          html`<span class="actions">
            <wt-button
              variant="secondary"
              data-test=${`save-offer-${offer.id}`}
              ?disabled=${this.busy}
              @click=${(event: Event) =>
              this.#saveOffer(
                menuId,
                offer.id,
                (event.currentTarget as Node).getRootNode() as ShadowRoot,
              )}
              >${t("venue.save_price")}</wt-button
            ><wt-button
              variant="secondary"
              data-test=${`remove-offer-${offer.id}`}
              ?disabled=${this.busy}
              @click=${() => void this.#save(() => this.api.deactivateMenuItem(menuId, offer.id))}
              >${t("venue.remove_offer")}</wt-button
            >
          </span>`,
      },
    ];
  }

  #routeColumns(): DataTableColumn<VenueServiceView["routes"][number]>[] {
    const model = this.model!;
    return [
      {
        key: "subject",
        label: t("venue.product_or_category"),
        cell: (route) =>
          route.productId === null
            ? (model.categories.find((category) => category.id === route.categoryId)?.name ??
              route.categoryId)
            : (model.products.find((product) => product.id === route.productId)?.descriptions.en ??
              model.products.find((product) => product.id === route.productId)?.descriptions.es ??
              route.productId),
      },
      {
        key: "zone",
        label: t("venue.zones"),
        cell: (route) =>
          route.zoneId === null
            ? t("venue.all_zones")
            : (model.floorZones.find((zone) => zone.id === route.zoneId)?.name ?? route.zoneId),
      },
      {
        key: "station",
        label: t("venue.station"),
        cell: (route) =>
          route.noPreparation
            ? t("venue.no_preparation")
            : (model.stations.find((station) => station.id === route.stationId)?.name ??
              route.stationId),
      },
      {
        key: "actions",
        label: t("venue.actions"),
        cell: (route) =>
          html`<wt-button
            variant="secondary"
            data-test=${`remove-route-${route.id}`}
            ?disabled=${this.busy}
            @click=${() => void this.#save(() => this.api.deleteRoute(route.id))}
            >${t("venue.remove_route")}</wt-button
          >`,
      },
    ];
  }

  #name(names: Record<string, string>): string {
    return names.en ?? names.es ?? Object.values(names)[0] ?? "";
  }

  #saveZone(zoneId: string, root: ParentNode): void {
    const departmentId = this.#value(`zone-department-${zoneId}`, root);
    const mode = this.#value(`zone-mode-${zoneId}`, root);
    if (departmentId === "") {
      this.error = t("venue.required");
      return;
    }
    void this.#save(() =>
      this.api.configureZone(zoneId, {
        departmentId,
        serviceMode: mode === "" ? null : (mode as ServiceMode),
      }),
    );
  }

  #addHours(): void {
    const departmentId = this.#value("hours-department");
    const weekday = Number(this.#value("hours-weekday"));
    const opensAt = this.#value("hours-opens");
    const closesAt = this.#value("hours-closes");
    if (departmentId === "" || opensAt === "" || closesAt === "" || opensAt === closesAt) {
      this.error = t("venue.required");
      return;
    }
    const existing = (this.model?.hours ?? [])
      .filter((interval) => interval.departmentId === departmentId)
      .map((interval) => ({
        weekday: interval.weekday,
        opensAt: interval.opensAt.slice(0, 5),
        closesAt: interval.closesAt.slice(0, 5),
      }));
    void this.#save(() =>
      this.api.replaceHours(departmentId, [...existing, { weekday, opensAt, closesAt }]),
    );
  }

  #addRoute(): void {
    const subject = this.#value("route-subject");
    const zoneId = this.#value("route-zone");
    const target = this.#value("route-target");
    const separator = subject.indexOf(":");
    const kind = subject.slice(0, separator);
    const subjectId = subject.slice(separator + 1);
    if ((kind !== "category" && kind !== "product") || subjectId === "" || target === "") {
      this.error = t("venue.required");
      return;
    }
    void this.#save(() =>
      this.api.createRoute({
        ...(kind === "category" ? { categoryId: subjectId } : { productId: subjectId }),
        zoneId: zoneId === "" ? null : zoneId,
        ...(target === "none" ? { noPreparation: true } : { stationId: target }),
      }),
    );
  }

  #modeOptions(selected: string, includeInherited = false) {
    return html`${
      includeInherited
        ? html`<option value="" ?selected=${selected === ""}>${t("venue.inherit")}</option>`
        : nothing
    }${MODES.map(
      (mode) =>
        html`<option value=${mode} ?selected=${selected === mode}>${t(`venue.${mode}`)}</option>`,
    )}`;
  }

  #hoursFor(departmentId: string): string[] {
    return (this.model?.hours ?? [])
      .filter((interval) => interval.departmentId === departmentId)
      .map(
        (interval) =>
          `${DAYS_EN[interval.weekday]} ${interval.opensAt.slice(0, 5)}–${interval.closesAt.slice(0, 5)}`,
      );
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
          : html`<ul role="alert">
              ${issues.map(
                (issue, index) =>
                  html`<li data-test=${`readiness-issue-${index}`}>
                    ${this.#readinessMessage(issue)}
                  </li>`,
              )}
            </ul>`
      }
    </section>`;
  }

  #departments() {
    const model = this.model!;
    return html`<section>
      <h2>${t("venue.departments")}</h2>
      ${
        model.departments.length === 0
          ? html`<p class="muted">${t("venue.empty")}</p>`
          : html`<div class="grid">
              ${model.departments.map(
                (department) =>
                  html`<article class="panel">
                    <h3>${department.name}</h3>
                    <p>${department.tradingName}</p>
                    <p>${t(`venue.${department.defaultServiceMode}`)}</p>
                    <strong>${t("venue.hours")}</strong>
                    <ul>
                      ${this.#hoursFor(department.id).map((line) => html`<li>${line}</li>`)}
                    </ul>
                    <wt-button
                      variant="secondary"
                      data-test=${`deactivate-department-${department.id}`}
                      ?disabled=${this.busy || !department.active}
                      @click=${() =>
                        void this.#save(() => this.api.deactivateDepartment(department.id))}
                      >${t("venue.deactivate_department")}</wt-button
                    >
                  </article>`,
              )}
            </div>`
      }
      <div class="panel">
        <h3>${t("venue.add_department")}</h3>
        <div class="form-row">
          <label
            >${t("venue.name")} <span class="required">*</span
            ><input name="department-name" required
          /></label>
          <label
            >${t("venue.trading_name")} <span class="required">*</span
            ><input name="trading-name" required
          /></label>
          <label
            >${t("venue.service_style")} <span class="required">*</span
            ><select name="department-mode">
              ${this.#modeOptions("prepay")}
            </select></label
          >
          <wt-button
            data-test="add-department"
            ?disabled=${this.busy}
            @click=${() => this.#addDepartment()}
            >${t("venue.add_department")}</wt-button
          >
        </div>
      </div>
      <div class="panel">
        <h3>${t("venue.hours")}</h3>
        <div class="form-row">
          <label
            >${t("venue.department")} <span class="required">*</span
            ><select name="hours-department">
              ${model.departments.map((d) => html`<option value=${d.id}>${d.name}</option>`)}
            </select></label
          >
          <label
            >${t("venue.weekday")}<select name="hours-weekday">
              ${DAYS_EN.map((day, index) => html`<option value=${index}>${day}</option>`)}
            </select></label
          >
          <label
            >${t("venue.opens")} <span class="required">*</span
            ><input name="hours-opens" type="time" required
          /></label>
          <label
            >${t("venue.closes")} <span class="required">*</span
            ><input name="hours-closes" type="time" required
          /></label>
          <wt-button
            data-test="add-hours"
            ?disabled=${this.busy || model.departments.length === 0}
            @click=${() => this.#addHours()}
            >${t("venue.add_hours")}</wt-button
          >
        </div>
      </div>
    </section>`;
  }

  #zones() {
    const model = this.model!;
    return html`<section>
      <h2>${t("venue.zones")}</h2>
      <div class="grid">
        ${model.floorZones.map((zone) => {
          const configured = model.zones.find((candidate) => candidate.id === zone.id);
          const assignments = model.zoneMenus.filter((item) => item.zoneId === zone.id);
          return html`<article class="panel" data-zone=${zone.id}>
            <h3>${zone.name}</h3>
            <div class="form-row">
              <label
                >${t("venue.department")}<select name=${`zone-department-${zone.id}`}>
                  ${model.departments.map(
                    (department) =>
                      html`<option
                        value=${department.id}
                        ?selected=${configured?.departmentId === department.id}
                      >
                        ${department.name}
                      </option>`,
                  )}
                </select></label
              >
              <label
                >${t("venue.service_style")}<select name=${`zone-mode-${zone.id}`}>
                  ${this.#modeOptions("", true)}
                </select></label
              >
              <wt-button
                ?disabled=${this.busy || model.departments.length === 0}
                @click=${(event: Event) => this.#saveZone(zone.id, (event.currentTarget as Element).parentElement!)}
                >${t("venue.save_zone")}</wt-button
              >
            </div>
            ${model.menus.map((menu, index) => {
              const assignment = assignments.find((item) => item.menuId === menu.id);
              return html`<div class="menu">
                <span>${menu.name}${assignment?.isDefault ? ` — ${t("venue.default")}` : ""}</span
                ><span class="actions"
                  >${assignment === undefined ? html`<wt-button variant="secondary" ?disabled=${this.busy || configured === undefined} @click=${() => void this.#save(() => this.api.allowMenu(zone.id, menu.id, { displayOrder: index, makeDefault: false }))}>${t("venue.make_available")}</wt-button>` : nothing}<wt-button
                    variant="secondary"
                    ?disabled=${this.busy || configured === undefined || assignment?.isDefault === true}
                    @click=${() => void this.#save(() => this.api.allowMenu(zone.id, menu.id, { displayOrder: index, makeDefault: true }))}
                    >${t("venue.make_default")}</wt-button
                  ></span
                >
              </div>`;
            })}
          </article>`;
        })}
      </div>
    </section>`;
  }

  #menus() {
    const model = this.model!;
    return html`<section>
      <h2>${t("venue.menus")}</h2>
      <div class="panel form-row">
        <label
          >${t("venue.menu_name")} <span class="required">*</span><input name="menu-name" required
        /></label>
        <wt-button data-test="add-menu" ?disabled=${this.busy} @click=${() => this.#addMenu()}
          >${t("venue.add_menu")}</wt-button
        >
      </div>
      <div class="grid">
        ${model.menus.map((menu) => {
          const offers = model.offers.filter((offer) => offer.menuId === menu.id);
          const availableProducts = model.products.filter(
            (product) => !offers.some((offer) => offer.productId === product.id),
          );
          return html`<article class="panel" data-menu=${menu.id}>
            <h3>${menu.name}</h3>
            ${html`<wt-data-table
              data-test=${`menu-offers-${menu.id}`}
              aria-label=${menu.name}
              .rows=${offers}
              .columns=${this.#offerColumns(menu.id)}
              .rowKey=${(offer: MenuOffer) => offer.id}
              .emptyMessage=${t("venue.no_offers")}
            ></wt-data-table>`}
            <div class="form-row">
              <label
                >${t("venue.product")} <span class="required">*</span
                ><select name=${`offer-product-${menu.id}`}>
                  ${availableProducts.map(
                    (product) =>
                      html`<option value=${product.id}>
                        ${this.#name(product.descriptions)}
                      </option>`,
                  )}
                </select></label
              >
              <label
                >${t("venue.section")} <span class="required">*</span
                ><input name=${`offer-section-${menu.id}`} required
              /></label>
              <label
                >${t("venue.price")} <span class="required">*</span
                ><input name=${`offer-price-${menu.id}`} inputmode="decimal" required
              /></label>
              <wt-button
                variant="secondary"
                ?disabled=${this.busy || availableProducts.length === 0}
                @click=${(event: Event) =>
                  this.#addOffer(menu.id, (event.currentTarget as Element).parentElement!)}
                >${t("venue.add_offer")}</wt-button
              >
            </div>
          </article>`;
        })}
      </div>
    </section>`;
  }

  #routing() {
    const model = this.model!;
    return html`<section>
      <h2>${t("venue.routing")}</h2>
      <wt-data-table
        data-test="preparation-routes"
        aria-label=${t("venue.routing")}
        .rows=${model.routes}
        .columns=${this.#routeColumns()}
        .rowKey=${(route: VenueServiceView["routes"][number]) => route.id}
        .emptyMessage=${t("venue.routing")}
      ></wt-data-table>
      <div class="panel form-row">
        <label
          >${t("venue.product_or_category")} <span class="required">*</span
          ><select name="route-subject">
            <optgroup label=${t("venue.category")}>
              ${model.categories.map(
                (category) =>
                  html`<option value=${`category:${category.id}`}>${category.name}</option>`,
              )}
            </optgroup>
            <optgroup label=${t("venue.product")}>
              ${model.products.map(
                (product) =>
                  html`<option value=${`product:${product.id}`}>
                    ${this.#name(product.descriptions)}
                  </option>`,
              )}
            </optgroup>
          </select></label
        >
        <label
          >${t("venue.zones")}<select name="route-zone">
            <option value="">${t("venue.all_zones")}</option>
            ${model.floorZones.map((zone) => html`<option value=${zone.id}>${zone.name}</option>`)}
          </select></label
        >
        <label
          >${t("venue.station")} <span class="required">*</span
          ><select name="route-target">
            ${model.stations.map((station) => html`<option value=${station.id}>${station.name}</option>`)}
            <option value="none">${t("venue.no_preparation")}</option>
          </select></label
        >
        <wt-button
          data-test="add-route"
          ?disabled=${this.busy || (model.categories.length === 0 && model.products.length === 0)}
          @click=${() => this.#addRoute()}
          >${t("venue.add_route")}</wt-button
        >
      </div>
    </section>`;
  }

  override render() {
    return html`<h1>${t("venue.title")}</h1>
      ${this.error === undefined ? nothing : html`<div role="alert">${this.error}</div>`}
      ${
        this.model === undefined
          ? nothing
          : html`${this.#readiness()}${this.#departments()}${this.#menus()}${this.#zones()}${this.#routing()}`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-operations-screen": VenueOperationsScreen;
  }
}
