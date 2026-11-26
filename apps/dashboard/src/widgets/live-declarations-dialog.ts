import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DeclarationMenu } from "@waitron/menu";
import type { DashboardApi } from "../api/client.js";
import { conjunctionList } from "../i18n/list.js";
import { fill, t } from "../i18n/t.js";
import { localTimeWords } from "./menu-publications.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";

export interface LiveDeclarationQuestion {
  id: string;
  menus: DeclarationMenu[];
}

@customElement("dashboard-live-declarations-dialog")
export class LiveDeclarationsDialog extends LitElement {
  static override styles = css`
    p {
      margin: 0 0 var(--wt-space-3);
    }
    fieldset {
      margin: 0;
      min-inline-size: 0;
      padding: 0;
      border: 0;
    }
    p + fieldset > legend {
      padding-inline: 0;
    }
    label {
      display: flex;
      align-items: center;
      gap: var(--wt-space-2);
      min-height: var(--wt-tap-min);
    }
    input {
      flex: none;
      margin: 0;
      accent-color: var(--wt-color-primary);
    }
  `;

  @property({ attribute: false }) question: LiveDeclarationQuestion | null = null;
  @property({ attribute: false }) correct!: DashboardApi["correctLiveDeclarations"];
  @state() private busy = false;
  @state() private error = "";
  @state() private selected = new Set<string>();

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("question")) return;
    this.busy = false;
    this.error = "";
    this.selected = new Set(
      this.question?.menus.flatMap(({ queued }) =>
        queued.filter(({ stillOld }) => stillOld).map(({ versionId }) => versionId),
      ),
    );
  }

  #choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = new Set(this.selected);
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
    this.selected = selected;
  }

  #dialog() {
    return this.renderRoot.querySelector("wt-dialog")!;
  }

  async #updateMenus(): Promise<void> {
    const question = this.question;
    if (question === null || this.busy) return;
    const queued = [...this.selected];
    const affected = question.menus.filter(
      (menu) => menu.live || menu.queued.some(({ versionId }) => this.selected.has(versionId)),
    );
    if (affected.length === 0) return;
    const current = () => this.question === question && this.isConnected;
    this.busy = true;
    try {
      await this.correct(question.id, queued);
      if (current()) this.#dialog().closeAfter("saved");
    } catch (error) {
      if (current()) {
        this.error = fill(
          typeof (error as { status?: unknown } | null)?.status === "number"
            ? "live_declarations.refused"
            : "live_declarations.unconfirmed",
          { menus: conjunctionList(affected.map(({ name }) => name)) },
        );
      }
    } finally {
      if (current()) this.busy = false;
    }
  }

  override render() {
    if (this.question === null) return nothing;
    const { menus } = this.question;
    const live = menus.filter((menu) => menu.live);
    const scheduled = menus.flatMap(({ name, queued }) =>
      queued.map((version) => ({ name, ...version })),
    );
    const blocked = live.length === 0 && this.selected.size === 0;
    return html`<wt-dialog
      .open=${true}
      .dismissible=${!this.busy}
      heading=${t(live.length ? "live_declarations.live_title" : "live_declarations.scheduled_title")}
    >
      ${live.length ? html`<p>${fill("live_declarations.live_menus", { menus: conjunctionList(live.map(({ name }) => name)) })}</p>` : nothing}
      ${
        scheduled.length
          ? html`<fieldset ?disabled=${this.busy}>
              <legend>
                ${t(live.length ? "live_declarations.also_scheduled" : "live_declarations.scheduled")}
              </legend>
              ${scheduled.map(
                ({ name, versionId, local }) =>
                  html`<label for=${`scheduled-${versionId}`}>
                    <input
                      id=${`scheduled-${versionId}`}
                      type="checkbox"
                      name="scheduled"
                      .value=${versionId}
                      .checked=${this.selected.has(versionId)}
                      @change=${this.#choose}
                    />
                    <span
                      >${fill("live_declarations.version", { menu: name, time: local.utcFallback ? `${localTimeWords(local)} UTC` : localTimeWords(local) })}</span
                    >
                  </label>`,
              )}
            </fieldset>`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${this.error}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => void this.#dialog().requestClose("navigation")}
          >${t(this.error ? "action.close" : "live_declarations.not_now")}</wt-button
        >
        <wt-button
          variant=${blocked ? "secondary" : "primary"}
          ?disabled=${blocked || this.busy}
          .loading=${this.busy}
          @click=${this.#updateMenus}
          >${t(this.error ? "live_declarations.retry" : "live_declarations.update")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-live-declarations-dialog": LiveDeclarationsDialog;
  }
}
