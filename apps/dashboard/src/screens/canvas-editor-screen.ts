import { DashboardQueries } from "../api/query-controller.js";
import { dashboardPath } from "../navigation.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, selectStyles, UrlStateController } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
// Side-effect import: registers <canvas-grid-preview>.
import "./canvas-editor/canvas-grid-preview.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { toggleMembership } from "../array-utils.js";
import type { StringKey } from "../i18n/strings.js";
import {
  CARD_CONTRACTS,
  CARD_TYPES,
  DEFAULT_CANVASES,
  FORM_FACTORS,
  GRID_MAX_COLUMNS,
  PRODUCT_GRID_MAX_COLUMNS,
  type CanvasDef,
  type CardInstance,
  type CardType,
  type FormFactor,
  type TabDef,
} from "./canvas-editor/card-contracts.js";
import { validateCanvasDraft } from "./canvas-editor/validate-canvas.js";
import type { Canvas, DashboardApi } from "../api/client.js";

/** The form factor a native `<select>` change event carries (its `value` is always one of the
 * form-factor keys that populated the options). */
function formFactorFromEvent(event: Event): FormFactor {
  return (event.target as HTMLSelectElement).value as FormFactor;
}

function clampSpan(field: "colSpan" | "rowSpan", value: number, columns: number): number {
  return field === "colSpan" ? Math.min(Math.max(value, 1), columns) : Math.max(value, 1);
}

@customElement("dashboard-canvas-editor-screen")
export class CanvasEditorScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
      .empty {
        color: var(--wt-color-text-muted);
      }
      .row {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
        margin-right: auto;
      }
      .label {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .badge {
        color: var(--wt-color-text-muted);
      }
      .actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .thumb {
        margin-top: var(--wt-space-3);
      }
      .thumb .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--wt-space-5);
        border: 1px dashed var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        font-size: var(--wt-font-size-sm);
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
      .editor-head {
        display: flex;
        gap: var(--wt-space-3);
        align-items: center;
        flex-wrap: wrap;
        margin-bottom: var(--wt-space-4);
      }
      .editor-head .actions {
        margin-left: auto;
      }
      .tabbar {
        display: flex;
        gap: var(--wt-space-2);
        flex-wrap: wrap;
        margin-bottom: var(--wt-space-4);
      }
      .editor-body {
        display: flex;
        gap: var(--wt-space-4);
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .canvas {
        flex: 1 1 60%;
        min-width: 0;
      }
      .sidebar {
        flex: 1 1 16rem;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        min-width: 0;
      }
      .panel-title {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .palette-items {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .panel {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3);
      }
      .panel-actions {
        display: flex;
        gap: var(--wt-space-2);
        flex-wrap: wrap;
        margin-top: var(--wt-space-3);
      }
      .panel-subtitle {
        display: block;
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
        margin-bottom: var(--wt-space-2);
      }
      .toggles {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        align-items: flex-start;
      }
      .warning {
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @state() private mode: "list" | "editor" = "list";

  @state() private canvases: Canvas[] = [];

  @state() private errorKey: string | null = null;

  @state() private createOpen = false;
  @state() private createName = "";
  @state() private createFormFactor: FormFactor = FORM_FACTORS[0];

  @state() private duplicateTarget: Canvas | null = null;
  @state() private duplicateName = "";

  @state() private deleteTarget: Canvas | null = null;

  @state() private draft: CanvasDef | null = null;
  @state() private draftName = "";
  @state() private editingId: string | null = null;

  @state() private activeTabIndex = 0;

  @state() private selection: { card: number } | { tab: true } | { canvas: true } | null = null;

  @state() private saving = false;

  #editorRequest = 0;
  #savedTabKeys = new Set<string>();
  readonly #url = new UrlStateController(
    this,
    () => {
      ++this.#editorRequest;
      const id = this.#url.read("canvas");
      if (id === null) {
        if (this.mode === "editor") this.#cancelEditor(true);
      } else if (id === this.editingId && this.draft !== null) {
        this.#selectTab(this.#requestedTabIndex(this.draft), true);
      } else {
        void this.#openEditor(id, true);
      }
    },
    dashboardPath,
  );

  #requestedTabIndex(draft: CanvasDef): number {
    const requested = this.#url.read("canvas-tab");
    return Math.max(
      0,
      draft.tabs.findIndex((tab) => tab.key === requested),
    );
  }

  #writeEditorUrl(replace = false): void {
    if (this.editingId === null) return;
    const tabKey = this.draft?.tabs[this.activeTabIndex]?.key;
    if (tabKey === undefined || !this.#savedTabKeys.has(tabKey)) return;
    this.#url.write(
      {
        dashboard: "canvas-editor",
        canvas: this.editingId,
        "canvas-tab": tabKey,
      },
      replace,
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#queries.watch("listCanvases", [], (value) => {
        this.canvases = value;
      });
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.errorKey = null;
    try {
      await action();
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** A shallow parse of the opaque `definition`: a malformed row renders the `no-preview` placeholder
   * rather than throwing. The server's `validateCanvas` stays the authority. */
  #parseDefinition(definition: unknown): CanvasDef | null {
    if (typeof definition !== "object" || definition === null) return null;
    const def = definition as Record<string, unknown>;
    if (!FORM_FACTORS.includes(def.formFactor as FormFactor)) return null;
    if (!Array.isArray(def.tabs)) return null;
    return def as unknown as CanvasDef;
  }

  #cardCount(def: CanvasDef): number {
    return def.tabs.reduce((n, tab) => n + (Array.isArray(tab?.cards) ? tab.cards.length : 0), 0);
  }

  // ── Crear ────────────────────────────────────────────────────────────────────────────────────────

  #openCreate(): void {
    this.createName = "";
    this.createFormFactor = FORM_FACTORS[0];
    this.createOpen = true;
  }

  #bindField(field: "createName" | "draftName" | "duplicateName") {
    return (event: CustomEvent<{ value: string }>): void => {
      event.stopPropagation();
      this[field] = event.detail.value;
    };
  }

  #onCreateFormFactor(event: Event): void {
    event.stopPropagation();
    this.createFormFactor = formFactorFromEvent(event);
  }

  /** Nothing is written until Guardar. `structuredClone` keeps the shared `DEFAULT_CANVASES` template
   * untouched by the editor's edits. */
  #confirmCreate(): void {
    ++this.#editorRequest;
    this.draft = structuredClone(DEFAULT_CANVASES[this.createFormFactor]);
    this.draftName = this.createName;
    this.editingId = null;
    this.#savedTabKeys.clear();
    this.activeTabIndex = 0;
    this.selection = null;
    this.createOpen = false;
    this.mode = "editor";
  }

  // ── Editar ─────────────────────────────────────────────────────────────────────────────────────

  /** Fetches the canvas fresh via `getCanvas(id)` rather than reusing the possibly-stale list row. */
  async #openEditor(id: string, fromHistory = false): Promise<void> {
    const request = ++this.#editorRequest;
    this.errorKey = null;
    try {
      const canvas = await this.api.getCanvas(id);
      if (!this.isConnected || request !== this.#editorRequest) return;
      const parsed = this.#parseDefinition(canvas.definition);
      if (parsed === null) {
        if (fromHistory) this.#cancelEditor(true);
        this.errorKey = "canvas.invalid";
        return;
      }
      this.#savedTabKeys = new Set(parsed.tabs.map((tab) => tab.key));
      this.draft = structuredClone(parsed);
      this.draftName = canvas.name;
      this.editingId = id;
      this.activeTabIndex = fromHistory ? this.#requestedTabIndex(parsed) : 0;
      this.selection = null;
      this.mode = "editor";
      this.#writeEditorUrl(fromHistory);
    } catch (error) {
      if (!this.isConnected || request !== this.#editorRequest) return;
      if (fromHistory) this.#cancelEditor(true);
      this.errorKey = codeOf(error);
    }
  }

  // ── Editor: draft mutation (all edits assign a fresh CanvasDef; never mutate in place) ───────────

  /** Every draft edit assigns a fresh {@link CanvasDef} so Lit and the `<canvas-grid-preview>` both
   * re-render. Never mutate the current draft in place. */
  #updateDraft(next: CanvasDef): void {
    this.draft = next;
  }

  #updateActiveTab(mutate: (tab: TabDef) => TabDef): void {
    const draft = this.draft;
    if (draft === null) return;
    const tabs = draft.tabs.map((tab, i) => (i === this.activeTabIndex ? mutate(tab) : tab));
    this.#updateDraft({ ...draft, tabs });
  }

  #selectTab(index: number, fromHistory = false): void {
    this.activeTabIndex = index;
    this.selection = null;
    this.#writeEditorUrl(fromHistory);
  }

  #addTab(): void {
    const draft = this.draft;
    if (draft === null) return;
    const tab: TabDef = {
      key: `tab-${crypto.randomUUID().slice(0, 8)}`,
      title: t("canvas_editor.new_tab"),
      columns: DEFAULT_CANVASES[draft.formFactor].tabs[0]?.columns ?? GRID_MAX_COLUMNS,
      cards: [],
    };
    const nextIndex = draft.tabs.length;
    this.#updateDraft({ ...draft, tabs: [...draft.tabs, tab] });
    this.#selectTab(nextIndex);
  }

  #addCard(type: CardType): void {
    const draft = this.draft;
    if (draft === null) return;
    const tab = draft.tabs[this.activeTabIndex];
    if (tab === undefined) return;
    const contract = CARD_CONTRACTS[type];
    const card: CardInstance = {
      type,
      colSpan: Math.min(contract.defaultColSpan, tab.columns),
      rowSpan: contract.defaultRowSpan,
      config: {},
    };
    this.#updateActiveTab((t) => ({ ...t, cards: [...t.cards, card] }));
  }

  #selectedCardIndex(): number | null {
    const sel = this.selection;
    return sel !== null && "card" in sel ? sel.card : null;
  }

  #setSpan(field: "colSpan" | "rowSpan", raw: string): void {
    const draft = this.draft;
    const index = this.#selectedCardIndex();
    if (draft === null || index === null) return;
    const tab = draft.tabs[this.activeTabIndex];
    if (tab === undefined) return;
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) return;
    const clamped = clampSpan(field, value, tab.columns);
    this.#updateActiveTab((t) => ({
      ...t,
      cards: t.cards.map((card, i) => (i === index ? { ...card, [field]: clamped } : card)),
    }));
  }

  #setSpans(index: number, spans: { colSpan: number; rowSpan: number }): void {
    const draft = this.draft;
    if (draft === null) return;
    const tab = draft.tabs[this.activeTabIndex];
    if (tab === undefined) return;
    const current = tab.cards[index];
    if (current === undefined) return;
    const colSpan = clampSpan("colSpan", spans.colSpan, tab.columns);
    const rowSpan = clampSpan("rowSpan", spans.rowSpan, tab.columns);
    // Past the clamp bound a resize drag re-emits spans that clamp to the same result, so skip the
    // rebuild when neither clamped span differs from the card's current spans.
    if (colSpan === current.colSpan && rowSpan === current.rowSpan) return;
    this.#updateActiveTab((t) => ({
      ...t,
      cards: t.cards.map((card, i) => (i === index ? { ...card, colSpan, rowSpan } : card)),
    }));
  }

  #onColSpan(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.#setSpan("colSpan", event.detail.value);
  }

  #onRowSpan(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.#setSpan("rowSpan", event.detail.value);
  }

  #removeCard(): void {
    const index = this.#selectedCardIndex();
    if (index === null) return;
    this.#updateActiveTab((t) => ({ ...t, cards: t.cards.filter((_, i) => i !== index) }));
    this.selection = null;
  }

  /** The bounds guard keeps either end a true no-op rather than letting `#moveCardTo` clamp the target
   * back in and rewrite. */
  #moveCard(delta: -1 | 1): void {
    const from = this.#selectedCardIndex();
    if (from === null) return;
    const draft = this.draft;
    if (draft === null) return;
    const tab = draft.tabs[this.activeTabIndex];
    if (tab === undefined) return;
    const to = from + delta;
    if (to < 0 || to >= tab.cards.length) return;
    this.#moveCardTo(from, to);
  }

  /** `to` is an index in the array AFTER the removal. The layout is flow-based, so a drag move is a
   * splice, not an x/y placement. */
  #moveCardTo(from: number, to: number): void {
    const draft = this.draft;
    if (draft === null) return;
    const tab = draft.tabs[this.activeTabIndex];
    if (tab === undefined) return;
    if (from < 0 || from >= tab.cards.length) return;
    const cards = [...tab.cards];
    const [moved] = cards.splice(from, 1);
    const landing = Math.min(Math.max(to, 0), cards.length);
    cards.splice(landing, 0, moved!);
    this.#updateActiveTab((t) => ({ ...t, cards }));
    this.selection = { card: landing };
  }

  #onMoveCard(event: CustomEvent<{ from: number; to: number }>): void {
    event.stopPropagation();
    this.#moveCardTo(event.detail.from, event.detail.to);
  }

  #onResizeCard(event: CustomEvent<{ index: number; colSpan: number; rowSpan: number }>): void {
    event.stopPropagation();
    const { index, colSpan, rowSpan } = event.detail;
    this.selection = { card: index };
    this.#setSpans(index, { colSpan, rowSpan });
  }

  #cancelEditor(fromHistory = false): void {
    ++this.#editorRequest;
    this.#url.write({ canvas: null, "canvas-tab": null }, fromHistory);
    this.mode = "list";
    this.draft = null;
    this.draftName = "";
    this.editingId = null;
    this.selection = null;
    this.errorKey = null;
  }

  // ── Property panel: card config / visibleWhen ────────────────────────────────────────────────────

  #onConfigColumns(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.#setConfigColumns(event.detail.value);
  }

  #setConfigColumns(raw: string): void {
    const draft = this.draft;
    const index = this.#selectedCardIndex();
    if (draft === null || index === null) return;
    const trimmed = raw.trim();
    this.#updateActiveTab((tab) => ({
      ...tab,
      cards: tab.cards.map((card, i) => {
        if (i !== index) return card;
        if (trimmed === "") {
          const config = { ...card.config };
          delete config.columns;
          return { ...card, config };
        }
        const value = Number.parseInt(trimmed, 10);
        if (Number.isNaN(value)) return card;
        return {
          ...card,
          config: {
            ...card.config,
            columns: Math.min(Math.max(value, 1), PRODUCT_GRID_MAX_COLUMNS),
          },
        };
      }),
    }));
  }

  /** An EMPTY result omits `visibleWhen` rather than storing `[]`. */
  #onVisibleToggle(event: CustomEvent<{ checked: boolean }>, state: string): void {
    event.stopPropagation();
    const draft = this.draft;
    const index = this.#selectedCardIndex();
    if (draft === null || index === null) return;
    const checked = event.detail.checked;
    this.#updateActiveTab((tab) => ({
      ...tab,
      cards: tab.cards.map((card, i) => {
        if (i !== index) return card;
        const allStates = CARD_CONTRACTS[card.type].visibilityStates;
        const next = toggleMembership(card.visibleWhen ?? [], allStates, state, checked);
        if (next.length === 0) {
          const rest = { ...card };
          delete rest.visibleWhen;
          return rest;
        }
        return { ...card, visibleWhen: next };
      }),
    }));
  }

  // ── Property panel: tab settings ─────────────────────────────────────────────────────────────────

  #selectTabSettings(): void {
    this.selection = { tab: true };
  }

  #onTabTitle(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    this.#updateActiveTab((tab) => ({ ...tab, title: value }));
  }

  #onTabColumns(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = Number.parseInt(event.detail.value, 10);
    if (Number.isNaN(value)) return;
    const columns = Math.min(Math.max(value, 1), GRID_MAX_COLUMNS);
    this.#updateActiveTab((tab) => ({ ...tab, columns }));
  }

  #deleteTab(): void {
    const draft = this.draft;
    if (draft === null || draft.tabs.length <= 1) return;
    const index = this.activeTabIndex;
    const tabs = draft.tabs.filter((_, i) => i !== index);
    this.#updateDraft({ ...draft, tabs });
    this.#selectTab(Math.min(index, tabs.length - 1), true);
  }

  // ── Property panel: canvas settings ──────────────────────────────────────────────────────────────

  #selectCanvasSettings(): void {
    this.selection = { canvas: true };
  }

  #onCanvasFormFactor(event: Event): void {
    event.stopPropagation();
    const draft = this.draft;
    if (draft === null) return;
    this.#updateDraft({ ...draft, formFactor: formFactorFromEvent(event) });
  }

  // ── Save ─────────────────────────────────────────────────────────────────────────────────────────

  /** The server accepts `""` as a name, so an empty name is refused here. */
  async #save(): Promise<void> {
    if (this.saving) return;
    const request = this.#editorRequest;
    const draft = this.draft;
    if (draft === null) return;
    const name = this.draftName.trim();
    if (name === "") {
      this.errorKey = "canvas_editor.err_no_name";
      return;
    }
    const err = validateCanvasDraft(draft);
    if (err) {
      this.errorKey = err;
      return;
    }
    const id = this.editingId;
    this.saving = true;
    try {
      await this.#mutate(async () => {
        if (id !== null) await this.api.updateCanvas(id, name, draft);
        else {
          const created = await this.api.createCanvas(name, draft);
          if (request === this.#editorRequest) {
            this.#savedTabKeys = new Set(draft.tabs.map((tab) => tab.key));
            this.editingId = created.id;
            this.#writeEditorUrl(true);
          }
        }
        if (request === this.#editorRequest)
          this.#savedTabKeys = new Set(draft.tabs.map((tab) => tab.key));
        // A finished write belongs to the draft submitted, not a destination opened during the request.
        if (
          request === this.#editorRequest &&
          this.draft === draft &&
          this.draftName.trim() === name
        )
          this.#cancelEditor();
      });
    } finally {
      this.saving = false;
    }
  }

  // ── Duplicar ───────────────────────────────────────────────────────────────────────────────────

  #openDuplicate(canvas: Canvas): void {
    this.duplicateTarget = canvas;
    this.duplicateName = `${canvas.name}${t("canvas_editor.copy_suffix")}`;
  }

  /** Duplicar writes immediately and the server accepts `""` as a name, so a blank name is refused
   * here and the dialog stays open for a correction. */
  #confirmDuplicate(): void {
    const target = this.duplicateTarget;
    if (target === null) return;
    const name = this.duplicateName.trim();
    if (name === "") return;
    this.duplicateTarget = null;
    void this.#mutate(() => this.api.createCanvas(name, target.definition));
  }

  // ── Eliminar ───────────────────────────────────────────────────────────────────────────────────

  #openDelete(canvas: Canvas): void {
    this.deleteTarget = canvas;
  }

  #confirmDelete(): void {
    const target = this.deleteTarget;
    if (target === null) return;
    const id = target.id;
    this.deleteTarget = null;
    void this.#mutate(() => this.api.deleteCanvas(id));
  }

  // ── Renderers ────────────────────────────────────────────────────────────────────────────────────

  #renderRow(canvas: Canvas): TemplateResult {
    const def = this.#parseDefinition(canvas.definition);
    return html`<li data-test="canvas-row-${canvas.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="canvas-name-${canvas.id}">${canvas.name}</span>
            ${
              def
                ? html`<span class="meta">
                    <span class="badge" data-test="canvas-form-factor-${canvas.id}"
                      >${t(`canvas_editor.form_factor.${def.formFactor}` as StringKey)}</span
                    >
                    <span data-test="canvas-tab-count-${canvas.id}"
                      >${def.tabs.length} ${t("canvas_editor.tab_count")}</span
                    >
                    <span data-test="canvas-card-count-${canvas.id}"
                      >${this.#cardCount(def)} ${t("canvas_editor.card_count")}</span
                    >
                  </span>`
                : nothing
            }
          </div>
          <div class="actions">
            <wt-button
              variant="primary"
              size="sm"
              data-test="edit-${canvas.id}"
              @click=${() => void this.#openEditor(canvas.id)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              variant="secondary"
              size="sm"
              data-test="duplicate-${canvas.id}"
              @click=${() => this.#openDuplicate(canvas)}
              >${t("canvas_editor.duplicate")}</wt-button
            >
            <wt-button
              variant="danger"
              size="sm"
              data-test="delete-${canvas.id}"
              @click=${() => this.#openDelete(canvas)}
              >${t("canvas_editor.delete_confirm")}</wt-button
            >
          </div>
        </div>
        <div class="thumb" data-test="canvas-thumb-${canvas.id}">
          ${
            def
              ? html`<canvas-grid-preview
                  .tab=${def.tabs[0] ?? null}
                  .interactive=${false}
                ></canvas-grid-preview>`
              : html`<div class="empty" data-test="no-preview">
                  ${t("canvas_editor.no_preview")}
                </div>`
          }
        </div>
      </wt-card>
    </li>`;
  }

  /** With `selected` given, the matching option carries `?selected`; without it (the Crear dialog,
   * whose `<select>` binds no value) the browser's first-option default stands, matching
   * `createFormFactor`'s default. */
  #renderFormFactorOptions(selected?: FormFactor): TemplateResult {
    return html`${FORM_FACTORS.map(
      (ff) =>
        html`<option value=${ff} ?selected=${selected !== undefined && ff === selected}>
          ${t(`canvas_editor.form_factor.${ff}` as StringKey)}
        </option>`,
    )}`;
  }

  #renderCreateDialog(): TemplateResult {
    return html`<wt-dialog
      heading=${t("canvas_editor.create_title")}
      .open=${this.createOpen}
      @wt-close=${() => (this.createOpen = false)}
    >
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-create]"))}
        class="field"
        data-test="create-name"
        label=${t("canvas_editor.create_name_label")}
        .value=${this.createName}
        @wt-change=${this.#bindField("createName")}
      ></wt-input>
      <label class="field"
        >${t("canvas_editor.form_factor_label")}
        <select data-test="create-form-factor" @change=${(e: Event) => this.#onCreateFormFactor(e)}>
          ${this.#renderFormFactorOptions()}
        </select>
      </label>
      <wt-button
        slot="footer"
        variant="primary"
        data-test="confirm-create"
        @click=${() => this.#confirmCreate()}
        >${t("action.create")}</wt-button
      >
    </wt-dialog>`;
  }

  #renderDuplicateDialog(): TemplateResult {
    return html`<wt-dialog
      heading=${t("canvas_editor.duplicate_title")}
      .open=${this.duplicateTarget !== null}
      @wt-close=${() => (this.duplicateTarget = null)}
    >
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-duplicate]"))}
        class="field"
        data-test="duplicate-name"
        label=${t("canvas_editor.duplicate_name_label")}
        .value=${this.duplicateName}
        @wt-change=${this.#bindField("duplicateName")}
      ></wt-input>
      <wt-button
        slot="footer"
        variant="primary"
        data-test="confirm-duplicate"
        ?disabled=${this.duplicateName.trim() === ""}
        @click=${() => this.#confirmDuplicate()}
        >${t("canvas_editor.duplicate")}</wt-button
      >
    </wt-dialog>`;
  }

  #renderDeleteDialog(): TemplateResult {
    return html`<wt-dialog
      heading=${t("canvas_editor.delete_title")}
      .open=${this.deleteTarget !== null}
      @wt-close=${() => (this.deleteTarget = null)}
    >
      <p data-test="delete-message">${t("canvas_editor.delete_message")}</p>
      <wt-button
        slot="footer"
        variant="danger"
        data-test="confirm-delete"
        @click=${() => this.#confirmDelete()}
        >${t("canvas_editor.delete_confirm")}</wt-button
      >
    </wt-dialog>`;
  }

  #renderList(): TemplateResult {
    return html`
      <h1 class="title">${t("canvas_editor.title")}</h1>
      <wt-button variant="primary" data-test="create" @click=${() => this.#openCreate()}
        >${t("canvas_editor.create")}</wt-button
      >
      ${
        this.canvases.length === 0
          ? html`<p class="empty" data-test="no-canvases">${t("canvas_editor.empty")}</p>`
          : html`<ol>
              ${this.canvases.map((canvas) => this.#renderRow(canvas))}
            </ol>`
      }
      ${this.#renderCreateDialog()} ${this.#renderDuplicateDialog()} ${this.#renderDeleteDialog()}
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }

  // ── Editor renderers ─────────────────────────────────────────────────────────────────────────────

  /** A plain group, NOT an ARIA `tablist`: `wt-button` wraps a native `<button>` in its shadow root,
   * so `role="tab"` on the host leaves the focusable control nested inside it, which axe flags. The
   * active tab is conveyed with `aria-current` plus the `primary` variant. */
  #renderTabBar(draft: CanvasDef): TemplateResult {
    return html`<div class="tabbar">
      ${draft.tabs.map(
        (tab, index) =>
          html`<wt-button
            size="sm"
            variant=${index === this.activeTabIndex ? "primary" : "secondary"}
            aria-current=${index === this.activeTabIndex ? "true" : nothing}
            data-test="tab-btn-${tab.key}"
            @click=${() => this.#selectTab(index)}
            >${tab.title}</wt-button
          >`,
      )}
      <wt-button size="sm" variant="ghost" data-test="add-tab" @click=${() => this.#addTab()}
        >${t("canvas_editor.add_tab")}</wt-button
      >
      <wt-button
        size="sm"
        variant="ghost"
        data-test="tab-settings"
        @click=${() => this.#selectTabSettings()}
        >${t("canvas_editor.tab_settings")}</wt-button
      >
    </div>`;
  }

  #renderPalette(): TemplateResult {
    return html`<div class="palette" data-test="palette">
      <h2 class="panel-title">${t("canvas_editor.palette_title")}</h2>
      <div class="palette-items">
        ${CARD_TYPES.map(
          (type) =>
            html`<wt-button
              size="sm"
              variant="secondary"
              data-test="palette-${type}"
              @click=${() => this.#addCard(type)}
              >${t(`canvas_editor.card.${type}` as StringKey)}</wt-button
            >`,
        )}
      </div>
    </div>`;
  }

  #renderConfig(card: CardInstance): TemplateResult | typeof nothing {
    const fields = CARD_CONTRACTS[card.type].configFields;
    if (fields.length === 0) {
      return html`<p class="field" data-test="no-config">${t("canvas_editor.no_config")}</p>`;
    }
    return html`${fields.map((field) =>
      field === "columns"
        ? html`<wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
            class="field"
            type="number"
            data-test="config-columns"
            label=${t("canvas_editor.config_columns")}
            .value=${card.config.columns === undefined ? "" : String(card.config.columns)}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onConfigColumns(e)}
          ></wt-input>`
        : nothing,
    )}`;
  }

  #renderVisibleWhen(card: CardInstance): TemplateResult | typeof nothing {
    const states = CARD_CONTRACTS[card.type].visibilityStates;
    if (states.length === 0) return nothing;
    const active = new Set(card.visibleWhen ?? []);
    return html`<div class="field" data-test="visible-when">
      <span class="panel-subtitle">${t("canvas_editor.visible_when")}</span>
      <div class="toggles">
        ${states.map(
          (state) =>
            html`<wt-switch
              data-test="visible-${state}"
              label=${state}
              .checked=${active.has(state)}
              @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
                this.#onVisibleToggle(e, state)}
            ></wt-switch>`,
        )}
      </div>
    </div>`;
  }

  #renderCardPanel(tab: TabDef, index: number): TemplateResult {
    const card = tab.cards[index]!;
    const contract = CARD_CONTRACTS[card.type];
    return html`<div class="panel" data-test="card-panel">
      <h2 class="panel-title">${t(`canvas_editor.card.${card.type}` as StringKey)}</h2>
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
        class="field"
        type="number"
        data-test="card-colspan"
        label=${t("canvas_editor.colspan")}
        .value=${String(card.colSpan)}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onColSpan(e)}
      ></wt-input>
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
        class="field"
        type="number"
        data-test="card-rowspan"
        label=${t("canvas_editor.rowspan")}
        .value=${String(card.rowSpan)}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onRowSpan(e)}
      ></wt-input>
      ${this.#renderConfig(card)} ${this.#renderVisibleWhen(card)}
      ${
        contract.requiredPermission !== undefined
          ? html`<p class="field" data-test="permission-note">
              ${t("canvas_editor.permission_note")}
            </p>`
          : nothing
      }
      <div class="panel-actions">
        <wt-button
          size="sm"
          variant="secondary"
          data-test="card-up"
          @click=${() => this.#moveCard(-1)}
          >${t("action.move_up")}</wt-button
        >
        <wt-button
          size="sm"
          variant="secondary"
          data-test="card-down"
          @click=${() => this.#moveCard(1)}
          >${t("action.move_down")}</wt-button
        >
        <wt-button
          size="sm"
          variant="danger"
          data-test="card-remove"
          @click=${() => this.#removeCard()}
          >${t("canvas_editor.remove_card")}</wt-button
        >
      </div>
    </div>`;
  }

  #renderTabSettings(draft: CanvasDef): TemplateResult | typeof nothing {
    const tab = draft.tabs[this.activeTabIndex];
    if (tab === undefined) return nothing;
    return html`<div class="panel" data-test="tab-settings-panel">
      <h2 class="panel-title">${t("canvas_editor.tab_settings")}</h2>
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
        class="field"
        data-test="tab-title"
        label=${t("canvas_editor.tab_title")}
        .value=${tab.title}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onTabTitle(e)}
      ></wt-input>
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
        class="field"
        type="number"
        data-test="tab-columns"
        label=${t("canvas_editor.tab_columns")}
        .value=${String(tab.columns)}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onTabColumns(e)}
      ></wt-input>
      <div class="panel-actions">
        <wt-button
          size="sm"
          variant="danger"
          data-test="tab-delete"
          ?disabled=${draft.tabs.length === 1}
          @click=${() => this.#deleteTab()}
          >${t("canvas_editor.tab_delete")}</wt-button
        >
      </div>
    </div>`;
  }

  #renderCanvasSettings(draft: CanvasDef): TemplateResult {
    return html`<div class="panel" data-test="canvas-settings-panel">
      <h2 class="panel-title">${t("canvas_editor.canvas_settings")}</h2>
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
        class="field"
        data-test="canvas-name"
        label=${t("canvas_editor.name")}
        .value=${this.draftName}
        @wt-change=${this.#bindField("draftName")}
      ></wt-input>
      <label class="field"
        >${t("canvas_editor.form_factor_label")}
        <select
          data-test="canvas-form-factor"
          .value=${draft.formFactor}
          @change=${(e: Event) => this.#onCanvasFormFactor(e)}
        >
          ${this.#renderFormFactorOptions(draft.formFactor)}
        </select>
      </label>
    </div>`;
  }

  #renderPanel(draft: CanvasDef, activeTab: TabDef | null): TemplateResult | typeof nothing {
    const cardIndex = this.#selectedCardIndex();
    if (cardIndex !== null && activeTab !== null && activeTab.cards[cardIndex] !== undefined) {
      return this.#renderCardPanel(activeTab, cardIndex);
    }
    const selection = this.selection;
    if (selection !== null && "tab" in selection) return this.#renderTabSettings(draft);
    if (selection !== null && "canvas" in selection) return this.#renderCanvasSettings(draft);
    return nothing;
  }

  #renderEditor(): TemplateResult {
    const draft = this.draft;
    const activeTab = draft?.tabs[this.activeTabIndex] ?? null;
    const selectedCardIndex = this.#selectedCardIndex();
    const panel = draft === null ? nothing : this.#renderPanel(draft, activeTab);
    return html`
      <div
        class="editor"
        data-test="editor-placeholder"
        data-editing-id=${this.editingId ?? nothing}
        data-form-factor=${draft?.formFactor ?? nothing}
      >
        <div class="editor-head">
          <span class="label" data-test="editor-name">${this.draftName}</span>
          <div class="actions">
            <wt-button
              variant="secondary"
              data-test="canvas-settings"
              @click=${() => this.#selectCanvasSettings()}
              >${t("canvas_editor.canvas_settings")}</wt-button
            >
            <wt-button
              variant="secondary"
              data-test="editor-cancel"
              @click=${() => this.#cancelEditor()}
              >${t("canvas_editor.cancel")}</wt-button
            >
            <wt-button
              variant="primary"
              data-test="save"
              ?disabled=${this.saving}
              @click=${() => void this.#save()}
              >${t("canvas_editor.save")}</wt-button
            >
          </div>
        </div>
        ${draft === null ? nothing : this.#renderTabBar(draft)}
        <div class="editor-body">
          <div class="canvas">
            <canvas-grid-preview
              .tab=${activeTab}
              .interactive=${true}
              .selectedIndex=${selectedCardIndex ?? -1}
              @select-card=${(e: CustomEvent<{ index: number }>) => {
                this.selection = { card: e.detail.index };
              }}
              @move-card=${(e: CustomEvent<{ from: number; to: number }>) => this.#onMoveCard(e)}
              @resize-card=${(
                e: CustomEvent<{ index: number; colSpan: number; rowSpan: number }>,
              ) => this.#onResizeCard(e)}
            ></canvas-grid-preview>
          </div>
          <aside class="sidebar">${this.#renderPalette()} ${panel}</aside>
        </div>
      </div>
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }

  override render(): TemplateResult {
    return this.mode === "editor" ? this.#renderEditor() : this.#renderList();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-canvas-editor-screen": CanvasEditorScreen;
  }
}
