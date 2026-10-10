import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  UndoHistory,
  UrlStateController,
  baseStyles,
  disabledStyles,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type PlanCanvasTable,
  type TableMove,
  type TableRotate,
  type TableSelect,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-floor-plan-canvas.js";
import { dashboardPath } from "../navigation.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, DashboardTable, FloorPlan } from "../api/client.js";
import {
  draftFromPlan,
  moveTable,
  rotateTable,
  sameDraft,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";

export interface FloorPlanChange {
  draft: FloorPlanDraft;
  mergeKey?: string;
}

export interface FloorPlanSelect {
  key: string | null;
}

const HOME = "/manage";

/** `back` when it is a dashboard path on this origin, else the dashboard's home. */
function closeHref(back: string | null): string {
  if (back === null) return HOME;
  try {
    const url = new URL(back, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith(`${HOME}/`)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // An unparsable `back` falls through to home.
  }
  return HOME;
}

@customElement("dashboard-floor-plan-editor")
export class FloorPlanEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      header {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-2) var(--wt-space-4);
      }
      h1 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      wt-form-actions {
        flex: 1 1 auto;
        width: auto;
      }
      .note {
        margin: var(--wt-space-2) 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .load-error {
        margin: var(--wt-space-4) 0;
        color: var(--wt-color-danger);
      }
      wt-floor-plan-canvas {
        height: 70vh;
      }
      /* The same box as a wt-button variant="secondary". */
      a.close {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        text-decoration: none;
      }
      a.close:hover {
        border-color: var(--wt-color-primary-text);
      }
      a.close:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      a.close[aria-disabled="true"] {
        ${disabledStyles}
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  @state() private plan: FloorPlan | null = null;
  @state() private zoneName: string | null = null;
  @state() private draft: FloorPlanDraft | null = null;
  @state() private selected: string | null = null;
  @state() private loadError: string | null = null;
  @state() private back: string | null = null;

  /** Other tables of the venue, for the panels' name checks. */
  protected venueTables: DashboardTable[] = [];

  #zoneId: string | null = null;
  #request = 0;
  #history: UndoHistory<FloorPlanDraft> | null = null;
  #opened: FloorPlanDraft | null = null;
  #scope?: DraftScope<FloorPlanDraft>;
  readonly #scopeId = {};

  readonly #url = new UrlStateController(this, () => this.#route(), dashboardPath);

  constructor() {
    super();
    this.addEventListener("floor-plan-change", (event) => {
      const { draft, mergeKey } = (event as CustomEvent<FloorPlanChange>).detail;
      this.#change(draft, mergeKey);
    });
    this.addEventListener("floor-plan-select", (event) => {
      this.selected = (event as CustomEvent<FloorPlanSelect>).detail.key;
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#disposeScope();
    super.disconnectedCallback();
  }

  override willUpdate(): void {
    if (!this.isConnected || this.draft === null || this.#scope) return;
    this.#scope = draftScopeFor<FloorPlanDraft>(this, {
      id: this.#scopeId,
      parent: this,
      current: () => this.draft!,
      snapshot: (value) => value,
      equal: sameDraft,
      restore: (value) => {
        this.draft = value;
        this.#history?.reset(value);
        this.selected = null;
      },
    }).scope;
    this.#scope.commit(this.#opened!);
    this.#scope.changed();
  }

  #disposeScope(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
  }

  #route(): void {
    this.back = new URL(location.href).searchParams.get("back");
    const zoneId = this.#url.read("zone");
    if (zoneId === this.#zoneId) return;
    this.#zoneId = zoneId;
    this.#disposeScope();
    this.plan = null;
    this.zoneName = null;
    this.draft = null;
    this.#opened = null;
    this.#history = null;
    this.selected = null;
    this.loadError = null;
    if (zoneId !== null) void this.#load(zoneId);
  }

  async #load(zoneId: string): Promise<void> {
    const request = ++this.#request;
    try {
      const [plan, zones, tables] = await Promise.all([
        this.api.getFloorPlan(zoneId),
        this.api.listZones(),
        this.api.listTables({ includeDisabled: true }),
      ]);
      if (request !== this.#request) return;
      const draft = draftFromPlan(plan);
      this.plan = plan;
      this.zoneName = zones.find((zone) => zone.id === zoneId)?.name ?? null;
      this.venueTables = tables;
      this.#opened = draft;
      this.#history = new UndoHistory(draft);
      this.draft = draft;
    } catch (error) {
      if (request !== this.#request) return;
      this.loadError = codeOf(error);
    }
  }

  #change(next: FloorPlanDraft, mergeKey?: string): void {
    if (this.#history === null || next === this.draft) return;
    this.#history.push(next, mergeKey);
    this.draft = next;
    this.#scope?.changed();
  }

  #step(next: FloorPlanDraft | undefined): void {
    if (next === undefined) return;
    this.draft = next;
    if (this.selected !== null && !next.tables.some((table) => table.key === this.selected)) {
      this.selected = null;
    }
    this.#scope?.changed();
  }

  readonly #onMove = (event: CustomEvent<TableMove>): void => {
    if (this.draft === null) return;
    const { key, x, y } = event.detail;
    this.#change(moveTable(this.draft, key, x, y));
  };

  readonly #onRotate = (event: CustomEvent<TableRotate>): void => {
    if (this.draft === null) return;
    this.#change(rotateTable(this.draft, event.detail.key, event.detail.rotation));
  };

  readonly #onSelect = (event: CustomEvent<TableSelect>): void => {
    this.selected = event.detail.key;
  };

  #canvasTables(draft: FloorPlanDraft): PlanCanvasTable[] {
    return draft.tables.flatMap((table) =>
      table.placement === null
        ? []
        : [{ key: table.key, label: table.label, fixed: table.fixed, placement: table.placement }],
    );
  }

  override render() {
    const save = saveActionState(this.#scope);
    const history = this.#history;
    return html`
      <header>
        <h1>${this.zoneName ?? t("floor_plan_editor.title")}</h1>
        <wt-form-actions>
          <a slot="cancel" class="close" data-action="close" href=${closeHref(this.back)}
            >${t("action.close")}</a
          >
          <wt-button
            slot="secondary"
            data-action="undo"
            variant="secondary"
            ?disabled=${!history?.canUndo}
            @click=${() => this.#step(history?.undo())}
            >${t("floor_plan_editor.undo")}</wt-button
          >
          <wt-button
            slot="secondary"
            data-action="redo"
            variant="secondary"
            ?disabled=${!history?.canRedo}
            @click=${() => this.#step(history?.redo())}
            >${t("floor_plan_editor.redo")}</wt-button
          >
          <wt-button data-action="save" variant=${save.variant} ?disabled=${save.unchanged}
            >${t("action.save")}</wt-button
          >
        </wt-form-actions>
      </header>
      ${
        this.plan === null
          ? nothing
          : html`<p class="note" data-note>
              ${t(this.plan.revision === 0 ? "floor_plan_editor.first_note" : "floor_plan_editor.note")}
            </p>`
      }
      ${
        this.loadError !== null
          ? html`<p class="load-error" role="alert" data-load-error>
              ${codeMessage(this.loadError)}
            </p>`
          : this.draft === null
            ? nothing
            : html`<wt-floor-plan-canvas
                .tables=${this.#canvasTables(this.draft)}
                .selected=${this.selected}
                .copy=${{ label: t("floor_plan_editor.title") }}
                @wt-table-move=${this.#onMove}
                @wt-table-rotate=${this.#onRotate}
                @wt-table-select=${this.#onSelect}
              ></wt-floor-plan-canvas>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-floor-plan-editor": FloorPlanEditor;
  }
}
