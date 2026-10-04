import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "../widgets/course-list.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { BumpMode, DashboardApi, FireControl } from "../api/client.js";

@customElement("dashboard-kitchen-screen")
export class KitchenScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .panel-title {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .bump {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-6);
        color: var(--wt-color-text);
      }
      .bump-options {
        display: flex;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) readOnly = false;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );

  @state() private bumpMode: BumpMode = "line";
  @state() private fireControl: FireControl = "waiter";
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.#showError(null);
    await Promise.all([
      this.#queries
        .watch("getBumpMode", [], (bump) => {
          this.bumpMode = bump.mode;
        })
        .catch((error: unknown) => this.#showReadError(error)),
      this.#queries
        .watch("getFireControl", [], (fire) => {
          this.fireControl = fire.mode;
        })
        .catch((error: unknown) => this.#showReadError(error)),
    ]);
  }

  async #setBump(mode: BumpMode): Promise<void> {
    this.#showError(null);
    this.bumpMode = mode;
    try {
      await this.api.setBumpMode(mode);
    } catch (error) {
      this.#showError(codeOf(error));
    }
  }

  async #setFire(mode: FireControl): Promise<void> {
    this.#showError(null);
    this.fireControl = mode;
    try {
      await this.api.setFireControl(mode);
    } catch (error) {
      this.#showError(codeOf(error));
    }
  }

  #bumpOption(mode: BumpMode, label: string): TemplateResult {
    return html`<wt-button
      variant=${this.bumpMode === mode ? "primary" : "secondary"}
      size="sm"
      data-test="bump-${mode}"
      @click=${() => void this.#setBump(mode)}
      >${label}</wt-button
    >`;
  }

  #fireOption(mode: FireControl, label: string): TemplateResult {
    return html`<wt-button
      variant=${this.fireControl === mode ? "primary" : "secondary"}
      size="sm"
      data-test="fire-${mode}"
      @click=${() => void this.#setFire(mode)}
      >${label}</wt-button
    >`;
  }

  override render(): TemplateResult {
    return html`
      <section data-test="courses-panel">
        <h2 class="panel-title">${t("kitchen.courses_title")}</h2>
        <dashboard-course-list .api=${this.api} .readOnly=${this.readOnly}></dashboard-course-list>
      </section>

      <section class="bump" role="group" aria-label=${t("kitchen.bump_mode")}>
        <span class="panel-title">${t("kitchen.bump_mode")}</span>
        <div class="bump-options">
          ${this.readOnly ? (this.bumpMode === "line" ? t("kitchen.bump_line") : t("kitchen.bump_ticket")) : html`${this.#bumpOption("line", t("kitchen.bump_line"))}${this.#bumpOption("ticket", t("kitchen.bump_ticket"))}`}
        </div>
      </section>

      <section class="bump" role="group" aria-label=${t("kitchen.fire_mode")}>
        <span class="panel-title">${t("kitchen.fire_mode")}</span>
        <div class="bump-options">
          ${this.readOnly ? t(this.fireControl === "waiter" ? "kitchen.fire_waiter" : this.fireControl === "kitchen" ? "kitchen.fire_kitchen" : "kitchen.fire_expo") : html`${this.#fireOption("waiter", t("kitchen.fire_waiter"))}${this.#fireOption("kitchen", t("kitchen.fire_kitchen"))}${this.#fireOption("expo", t("kitchen.fire_expo"))}`}
        </div>
      </section>

      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-kitchen-screen": KitchenScreen;
  }
}
