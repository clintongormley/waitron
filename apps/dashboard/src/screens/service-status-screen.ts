import { DraftRows } from "@waitron/dashboard-kit";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  submitOnEnter,
  baseStyles,
  draftScopeFor,
  saveActionState,
  type DraftScope,
} from "@waitron/ui";
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

interface NewStatusDraft {
  label: string;
  color: string;
}

function sameRow(a: EditableStatus, b: EditableStatus): boolean {
  return (
    a.label === b.label &&
    a.color === b.color &&
    a.displayOrder === b.displayOrder &&
    a.active === b.active
  );
}

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
  #statusesDrafts = new DraftRows<EditableStatus>();
  readonly #rowScopes = new Map<
    string,
    { scope: DraftScope<EditableStatus>; saved: EditableStatus }
  >();
  #newScope?: DraftScope<NewStatusDraft>;
  #connection = 0;
  #listedStatusCount = 0;

  #newDraft(): NewStatusDraft {
    return { label: this.newLabel, color: this.newColor };
  }

  #registerNew(): void {
    if (this.readOnly || this.#newScope) return;
    this.#newScope = draftScopeFor<NewStatusDraft>(this, {
      id: {},
      parent: this,
      current: () => this.#newDraft(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.label.trim() === b.label.trim() && a.color === b.color,
      restore: (value) => {
        this.newLabel = value.label;
        this.newColor = value.color;
      },
    }).scope;
  }

  #acceptRows(rows: EditableStatus[]): void {
    this.#listedStatusCount = rows.length;
    const current = new Map(this.statuses.map((row) => [row.id, row]));
    const dirty = new Set(
      [...this.#rowScopes].filter(([, entry]) => entry.scope.isDirty()).map(([id]) => id),
    );
    const merged = this.#statusesDrafts.merge(this.statuses, rows);
    for (const [id, entry] of this.#rowScopes) {
      if (!rows.some((row) => row.id === id) && !dirty.has(id)) {
        entry.scope.dispose();
        this.#rowScopes.delete(id);
      }
    }
    this.statuses = rows.map((row, index) =>
      dirty.has(row.id) ? current.get(row.id)! : this.#rowScopes.has(row.id) ? row : merged[index]!,
    );
    for (const id of dirty) {
      if (!rows.some((row) => row.id === id)) this.statuses = [...this.statuses, current.get(id)!];
    }
    if (this.readOnly) return;
    for (const row of this.statuses) {
      const entry = this.#rowScopes.get(row.id);
      if (entry) {
        if (!dirty.has(row.id) && !sameRow(entry.saved, row)) {
          entry.saved = { ...row };
          entry.scope.commit(row);
        }
      } else {
        const { scope } = draftScopeFor<EditableStatus>(this, {
          id: {},
          parent: this,
          current: () => this.statuses.find((value) => value.id === row.id)!,
          snapshot: (value) => ({ ...value }),
          equal: sameRow,
          restore: (value) => {
            this.statuses = this.statuses.map((draft) =>
              draft.id === row.id ? { ...value } : draft,
            );
          },
        });
        this.#rowScopes.set(row.id, { scope, saved: { ...row } });
      }
    }
  }
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
    this.#registerNew();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#connection++;
    this.#newScope?.dispose();
    this.#newScope = undefined;
    for (const entry of this.#rowScopes.values()) entry.scope.dispose();
    this.#rowScopes.clear();
    this.statuses = [];
    this.#listedStatusCount = 0;
    this.#statusesDrafts = new DraftRows<EditableStatus>();
    this.newLabel = "";
    this.newColor = "#ef4444";
    this.submitting = false;
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    const connection = this.#connection;
    if (this.#readErrorShown) this.#showError(null);
    try {
      await this.#queries.watch("listStatuses", [], (rows) => {
        this.#acceptRows(
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
      if (connection === this.#connection) this.#showReadError(error);
    }
  }

  #onNewLabel(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newLabel = event.detail.value;
    this.#newScope?.changed();
  }

  #onNewColor(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newColor = event.detail.value;
    this.#newScope?.changed();
  }

  async #create(): Promise<void> {
    if (this.submitting || saveActionState(this.#newScope).unchanged) return;
    this.#showError(null);
    const label = this.newLabel.trim();
    if (label === "") return;
    const submitted = this.#newDraft();
    const scope = this.#newScope;
    const connection = this.#connection;
    this.submitting = true;
    try {
      await this.api.createStatus({
        label,
        color: submitted.color,
        displayOrder: this.#listedStatusCount,
      });
      if (connection !== this.#connection) return;
      scope?.commit(submitted);
      if (this.newLabel.trim() === label) {
        this.newLabel = "";
        scope?.commit({ ...submitted, label: "" });
      }
      await this.#load();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
    } finally {
      if (connection === this.#connection) this.submitting = false;
    }
  }

  #edit(id: string, patch: Partial<EditableStatus>): void {
    this.statuses = this.statuses.map((s) => (s.id === id ? { ...s, ...patch } : s));
    this.#rowScopes.get(id)?.scope.changed();
  }

  async #saveRow(id: string): Promise<void> {
    if (this.submitting) return;
    const row = this.statuses.find((s) => s.id === id);
    const entry = this.#rowScopes.get(id);
    if (row !== undefined && saveActionState(entry?.scope).unchanged) return;
    this.#showError(null);
    if (row === undefined || entry === undefined) return;
    const submitted = { ...row };
    const connection = this.#connection;
    this.submitting = true;
    try {
      await this.api.updateStatus(row.id, {
        label: row.label,
        color: row.color,
        displayOrder: row.displayOrder,
        active: row.active,
      });
      if (connection !== this.#connection) return;
      entry.saved = submitted;
      entry.scope.commit(submitted);
      await this.#load();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
    } finally {
      if (connection === this.#connection) this.submitting = false;
    }
  }

  async #deactivate(id: string): Promise<void> {
    const connection = this.#connection;
    const entry = this.#rowScopes.get(id);
    this.#showError(null);
    try {
      await this.api.deactivateStatus(id);
      if (connection !== this.#connection) return;
      if (entry && entry === this.#rowScopes.get(id)) {
        this.statuses = this.statuses.map((row) =>
          row.id === id ? { ...row, active: false } : row,
        );
        entry.saved = { ...entry.saved, active: false };
        entry.scope.commit(entry.saved);
      }
      await this.#load();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
    }
  }

  #renderRow(s: EditableStatus): TemplateResult {
    const save = saveActionState(this.#rowScopes.get(s.id)?.scope);
    if (this.readOnly) {
      return html`<li data-test="row-${s.id}">
        <wt-card>
          <div class="read-row">
            <strong>${s.label}</strong>
            <span>${t("status.color")}: ${s.color}</span>
            <span>${t("status.display_order")}: ${s.displayOrder}</span>
            <span>${s.active ? t("status.active") : t("status.disabled")}</span>
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
            name=${`status-label-${s.id}`}
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
            name=${`status-color-${s.id}`}
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
            name=${`status-order-${s.id}`}
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
            variant=${save.variant}
            size="sm"
            data-test="save-${s.id}"
            ?disabled=${save.unchanged || this.submitting}
            @click=${() => void this.#saveRow(s.id)}
            >${t("action.save")}</wt-button
          >
          <wt-button
            variant=${s.active ? "danger" : "secondary"}
            size="sm"
            data-test="deactivate-${s.id}"
            ?disabled=${!s.active}
            @click=${() => void this.#deactivate(s.id)}
            >${t("action.disable")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }

  override render(): TemplateResult {
    const add = saveActionState(this.#newScope);
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
                name="new-status-label"
                data-test="new-label"
                .value=${this.newLabel}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewLabel(e)}
              ></wt-input>
              <wt-input
                @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=add]"))}
                type="color"
                label=${t("status.new_color")}
                name="new-status-color"
                data-test="new-color"
                .value=${this.newColor}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewColor(e)}
              ></wt-input>
              <wt-button
                variant=${add.variant}
                data-test="add"
                ?disabled=${add.unchanged || this.submitting || this.newLabel.trim() === ""}
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
