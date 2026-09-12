import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import { ImageApi } from "./client.js";
import "./image-library.js";

@customElement("media-image-picker")
export class ImagePicker extends LitElement {
  @property({ attribute: false }) request?: DashboardRequest;
  @property({ attribute: false }) liveData?: LiveData;
  #api?: ImageApi;
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("request") || changed.has("liveData"))
      this.#api = this.request ? new ImageApi(this.request, this.liveData) : undefined;
  }
  override render() {
    return this.#api
      ? html`<dashboard-image-library .api=${this.#api} picker></dashboard-image-library>`
      : nothing;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "media-image-picker": ImagePicker;
  }
}
