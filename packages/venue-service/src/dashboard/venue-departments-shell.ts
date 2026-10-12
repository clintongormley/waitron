import type { DashboardPanelRenderer } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, UrlStateController } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import { t } from "./strings.js";
import "./departments-list.js";
import "./department-edit-dialog.js";
import "./zone-edit-dialog.js";
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
  @property({ attribute: false }) renderPanel?: DashboardPanelRenderer;
  @property({ attribute: false }) api!: VenueServiceApi;
  @property({ attribute: false }) model!: VenueServiceView;
  @state() private departmentId = "";
  @state() private view: "settings" | "zones" | "receipt" = "settings";
  @state() private zone = "";
  @state() private dialog?: DepartmentDialog;
  @state() private busy = false;
  @state() private loadError = "";
  @state() private actionError = "";
  #generation = {};
  #refreshAgain = false;
  #refreshActive?: Promise<boolean>;
  #opener?: HTMLElement;
  override disconnectedCallback() {
    this.#generation = {};
    this.#refreshAgain = false;
    this.#refreshActive = undefined;
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
      const department = this.model.departments.find(
        (row) => row.id === (event.detail.departmentId ?? this.departmentId),
      );
      if (!department?.active) return;
      dialog = { kind, departmentId: department.id };
    } else if (kind === "rename-department" || kind === "delete-department") {
      const row = this.model.departments.find((row) => row.id === event.detail.departmentId);
      if (!row || row.active === false) return;
      dialog = { kind, row };
    } else {
      const row = this.model.floorZones.find((row) => row.id === event.detail.zoneId);
      if (!row || row.active === false) return;
      dialog = { kind, row };
    }
    const list = this.shadowRoot?.querySelector("departments-list");
    const table = list?.shadowRoot?.querySelector("wt-data-table");
    if (kind === "add-department")
      this.#opener =
        list?.shadowRoot?.querySelector<HTMLElement>("[data-test=add-department]") ?? undefined;
    else if (kind === "add-zone")
      this.#opener =
        table?.shadowRoot
          ?.querySelector<HTMLElement>(
            `[data-test="add-zone-${CSS.escape(event.detail.departmentId ?? this.departmentId)}"]`,
          )
          ?.closest("wt-row-actions")
          ?.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? undefined;
    else if (kind === "add-to-department")
      this.#opener =
        list?.shadowRoot?.querySelector<HTMLElement>(
          `[data-test="add-zone-to-department-${CSS.escape(event.detail.zoneId!)}"]`,
        ) ?? undefined;
    else {
      const table = list?.shadowRoot?.querySelector("wt-data-table");
      const key = kind;
      const action = kind.endsWith("department")
        ? table?.shadowRoot?.querySelector<HTMLElement>(
            `[data-test="${key}-${CSS.escape(event.detail.departmentId!)}"]`,
          )
        : table?.shadowRoot?.querySelector<HTMLElement>(
            `[data-test="${kind}-${CSS.escape(event.detail.zoneId!)}"]`,
          );
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
    await list?.updateComplete;
    if (!this.#current(generation) || this.busy || this.dialog || location.pathname !== path)
      return;
    const root = opener?.getRootNode();
    const zoneId = root instanceof ShadowRoot ? root.host.getAttribute("data-zone-id") : null;
    const sameRow = zoneId === null || (dialog && "row" in dialog && zoneId === dialog.row.id);
    const target =
      opener?.isConnected && sameRow
        ? opener
        : (list?.shadowRoot?.querySelector<HTMLElement>("[data-test=add-department]") ??
          this.shadowRoot?.querySelector<HTMLElement>("nav a"));
    target?.focus();
  }
  async #refresh(generation: object): Promise<boolean> {
    if (this.#refreshActive) {
      this.#refreshAgain = true;
      return this.#refreshActive;
    }
    const run = async () => {
      let success: boolean;
      do {
        this.#refreshAgain = false;
        success = await this.#readRefresh(generation);
      } while (this.#refreshAgain && this.#current(generation));
      return success;
    };
    const pending = run();
    this.#refreshActive = pending;
    try {
      return await pending;
    } finally {
      if (this.#refreshActive === pending) this.#refreshActive = undefined;
    }
  }
  async #readRefresh(generation: object) {
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
  async #gone(event: Event) {
    event.stopPropagation();
    if (this.busy) return;
    const generation = this.#generation;
    this.busy = true;
    await this.#closeDialog();
    await this.#refresh(generation);
    if (this.#current(generation)) this.busy = false;
  }
  async #moved(event: CustomEvent<{ zoneId: string; focus?: boolean }>) {
    const path = location.pathname,
      generation = this.#generation;
    await this.#written(event);
    if (!event.detail.focus) return;
    await this.updateComplete;
    const list = this.shadowRoot!.querySelector("departments-list");
    await list?.updateComplete;
    const table = list?.shadowRoot?.querySelector("wt-data-table");
    await table?.updateComplete;
    if (!this.#current(generation) || this.busy || this.dialog || location.pathname !== path)
      return;
    const target =
      table?.shadowRoot?.querySelector<HTMLElement>(
        `[data-test="zone-grip-${CSS.escape(event.detail.zoneId)}"]`,
      ) ?? list?.shadowRoot?.querySelector<HTMLElement>("[data-test=add-department]");
    target?.focus();
  }
  async #written(event: Event) {
    event.stopPropagation();
    if (this.busy) {
      this.#refreshAgain = true;
      await this.#refreshActive;
      return;
    }
    const generation = this.#generation;
    this.busy = true;
    await this.#refresh(generation);
    if (this.#current(generation)) this.busy = false;
  }
  async #saved(event: CustomEvent<{ departmentId?: string; zoneId?: string }>) {
    event.stopPropagation();
    if (this.busy) return;
    const generation = this.#generation;
    const dialog = this.dialog;
    const opener = this.#opener;
    const path = location.pathname;
    let focusPath = path;
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
        focusPath = location.pathname;
      }
    }
    if (this.#current(generation)) {
      this.busy = false;
      await this.updateComplete;
      if (this.#current(generation) && location.pathname === focusPath)
        await this.#returnFocus(opener, dialog);
    }
  }
  readonly #url = new UrlStateController(this, () => this.#restore(), {
    basePath: "/manage",
    primary: "dashboard",
    children: { "venue-operations": { department: "department", view: "view", zone: "zone" } },
  });
  #restore() {
    if (this.#url.read("dashboard") !== "venue-operations") return;
    this.departmentId = this.#url.read("department") ?? "";
    const view = this.#url.read("view");
    this.view = view === "zones" || view === "receipt" ? view : "settings";
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
  #openZone(event: CustomEvent<{ zoneId: string }>) {
    event.stopPropagation();
    const zone = this.model.zones.find(
      (row) => row.id === event.detail.zoneId && row.active !== false,
    );
    if (zone) void this.#navigate({ department: zone.departmentId, view: "zones", zone: zone.id });
  }
  #openReceipt(event: CustomEvent<{ departmentId: string }>) {
    event.stopPropagation();
    void this.#navigate({ department: event.detail.departmentId, view: "receipt", zone: null });
  }
  async #editorClosed(event: CustomEvent<{ departmentId?: string; zoneId?: string }>) {
    event.stopPropagation();
    if (
      (event.detail.zoneId && event.detail.zoneId !== this.zone) ||
      (event.detail.departmentId && event.detail.departmentId !== this.departmentId)
    )
      return;
    await this.#navigate({ department: null, view: null, zone: null }, true);
    await this.updateComplete;
    this.shadowRoot!.querySelector("departments-list")
      ?.shadowRoot?.querySelector<HTMLElement>("[data-test=add-department]")
      ?.focus();
  }
  async #editorSaved(event: CustomEvent<{ departmentId?: string; zoneId?: string }>) {
    await this.#editorClosed(event);
    await this.#written(event);
  }
  async #receiptClosed(event: CustomEvent<{ departmentId: string }>) {
    event.stopPropagation();
    if (this.departmentId !== event.detail.departmentId || this.view !== "receipt") return;
    await this.#navigate({ department: null, view: null, zone: null }, true);
  }
  async #receiptSaved(event: CustomEvent<{ departmentId: string }>) {
    await this.#receiptClosed(event);
    await this.#written(event);
  }
  #content(): unknown {
    if (!this.model) return nothing;
    const department = this.model.departments.find(
      (row) => row.id === this.departmentId && row.active,
    );
    const zone = this.model.zones.find(
      (row) =>
        row.id === this.zone &&
        row.departmentId === this.departmentId &&
        row.active !== false &&
        this.model.floorZones.find((floor) => floor.id === row.id)?.active !== false,
    );
    return html`<departments-list
        .api=${this.api}
        .model=${this.model}
        @open-department=${this.#open}
        @edit-zone=${this.#openZone}
        @edit-receipt=${this.#openReceipt}
      ></departments-list>
      ${this.departmentId && !department ? html`<p role="status">${t("venue.department_not_found")}</p>` : nothing}
      ${
        department
          ? this.view === "receipt"
            ? keyed(
                department.id,
                this.renderPanel?.("department-receipt", {
                  id: department.id,
                  name: department.name,
                }) ?? nothing,
              )
            : this.view === "zones"
              ? zone
                ? keyed(
                    zone.id,
                    html`<zone-edit-dialog
                      .api=${this.api}
                      .model=${this.model}
                      .zoneId=${zone.id}
                      @closed=${this.#editorClosed}
                      @gone=${this.#editorClosed}
                      @saved=${this.#editorSaved}
                      @written=${this.#written}
                    ></zone-edit-dialog>`,
                  )
                : nothing
              : keyed(
                  department.id,
                  html`<department-edit-dialog
                    .api=${this.api}
                    .model=${this.model}
                    .departmentId=${department.id}
                    @closed=${this.#editorClosed}
                    @gone=${this.#editorClosed}
                    @saved=${this.#editorSaved}
                    @written=${this.#written}
                  ></department-edit-dialog>`,
                )
          : nothing
      }`;
  }
  override render() {
    return html`<div
        @add-department=${this.#openDialog}
        @rename-department=${this.#openDialog}
        @delete-department=${this.#openDialog}
        @add-zone=${this.#openDialog}
        @rename-zone=${this.#openDialog}
        @move-zone=${this.#openDialog}
        @add-to-department=${this.#openDialog}
        @delete-zone=${this.#openDialog}
        @saved=${this.#saved}
        @zone-moved=${this.#moved}
        @zone-change=${this.#openZone}
        @department-receipt-closed=${this.#receiptClosed}
        @department-receipt-saved=${this.#receiptSaved}
        ?inert=${this.busy}
      >
        ${this.actionError || this.loadError ? html`<p role="alert">${this.actionError || this.loadError}</p>` : nothing}${this.#content()}
      </div>
      <department-dialogs
        .api=${this.api}
        .model=${this.model}
        .dialog=${this.dialog}
        .opener=${this.#opener ?? null}
        @gone=${this.#gone}
        .refreshing=${this.busy}
        @saved=${this.#saved}
        @written=${this.#written}
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
