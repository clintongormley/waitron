import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";

@customElement("dashboard-app")
export class DashboardApp extends LitElement {
  static override styles = [baseStyles];
  override render() {
    return html`<main></main>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-app": DashboardApp;
  }
}
