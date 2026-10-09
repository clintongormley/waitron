import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, UrlStateController } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import { t } from "./strings.js";
import "./departments-list.js";
import "./department-page.js";
import "./department-zones.js";

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
  override render(): unknown {
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
}
declare global {
  interface HTMLElementTagNameMap {
    "venue-departments-shell": VenueDepartmentsShell;
  }
}
