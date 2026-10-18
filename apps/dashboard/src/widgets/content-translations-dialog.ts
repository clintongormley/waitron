import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { ContentSuggestionView } from "@waitron/catalogue/src/content-suggestion-types.js";
import { languageDisplayName, type ContentLanguages } from "@waitron/shared";
import { QueryController } from "@waitron/dashboard-kit";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  translationCellKey,
  type TranslationCellEdit,
  type TranslationCellRef,
  type MissingIn,
  type TranslationRef,
} from "@waitron/catalogue/src/content-translation-types.js";
import { TRANSLATION_GAP_KINDS } from "@waitron/catalogue/src/content-translation-kinds.js";
import type { DashboardApi, SuggestionRunView } from "../api/client.js";
import { QUERY_DEPENDENCIES } from "../api/live-queries.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { leftToBrowser } from "../navigation.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { sameValue } from "./product-editor-model.js";
import { TranslationDrafts, type ReviewChoice } from "./content-translations-model.js";
import { TranslationPages, type TranslationSelection } from "./content-translations-pages.js";
import {
  ContentTranslationWindow,
  translationEditorHref,
  type TranslationWindowChange,
} from "./content-translations-window.js";
import { runActive, type SuggestionService } from "./content-suggestions-bar.js";

type Batch = { edits: TranslationCellEdit[] };
type Refusal = { cell: TranslationCellRef; message: string };
function sameRun(a: SuggestionRunView | null, b: SuggestionRunView | null): boolean {
  if (a === null || b === null) return a === b;
  return !runActive(a) && !runActive(b) && a.finishedAt === b.finishedAt;
}

@customElement("dashboard-content-translations-dialog")
export class ContentTranslationsDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-inline-size: 0;
      }
      .filters,
      .counts,
      .pages {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
        align-items: center;
      }
      .filters > * {
        flex: 1;
        min-inline-size: min(100%, 16ch);
      }
      .review {
        overflow-wrap: anywhere;
        margin-block: var(--wt-space-3);
        padding-block: var(--wt-space-3);
        border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
      }
      .review a {
        display: inline-flex;
        align-items: center;
        min-block-size: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
      }
      .review dd {
        margin-inline: 0;
        margin-block-end: var(--wt-space-3);
      }
      .review-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
      }
      .help {
        color: var(--wt-color-text-muted);
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) config: ContentLanguages | null = null;
  @property() language = "";
  @property({ type: Boolean }) open = false;
  @state() private reader?: TranslationPages;
  @state() private loading = false;
  @state() private busy = false;
  @state() private reading = false;
  @state() private attempted = false;
  @state() private readError = "";
  @state() private actionError = "";
  @state() private refused: readonly Refusal[] = [];
  @state() private missing = "";
  @state() private kind = "";
  @state() private search = "";
  @state() private anchor = "";
  @state() private staged = false;
  @state() private width: "phone" | "desktop" = "desktop";
  @state() private uncertain: Batch | null = null;
  @state() private batchReview: readonly TranslationCellRef[] = [];
  @state() private service: SuggestionService | null = null;
  @state() private suggestionRun: SuggestionRunView | null = null;
  @state() private cloudOrigin: string | null = null;
  @state() private suggestionBusy = false;
  @state() private suggestionAction = "";
  @state() private staleSuggestions = new Set<string>();
  readonly #discardedSuggestions = new Set<string>();
  @state() private suggestionError = "";
  @state() private nothingMissing = false;
  @state() private fixesFilter = false;
  #nothingSaw: SuggestionRunView | null = null;
  #suggestionReads = 0;
  #runReplacedAt = 0;
  #generation = 0;
  #readSequence = 0;
  #personal = "";
  #scope?: DraftScope<Batch>;
  #leave?: LeaveCoordinator;
  readonly #media = matchMedia("(max-width: 600px)");
  readonly #resize = () => {
    const width = this.#media.matches ? "phone" : "desktop";
    if (this.width === width) return;
    this.width = width;
    if (this.reader && this.open) void this.#select({ width });
  };
  readonly #queries = new QueryController(
    this,
    () => this.api?.liveData,
    () => {
      if (this.open) this.readError = t("content_gaps.load_error");
    },
  );
  readonly #beforeClose = async (reason: LeaveReason) =>
    !this.busy &&
    (!this.#leave ||
      (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded");

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
    this.width = this.#media.matches ? "phone" : "desktop";
    this.#media.addEventListener("change", this.#resize);
    if (this.open && this.reader) void this.#resume();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#queries.release("translations");
    this.#queries.release("suggestion-run");
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#media.removeEventListener("change", this.#resize);
    this.busy = false;
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("open") || (changed.has("language") && this.open)) {
      this.#generation++;
      this.reader?.close();
      this.reader = undefined;
      this.#queries.release("translations");
      this.#queries.release("suggestion-run");
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
      this.busy = false;
      this.reading = false;
      this.attempted = false;
      this.readError = "";
      this.actionError = "";
      this.refused = [];
      this.uncertain = null;
      this.batchReview = [];
      this.service = null;
      this.suggestionRun = null;
      this.suggestionBusy = false;
      this.suggestionError = "";
      this.staleSuggestions = new Set();
      this.nothingMissing = false;
      this.search = "";
      this.kind = "";
      this.staged = false;
      this.fixesFilter = false;
      this.anchor = this.language;
      this.missing = this.language;
      if (this.open) void this.#open();
    }
    if (this.open && this.reader && !this.#scope) {
      const { scope, coordinator } = draftScopeFor<Batch>(this, {
        id: this,
        current: () => this.reader!.drafts.personalSubmission(),
        snapshot: (value) => structuredClone(value),
        equal: sameValue,
        restore: () => {
          const reader = this.reader!;
          reader.drafts = new TranslationDrafts(
            reader.page?.config ?? this.config!,
            reader.page?.rows.flatMap((row) => row.cells) ?? [],
          );
          reader.drafts.suggest(reader.suggestions?.suggestions ?? []);
          this.refused = [];
          this.attempted = false;
          this.uncertain = null;
          this.requestUpdate();
        },
      });
      this.#scope = scope;
      this.#leave = coordinator;
      scope.commit({ edits: [] });
    }
  }
  async #open(): Promise<void> {
    const generation = this.#generation;
    this.loading = true;
    try {
      const config = this.config ?? (await this.api.getContentLanguages());
      if (generation !== this.#generation || !this.open || !this.isConnected) return;
      const client = this.api.background ?? this.api;
      const reader = new TranslationPages(
        {
          items: (query) => client.getContentTranslationTargets(query),
          cells: (refs) => client.getContentTranslationCells(refs),
          suggestions: (query) => client.getContentSuggestions(query),
        },
        config,
        this.language,
      );
      this.reader = reader;
      const initialSuggestions = ++this.#suggestionReads;
      await reader.open({ width: this.width });
      if (generation !== this.#generation || !this.open || !this.isConnected) return;
      this.#snapshot(initialSuggestions);
      await this.#watch(reader, generation, initialSuggestions);
    } catch {
      if (generation === this.#generation && this.open)
        this.readError = t("content_gaps.load_error");
    } finally {
      if (generation === this.#generation) this.loading = false;
    }
  }
  async #resume(): Promise<void> {
    const reader = this.reader!,
      generation = this.#generation;
    const suggestions = ++this.#suggestionReads;
    await this.#read(async () => {
      await reader.refresh();
      await reader.refreshSuggestions();
      if (generation === this.#generation && this.open) this.#snapshot(suggestions);
    });
    if (generation === this.#generation && this.open && this.isConnected)
      await this.#watch(reader, generation, suggestions);
  }
  async #watch(
    reader: TranslationPages,
    generation: number,
    initialSuggestions: number,
  ): Promise<void> {
    let first = true;
    await this.#queries.watch(
      "translations",
      {
        key: JSON.stringify(["translation-editor", generation]),
        dependencies: QUERY_DEPENDENCIES.getContentTranslationTargets.map((type) => ({ type })),
        refreshMs: 60_000,
        read: async () => {
          if (first) {
            first = false;
            return;
          }
          await reader.refresh();
        },
      },
      () => {
        if (generation === this.#generation && this.open) this.#snapshot();
      },
    );
    let firstSuggestions = true;
    await this.#queries.watch(
      "suggestion-run",
      {
        key: JSON.stringify(["translation-suggestions", generation]),
        dependencies: QUERY_DEPENDENCIES.getContentSuggestions.map((type) => ({ type })),
        refreshMs: 60_000,
        read: async () => {
          if (firstSuggestions) {
            firstSuggestions = false;
            return initialSuggestions;
          }
          const sequence = ++this.#suggestionReads;
          await reader.refreshSuggestions();
          return sequence;
        },
      },
      (sequence) => {
        if (generation === this.#generation && this.open) this.#snapshot(sequence);
      },
    );
  }
  #snapshot(suggestionSequence?: number): void {
    const reader = this.reader!;
    for (const id of this.#discardedSuggestions) reader.drafts.discardSuggestion(id);
    this.readError = reader.readError ? t("content_gaps.load_error") : "";
    if (reader.suggestions) {
      this.service = reader.suggestions.service;
      this.cloudOrigin = reader.suggestions.cloudOrigin;
      if (suggestionSequence !== undefined && suggestionSequence > this.#runReplacedAt) {
        if (this.nothingMissing && !sameRun(reader.suggestions.run, this.#nothingSaw))
          this.nothingMissing = false;
        this.suggestionRun = reader.suggestions.run;
      }
    }
    this.#notifyDraft();
    this.requestUpdate();
  }
  async #read(operation: () => Promise<void>): Promise<void> {
    const generation = this.#generation;
    const sequence = ++this.#readSequence;
    this.reading = true;
    try {
      await operation();
      if (
        generation === this.#generation &&
        sequence === this.#readSequence &&
        this.open &&
        this.isConnected
      )
        this.#snapshot();
    } finally {
      if (generation === this.#generation && sequence === this.#readSequence) this.reading = false;
    }
  }
  async #select(selection: Partial<TranslationSelection>): Promise<void> {
    if (!this.reader || this.busy || this.uncertain) return;
    await this.#read(() => this.reader!.select(selection));
  }
  #change(event: CustomEvent<TranslationWindowChange>): void {
    event.stopPropagation();
    this.refused = this.refused.filter(
      (fault) => translationCellKey(fault.cell) !== translationCellKey(event.detail.cell),
    );
    this.#notifyDraft();
    this.requestUpdate();
  }
  #notifyDraft(): void {
    this.#window()?.requestUpdate();
    const personal = JSON.stringify(this.reader?.drafts.personalSubmission());
    if (personal === this.#personal) return;
    this.#personal = personal;
    this.#scope?.changed();
  }
  #window(): ContentTranslationWindow | null {
    return this.shadowRoot?.querySelector("dashboard-content-translation-window") ?? null;
  }
  #state() {
    return saveActionState(this.#scope, {
      savableAtOpen: (this.reader?.drafts.suggestedCount ?? 0) > 0 || this.uncertain !== null,
    });
  }
  #faults(): Refusal[] {
    return [
      ...this.refused,
      ...this.batchReview.map((cell) => ({ cell, message: t("translations.batch_review") })),
      ...(this.reader?.drafts.validate() ?? []).map((fault) => ({
        cell: fault.cell,
        message: t(`translations.${fault.message}`),
      })),
    ];
  }
  async #save(): Promise<void> {
    const reader = this.reader;
    if (
      !reader ||
      this.busy ||
      this.suggestionAction ||
      this.loading ||
      this.reading ||
      this.batchReview.length > 0 ||
      this.#state().unchanged ||
      this.#window()?.hasRejectedEdits
    )
      return;
    this.attempted = true;
    const invalid = !this.uncertain && reader.drafts.validate()[0];
    if (invalid) {
      await this.#reveal(invalid.cell);
      return;
    }
    const submitted = this.uncertain ?? reader.drafts.submission();
    if (!submitted.edits.length) return;
    const generation = this.#generation;
    this.busy = true;
    this.actionError = "";
    this.refused = [];
    try {
      const result = await this.api.saveContentTranslations(submitted);
      if (generation !== this.#generation || !this.open || !this.isConnected) return;
      reader.drafts.commit(submitted, result.saved);
      this.#scope?.commit({ edits: [] });
      this.uncertain = null;
      if (reader.drafts.staged().length) {
        this.#scope?.changed();
        this.requestUpdate();
        return;
      }
      this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
      this.open = false;
      this.dispatchEvent(
        new CustomEvent("translations-saved", { detail: result, bubbles: true, composed: true }),
      );
    } catch (error) {
      if (generation !== this.#generation || !this.open || !this.isConnected) return;
      const params = (error as { params?: Record<string, unknown> } | null)?.params ?? {};
      const code = (error as { code?: unknown } | null)?.code;
      this.uncertain =
        typeof code !== "string" || code.startsWith("connection.") || code === "server.internal"
          ? submitted
          : null;
      const message = this.uncertain
        ? t("translations.uncertain")
        : codeMessage(typeof params.causeCode === "string" ? params.causeCode : codeOf(error));
      const cell = submitted.edits.find(
        (edit) =>
          edit.kind === params.kind &&
          edit.id === params.id &&
          edit.language === params.language &&
          edit.field === params.field,
      );
      if (cell) {
        this.refused = [{ cell, message }];
        this.busy = false;
        await this.#reveal(cell);
      } else this.actionError = message;
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  async #reviewBatch(): Promise<void> {
    const reader = this.reader,
      submitted = this.uncertain,
      generation = this.#generation;
    if (!reader || !submitted || this.busy || this.reading || this.suggestionAction) return;
    if (!reader.drafts.beginReview(submitted)) return;
    await this.#read(() => reader.refresh());
    if (generation !== this.#generation || !this.open || !this.isConnected || reader.readError)
      return;
    this.batchReview = submitted.edits.map(({ kind, id, language, field }) => ({
      kind,
      id,
      language,
      field,
    }));
    this.uncertain = null;
    this.actionError = "";
    this.refused = [];
    this.#notifyDraft();
    this.requestUpdate();
  }
  async #reveal(cell: TranslationCellRef): Promise<void> {
    const generation = this.#generation,
      reader = this.reader;
    if (!reader) return;
    this.staged = true;
    this.anchor = cell.language;
    await this.#read(() => reader.reveal(cell));
    if (generation !== this.#generation || !this.open || !this.isConnected) return;
    await this.updateComplete;
    if (await this.#window()?.focusCell(cell)) return;
    const panel = [...this.shadowRoot!.querySelectorAll<HTMLElement>("[data-review]")].find(
      (element) => element.dataset.review === translationCellKey(cell),
    );
    panel?.focus();
  }
  #reviewCell(cell: TranslationCellRef, choice: ReviewChoice): void {
    if (this.busy || this.reading || this.uncertain || !this.reader) return;
    const current = this.reader.drafts.current(cell);
    if (!current || (choice === "keep" && !this.reader.drafts.canKeep(cell))) return;
    this.reader.drafts.review([current], new Map([[translationCellKey(cell), choice]]));
    this.batchReview = this.batchReview.filter(
      (ref) => translationCellKey(ref) !== translationCellKey(cell),
    );
    this.refused = this.refused.filter(
      (fault) => translationCellKey(fault.cell) !== translationCellKey(cell),
    );
    this.#notifyDraft();
    this.requestUpdate();
  }
  #reviews() {
    const draft = this.reader?.drafts;
    if (!draft) return nothing;
    return draft
      .staged()
      .filter(
        (cell) =>
          draft.changed(cell) ||
          this.batchReview.some((ref) => translationCellKey(ref) === translationCellKey(cell)),
      )
      .map((cell) => {
        const old = draft.baseline(cell)!,
          current = draft.current(cell);
        const name = `${old.staffText ?? cell.id} · ${this.#name(cell.language)} · ${t(cell.field === "name" ? "units.name" : "units.abbreviation")}`;
        return html`<section
          class="review"
          data-review=${translationCellKey(cell)}
          role="group"
          aria-label=${name}
          tabindex="-1"
        >
          <p>${name}</p>
          <p>
            ${t(this.batchReview.some((ref) => translationCellKey(ref) === translationCellKey(cell)) ? "translations.batch_review" : "translations.changed")}
          </p>
          <dl>
            <dt>${t("translations.old")}</dt>
            <dd lang=${cell.language}>${old.effectiveText ?? ""}</dd>
            <dt>${t("translations.current")}</dt>
            <dd lang=${cell.language}>${current?.effectiveText ?? ""}</dd>
            <dt>${t("translations.draft")}</dt>
            <dd lang=${cell.language}>${draft.value(cell)}</dd>
          </dl>
          <div class="review-actions">
            ${(["keep", "replace", "discard"] as const).map(
              (choice) =>
                html`<wt-button
                  data-choice=${choice}
                  variant=${choice === "keep" && draft.canKeep(cell) ? "primary" : "secondary"}
                  ?disabled=${this.busy || this.reading || this.uncertain !== null || (choice === "keep" && !draft.canKeep(cell))}
                  @click=${() => this.#reviewCell(cell, choice)}
                  >${t(`translations.${choice}`)}</wt-button
                >`,
            )}
          </div>
        </section>`;
      });
  }
  #openProduct(row: TranslationRef): void {
    const proceed = () => {
      this.dispatchEvent(
        new CustomEvent("wt-edit-product", {
          detail: { productId: row.id },
          bubbles: true,
          composed: true,
        }),
      );
    };
    if (this.#leave) void this.#leave.request({ scopes: [this], reason: "navigation", proceed });
    else proceed();
  }
  #suggestionCurrent(generation: number, reader: TranslationPages, api: DashboardApi): boolean {
    return (
      generation === this.#generation &&
      this.reader === reader &&
      this.api === api &&
      this.open &&
      this.isConnected
    );
  }
  async #useFix(view: ContentSuggestionView): Promise<void> {
    const reader = this.reader;
    if (
      !reader ||
      !view.cell ||
      !view.fix ||
      view.stale ||
      this.busy ||
      this.reading ||
      this.uncertain ||
      this.suggestionAction
    )
      return;
    const generation = this.#generation,
      api = this.api;
    const current = () => this.#suggestionCurrent(generation, reader, api);
    const query = reader.suggestionQuery;
    this.suggestionAction = view.id;
    this.suggestionError = "";
    try {
      const client = api.background ?? api;
      const page = await client.getContentTranslationCells([view.cell]);
      if (!current()) return;
      const latest = await client.getContentSuggestions({
        ...query,
        ...(query.after === undefined ? {} : { configuration: page.configuration }),
      });
      if (!current()) return;
      if (reader.page?.configuration !== page.configuration) {
        await reader.select({});
        if (!current()) return;
      }
      const fresh = page.cells.find(
        (cell) => translationCellKey(cell) === translationCellKey(view.cell!),
      );
      const checked = latest.suggestions.find((suggestion) => suggestion.id === view.id);
      if (
        !fresh ||
        latest.configuration !== page.configuration ||
        reader.page?.configuration !== page.configuration ||
        !checked ||
        !sameValue(checked.fix, view.fix) ||
        !sameValue(checked.cell, view.cell)
      ) {
        this.staleSuggestions = new Set([...this.staleSuggestions, view.id]);
        return;
      }
      reader.receiveCells(page);
      const outcome = reader.drafts.useFix(checked, fresh);
      if (outcome === "stale") this.staleSuggestions = new Set([...this.staleSuggestions, view.id]);
      if (outcome === "full") this.suggestionError = t("suggestions.fix_capacity");
      this.#notifyDraft();
      this.requestUpdate();
    } catch (error) {
      if (current()) this.suggestionError = codeMessage(codeOf(error));
    } finally {
      this.suggestionAction = "";
    }
  }
  async #discardSuggestion(view: ContentSuggestionView): Promise<void> {
    if (this.busy || this.uncertain || this.suggestionAction) return;
    const generation = this.#generation,
      api = this.api;
    this.suggestionAction = view.id;
    this.suggestionError = "";
    try {
      await api.discardContentSuggestion(view.id);
      this.#discardedSuggestions.add(view.id);
      this.reader?.drafts.discardSuggestion(view.id);
      this.#notifyDraft();
      this.requestUpdate();
    } catch (error) {
      if (generation === this.#generation && this.open && this.isConnected && this.api === api)
        this.suggestionError = codeMessage(codeOf(error));
    } finally {
      this.suggestionAction = "";
    }
  }
  #suggestionNotes() {
    const reader = this.reader;
    if (!reader?.suggestions) return nothing;
    return repeat(
      reader.suggestions.suggestions.filter((view) => !this.#discardedSuggestions.has(view.id)),
      (view) => view.id,
      (view) => {
        const row = { kind: view.kind, id: view.itemId, ...view.item };
        const name = row.name;
        const origin = view.cell ? reader.drafts.origin(view.cell) : null;
        const stale =
          view.stale || this.staleSuggestions.has(view.id) || (!!view.fix && origin === "personal");
        const canFix =
          !!view.cell &&
          !!view.fix &&
          view.fix.field === view.cell.language &&
          view.cell.field === "name" &&
          !!view.expected &&
          !stale &&
          origin !== "personal" &&
          origin !== "fix";
        const locked = this.busy || this.uncertain !== null || !!this.suggestionAction;
        return html`<section
          class="review"
          data-suggestion=${view.id}
          role="group"
          aria-label=${name}
        >
          <p>${name}${view.language ? ` · ${this.#name(view.language)}` : ""}</p>
          ${origin === "suggested" ? html`<p>${t("suggestions.suggested")}</p>` : nothing}
          ${view.placeholder ? html`<p>${t("suggestions.placeholder")}</p>` : nothing}
          ${
            view.fix
              ? html`<p>
                  ${
                    view.fix.field === "internal"
                      ? fill("suggestions.fix_internal", {
                          wrong: view.fix.wrong,
                          right: view.fix.right,
                        })
                      : fill("suggestions.fix_language", {
                          language: this.#name(view.fix.field),
                          wrong: view.fix.wrong,
                          right: view.fix.right,
                        })
                  }
                </p>`
              : nothing
          }
          ${stale ? html`<p role="status">${t("suggestions.stale")}</p>` : nothing}
          <div class="review-actions">
            ${html`<a
              href=${translationEditorHref(row)}
              @click=${(event: MouseEvent) => {
                if ((row.kind !== "product" && row.kind !== "variant") || leftToBrowser(event))
                  return;
                event.preventDefault();
                this.#openProduct(row);
              }}
              >${t("content_gaps.open")}</a
            >`}
            ${
              view.fix && view.cell
                ? html`<wt-button
                    data-test="use-fix"
                    variant=${canFix ? "primary" : "secondary"}
                    ?disabled=${locked || this.reading || !canFix}
                    ?loading=${this.suggestionAction === view.id}
                    @click=${() => void this.#useFix(view)}
                    >${t("suggestions.use_fix")}</wt-button
                  >`
                : nothing
            }
            <wt-button
              data-test="discard-suggestion"
              variant="secondary"
              ?disabled=${locked}
              ?loading=${this.suggestionAction === view.id}
              aria-label=${fill("suggestions.discard_named", { name })}
              @click=${() => void this.#discardSuggestion(view)}
              >${t("suggestions.discard")}</wt-button
            >
          </div>
        </section>`;
      },
    );
  }
  async #startRun(): Promise<void> {
    if (this.suggestionBusy || this.service !== "on" || runActive(this.suggestionRun)) return;
    const generation = this.#generation;
    this.suggestionBusy = true;
    this.suggestionError = "";
    this.nothingMissing = false;
    try {
      const { run } = await this.api.startContentSuggestions();
      if (generation !== this.#generation || !this.open) return;
      this.#runReplacedAt = this.#suggestionReads;
      this.#nothingSaw = this.suggestionRun;
      this.nothingMissing = run === null;
      if (run !== null) this.suggestionRun = run;
    } catch (error) {
      if (generation === this.#generation && this.open)
        this.suggestionError = codeMessage(codeOf(error));
    } finally {
      if (generation === this.#generation) this.suggestionBusy = false;
    }
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("translations-closed", { bubbles: true, composed: true }));
  }
  #name(language: string): string {
    return languageDisplayName(language, currentLocale());
  }
  #filter(
    name: string,
    value: string,
    label: string,
    options: { value: string; label: string }[],
    change: (value: string) => void,
  ) {
    return html`<wt-combobox
      name=${name}
      label=${label}
      .value=${value}
      .options=${options}
      ?show-empty-option=${options.some((option) => option.value === "")}
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      ?disabled=${this.busy || this.uncertain !== null}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        change(event.detail.value);
      }}
    ></wt-combobox>`;
  }
  override render() {
    const reader = this.reader,
      draft = reader?.drafts;
    const config = reader?.page?.config ?? this.config;
    const count = draft?.staged().length ?? 0;
    const action = this.#state();
    const faults = this.#faults();
    const locked = this.busy || this.uncertain !== null;
    return html`<wt-modal
      data-test="translations-dialog"
      size="wide"
      .open=${this.open}
      .beforeClose=${this.#beforeClose}
      heading=${t("content_languages.edit_translations")}
      @wt-close=${this.#closed}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
    >
      <p class="help">${t("translations.help")}</p>
      <dashboard-content-suggestions-bar
        .service=${this.service}
        .run=${this.suggestionRun}
        .busy=${this.suggestionBusy}
        .error=${this.suggestionError || (reader?.suggestionError ? codeMessage(codeOf(reader.suggestionError)) : "")}
        .nothing=${this.nothingMissing}
        .waitingFixes=${reader?.suggestions?.waitingFixes ?? 0}
        .reviewDisabled=${locked || this.reading || Boolean(this.suggestionAction)}
        @review-fixes=${(event: Event) => {
          event.stopPropagation();
          if (locked || this.reading || this.suggestionAction) return;
          this.missing = "all";
          this.staged = false;
          this.fixesFilter = true;
          void this.#select({ missing: { mode: "all" }, waitingFixes: true, staged: false });
        }}
        .cloudOrigin=${this.cloudOrigin}
        @translate-all=${(event: Event) => {
          event.stopPropagation();
          void this.#startRun();
        }}
      ></dashboard-content-suggestions-bar>
      ${this.loading ? html`<p role="status" data-test="loading">${t("content_gaps.loading")}</p>` : nothing}
      ${
        this.readError
          ? html`<p role="alert" data-test="read-error">${this.readError}</p>
              <wt-button
                data-test="retry"
                variant="secondary"
                ?disabled=${this.reading}
                @click=${() => void (reader ? this.#read(() => reader.refresh()) : this.#open())}
                >${t("content_languages.retry")}</wt-button
              >`
          : nothing
      }
      ${
        reader && config
          ? html` <div class="filters">
                ${this.#filter(
                  "missing",
                  this.missing,
                  t("translations.missing_in"),
                  [
                    { value: "any", label: t("translations.any_language") },
                    { value: "all", label: t("translations.all_names") },
                    ...config.languages.map((language) => ({
                      value: language,
                      label: this.#name(language),
                    })),
                  ],
                  (value) => {
                    this.missing = value;
                    this.fixesFilter = false;
                    this.staged = false;
                    const missing: MissingIn =
                      value === "any"
                        ? { mode: "any" }
                        : value === "all"
                          ? { mode: "all" }
                          : { mode: "language", language: value };
                    void this.#select({ missing, waitingFixes: undefined, staged: false });
                  },
                )}
                ${this.#filter(
                  "kind",
                  this.kind,
                  t("content_gaps.kind"),
                  [
                    { value: "", label: t("content_gaps.kind_all") },
                    ...TRANSLATION_GAP_KINDS.map((kind) => ({
                      value: kind,
                      label: t(`content_gaps.kind_${kind}`),
                    })),
                  ],
                  (value) => {
                    this.kind = value;
                    this.staged = false;
                    void this.#select({
                      kind: (value as TranslationRef["kind"]) || undefined,
                      staged: false,
                    });
                  },
                )}
                <wt-input
                  name="search"
                  label=${t("content_gaps.search")}
                  .value=${this.search}
                  ?disabled=${locked}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.search = event.detail.value;
                    this.staged = false;
                    void this.#select({ search: this.search, staged: false });
                  }}
                ></wt-input>
                ${this.#filter(
                  "jump",
                  this.anchor,
                  t("translations.jump"),
                  config.languages.map((language) => ({
                    value: language,
                    label: this.#name(language),
                  })),
                  (value) => {
                    this.anchor = value;
                    void this.#select({ anchor: value });
                  },
                )}
              </div>
              ${this.fixesFilter ? html`<p role="status" data-test="fixes-filter-notice">${t("suggestions.fixes_filter")}</p>` : nothing}
              <div class="counts">
                <span data-test="edited-count"
                  >${fill("translations.edited", { count: String(count) })}</span
                >
                <span data-test="hidden-count"
                  >${fill("translations.hidden", { count: String(reader.hiddenCount) })}</span
                >
                <wt-button
                  data-test="show-edited"
                  variant=${count ? "primary" : "secondary"}
                  ?disabled=${locked || (!count && !this.staged)}
                  @click=${() => {
                    this.staged = !this.staged;
                    void this.#select({ staged: this.staged });
                  }}
                  >${t(this.staged ? "translations.show_all" : "translations.show_edited")}</wt-button
                >
                <wt-button
                  data-test="review"
                  variant="secondary"
                  ?disabled=${this.reading || locked}
                  @click=${() => void this.#read(() => reader.refresh())}
                  >${t("translations.review_latest")}</wt-button
                >
              </div>
              ${count > 100 ? html`<p role="alert">${t("translations.capacity")}</p>` : nothing}
              ${draft!.waitingCount > 0 && draft!.suggestedCount > 0 ? html`<p data-test="suggestion-capacity" role="status">${fill("suggestions.capacity", { shown: String(draft!.suggestedCount) })}</p>` : nothing}
              <dashboard-content-translation-window
                .rows=${reader.page?.rows ?? []}
                .languages=${config.languages}
                .anchor=${this.anchor}
                .width=${this.width}
                .drafts=${draft!}
                .disabled=${locked || this.batchReview.length > 0}
                .errors=${this.attempted ? faults : this.refused}
                @translation-change=${this.#change}
                @translation-open=${(event: CustomEvent<{ row: TranslationRef }>) => {
                  event.stopPropagation();
                  this.#openProduct(event.detail.row);
                }}
                @translation-focus=${(event: CustomEvent<{ cell: TranslationCellRef | null }>) => {
                  event.stopPropagation();
                  reader.focus(event.detail.cell);
                }}
              ></dashboard-content-translation-window>
              ${this.#reviews()} ${this.#suggestionNotes()}
              ${reader.page?.rows.length === 0 ? html`<p data-test="complete">${fill("content_gaps.complete", { language: languageDisplayName(this.language, currentLocale(), false) })}</p>` : nothing}
              <div class="pages">
                <wt-button
                  data-test="previous"
                  variant="secondary"
                  ?disabled=${locked || this.reading || !reader.canPrevious}
                  @click=${() => void this.#read(() => reader.previous())}
                  >${t("translations.previous")}</wt-button
                >
                <span>${reader.position + 1}</span>
                <wt-button
                  data-test="next"
                  variant="secondary"
                  ?disabled=${locked || this.reading || !reader.canNext}
                  @click=${() => void this.#read(() => reader.next())}
                  >${t("translations.next")}</wt-button
                >
                ${reader.suggestions?.next ? html`<wt-button data-test="next-suggestions" variant="secondary" ?disabled=${locked || this.reading} @click=${() => void this.#read(() => reader.nextSuggestions())}>${t("translations.more_suggestions")}</wt-button>` : nothing}
              </div>`
          : nothing
      }
      <wt-form-actions
        slot="footer"
        .error=${[this.attempted && (faults.length || this.#window()?.hasRejectedEdits) ? t("form.fix_fields") : "", this.actionError].filter(Boolean).join(" ")}
      >
        ${
          this.uncertain
            ? html`<wt-button
                data-test="review-batch"
                slot="secondary"
                variant="secondary"
                ?disabled=${this.busy || this.reading || Boolean(this.suggestionAction)}
                @click=${() => void this.#reviewBatch()}
                >${t("translations.review_batch")}</wt-button
              >`
            : nothing
        }
        <wt-button
          data-test="close"
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")}
          >${t("action.close")}</wt-button
        >
        <wt-button
          data-test="save"
          variant=${action.variant}
          ?disabled=${action.unchanged || this.loading || this.busy || Boolean(this.suggestionAction) || this.reading || this.batchReview.length > 0 || count > 100 || Boolean(this.#window()?.hasRejectedEdits) || (!this.uncertain && this.attempted && faults.some((fault) => !this.refused.includes(fault)))}
          @click=${() => void this.#save()}
          >${t(this.uncertain ? "translations.retry_batch" : "translations.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-content-translations-dialog": ContentTranslationsDialog;
  }
}
