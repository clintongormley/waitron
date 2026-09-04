import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, ServiceStatus } from "../api/client.js";

/** A row the editor holds in local, editable state (a defensive copy of the loaded ServiceStatus). */
interface EditableStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
}

/**
 * The management dashboard's SERVICE-STATUS SCREEN: configures the table statuses a server can set on a
 * table (design §3a), mirroring `receipt-screen.ts`. On connect it loads
 * `api.listStatuses()` (active + inactive) into editable rows; per row a manager edits the
 * label/colour/order/active toggle and Guardar-s it, and a "new status" form authors a fresh one.
 *
 * Each mutation drives the PER-ITEM CRUD on the injected `api` and RELOADS afterwards (the
 * `category-manager` idiom): Task 8's routes are per-item POST/PATCH/DELETE, not a single bulk PUT like
 * the receipt config, so there is no "compose the whole thing and PUT it" path here — create,
 * save-row and deactivate each hit one endpoint then call `#load` to resync. A row's save reads its
 * CURRENT values from state at click time, never a stale render
 * closure, so an edit made just before the click is the one that persists.
 *
 * Gating is server-side (`till.configure`): the shell hides this nav from a `staff` session and every
 * route re-checks. ERROR HANDLING mirrors the sibling screens — `#load`/`#create`/`#saveRow`/
 * `#deactivate` are each fully `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey`
 * (the raw `{ code }`, falling back to `server.internal`) rendered in a `role="alert"` banner, never an
 * unhandled promise rejection. The raw code stays in state; `codeMessage` maps it to localised copy at
 * the render edge, so the banner shows a sentence and never the raw wire code.
 */
@customElement("dashboard-service-status-screen")
export class ServiceStatusScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
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

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  // The configured statuses as editable rows, loaded on connect and re-synced after every mutation.
  @state() private statuses: EditableStatus[] = [];
  // The new-status form's fields. `newColor` seeds a sensible default swatch for a never-touched form.
  @state() private newLabel = "";
  @state() private newColor = "#ef4444";
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Load the configured statuses into editable rows. A rejection becomes the `errorKey` banner rather
   * than an unhandled rejection. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const rows = await this.api.listStatuses();
      this.statuses = rows.map((s: ServiceStatus) => ({
        id: s.id,
        label: s.label,
        color: s.color,
        displayOrder: s.displayOrder,
        active: s.active,
      }));
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The new-status label field's composed `wt-change`. `stopPropagation` keeps it inside this screen
   * (the house field-handler pattern). */
  #onNewLabel(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newLabel = event.detail.value;
  }

  /** The new-status colour field's composed `wt-change`. */
  #onNewColor(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newColor = event.detail.value;
  }

  /**
   * Create a status from the new-status form, then reload. A blank (whitespace-only) label is a no-op —
   * the server requires one, and this keeps an empty form from firing a doomed request. `displayOrder`
   * is the current row count, so a new status lands at the end. A rejection becomes the `errorKey`
   * banner; never an unhandled rejection (called via `void`).
   */
  async #create(): Promise<void> {
    this.errorKey = null;
    const label = this.newLabel.trim();
    if (label === "") return;
    try {
      await this.api.createStatus({
        label,
        color: this.newColor,
        displayOrder: this.statuses.length,
      });
      this.newLabel = "";
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Apply a partial edit to the row `id` holds, replacing it in state with a fresh object (so a row's
   * edits never mutate a shared reference the render still points at). */
  #edit(id: string, patch: Partial<EditableStatus>): void {
    this.statuses = this.statuses.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }

  /**
   * Persist the CURRENT values of the row `id` holds, then reload. Reads the row from state at click
   * time (not a captured render closure), so an edit made immediately before the click is what
   * persists — the reads-current-values `#saveRow` discipline. A vanished row is a no-op. A rejection becomes
   * the `errorKey` banner; never an unhandled rejection (called via `void`).
   */
  async #saveRow(id: string): Promise<void> {
    this.errorKey = null;
    const row = this.statuses.find((s) => s.id === id);
    if (row === undefined) return;
    try {
      await this.api.updateStatus(row.id, {
        label: row.label,
        color: row.color,
        displayOrder: row.displayOrder,
        active: row.active,
      });
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Soft-delete (deactivate) the status `id` holds, then reload. A rejection becomes the `errorKey`
   * banner; never an unhandled rejection (called via `void`). */
  async #deactivate(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.deactivateStatus(id);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #renderRow(s: EditableStatus): TemplateResult {
    return html`<li data-test="row-${s.id}">
      <wt-card>
        <div class="row">
          <wt-input
            label=${t("status.label")}
            data-test="label-${s.id}"
            .value=${s.label}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#edit(s.id, { label: e.detail.value });
            }}
          ></wt-input>
          <wt-input
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
      <h1 class="title">${t("status.title")}</h1>
      <ol>
        ${this.statuses.map((s) => this.#renderRow(s))}
      </ol>

      <div class="new">
        <wt-input
          label=${t("status.new_label")}
          data-test="new-label"
          .value=${this.newLabel}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewLabel(e)}
        ></wt-input>
        <wt-input
          type="color"
          label=${t("status.new_color")}
          data-test="new-color"
          .value=${this.newColor}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewColor(e)}
        ></wt-input>
        <wt-button variant="primary" data-test="add" @click=${() => void this.#create()}
          >${t("action.create")}</wt-button
        >
      </div>

      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-service-status-screen": ServiceStatusScreen;
  }
}
