import type { ContentLanguages } from "@waitron/shared";
import {
  translationCellKey,
  type MissingIn,
  type TranslationCell,
  type TranslationCellPage,
  type TranslationCellRef,
  type TranslationItemPage,
  type TranslationQuery,
  type TranslationRef,
} from "@waitron/catalogue/src/content-translation-types.js";
import { TRANSLATION_GAP_KINDS } from "@waitron/catalogue/src/content-translation-kinds.js";
import type {
  ContentSuggestionQuery,
  ContentSuggestionRead,
} from "@waitron/catalogue/src/content-suggestion-types.js";
import { TranslationDrafts } from "./content-translations-model.js";
import { sameValue } from "./product-editor-model.js";
import { languageWindow } from "./content-translations-window.js";

export interface TranslationPageApi {
  items(query: TranslationQuery): Promise<TranslationItemPage>;
  cells(refs: readonly TranslationCellRef[]): Promise<TranslationCellPage>;
  suggestions(query: ContentSuggestionQuery): Promise<ContentSuggestionRead>;
}
export interface TranslationSelection {
  missing: MissingIn;
  kind?: TranslationRef["kind"];
  search?: string;
  waitingFixes?: true;
  staged?: boolean;
  anchor?: string;
  width?: "phone" | "desktop";
  focused?: TranslationCellRef | null;
}
const itemKey = (ref: TranslationRef): string => JSON.stringify([ref.kind, ref.id]);
function last(cursor: string): TranslationRef {
  const parsed = JSON.parse(cursor) as { last: TranslationRef };
  if (
    !parsed.last ||
    !TRANSLATION_GAP_KINDS.includes(parsed.last.kind) ||
    typeof parsed.last.id !== "string" ||
    !parsed.last.id
  )
    throw new Error("Invalid translation cursor");
  return parsed.last;
}
function advances(next: string, query: TranslationQuery, configuration: string): boolean {
  if ("targets" in query) return false;
  const value = JSON.parse(next) as { configuration: string; filter: unknown };
  if (
    value.configuration !== configuration ||
    !sameValue(value.filter, {
      languages: query.languages,
      missing: query.missing,
      kind: query.kind ?? null,
      search: query.search?.trim() ?? "",
      waitingFixes: query.waitingFixes === true,
    })
  )
    return false;
  const right = last(next);
  if (!query.after) return true;
  const left = last(query.after);
  const difference =
    TRANSLATION_GAP_KINDS.indexOf(right.kind) - TRANSLATION_GAP_KINDS.indexOf(left.kind);
  return difference > 0 || (difference === 0 && right.id > left.id);
}

function updatedPage(
  page: TranslationItemPage,
  fresh: readonly TranslationCell[],
): TranslationItemPage {
  const cells = new Map(fresh.map((cell) => [translationCellKey(cell), cell]));
  return {
    ...page,
    rows: page.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => cells.get(translationCellKey(cell)) ?? cell),
    })),
  };
}

export class TranslationPages {
  drafts: TranslationDrafts;
  page: TranslationItemPage | null = null;
  suggestions: ContentSuggestionRead | null = null;
  readError: unknown = null;
  suggestionError: unknown = null;
  #config: ContentLanguages;
  #selection: TranslationSelection;
  #active = false;
  #ready = false;
  #opening = 0;
  #itemSequence = 0;
  #suggestionSequence = 0;
  #position = 0;
  #cursors: (string | undefined)[] = [undefined];
  constructor(
    readonly api: TranslationPageApi,
    config: ContentLanguages,
    readonly initial: string,
  ) {
    this.#config = structuredClone(config);
    this.#selection = this.#initialSelection();
    this.drafts = new TranslationDrafts(config, []);
  }
  #initialSelection(): TranslationSelection {
    const language = this.#config.languages.includes(this.initial)
      ? this.initial
      : this.#config.defaultLanguage;
    return { missing: { mode: "language", language }, anchor: language };
  }
  get hiddenCount(): number {
    const shown = new Set(
      this.page?.rows.flatMap((row) => row.cells.map(translationCellKey)) ?? [],
    );
    return this.drafts.staged().filter((cell) => !shown.has(translationCellKey(cell))).length;
  }
  #stagedItems(): TranslationRef[] {
    return [
      ...new Map(
        this.drafts.staged().map(({ kind, id }) => {
          const ref = { kind, id };
          return [itemKey(ref), ref];
        }),
      ).values(),
    ];
  }
  #query(position: number): TranslationQuery | null {
    const selection = this.#selection;
    const languages = languageWindow(
      this.#config.languages,
      selection.anchor ?? this.#config.defaultLanguage,
      selection.width ?? "desktop",
      selection.focused?.language ?? null,
    );
    if (selection.staged) {
      const targets = this.#stagedItems().slice(position * 50, (position + 1) * 50);
      return targets.length ? { languages, targets } : null;
    }
    return {
      languages,
      missing: selection.missing,
      ...(selection.kind ? { kind: selection.kind } : {}),
      ...(selection.search ? { search: selection.search } : {}),
      ...(selection.waitingFixes ? { waitingFixes: true } : {}),
      ...(this.#cursors[position] === undefined ? {} : { after: this.#cursors[position] }),
    };
  }
  get position(): number {
    return this.#position;
  }
  get canPrevious(): boolean {
    return this.#ready && this.#position > 0;
  }
  get canNext(): boolean {
    return (
      this.#ready &&
      (this.#selection.staged
        ? this.#stagedItems().length > (this.#position + 1) * 50
        : this.page?.next != null)
    );
  }
  async open(selection: Partial<TranslationSelection> = {}): Promise<void> {
    this.close();
    this.#active = true;
    this.#selection = { ...this.#initialSelection(), ...selection };
    this.#position = 0;
    this.#cursors = [undefined];
    this.drafts = new TranslationDrafts(this.#config, []);
    this.page = null;
    this.suggestions = null;
    this.readError = null;
    this.suggestionError = null;
    const opening = this.#opening;
    const sequence = ++this.#suggestionSequence;
    const suggestion = this.api.suggestions({}).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await this.#readItems(0);
    const answer = await suggestion;
    if (!this.#active || opening !== this.#opening || sequence !== this.#suggestionSequence) return;
    if ("error" in answer) this.suggestionError = answer.error;
    else
      await this.#applySuggestions(
        answer.value,
        undefined,
        () => this.#active && opening === this.#opening && sequence === this.#suggestionSequence,
      );
  }
  close(): void {
    this.#active = false;
    this.#ready = false;
    this.#opening++;
    this.#itemSequence++;
    this.#suggestionSequence++;
  }
  focus(cell: TranslationCellRef | null): void {
    this.#selection.focused = structuredClone(cell);
  }
  async select(selection: Partial<TranslationSelection>): Promise<void> {
    if (!this.#active) return;
    this.#selection = { ...this.#selection, ...structuredClone(selection) };
    if (this.#selection.missing.mode !== "all") delete this.#selection.waitingFixes;
    this.#cursors = [undefined];
    await this.#readItems(0);
  }
  async reveal(cell: TranslationCellRef): Promise<void> {
    if (!this.#active) return;
    const index = this.#stagedItems().findIndex((ref) => itemKey(ref) === itemKey(cell));
    if (index < 0) return;
    this.#selection = { ...this.#selection, staged: true, anchor: cell.language, focused: null };
    this.#cursors = [undefined];
    await this.#readItems(Math.floor(index / 50));
  }
  async next(): Promise<void> {
    if (!this.#active || !this.#ready || !this.page) return;
    if (this.#selection.staged) {
      if (this.#stagedItems().length <= (this.#position + 1) * 50) return;
    } else {
      if (!this.page.next) return;
      this.#cursors[this.#position + 1] = this.page.next;
    }
    await this.#readItems(this.#position + 1);
  }
  async previous(): Promise<void> {
    if (this.#active && this.#ready && this.#position > 0)
      await this.#readItems(this.#position - 1);
  }
  async refresh(): Promise<void> {
    if (this.#active) await this.#readItems(this.#position);
  }
  async #readItems(position: number): Promise<void> {
    this.#ready = false;
    this.#position = position;
    const sequence = ++this.#itemSequence;
    const current = () => this.#active && sequence === this.#itemSequence;
    const query = this.#query(position);
    const retained = [
      ...new Map(
        [
          ...this.drafts.staged(),
          ...(this.#selection.focused ? [this.#selection.focused] : []),
        ].map((cell) => [translationCellKey(cell), cell]),
      ).values(),
    ];
    try {
      const [page, ...refreshes] = await Promise.all([
        query
          ? this.api.items(query)
          : Promise.resolve({
              config: this.#config,
              required: this.page?.required ?? [],
              configuration: this.page?.configuration ?? "",
              rows: [],
              total: 0,
              next: null,
            } satisfies TranslationItemPage),
        ...Array.from({ length: Math.ceil(retained.length / 100) }, (_, index) =>
          this.api.cells(retained.slice(index * 100, (index + 1) * 100)),
        ),
      ]);
      if (!current()) return;
      if (
        page.rows.length > 50 ||
        refreshes.some((value) => value.configuration !== page.configuration) ||
        (query && "after" in query && this.page?.configuration !== page.configuration) ||
        (page.next !== null && (!query || !advances(page.next, query, page.configuration)))
      )
        throw new Error("Translation page changed or did not advance");
      const merged = new Map(
        [
          ...page.rows.flatMap((row) => row.cells),
          ...refreshes.flatMap((value) => value.cells),
        ].map((cell) => [translationCellKey(cell), cell]),
      );
      this.drafts.receive({ ...page, cells: [...merged.values()] });
      this.#config = structuredClone(page.config);
      this.page = updatedPage(
        page,
        refreshes.flatMap((value) => value.cells),
      );
      this.#position = position;
      this.#ready = true;
      this.readError = null;
      if (this.suggestions?.configuration === page.configuration)
        this.drafts.suggest(this.suggestions.suggestions);
      else this.suggestions = null;
    } catch (error) {
      if (current()) this.readError = error;
    }
  }
  async #applySuggestions(
    page: ContentSuggestionRead,
    after: string | undefined,
    current: () => boolean,
  ): Promise<void> {
    if (
      page.configuration !== this.page?.configuration ||
      page.suggestions.length > 100 ||
      (after !== undefined && page.next !== null && page.next <= after)
    ) {
      this.suggestionError = new Error("Suggestion page changed or did not advance");
      return;
    }
    try {
      const wanted = [
        ...new Map(
          page.suggestions.flatMap((suggestion) =>
            suggestion.cell &&
            suggestion.text &&
            !suggestion.fix &&
            !suggestion.stale &&
            this.drafts.current(suggestion.cell)?.expected !== suggestion.expected
              ? [[translationCellKey(suggestion.cell), suggestion.cell] as const]
              : [],
          ),
        ).values(),
      ];
      const refreshed = wanted.length ? await this.api.cells(wanted) : null;
      if (!current()) return;
      if (
        page.configuration !== this.page?.configuration ||
        (refreshed && refreshed.configuration !== page.configuration)
      )
        throw new Error("Suggestion cells changed configuration");
      if (refreshed) {
        const retained = this.drafts.staged().flatMap((ref) => {
          const cell = this.drafts.current(ref);
          return cell ? [cell] : [];
        });
        const values = new Map(
          [...this.page.rows.flatMap((row) => row.cells), ...retained, ...refreshed.cells].map(
            (cell) => [translationCellKey(cell), cell],
          ),
        );
        this.drafts.receive({ ...refreshed, cells: [...values.values()] });
        this.page = updatedPage(this.page, refreshed.cells);
      }
      this.suggestions = page;
      this.suggestionError = null;
      this.drafts.suggest(page.suggestions);
    } catch (error) {
      if (current()) this.suggestionError = error;
    }
  }
  async nextSuggestions(): Promise<void> {
    const previous = this.suggestions;
    if (!this.#active || !previous?.next) return;
    const sequence = ++this.#suggestionSequence;
    const current = () => this.#active && sequence === this.#suggestionSequence;
    try {
      const page = await this.api.suggestions({
        after: previous.next,
        configuration: previous.configuration,
      });
      if (current()) await this.#applySuggestions(page, previous.next, current);
    } catch (error) {
      if (current()) this.suggestionError = error;
    }
  }
  async refreshSuggestions(): Promise<void> {
    if (!this.#active) return;
    const sequence = ++this.#suggestionSequence;
    const current = () => this.#active && sequence === this.#suggestionSequence;
    try {
      const page = await this.api.suggestions({});
      if (current()) await this.#applySuggestions(page, undefined, current);
    } catch (error) {
      if (current()) this.suggestionError = error;
    }
  }
}
