import { DraftRows } from "@waitron/dashboard-kit";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, ServiceStatus } from "../api/client.js";

interface EditableStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
}

/** A row's save reads its values from state at click time, not from a render closure, so an edit made
 * just before the click is the one that persists. */
@customElement("dashboard-service-status-screen")
export class ServiceStatusScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .row {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        flex-wrap: wrap;
      }
      .read-row {
        display: grid;
        gap: var(--wt-space-2);
      }
      .new {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        margin-top: var(--wt-space-6);
        flex-wrap: wrap;
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) readOnly = false;
  readonly #statusesDrafts = new DraftRows<EditableStatus>();
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );

  @state() private submitting = false;
  @state() private statuses: EditableStatus[] = [];
  @state() private newLabel = "";
  @state() private newColor = "#ef4444";
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
    this.#showError(null);
    void this.#load();
  }

  async #load(): Promise<void> {
    if (this.#readErrorShown) this.#showError(null);
    try {
      await this.#queries.watch("listStatuses", [], (rows) => {
        this.statuses = this.#statusesDrafts.merge(
          this.statuses,
          rows.map((s: ServiceStatus) => ({
            id: s.id,
            label: s.label,
            color: s.color,
            displayOrder: s.displayOrder,
            active: s.active,
          })),
        );
      });
    } catch (error) {
      this.#showReadError(error);
    }
  }

  #onNewLabel(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newLabel = event.detail.value;
  }

  #onNewColor(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newColor = event.detail.value;
  }

  async #create(): Promise<void> {
    if (this.submitting) return;
    this.#showError(null);
    const label = this.newLabel.trim();
    if (label === "") return;
    this.submitting = true;
    try {
      await this.api.createStatus({
        label,
        color: this.newColor,
        displayOrder: this.statuses.length,
      });
      this.newLabel = "";
      await this.#load();
    } catch (error) {
      this.#showError(codeOf(error));
    } finally {
      this.submitting = false;
    }
  }

  #edit(id: string, patch: Partial<EditableStatus>): void {
    this.statuses = this.statuses.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }

  async #saveRow(id: string): Promise<void> {
    if (this.submitting) return;
    this.#showError(null);
    const row = this.statuses.find((s) => s.id === id);
    if (row === undefined) return;
    this.submitting = true;
    try {
      await this.api.updateStatus(row.id, {
        label: row.label,
        color: row.color,
        displayOrder: row.displayOrder,
        active: row.active,
      });
      await this.#load();
    } catch (error) {
      this.#showError(codeOf(error));
    } finally {
      this.submitting = false;
    }
  }

  async #deactivate(id: string): Promise<void> {
    this.#showError(null);
    try {
      await this.api.deactivateStatus(id);
      await this.#load();
    } catch (error) {
      this.#showError(codeOf(error));
    }
  }

  #renderRow(s: EditableStatus): TemplateResult {
    if (this.readOnly) {
      return html`<li data-test="row-${s.id}">
        <wt-card>
          <div class="read-row">
            <strong>${s.label}</strong>
            <span>${t("status.color")}: ${s.color}</span>
            <span>${t("status.display_order")}: ${s.displayOrder}</span>
            <span>${s.active ? t("status.active") : t("status.inactive")}</span>
          </div>
        </wt-card>
      </li>`;
    }
    return html`<li data-test="row-${s.id}">
      <wt-card>
        <div class="row">
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="save-${s.id}"]`))}
            label=${t("status.label")}
            data-test="label-${s.id}"
            .value=${s.label}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#edit(s.id, { label: e.detail.value });
            }}
          ></wt-input>
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="save-${s.id}"]`))}
            type="color"
            label=${t("status.color")}
            data-test="color-${s.id}"
            .value=${s.color}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#edit(s.id, { color: e.detail.value });
            }}
          ></wt-input>
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="save-${s.id}"]`))}
            type="number"
            label=${t("status.display_order")}
            data-test="order-${s.id}"
            .value=${String(s.displayOrder)}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#edit(s.id, { displayOrder: Number(e.detail.value) || 0 });
            }}
          ></wt-input>
          <wt-switch
            label=${t("status.active")}
            data-test="active-${s.id}"
            .checked=${s.active}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
              e.stopPropagation();
              this.#edit(s.id, { active: e.detail.checked });
            }}
          ></wt-switch>
          <wt-button
            variant="primary"
            size="sm"
            data-test="save-${s.id}"
            ?disabled=${this.submitting}
            @click=${() => void this.#saveRow(s.id)}
            >${t("action.save")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="deactivate-${s.id}"
            ?disabled=${!s.active}
            @click=${() => void this.#deactivate(s.id)}
            >${t("action.deactivate")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }

  override render(): TemplateResult {
    return html`
      <ol>
        ${this.statuses.map((s) => this.#renderRow(s))}
      </ol>

      ${
        this.readOnly
          ? nothing
          : html`<div class="new">
              <wt-input
                @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=add]"))}
                label=${t("status.new_label")}
                data-test="new-label"
                .value=${this.newLabel}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewLabel(e)}
              ></wt-input>
              <wt-input
                @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=add]"))}
                type="color"
                label=${t("status.new_color")}
                data-test="new-color"
                .value=${this.newColor}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewColor(e)}
              ></wt-input>
              <wt-button
                variant="primary"
                data-test="add"
                ?disabled=${this.submitting}
                @click=${() => void this.#create()}
                >${t("action.create")}</wt-button
              >
            </div>`
      }
      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-service-status-screen": ServiceStatusScreen;
  }
}
