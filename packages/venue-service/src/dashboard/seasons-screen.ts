import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, pageTitleStyles } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import { t } from "./strings.js";
import "./seasons-window.js";

@customElement("dashboard-seasons-screen")
export class SeasonsScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ type: Boolean }) readOnly = false;
  @state() private model?: OpeningHoursModel;
  @state() private readError = "";
  private detach?: () => void;

  override connectedCallback() {
    super.connectedCallback();
    this.detach = this.api.watchOpeningHours(
      (model) => {
        this.model = model;
        this.readError = "";
      },
      () => {
        this.readError = t("opening.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }
  override disconnectedCallback() {
    this.detach?.();
    super.disconnectedCallback();
  }
  override render() {
    return html`<h1>${t("season.seasons")}</h1>
      ${this.readError ? html`<p role="alert" data-test="read-error">${this.readError}</p>` : nothing}
      ${
        this.model
          ? html`<seasons-window
              .api=${this.api}
              .seasons=${this.model.seasons}
              .clockRevision=${this.model.clockRevision}
              .readOnly=${this.readOnly}
              @seasons-saved=${(event: Event) => {
                event.stopPropagation();
                this.api.rereadWatches();
              }}
            ></seasons-window>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-seasons-screen": SeasonsScreen;
  }
}
