import { customElement } from "lit/decorators.js";
import { VenueOperationsLoader } from "./venue-operations-loader.js";

@customElement("dashboard-venue-operations-screen")
export class VenueOperationsScreen extends VenueOperationsLoader {}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-operations-screen": VenueOperationsScreen;
  }
}
