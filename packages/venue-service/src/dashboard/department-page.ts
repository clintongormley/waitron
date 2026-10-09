import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, leaveCoordinatorFor } from "@waitron/ui";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-button.js";
import "./department-settings.js";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import { t } from "./strings.js";

@customElement("department-page")
export class DepartmentPage extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      nav {
        color: var(--wt-color-primary-text);
        margin-block-end: var(--wt-space-3);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .heading {
        display: flex;
        align-items: baseline;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
        margin-block-end: var(--wt-space-4);
      }
      h1 {
        font-size: var(--wt-font-size-xl);
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
        max-width: 100%;
      }
      .status {
        color: var(--wt-color-text-muted);
      }
      .setup {
        margin-block: 0 var(--wt-space-4);
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api?: VenueServiceApi;
  @property({ attribute: false }) model?: VenueServiceView;
  @property() departmentId = "";
  @property() view: "settings" | "zones" = "settings";
  private generation = {};
  override disconnectedCallback() {
    this.generation = {};
    super.disconnectedCallback();
  }
  private emit(name: string, detail: object) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private async select(view: "settings" | "zones") {
    const id = this.departmentId,
      generation = this.generation;
    const proceed = () => {
      if (this.isConnected && this.departmentId === id && this.generation === generation)
        this.emit("view-change", { view });
    };
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator) await coordinator.request({ scopes: "all", reason: "navigation", proceed });
    else proceed();
    const tabs = this.shadowRoot?.querySelector("wt-tabs");
    if (tabs) tabs.value = this.view;
  }
  private setup() {
    const row = this.model!.departments.find((d) => d.id === this.departmentId)!;
    if (!row.active) return html`${t("venue.department_disabled")}`;
    const issues = this.model!.readiness.filter((issue) =>
      issue.code === "department.no_periods"
        ? issue.departmentId === row.id
        : (issue.code === "zone.menu_unpublished" || issue.code === "zone.menu_empty") &&
          this.model!.zones.some((z) => z.id === issue.zoneId && z.departmentId === row.id),
    );
    if (!issues.length) return nothing;
    return html`${issues.map((issue, index) => html`${index ? " " : nothing}${issue.code === "department.no_periods" ? html`${issue.departmentName} ${t("venue.readiness.department_no_periods")} <a href=${`/manage/opening-hours/department/${encodeURIComponent(row.id)}`}>${t("venue.set_up_periods")}</a>` : issue.code === "zone.menu_unpublished" ? html`${issue.zoneName} ${t("venue.readiness.zone_menu_unpublished")}` : issue.code === "zone.menu_empty" ? html`${issue.zoneName}: ${issue.menuName} ${t("venue.readiness.menu_empty")} ${issue.zoneName}.` : nothing}`)}`;
  }
  override render() {
    const row = this.model?.departments.find((d) => d.id === this.departmentId);
    if (!row) return nothing;
    const setup = this.setup();
    return html`<nav aria-label=${t("venue.departments")}>
        <a href="/manage/venue-operations">${t("venue.departments")}</a> ›
      </nav>
      <div class="heading">
        <h1>${row.name}</h1>
        ${!row.active ? html`<span class="status" data-test="department-status">(${t("venue.department_disabled")})</span><wt-button data-test="enable-department" @click=${() => this.emit("enable-department", { departmentId: row.id })}>${t("venue.enable")}</wt-button>` : nothing}
      </div>
      ${setup === nothing ? nothing : html`<p class="setup" data-test="setup">${setup}</p>`}
      <wt-tabs
        .items=${[
          { key: "settings", label: t("venue.settings_tab") },
          { key: "zones", label: t("venue.list_zones") },
        ]}
        .value=${this.view}
        label=${row.name}
        @wt-tab-change=${(e: CustomEvent<{ value: "settings" | "zones" }>) => {
          e.stopPropagation();
          void this.select(e.detail.value);
        }}
      >
        <department-settings
          slot="settings"
          .api=${this.api}
          .model=${this.model}
          .departmentId=${row.id}
          .showEnable=${false}
        ></department-settings>
        <slot name="zones" slot="zones"></slot>
      </wt-tabs>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "department-page": DepartmentPage;
  }
}
