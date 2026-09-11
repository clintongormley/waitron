import { customElement } from "lit/decorators.js";
import { WtRowActions } from "@waitron/ui";

@customElement("dashboard-row-actions")
export class RowActions extends WtRowActions {}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-row-actions": RowActions;
  }
}
