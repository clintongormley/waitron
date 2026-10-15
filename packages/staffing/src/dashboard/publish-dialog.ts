import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { RosterBreach } from "@waitron/workforce/roster-validation";
import type { RotaWeek } from "../staffing-types.js";
import { breachText } from "./rota-warnings.js";
import { t } from "./strings.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";
@customElement("rota-publish-dialog")
export class PublishDialog extends LitElement {
  static override styles = [baseStyles];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) breaches: RosterBreach[] = [];
  @property({ attribute: false }) week!: RotaWeek;
  @property() error = "";
  #back() {
    if (!this.busy) this.dispatchEvent(new CustomEvent("back", { bubbles: true, composed: true }));
  }
  override render() {
    return html`<wt-dialog
      .open=${this.open}
      heading=${t("staffing.rota.publish")}
      .dismissible=${!this.busy}
      @wt-close=${() => this.#back()}
    >
      <ul>
        ${this.breaches.map((b) => html`<li>${this.week.people.find((p) => p.personId === b.personId)?.name}: ${breachText(b)}</li>`)}
      </ul>
      ${this.breaches.length ? nothing : html`<p>${t("staffing.rota.no_warnings")}</p>`}
      <wt-form-actions slot="footer" .error=${this.error}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="back"
          ?disabled=${this.busy}
          @click=${() => this.#back()}
          >${t("staffing.rota.back")}</wt-button
        >
        <wt-button
          data-test="publish"
          ?disabled=${this.busy}
          @click=${() => {
            if (!this.busy)
              this.dispatchEvent(new CustomEvent("publish", { bubbles: true, composed: true }));
          }}
          >${t(this.breaches.length ? "staffing.rota.publish_anyway" : "staffing.rota.publish")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}
