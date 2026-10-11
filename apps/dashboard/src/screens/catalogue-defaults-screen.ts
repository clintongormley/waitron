import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import "./catalogue-settings-panel.js";

@customElement("dashboard-catalogue-defaults-screen")
export class CatalogueDefaultsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;

  override render() {
    return html`<h1>${t("catalogue_defaults.title")}</h1>
      <dashboard-catalogue-settings-panel .api=${this.api}></dashboard-catalogue-settings-panel>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-defaults-screen": CatalogueDefaultsScreen;
  }
}
