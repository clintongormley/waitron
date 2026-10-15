import { sameValue } from "./product-editor-model.js";
import type {
  ContentSuggestionView,
  TranslationBatch,
  TranslationRef,
  TranslationTarget,
} from "../api/client.js";

export interface FieldFault {
  target: TranslationRef;
  field: "text" | "defaultText";
  message: string;
}

export type ReviewChoice = "keep" | "replace" | "discard";

export interface RowSuggestion {
  ids: string[];
  text: string | null;
  defaultText: string | null;
  stale: boolean;
  placeholder: boolean;
  fixes: { field: string; wrong: string; right: string }[];
}

interface DraftValues {
  text: string;
  defaultText: string;
}

export class TranslationDrafts {
  #latest = new Map<string, TranslationTarget>();
  #receivedSnapshot = false;
  #gaps: readonly TranslationTarget[] = [];
  #latestDefaultLanguage: string;
  readonly #targets: Map<string, TranslationTarget>;
  readonly #values = new Map<string, DraftValues>();
  #suggestions = new Map<string, RowSuggestion>();
  #filled = new Map<string, DraftValues>();
  readonly #dismissed = new Set<string>();
  readonly #staleIds = new Set<string>();
  constructor(
    readonly language: string,
    public defaultLanguage: string,
    public rows: readonly TranslationTarget[],
  ) {
    this.rows = structuredClone(rows);
    this.#targets = new Map(this.rows.map((row) => [translationKey(row), row]));
    this.#latestDefaultLanguage = defaultLanguage;
  }
  get arrivals(): number {
    return this.#gaps.filter((row) => !this.#targets.has(translationKey(row))).length;
  }
  current(ref: TranslationRef): TranslationTarget | undefined {
    return this.#latest.get(translationKey(ref));
  }
  changed(ref: TranslationRef): boolean {
    const baseline = this.#targets.get(translationKey(ref));
    const current = this.current(ref);
    return (
      this.isEdited(ref) &&
      this.#receivedSnapshot &&
      (!current || !current.eligible || current.expected !== baseline?.expected)
    );
  }
  snapshot(
    gaps: readonly TranslationTarget[],
    retained: readonly TranslationTarget[],
    defaultLanguage = this.defaultLanguage,
  ): void {
    this.#receivedSnapshot = true;
    this.#latestDefaultLanguage = defaultLanguage;
    if (!this.personalSubmission().edits.length) this.defaultLanguage = defaultLanguage;
    this.#gaps = gaps;
    this.#latest = new Map([...gaps, ...retained].map((row) => [translationKey(row), row]));
    const present = new Set(gaps.map(translationKey));
    this.rows = this.rows.filter((row) => this.isEdited(row) || present.has(translationKey(row)));
    const kept = new Set(this.rows.map(translationKey));
    for (const key of this.#targets.keys()) if (!kept.has(key)) this.#targets.delete(key);
    for (const row of this.rows) {
      if (!this.isEdited(row)) {
        const latest = this.current(row);
        if (latest) Object.assign(row, latest);
      }
    }
    this.#refill();
  }
  review(latest: readonly TranslationTarget[], choices: Map<string, ReviewChoice>): void {
    const current = new Map(latest.map((row) => [translationKey(row), row]));
    const unresolved: TranslationTarget[] = [];
    for (const row of this.rows) {
      if (!this.isEdited(row)) continue;
      const key = translationKey(row);
      const next = current.get(key);
      if (!next || (this.changed(row) && !choices.has(key))) {
        unresolved.push(row);
        continue;
      }
      const choice = choices.get(key);
      if (choice === "discard" || choice === "replace") this.#values.delete(key);
      if (choice === "keep" && (!next.eligible || !sameValue(next.owners, row.owners))) {
        unresolved.push(row);
        continue;
      }
      if (
        choice === "keep" &&
        (!next.defaultRequired || this.#latestDefaultLanguage !== this.defaultLanguage)
      ) {
        const values = this.#values.get(key);
        if (values) values.defaultText = "";
      }
      Object.assign(row, next);
      if (next.eligible || this.#gaps.some((gap) => translationKey(gap) === key))
        unresolved.push(row);
    }
    this.rows = [
      ...this.#gaps.map(
        (row) => unresolved.find((held) => translationKey(held) === translationKey(row)) ?? row,
      ),
      ...unresolved.filter(
        (row) => !this.#gaps.some((gap) => translationKey(gap) === translationKey(row)),
      ),
    ];
    this.#targets.clear();
    for (const row of this.rows) this.#targets.set(translationKey(row), row);
    if (!this.rows.some((row) => this.changed(row)))
      this.defaultLanguage = this.#latestDefaultLanguage;
    this.#refill();
  }
  get count(): number {
    return this.submission().edits.length;
  }
  edit(ref: TranslationRef, field: "text" | "defaultText", text: string): void {
    const key = translationKey(ref);
    const row = this.#targets.get(key);
    if (!row?.eligible || (field === "defaultText" && !this.needsDefault(row))) return;
    if (!this.isEdited(ref) && !this.isSuggested(ref) && this.count >= 100) return;
    const next = {
      text: this.value(row, "text"),
      defaultText: this.value(row, "defaultText"),
      [field]: text,
    };
    const filled = this.#filled.get(key);
    if (filled?.text === next.text && filled.defaultText === next.defaultText)
      this.#values.delete(key);
    else this.#values.set(key, next);
  }
  needsDefault(row: TranslationTarget): boolean {
    return this.language !== this.defaultLanguage && row.defaultRequired;
  }
  value(ref: TranslationRef, field: "text" | "defaultText"): string {
    const key = translationKey(ref);
    return (
      this.#values.get(key)?.[field] ??
      this.#filled.get(key)?.[field] ??
      (field === "text" ? (this.#targets.get(key)?.selectedText ?? "") : "")
    );
  }
  /** A person's own edit; a suggestion filled in and left untouched is not one. */
  isEdited(ref: TranslationRef): boolean {
    const key = translationKey(ref);
    const row = this.#targets.get(key);
    const values = this.#values.get(key);
    if (!row || !values) return false;
    const text = values.text.trim();
    const companion = values.defaultText.trim();
    if (!text && !companion) return false;
    return text !== (row.selectedText ?? "").trim() || companion !== "";
  }
  isSuggested(ref: TranslationRef): boolean {
    const key = translationKey(ref);
    return this.#filled.has(key) && !this.#values.has(key) && this.#targets.has(key);
  }
  get suggestedCount(): number {
    return this.rows.filter((row) => this.isSuggested(row)).length;
  }
  /** Rows a waiting suggestion could fill that the 100-edit limit left empty. */
  get unfilledCount(): number {
    return this.rows.filter(
      (row) =>
        !this.#filled.has(translationKey(row)) &&
        !this.#values.has(translationKey(row)) &&
        this.#fillable(row) !== undefined,
    ).length;
  }
  suggestionFor(ref: TranslationRef): RowSuggestion | undefined {
    const found = this.#suggestions.get(translationKey(ref));
    if (!found || found.ids.every((id) => this.#dismissed.has(id))) return undefined;
    return found.ids.some((id) => this.#staleIds.has(id)) ? { ...found, stale: true } : found;
  }
  suggest(found: ReadonlyMap<string, RowSuggestion>): void {
    this.#suggestions = new Map(found);
    this.#refill();
  }
  unsuggest(ref: TranslationRef): void {
    for (const id of this.#suggestions.get(translationKey(ref))?.ids ?? []) this.#dismissed.add(id);
    this.#refill();
  }
  markStale(ref: TranslationRef): void {
    for (const id of this.#suggestions.get(translationKey(ref))?.ids ?? []) this.#staleIds.add(id);
    this.#refill();
  }
  #fillable(row: TranslationTarget): DraftValues | undefined {
    const found = this.suggestionFor(row);
    if (
      !row.eligible ||
      (row.effectiveSelectedText ?? "").trim() ||
      !found ||
      found.stale ||
      found.text === null
    )
      return undefined;
    if (!this.needsDefault(row)) return { text: found.text, defaultText: "" };
    return found.defaultText === null
      ? undefined
      : { text: found.text, defaultText: found.defaultText };
  }
  // Rows filled before keep their fill, so a refresh never moves the 100 drafts to other rows.
  #refill(): void {
    const previous = this.#filled;
    this.#filled = new Map();
    let room = 100 - this.personalSubmission().edits.length;
    const fill = (row: TranslationTarget): void => {
      const key = translationKey(row);
      if (this.#filled.has(key)) return;
      if (this.#values.has(key)) {
        const kept = previous.get(key);
        if (kept && this.#fillable(row)) this.#filled.set(key, kept);
        return;
      }
      if (room <= 0) return;
      const values = this.#fillable(row);
      if (!values) return;
      this.#filled.set(key, values);
      room--;
    };
    for (const row of this.rows) if (previous.has(translationKey(row))) fill(row);
    for (const row of this.rows) fill(row);
  }
  submission(): TranslationBatch {
    return this.#batch((row) => this.isEdited(row) || this.isSuggested(row));
  }
  personalSubmission(): TranslationBatch {
    return this.#batch((row) => this.isEdited(row));
  }
  #batch(include: (row: TranslationTarget) => boolean): TranslationBatch {
    return {
      edits: this.rows.filter(include).map((row) => ({
        kind: row.kind,
        id: row.id,
        expected: row.expected,
        text: this.value(row, "text").trim(),
        ...(this.needsDefault(row) && this.value(row, "defaultText").trim()
          ? { defaultText: this.value(row, "defaultText").trim() }
          : {}),
      })),
    };
  }
  validate(): FieldFault[] {
    const faults: FieldFault[] = [];
    for (const row of this.rows) {
      if (!this.isEdited(row) && !this.isSuggested(row)) continue;
      const target = { kind: row.kind, id: row.id };
      if (this.changed(row)) faults.push({ target, field: "text", message: "review" });
      const fields = this.needsDefault(row)
        ? (["text", "defaultText"] as const)
        : (["text"] as const);
      for (const field of fields) {
        const value = this.value(row, field).trim();
        if (!value) faults.push({ target, field, message: "required" });
        else if (new TextEncoder().encode(value).length > 4096)
          faults.push({ target, field, message: "name_bytes" });
      }
    }
    if (new TextEncoder().encode(JSON.stringify(this.submission())).length > 262144) {
      const first = this.submission().edits[0]!;
      faults.push({
        target: { kind: first.kind, id: first.id },
        field: "text",
        message: "batch_bytes",
      });
    }
    return faults;
  }
  reset(): void {
    this.#values.clear();
    this.#refill();
  }
}

export function indexSuggestions(
  views: readonly ContentSuggestionView[],
  language: string,
  defaultLanguage: string,
): Map<string, RowSuggestion> {
  const index = new Map<string, RowSuggestion>();
  for (const view of views) {
    const key = translationKey({ kind: view.kind, id: view.itemId });
    const entry = index.get(key) ?? {
      ids: [],
      text: null,
      defaultText: null,
      stale: false,
      placeholder: false,
      fixes: [],
    };
    entry.ids.push(view.id);
    if (view.placeholder) entry.placeholder = true;
    if (view.fix) entry.fixes.push(view.fix);
    if (view.text !== null && (view.language === language || view.language === defaultLanguage)) {
      if (view.language === language) entry.text = view.text;
      else entry.defaultText = view.text;
      entry.stale ||= view.stale;
    }
    index.set(key, entry);
  }
  return index;
}

export function translationKey(ref: TranslationRef): string {
  return `${ref.kind}:${ref.id}`;
}
