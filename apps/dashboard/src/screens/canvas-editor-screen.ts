import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
// Side-effect import: register <canvas-grid-preview> (the shared thumbnail/canvas unit, Task B4) so
// the list can render each canvas's first tab as an inert preview.
import "./canvas-editor/canvas-grid-preview.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import {
  DEFAULT_CANVASES,
  FORM_FACTORS,
  type CanvasDef,
  type FormFactor,
} from "./canvas-editor/card-contracts.js";
import type { Canvas, DashboardApi } from "../api/client.js";

/**
 * The management dashboard's CANVAS EDITOR screen (SP-B3.2) — the venue's central surface for the
 * per-device grid layouts ("canvases"). This task (B5) implements its LIST mode: it loads the tenant's
 * canvases (`api.listCanvases()`), and renders each as a card carrying its name, a form-factor badge,
 * tab/card counts and an inert `<canvas-grid-preview>` thumbnail of its first tab, plus per-row Editar /
 * Duplicar / Eliminar controls. It also offers a Crear dialog (name + form-factor) that seeds a fresh
 * draft from the built-in default for that form factor and enters EDITOR mode.
 *
 * EDITOR mode is a placeholder here — Tasks B6/B7 fill it in (the draft grid editor + save). The screen
 * carries the `draft`/`draftName`/`editingId` state those tasks build on, and `render()` switches on
 * `mode`; the editor branch renders nothing but the error banner for now.
 *
 * DEFENSIVE PARSE. A canvas's `definition` crosses the client boundary as opaque `unknown` (the #70
 * bundle rule — the dashboard never imports `@waitron/layouts`' real type). `#parseDefinition` shallow-
 * checks it before the thumbnail reads it, so a malformed/absent definition renders a neutral
 * `no-preview` placeholder rather than throwing and blanking the whole list.
 *
 * ERROR HANDLING mirrors the sibling screens (printers/staff): every loader/mutation is fully
 * `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` (the raw `{ code }`, falling
 * back to `server.internal`) rendered in a `role="alert"` banner; `codeMessage` maps it to localised
 * copy at the render edge.
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
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  /** Which mode is showing. `list` is the canvas gallery (this task); `editor` is the draft grid
   * editor (Tasks B6/B7). */
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

  // Editor-mode draft (Tasks B6/B7 own the grid editing + save): the parsed definition being edited,
  // its name, and the id of the canvas being edited (null for a freshly-created draft not yet saved).
  @state() private draft: CanvasDef | null = null;
  @state() private draftName = "";
  @state() private editingId: string | null = null;

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

  #onCreateName(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.createName = event.detail.value;
  }

  #onCreateFormFactor(event: Event): void {
    event.stopPropagation();
    this.createFormFactor = (event.target as HTMLSelectElement).value as FormFactor;
  }

  /** Seed a fresh draft from the built-in default for the chosen form factor and enter editor mode.
   * The save is Task B7 — nothing is written to the server here. `structuredClone` gives the editor a
   * private copy it can mutate without touching the shared `DEFAULT_CANVASES` template. */
  #confirmCreate(): void {
    this.draft = structuredClone(DEFAULT_CANVASES[this.createFormFactor]);
    this.draftName = this.createName;
    this.editingId = null;
    this.createOpen = false;
    this.mode = "editor";
  }

  // ── Editar ─────────────────────────────────────────────────────────────────────────────────────

  /** Open the editor for an existing canvas (Tasks B6/B7 own the grid editing + save). Parses the
   * definition into an editable draft and enters editor mode. */
  #openEditor(canvas: Canvas): void {
    this.editingId = canvas.id;
    this.draft = this.#parseDefinition(canvas.definition);
    this.draftName = canvas.name;
    this.mode = "editor";
  }

  // ── Duplicar ───────────────────────────────────────────────────────────────────────────────────

  #openDuplicate(canvas: Canvas): void {
    this.duplicateTarget = canvas;
    this.duplicateName = `${canvas.name} (copy)`;
  }

  #onDuplicateName(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.duplicateName = event.detail.value;
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
              @click=${() => this.#openEditor(canvas)}
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
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onCreateName(e)}
      ></wt-input>
      <label class="field"
        >${t("canvas_editor.form_factor_label")}
        <select data-test="create-form-factor" @change=${(e: Event) => this.#onCreateFormFactor(e)}>
          ${FORM_FACTORS.map(
            (ff) =>
              html`<option value=${ff}>
                ${t(`canvas_editor.form_factor.${ff}` as StringKey)}
              </option>`,
          )}
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
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDuplicateName(e)}
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

  /** Editor mode is Tasks B6/B7 — a placeholder here that holds the editing SEAM (the draft, its name
   * and the id being edited) those tasks build the grid editor + save on. Only the seam and the error
   * banner render for now. */
  #renderEditor(): TemplateResult {
    return html`
      <div
        data-test="editor-placeholder"
        data-editing-id=${this.editingId ?? nothing}
        data-form-factor=${this.draft?.formFactor ?? nothing}
      >
        ${this.draftName}
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
