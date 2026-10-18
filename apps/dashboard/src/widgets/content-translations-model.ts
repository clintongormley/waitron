import type { ContentLanguages } from "@waitron/shared";
import { sameValue } from "./product-editor-model.js";
import {
  translationCellKey,
  type TranslationCell,
  type TranslationCellEdit,
  type TranslationCellKey,
  type TranslationCellPage,
  type TranslationCellRef,
} from "@waitron/catalogue/src/content-translation-types.js";
import type { ContentSuggestionView } from "@waitron/catalogue/src/content-suggestion-types.js";

export type ReviewChoice = "keep" | "replace" | "discard";
export type DraftOrigin = "personal" | "suggested" | "fix";
export interface FieldFault {
  cell: TranslationCellRef;
  message: "review" | "capacity" | "name_bytes" | "batch_bytes";
}
type Batch = { edits: TranslationCellEdit[] };
interface Draft {
  base: TranslationCell;
  config: ContentLanguages;
  value: string;
  origin: DraftOrigin;
  suggestionId?: string;
  revision: number;
}
interface Input {
  value: string;
  revision: number;
  baseline: Pick<TranslationCell, "text" | "owners" | "expected">;
  config: ContentLanguages;
}
interface SubmittedCell {
  revision: number;
  config: ContentLanguages;
}
const normalized = (text: string | null): string | null => text?.trim() || null;
const reference = ({ kind, id, language, field }: TranslationCellRef): TranslationCellRef => ({
  kind,
  id,
  language,
  field,
});
const sameConfig = (left: ContentLanguages, right: ContentLanguages): boolean =>
  left.defaultLanguage === right.defaultLanguage &&
  sameValue([...left.languages].sort(), [...right.languages].sort());

export class TranslationDrafts {
  #config: ContentLanguages;
  #current = new Map<TranslationCellKey, TranslationCell>();
  readonly #drafts = new Map<TranslationCellKey, Draft>();
  readonly #inputs = new Map<TranslationCellKey, Input>();
  readonly #dismissed = new Set<string>();
  readonly #waiting = new Set<string>();
  readonly #submitted = new WeakMap<Batch, ReadonlyMap<TranslationCellKey, SubmittedCell>>();
  #revision = 0;

  constructor(config: ContentLanguages, cells: readonly TranslationCell[]) {
    this.#config = structuredClone(config);
    for (const cell of cells) this.#current.set(translationCellKey(cell), structuredClone(cell));
  }
  current(cell: TranslationCellRef): TranslationCell | undefined {
    const current = this.#current.get(translationCellKey(cell));
    return current && structuredClone(current);
  }
  baseline(cell: TranslationCellRef): TranslationCell | undefined {
    const draft = this.#drafts.get(translationCellKey(cell));
    return draft && structuredClone(draft.base);
  }
  canKeep(cell: TranslationCellRef): boolean {
    const draft = this.#drafts.get(translationCellKey(cell)),
      latest = this.#current.get(translationCellKey(cell));
    return (
      !!draft &&
      !!latest?.eligible &&
      this.#config.languages.includes(cell.language) &&
      sameValue(draft.base.owners, latest.owners)
    );
  }
  value(cell: TranslationCellRef): string {
    const key = translationCellKey(cell);
    return (
      this.#drafts.get(key)?.value ??
      this.#inputs.get(key)?.value ??
      this.#current.get(key)?.text ??
      ""
    );
  }
  origin(cell: TranslationCellRef): DraftOrigin | null {
    const key = translationCellKey(cell);
    return this.#drafts.get(key)?.origin ?? (this.#inputs.has(key) ? "personal" : null);
  }
  changed(cell: TranslationCellRef): boolean {
    const key = translationCellKey(cell),
      draft = this.#drafts.get(key),
      latest = this.#current.get(key);
    return (
      !!draft &&
      (!latest?.eligible ||
        !this.#config.languages.includes(cell.language) ||
        !sameConfig(draft.config, this.#config) ||
        draft.base.expected !== latest.expected ||
        !sameValue(draft.base.owners, latest.owners))
    );
  }
  staged(): readonly TranslationCellRef[] {
    return [...this.#drafts.values()].map((draft) => reference(draft.base));
  }
  get suggestedCount(): number {
    return [...this.#drafts.values()].filter((draft) => draft.origin === "suggested").length;
  }
  get waitingCount(): number {
    return this.#waiting.size;
  }
  edit(cell: TranslationCellRef, text: string): boolean {
    const key = translationCellKey(cell),
      previous = this.#drafts.get(key),
      base = previous?.base ?? this.#current.get(key);
    if (!base || (!base.eligible && !previous)) return false;
    const different = normalized(text) !== normalized(base.text);
    const personalCount = [...this.#drafts.values()].filter(
      (draft) => draft.origin !== "suggested",
    ).length;
    if (different && !previous && personalCount >= 101) return false;
    const revision = ++this.#revision;
    this.#inputs.set(key, {
      value: text,
      revision,
      baseline: { text: base.text, owners: structuredClone(base.owners), expected: base.expected },
      config: structuredClone(previous?.config ?? this.#config),
    });
    if (!different) this.#drafts.delete(key);
    else
      this.#drafts.set(key, {
        base: structuredClone(base),
        config: structuredClone(previous?.config ?? this.#config),
        value: text,
        origin: "personal",
        revision,
      });
    this.#makeRoom();
    return true;
  }
  #makeRoom(): void {
    for (const [key, draft] of [...this.#drafts].reverse()) {
      if (this.#drafts.size <= 100) break;
      if (draft.origin !== "suggested") continue;
      if (draft.suggestionId) this.#waiting.add(draft.suggestionId);
      this.#drafts.delete(key);
    }
  }
  receive(page: TranslationCellPage): void {
    this.#config = structuredClone(page.config);
    const next = new Map<TranslationCellKey, TranslationCell>();
    for (const key of this.#drafts.keys()) {
      const current = this.#current.get(key);
      if (current) next.set(key, current);
    }
    for (const cell of page.cells) {
      const key = translationCellKey(cell),
        input = this.#inputs.get(key);
      if (input && !this.#drafts.has(key) && normalized(input.value) !== normalized(cell.text)) {
        this.#drafts.set(key, {
          base: { ...structuredClone(cell), ...structuredClone(input.baseline) },
          config: structuredClone(input.config),
          value: input.value,
          origin: "personal",
          revision: input.revision,
        });
      }
      next.set(key, structuredClone(cell));
    }
    this.#current = next;
    for (const [key, draft] of this.#drafts) {
      if (draft.origin !== "suggested") continue;
      if (this.changed(draft.base) || normalized(this.#current.get(key)?.effectiveText ?? null))
        this.#drafts.delete(key);
    }
    this.#makeRoom();
  }
  #matches(view: ContentSuggestionView, cell: TranslationCell): boolean {
    return (
      !!view.cell &&
      translationCellKey(view.cell) === translationCellKey(cell) &&
      view.kind === cell.kind &&
      view.itemId === cell.id &&
      view.language === cell.language &&
      view.cell.field === "name" &&
      !view.stale &&
      !view.placeholder &&
      !!view.expected &&
      view.expected === cell.expected &&
      cell.eligible &&
      this.#config.languages.includes(cell.language) &&
      !this.#dismissed.has(view.id)
    );
  }
  suggest(views: readonly ContentSuggestionView[]): void {
    for (const view of views) {
      if (!view.cell) continue;
      const key = translationCellKey(view.cell),
        current = this.#current.get(key),
        previous = this.#drafts.get(key);
      if (
        previous?.origin === "suggested" &&
        previous.suggestionId === view.id &&
        (!current || !this.#matches(view, current) || !normalized(view.text))
      )
        this.#drafts.delete(key);
      if (
        !current ||
        !this.#matches(view, current) ||
        !normalized(view.text) ||
        view.fix ||
        normalized(current.effectiveText) ||
        this.#inputs.has(key) ||
        (previous && previous.origin !== "suggested")
      )
        continue;
      if (!previous && (this.#waiting.has(view.id) || this.#drafts.size >= 100)) {
        this.#waiting.add(view.id);
        continue;
      }
      this.#drafts.set(key, {
        base: structuredClone(current),
        config: structuredClone(this.#config),
        value: view.text!,
        origin: "suggested",
        suggestionId: view.id,
        revision: ++this.#revision,
      });
    }
  }
  useFix(view: ContentSuggestionView, current: TranslationCell): "staged" | "stale" | "full" {
    const key = translationCellKey(current);
    if (
      !this.#matches(view, current) ||
      !view.fix ||
      view.fix.field !== current.language ||
      view.fix.wrong !== current.effectiveText ||
      !normalized(view.fix.right) ||
      this.#inputs.has(key) ||
      this.#drafts.get(key)?.origin === "fix"
    )
      return "stale";
    const observed = this.#current.get(key);
    if (observed && !sameValue(observed.owners, current.owners)) return "stale";
    if (!this.#drafts.has(key) && this.#drafts.size - this.suggestedCount >= 100) return "full";
    this.#current.set(key, structuredClone(current));
    this.#drafts.set(key, {
      base: structuredClone(current),
      config: structuredClone(this.#config),
      value: view.fix.right,
      origin: "fix",
      suggestionId: view.id,
      revision: ++this.#revision,
    });
    this.#makeRoom();
    return "staged";
  }
  review(
    current: readonly TranslationCell[],
    choices: ReadonlyMap<TranslationCellKey, ReviewChoice>,
  ): void {
    for (const cell of current) {
      const key = translationCellKey(cell),
        choice = choices.get(key),
        draft = this.#drafts.get(key);
      this.#current.set(key, structuredClone(cell));
      if (choice === "discard" || choice === "replace") {
        this.unstage(cell);
        continue;
      }
      if (choice !== "keep" || !draft || !this.canKeep(cell)) continue;
      draft.base = structuredClone(cell);
      draft.config = structuredClone(this.#config);
      const input = this.#inputs.get(key);
      if (input) {
        input.baseline = {
          text: cell.text,
          owners: structuredClone(cell.owners),
          expected: cell.expected,
        };
        input.config = structuredClone(this.#config);
      }
      if (normalized(draft.value) === normalized(cell.text)) this.#drafts.delete(key);
    }
  }
  unstage(cell: TranslationCellRef): void {
    const key = translationCellKey(cell),
      draft = this.#drafts.get(key);
    if (draft?.suggestionId) this.#dismissed.add(draft.suggestionId);
    this.#drafts.delete(key);
    this.#inputs.delete(key);
  }
  discardSuggestion(id: string): void {
    this.#dismissed.add(id);
    for (const [key, draft] of this.#drafts) {
      if (draft.origin === "suggested" && draft.suggestionId === id) this.#drafts.delete(key);
    }
  }
  #batch(personal: boolean): Batch {
    const edits = [...this.#drafts.values()]
      .filter((draft) => !personal || draft.origin !== "suggested")
      .map((draft) => ({
        ...reference(draft.base),
        expected: draft.base.expected,
        text: normalized(draft.value),
      }));
    const batch = { edits };
    this.#submitted.set(
      batch,
      new Map(
        edits.map((edit) => {
          const draft = this.#drafts.get(translationCellKey(edit))!;
          return [
            translationCellKey(edit),
            { revision: draft.revision, config: structuredClone(draft.config) },
          ];
        }),
      ),
    );
    return batch;
  }
  submission(): Batch {
    return this.#batch(false);
  }
  personalSubmission(): Batch {
    return this.#batch(true);
  }
  validate(): FieldFault[] {
    const faults: FieldFault[] = [];
    for (const [index, draft] of [...this.#drafts.values()].entries()) {
      const cell = reference(draft.base);
      if (this.changed(cell)) faults.push({ cell, message: "review" });
      if (index >= 100) faults.push({ cell, message: "capacity" });
      if (new TextEncoder().encode(draft.value.trim()).length > 4096)
        faults.push({ cell, message: "name_bytes" });
    }
    if (new TextEncoder().encode(JSON.stringify(this.submission())).length > 262144) {
      const first = this.staged()[0];
      if (first) faults.push({ cell: first, message: "batch_bytes" });
    }
    return faults;
  }
  commit(submitted: Batch, saved: readonly TranslationCell[]): void {
    const versions = this.#submitted.get(submitted);
    if (!versions) return;
    const replies = new Map(saved.map((cell) => [translationCellKey(cell), cell]));
    for (const edit of submitted.edits) {
      const key = translationCellKey(edit),
        cell = replies.get(key);
      if (!cell) continue;
      const draft = this.#drafts.get(key),
        input = this.#inputs.get(key);
      const snapshot = versions.get(key),
        revision = snapshot?.revision;
      const newer =
        revision !== undefined && (input?.revision ?? draft?.revision ?? revision) > revision;
      this.#current.set(key, structuredClone(cell));
      if (!newer) {
        this.#drafts.delete(key);
        this.#inputs.delete(key);
        continue;
      }
      const value = input?.value ?? draft?.value ?? "";
      if (input) {
        input.baseline = {
          text: cell.text,
          owners: structuredClone(cell.owners),
          expected: cell.expected,
        };
        input.config = structuredClone(snapshot?.config ?? this.#config);
      }
      if (normalized(value) === normalized(cell.text)) this.#drafts.delete(key);
      else
        this.#drafts.set(key, {
          base: structuredClone(cell),
          config: structuredClone(snapshot?.config ?? this.#config),
          value,
          origin: draft?.origin === "fix" ? "fix" : "personal",
          revision: input?.revision ?? draft!.revision,
        });
    }
    this.#submitted.delete(submitted);
  }
}
