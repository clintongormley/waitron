import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, UrlStateController } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import { t } from "./strings.js";
import "./departments-list.js";
import "./department-page.js";
import "./department-zones.js";
import "./department-dialogs.js";
import type { DepartmentDialog } from "./department-dialogs.js";

@customElement("venue-departments-shell")
export class VenueDepartmentsShell extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      nav {
        margin-block-end: var(--wt-space-3);
        color: var(--wt-color-primary-text);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
    `,
  ];
  @property({ attribute: false }) api!: VenueServiceApi;
  @property({ attribute: false }) model!: VenueServiceView;
  @state() private departmentId = "";
  @state() private view: "settings" | "zones" = "settings";
  @state() private zone = "";
  @state() private dialog?: DepartmentDialog;
  @state() private busy = false;
  @state() private loadError = "";
  @state() private actionError = "";
  #generation = {};
  #opener?: HTMLElement;
  override disconnectedCallback() {
    this.#generation = {};
    this.busy = false;
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("model")) this.loadError = "";
  }
  protected override updated() {
    this.setAttribute("aria-busy", String(this.busy));
  }
  #current(generation: object) {
    return this.isConnected && this.#generation === generation;
  }
  #openDialog(event: CustomEvent<{ departmentId?: string; zoneId?: string }>) {
    event.stopPropagation();
    if (this.busy || this.dialog || !this.model) return;
    const kind = event.type as DepartmentDialog["kind"];
    let dialog: DepartmentDialog;
    if (kind === "add-department") dialog = { kind };
    else if (kind === "add-zone") {
      const department = this.model.departments.find((row) => row.id === this.departmentId);
      if (!department?.active) return;
      dialog = { kind, departmentId: department.id };
    } else if (kind === "rename-department" || kind === "disable-department") {
      const row = this.model.departments.find((row) => row.id === event.detail.departmentId);
      if (!row) return;
      dialog = { kind, row };
    } else {
      const row = this.model.floorZones.find((row) => row.id === event.detail.zoneId);
      if (!row) return;
      dialog = { kind, row };
    }
    const list = this.shadowRoot?.querySelector("departments-list");
    const zones = this.shadowRoot?.querySelector("department-zones");
    if (kind === "add-department")
      this.#opener =
        list?.shadowRoot?.querySelector<HTMLElement>("[data-test=add-department]") ?? undefined;
    else if (kind === "add-zone")
      this.#opener =
        zones?.shadowRoot?.querySelector<HTMLElement>("[data-test=add-zone]") ?? undefined;
    else if (kind === "add-to-department")
      this.#opener =
        list?.shadowRoot?.querySelector<HTMLElement>(
          `[data-test="add-zone-to-department-${CSS.escape(event.detail.zoneId!)}"]`,
        ) ?? undefined;
    else {
      const table = list?.shadowRoot?.querySelector("wt-data-table");
      const key = kind === "disable-department" ? "deactivate-department" : kind;
      const action = kind.endsWith("department")
        ? table?.shadowRoot?.querySelector<HTMLElement>(
            `[data-test="${key}-${CSS.escape(event.detail.departmentId!)}"]`,
          )
        : zones?.shadowRoot?.querySelector<HTMLElement>(`[data-test="${kind}"]`);
      this.#opener =
        action?.closest("wt-row-actions")?.shadowRoot?.querySelector<HTMLButtonElement>("button") ??
        undefined;
    }
    this.dialog = dialog;
  }
  async #closeDialog() {
    const opener = this.#opener;
    const dialog = this.dialog;
    this.dialog = undefined;
    this.#opener = undefined;
    await this.updateComplete;
    await this.#returnFocus(opener, dialog);
  }
  async #returnFocus(opener?: HTMLElement, dialog?: DepartmentDialog) {
    const path = location.pathname;
    const generation = this.#generation;
    const list = this.shadowRoot?.querySelector("departments-list");
    const zones = this.shadowRoot?.querySelector("department-zones");
    await list?.updateComplete;
    await zones?.updateComplete;
    if (!this.#current(generation) || this.busy || this.dialog || location.pathname !== path)
      return;
    const root = opener?.getRootNode();
    const zoneId = root instanceof ShadowRoot ? root.host.getAttribute("data-zone-id") : null;
    const sameRow = zoneId === null || (dialog && "row" in dialog && zoneId === dialog.row.id);
    const target =
      opener?.isConnected && sameRow
        ? opener
        : (list?.shadowRoot?.querySelector<HTMLElement>("[data-test=add-department]") ??
          zones?.shadowRoot?.querySelector<HTMLElement>("[data-test=add-zone]") ??
          this.shadowRoot?.querySelector<HTMLElement>("nav a"));
    target?.focus();
  }
  async #refresh(generation: object) {
    const snapshot = this.model;
    try {
      const model = await (this.api.background ?? this.api).load();
      if (!this.#current(generation)) return false;
      if (this.model === snapshot) {
        this.model = model;
        this.dispatchEvent(
          new CustomEvent("model-change", { detail: { model }, bubbles: true, composed: true }),
        );
      }
      this.loadError = "";
      return true;
    } catch {
      if (this.#current(generation) && this.model === snapshot)
        this.loadError = t("venue.load_error");
      return false;
    }
  }
  async #saved(event: CustomEvent<{ departmentId?: string; zoneId?: string }>) {
    event.stopPropagation();
    if (this.busy) return;
    const generation = this.#generation;
    const dialog = this.dialog;
    const opener = this.#opener;
    const path = location.pathname;
    this.busy = true;
    await this.#closeDialog();
    const refreshed = await this.#refresh(generation);
    if (refreshed && this.#current(generation) && location.pathname === path) {
      if (dialog?.kind === "add-department" && event.detail.departmentId)
        await this.#navigate({ department: event.detail.departmentId, view: null, zone: null });
      else if (event.detail.zoneId && this.departmentId) {
        const zone = this.model.zones.find(
          (row) => row.id === event.detail.zoneId && row.departmentId === this.departmentId,
        );
        const selected =
          zone?.id ?? this.model.zones.find((row) => row.departmentId === this.departmentId)?.id;
        await this.#navigate({ view: "zones", zone: selected ?? null }, true);
      }
    }
    if (this.#current(generation)) {
      this.busy = false;
      await this.updateComplete;
      if (this.#current(generation) && location.pathname === path)
        await this.#returnFocus(opener, dialog);
    }
  }
  async #enable(event: CustomEvent<{ departmentId?: string; zoneId?: string }>) {
    event.stopPropagation();
    if (this.busy || this.dialog) return;
    const department = event.type === "enable-department";
    const id = department ? event.detail.departmentId : event.detail.zoneId;
    if (
      !id ||
      !(department ? this.model.departments : this.model.floorZones).some((row) => row.id === id)
    )
      return;
    const generation = this.#generation;
    this.busy = true;
    this.actionError = "";
    try {
      if (department) await this.api.updateDepartment(id, { active: true });
      else await this.api.updateZone(id, { active: true });
    } catch (error) {
      if (this.#current(generation)) {
        this.actionError = t(
          (error as { code?: string } | undefined)?.code === "zone.department_inactive"
            ? "venue.zone_department_inactive"
            : "venue.save_error",
        );
        this.busy = false;
      }
      return;
    }
    if (this.#current(generation)) await this.#refresh(generation);
    if (this.#current(generation)) this.busy = false;
  }
  readonly #url = new UrlStateController(this, () => this.#restore(), {
    basePath: "/manage",
    primary: "dashboard",
    children: { "venue-operations": { department: "department", view: "view", zone: "zone" } },
  });
  #restore() {
    if (this.#url.read("dashboard") !== "venue-operations") return;
    this.departmentId = this.#url.read("department") ?? "";
    this.view = this.#url.read("view") === "zones" ? "zones" : "settings";
    this.zone = this.#url.read("zone") ?? "";
    if (!this.departmentId && (this.#url.read("view") || this.#url.read("zone")))
      void this.#url.write({ view: null, zone: null }, true);
  }
  async #navigate(changes: Record<string, string | null>, replace = false) {
    await this.#url.write(changes, replace);
    if (this.isConnected) this.#restore();
  }
  #open(event: CustomEvent<{ departmentId: string }>) {
    event.stopPropagation();
    void this.#navigate({ department: event.detail.departmentId, view: null, zone: null });
  }
  #view(event: CustomEvent<{ view: "settings" | "zones" }>) {
    event.stopPropagation();
    void this.#navigate({ view: event.detail.view === "zones" ? "zones" : null, zone: null });
  }
  #zone(event: CustomEvent<{ zoneId: string }>) {
    event.stopPropagation();
    void this.#navigate({ view: "zones", zone: event.detail.zoneId }, true);
  }
  #content(): unknown {
    if (!this.model) return nothing;
    if (!this.departmentId)
      return html`<departments-list
        .model=${this.model}
        @open-department=${this.#open}
      ></departments-list>`;
    const row = this.model.departments.find((d) => d.id === this.departmentId);
    if (!row)
      return html`<nav aria-label=${t("venue.departments")}>
          <a href="/manage/venue-operations">${t("venue.departments")}</a> ›
        </nav>
        <p role="status">${t("venue.department_not_found")}</p>`;
    return keyed(
      row.id,
      html`<department-page
        .api=${this.api}
        .model=${this.model}
        .departmentId=${row.id}
        .view=${this.view}
        @view-change=${this.#view}
        @zone-change=${this.#zone}
      >
        <department-zones
          slot="zones"
          .api=${this.api}
          .model=${this.model}
          .departmentId=${row.id}
          .zone=${this.zone}
        ></department-zones>
      </department-page>`,
    );
  }
  override render() {
    return html`<div
        @add-department=${this.#openDialog}
        @rename-department=${this.#openDialog}
        @disable-department=${this.#openDialog}
        @add-zone=${this.#openDialog}
        @rename-zone=${this.#openDialog}
        @move-zone=${this.#openDialog}
        @add-to-department=${this.#openDialog}
        @disable-zone=${this.#openDialog}
        @enable-department=${this.#enable}
        @enable-zone=${this.#enable}
        @saved=${this.#saved}
        ?inert=${this.busy}
      >
        ${this.actionError || this.loadError ? html`<p role="alert">${this.actionError || this.loadError}</p>` : nothing}${this.#content()}
      </div>
      <department-dialogs
        .api=${this.api}
        .model=${this.model}
        .dialog=${this.dialog}
        @saved=${this.#saved}
        @closed=${(event: Event) => {
          event.stopPropagation();
          void this.#closeDialog();
        }}
      ></department-dialogs>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "venue-departments-shell": VenueDepartmentsShell;
  }
}
