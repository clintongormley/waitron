import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
// Side-effect import: register <canvas-grid-preview> (the shared thumbnail/canvas unit) — the list
// renders each canvas's first tab as an inert preview with it, and the editor renders its live tab
// as the interactive canvas.
import "./canvas-editor/canvas-grid-preview.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import {
  CAPABILITY_FLAGS,
  CARD_CONTRACTS,
  CARD_TYPES,
  DEFAULT_CANVASES,
  FORM_FACTORS,
  GRID_MAX_COLUMNS,
  PRODUCT_GRID_MAX_COLUMNS,
  type CanvasDef,
  type CapabilityFlag,
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

/** Toggle `value`'s membership of `current`, returning a NEW array ordered by `all` (deterministic,
 * not click order): add it when `checked`, drop it otherwise, then filter `all` to what remains. The
 * shared core of the `visibleWhen` and `capabilities` toggles; each caller keeps its own write-back
 * (`visibleWhen` OMITS the key when the result is empty; `capabilities` always stores the array). */
function toggleMembership<T>(
  current: readonly T[],
  all: readonly T[],
  value: T,
  checked: boolean,
): T[] {
  const set = new Set(current);
  if (checked) set.add(value);
  else set.delete(value);
  return all.filter((x) => set.has(x));
}

/**
 * The management dashboard's CANVAS EDITOR screen (SP-B3.2) — the venue's central surface for the
 * per-device grid layouts ("canvases"). LIST mode loads the tenant's
 * canvases (`api.listCanvases()`), and renders each as a card carrying its name, a form-factor badge,
 * tab/card counts and an inert `<canvas-grid-preview>` thumbnail of its first tab, plus per-row Editar /
 * Duplicar / Eliminar controls. It also offers a Crear dialog (name + form-factor) that seeds a fresh
 * draft from the built-in default for that form factor and enters EDITOR mode.
 *
 * EDITOR mode is the draft editor: a tab bar (select/add tab), the interactive
 * `<canvas-grid-preview>` as the canvas, a palette that appends a card at its default spans, and —
 * when a card tile is selected — a property panel with colSpan/rowSpan steppers, remove, and ↑/↓
 * reorder, plus the rest of the property panel (per-card CONFIG + `visibleWhen` toggles +
 * permission/capability notes), TAB settings (title/columns/delete, with a last-tab guard), CANVAS
 * settings (name/form-factor/capabilities), and the real SAVE (`#save`): it refuses an empty
 * name, runs the light client validator (`validateCanvasDraft`) — a broken draft shows the banner and
 * does not write — then `createCanvas`/`updateCanvas` on `editingId` and returns to the reloaded list.
 * Every draft edit goes through `#updateDraft`, which assigns a FRESH `CanvasDef` (never mutates in
 * place) so Lit and the preview re-render. `Cancelar` returns to the list, clearing the draft. The
 * editor root keeps the `editor-placeholder` seam (its `data-editing-id`/`data-form-factor`
 * attributes).
 *
 * DEFENSIVE PARSE. A canvas's `definition` crosses the client boundary as opaque `unknown` (the #70
 * bundle rule — the dashboard never imports `@waitron/layouts`' real type). `#parseDefinition` shallow-
 * checks it before the thumbnail reads it, so a malformed/absent definition renders a neutral
 * `no-preview` placeholder rather than throwing and blanking the whole list.
 *
 * ERROR HANDLING mirrors the sibling screens (printers/staff): every loader/mutation is fully
 * `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` (the raw `{ code }`, falling
 * back to `server.internal`) rendered in a `role="alert"` banner. Both banners map their code with
 * `codeMessage`: the client validator's `canvas_editor.err_*` pseudo-codes and the server's
 * `canvas.*`/`server.*` codes all live in `CODE_MESSAGES`, so one banner shows both kinds localised
 * with no per-key routing.
 */
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

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  /** Which mode is showing. `list` is the canvas gallery; `editor` is the draft grid editor. */
  @state() private mode: "list" | "editor" = "list";

  /** The tenant's canvases, (re)loaded on connect and after every mutation. */
  @state() private canvases: Canvas[] = [];

  @state() private errorKey: string | null = null;

  // Crear dialog state: whether it is open, and the fields the operator fills in.
  @state() private createOpen = false;
  @state() private createName = "";
  @state() private createFormFactor: FormFactor = FORM_FACTORS[0];

  // Duplicar dialog state: the canvas being copied (null = closed) and the new name (prefilled
  // "<name> (copy)"), edited in the dialog before it confirms.
  @state() private duplicateTarget: Canvas | null = null;
  @state() private duplicateName = "";

  // Eliminar dialog state: the canvas armed for deletion (null = closed).
  @state() private deleteTarget: Canvas | null = null;

  // Editor-mode draft: the parsed definition being edited, its name, and the id of the canvas being
  // edited (null for a freshly-created draft not yet saved).
  @state() private draft: CanvasDef | null = null;
  @state() private draftName = "";
  @state() private editingId: string | null = null;

  /** Which tab of the draft the canvas + palette act on. */
  @state() private activeTabIndex = 0;

  /** What the property panel targets: a card by index, the tab, or the whole canvas — rendering the
   * card panel, the tab-settings panel, or the canvas-settings panel respectively, or nothing when
   * `null`. */
  @state() private selection: { card: number } | { tab: true } | { canvas: true } | null = null;

  /** True while a `#save` write is in flight, so Guardar disables itself and no second write races. */
  @state() private saving = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** (Re)load the tenant's canvases. Called on connect and after every mutation. A rejection becomes
   * the `errorKey` banner rather than an unhandled rejection. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      this.canvases = await this.api.listCanvases();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The shared shape of every mutation: clear the error banner, run `action`, reload on success, and
   * turn a rejection into the `errorKey` banner (never an unhandled rejection). */
  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.errorKey = null;
    try {
      await action();
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /**
   * A defensive shallow parse of a canvas's opaque `definition` (it crosses the client boundary as
   * `unknown`). Returns a {@link CanvasDef} only when the value is an object whose `formFactor` is a
   * known {@link FormFactor} and whose `tabs` is an array; otherwise `null`, so a malformed row renders
   * the neutral `no-preview` placeholder rather than throwing. The server's `validateCanvas` stays the
   * authority — this only decides whether the thumbnail can safely read the definition.
   */
  #parseDefinition(definition: unknown): CanvasDef | null {
    if (typeof definition !== "object" || definition === null) return null;
    const def = definition as Record<string, unknown>;
    if (!FORM_FACTORS.includes(def.formFactor as FormFactor)) return null;
    if (!Array.isArray(def.tabs)) return null;
    return def as unknown as CanvasDef;
  }

  /** Total cards across all tabs of a parsed definition (defensive against a tab missing `cards`). */
  #cardCount(def: CanvasDef): number {
    return def.tabs.reduce((n, tab) => n + (Array.isArray(tab?.cards) ? tab.cards.length : 0), 0);
  }

  // ── Crear ────────────────────────────────────────────────────────────────────────────────────────

  #openCreate(): void {
    this.createName = "";
    this.createFormFactor = FORM_FACTORS[0];
    this.createOpen = true;
  }

  /** Build a `wt-change` handler that writes the event's value straight into one plain string state
   * field — the shared shape of the create/canvas/duplicate NAME inputs. (Fields with a different
   * write-back, like the active tab's title, keep their own handler.) */
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

  /** Seed a fresh draft from the built-in default for the chosen form factor and enter editor mode.
   * Nothing is written to the server here — that happens on Guardar (`#save`). `structuredClone` gives
   * the editor a private copy it can mutate without touching the shared `DEFAULT_CANVASES` template. */
  #confirmCreate(): void {
    this.draft = structuredClone(DEFAULT_CANVASES[this.createFormFactor]);
    this.draftName = this.createName;
    this.editingId = null;
    this.activeTabIndex = 0;
    this.selection = null;
    this.createOpen = false;
    this.mode = "editor";
  }

  // ── Editar ─────────────────────────────────────────────────────────────────────────────────────

  /** Open the editor for an existing canvas. FETCHES the canvas fresh via `getCanvas(id)` (spec §6.2)
   * rather than reusing the possibly-stale list snapshot, then parses its definition into a PRIVATE
   * editable draft (`structuredClone`, so structural edits never touch the store's copy) and enters
   * editor mode. Routed through the screen's `errorKey` pattern: a `getCanvas` rejection — or a
   * definition the defensive parse rejects — sets the banner and stays in LIST mode rather than
   * entering a broken editor (and never becomes an unhandled rejection; the caller `void`-invokes it).
   * Guardar (`#save`) writes the draft back. */
  async #openEditor(id: string): Promise<void> {
    this.errorKey = null;
    try {
      const canvas = await this.api.getCanvas(id);
      const parsed = this.#parseDefinition(canvas.definition);
      if (parsed === null) {
        this.errorKey = "canvas.invalid";
        return;
      }
      this.draft = structuredClone(parsed);
      this.draftName = canvas.name;
      this.editingId = id;
      this.activeTabIndex = 0;
      this.selection = null;
      this.mode = "editor";
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Editor: draft mutation (all edits assign a fresh CanvasDef; never mutate in place) ───────────

  /** The single seam every draft edit flows through: assign a fresh {@link CanvasDef} so Lit and the
   * `<canvas-grid-preview>` both re-render. Never mutate the current draft in place. */
  #updateDraft(next: CanvasDef): void {
    this.draft = next;
  }

  /** Apply `mutate` to the active tab, producing a fresh draft with that one tab replaced. */
  #updateActiveTab(mutate: (tab: TabDef) => TabDef): void {
    const draft = this.draft;
    if (draft === null) return;
    const tabs = draft.tabs.map((tab, i) => (i === this.activeTabIndex ? mutate(tab) : tab));
    this.#updateDraft({ ...draft, tabs });
  }

  #selectTab(index: number): void {
    this.activeTabIndex = index;
    this.selection = null;
  }

  /** Append a fresh, empty tab and make it active. Its column count comes from the form factor's
   * built-in default canvas primary tab (`DEFAULT_CANVASES`), the single source for those figures; the
   * operator renames/resizes it in the tab-settings panel. */
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
    this.activeTabIndex = nextIndex;
    this.selection = null;
  }

  /** Append a card of `type` to the active tab at its default spans (colSpan capped to the tab's
   * column count so a wide card never overflows a narrow tab). */
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

  /** The index of the selected card, or `null` when the selection is not a card. */
  #selectedCardIndex(): number | null {
    const sel = this.selection;
    return sel !== null && "card" in sel ? sel.card : null;
  }

  /** Rewrite the selected card's `colSpan`/`rowSpan` from the stepper's string value: a non-number is
   * ignored, colSpan clamps to `1..tab.columns`, rowSpan clamps to `≥1`. */
  #setSpan(field: "colSpan" | "rowSpan", raw: string): void {
    const draft = this.draft;
    const index = this.#selectedCardIndex();
    if (draft === null || index === null) return;
    const tab = draft.tabs[this.activeTabIndex];
    if (tab === undefined) return;
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) return;
    const clamped =
      field === "colSpan" ? Math.min(Math.max(value, 1), tab.columns) : Math.max(value, 1);
    this.#updateActiveTab((t) => ({
      ...t,
      cards: t.cards.map((card, i) => (i === index ? { ...card, [field]: clamped } : card)),
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

  /** Remove the selected card from the active tab and clear the selection. */
  #removeCard(): void {
    const index = this.#selectedCardIndex();
    if (index === null) return;
    this.#updateActiveTab((t) => ({ ...t, cards: t.cards.filter((_, i) => i !== index) }));
    this.selection = null;
  }

  /** Swap the selected card with its neighbour (`delta` −1 = up, +1 = down); a no-op at either end.
   * The selection follows the card to its new index. */
  #moveCard(delta: -1 | 1): void {
    const draft = this.draft;
    const from = this.#selectedCardIndex();
    if (draft === null || from === null) return;
    const tab = draft.tabs[this.activeTabIndex];
    if (tab === undefined) return;
    const to = from + delta;
    if (to < 0 || to >= tab.cards.length) return;
    const cards = [...tab.cards];
    const moved = cards[from]!;
    cards[from] = cards[to]!;
    cards[to] = moved;
    this.#updateActiveTab((t) => ({ ...t, cards }));
    this.selection = { card: to };
  }

  /** Discard the draft and return to the list, clearing the error banner too. */
  #cancelEditor(): void {
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

  /** Set (or, on an empty entry, CLEAR) the selected product-grid card's `config.columns` — a number
   * clamped to 1..12, an empty box removing the key so the config never carries a stray value. */
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

  /** Toggle the selected card's membership of a visibility `state`. The result is rebuilt in the
   * contract's declared state order (deterministic, not click order), and an EMPTY result OMITS
   * `visibleWhen` entirely rather than storing `[]` — the shape the server and validator expect. */
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

  /** Remove the active tab. A no-op at the last tab (the button is also disabled there) so a canvas
   * never ends up tab-less. `activeTabIndex` clamps back into range and the selection clears. */
  #deleteTab(): void {
    const draft = this.draft;
    if (draft === null || draft.tabs.length <= 1) return;
    const index = this.activeTabIndex;
    const tabs = draft.tabs.filter((_, i) => i !== index);
    this.#updateDraft({ ...draft, tabs });
    this.activeTabIndex = Math.min(index, tabs.length - 1);
    this.selection = null;
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

  /** Toggle a canvas capability flag, rebuilt in the declared flag order (deterministic). */
  #onCapToggle(event: CustomEvent<{ checked: boolean }>, flag: CapabilityFlag): void {
    event.stopPropagation();
    const draft = this.draft;
    if (draft === null) return;
    const capabilities = toggleMembership(
      draft.capabilities,
      CAPABILITY_FLAGS,
      flag,
      event.detail.checked,
    );
    this.#updateDraft({ ...draft, capabilities });
  }

  // ── Save ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Persist the draft: refuse an empty NAME first (the server accepts `""`, so it is guarded here),
   * then run the light client validator (`validateCanvasDraft`) — a broken draft sets the banner and
   * does NOT write. Only a clean draft reaches the server: `updateCanvas` when editing an existing
   * canvas, `createCanvas` for a fresh one, after which the editor returns to the (reloaded) list. A
   * server rejection (a `canvas.*` code) stays in the editor with the banner shown. Guardar disables
   * itself while the write is in flight.
   */
  async #save(): Promise<void> {
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
        else await this.api.createCanvas(name, draft);
        this.mode = "list";
        this.draft = null;
        this.draftName = "";
        this.editingId = null;
        this.selection = null;
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

  /** Create a copy of the armed canvas under the entered name, from the SAME definition, then reload.
   * Duplicar is an IMMEDIATE server write (unlike Crear, which only enters editor mode), and the server
   * accepts `""` as a name, so a blank/whitespace name is refused HERE — the dialog stays open (target
   * kept) so the operator can correct it rather than silently persisting an empty-named canvas. */
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

  /** Delete the armed canvas, then reload. A rejection (a since-deleted id) becomes the error banner. */
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

  /** The `<option>` list for a form-factor `<select>`. With `selected` given (canvas settings) the
   * matching option carries `?selected`; without it (the Crear dialog, whose `<select>` binds no value)
   * the browser's default first-option selection stands — matching `createFormFactor`'s default. */
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

  /** The tab bar: one button per draft tab (selecting `activeTabIndex`) plus a `+ Tab` button.
   * The buttons are a plain group, NOT an ARIA `tablist`: `wt-button` wraps a native `<button>` in its
   * shadow root, so `role="tab"` on the host (which forwards only `aria-label`) leaves the real
   * focusable control nested inside it — axe flags `aria-required-children` / `nested-interactive` /
   * `no-focusable-content`. The active tab is conveyed with `aria-current` (a GLOBAL ARIA property,
   * valid on any element, so no `aria-allowed-attr` issue) plus the `primary` variant. */
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

  /** The palette: one button per card type; a click appends that card to the active tab. */
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

  /** The config section for the selected card: a field per `configFields` entry (only product-grid's
   * `columns` today), or a "no settings" note when the card takes none. */
  #renderConfig(card: CardInstance): TemplateResult | typeof nothing {
    const fields = CARD_CONTRACTS[card.type].configFields;
    if (fields.length === 0) {
      return html`<p class="field" data-test="no-config">${t("canvas_editor.no_config")}</p>`;
    }
    return html`${fields.map((field) =>
      field === "columns"
        ? html`<wt-input
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

  /** The visibility section: one switch per declared visibility state, toggling `visibleWhen`
   * membership. Absent for a card with no visibility states. */
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

  /** The card property panel: colSpan/rowSpan steppers, per-card config + visibility, permission /
   * capability notes, then remove and ↑/↓ reorder. */
  #renderCardPanel(tab: TabDef, index: number): TemplateResult {
    const card = tab.cards[index]!;
    const contract = CARD_CONTRACTS[card.type];
    const capabilityUnmet =
      contract.requiredCapability !== undefined &&
      !(this.draft?.capabilities ?? []).includes(contract.requiredCapability);
    return html`<div class="panel" data-test="card-panel">
      <h2 class="panel-title">${t(`canvas_editor.card.${card.type}` as StringKey)}</h2>
      <wt-input
        class="field"
        type="number"
        data-test="card-colspan"
        label=${t("canvas_editor.colspan")}
        .value=${String(card.colSpan)}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onColSpan(e)}
      ></wt-input>
      <wt-input
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
      ${
        capabilityUnmet
          ? html`<p class="field warning" data-test="capability-warning">
              ${t("canvas_editor.capability_warning")}
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

  /** The tab-settings panel (selection = tab): the active tab's title + column count, and a Delete
   * that is disabled at the last tab (the last-tab guard). */
  #renderTabSettings(draft: CanvasDef): TemplateResult | typeof nothing {
    const tab = draft.tabs[this.activeTabIndex];
    if (tab === undefined) return nothing;
    return html`<div class="panel" data-test="tab-settings-panel">
      <h2 class="panel-title">${t("canvas_editor.tab_settings")}</h2>
      <wt-input
        class="field"
        data-test="tab-title"
        label=${t("canvas_editor.tab_title")}
        .value=${tab.title}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onTabTitle(e)}
      ></wt-input>
      <wt-input
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

  /** The canvas-settings panel (selection = canvas): the canvas NAME (edits `draftName`), its form
   * factor, and a switch per capability flag. */
  #renderCanvasSettings(draft: CanvasDef): TemplateResult {
    return html`<div class="panel" data-test="canvas-settings-panel">
      <h2 class="panel-title">${t("canvas_editor.canvas_settings")}</h2>
      <wt-input
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
      <div class="field" data-test="capabilities">
        <span class="panel-subtitle">${t("canvas_editor.capabilities")}</span>
        <div class="toggles">
          ${CAPABILITY_FLAGS.map(
            (flag) =>
              html`<wt-switch
                data-test="cap-${flag}"
                label=${flag}
                .checked=${draft.capabilities.includes(flag)}
                @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onCapToggle(e, flag)}
              ></wt-switch>`,
          )}
        </div>
      </div>
    </div>`;
  }

  /** Pick the property panel for the current selection: the card panel when a card is selected AND
   * still present in the active tab, else the tab- or canvas-settings panel, else `nothing`. A guard
   * clause per case (each doing its own TS narrowing) rather than a nested ternary. */
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

  /** Editor mode: tab bar, interactive canvas, palette and the property panel for the current
   * selection (card / tab-settings / canvas-settings). Guardar validates the draft and persists it via
   * `#save` (create or update on `editingId`); Cancelar discards. The editor root keeps the
   * `editor-placeholder` seam so the `data-editing-id`/`data-form-factor` hooks still resolve. */
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
