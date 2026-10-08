import { sameValue } from "./product-editor-model.js";
import type { TranslationBatch, TranslationRef, TranslationTarget } from "../api/client.js";

export interface FieldFault {
  target: TranslationRef;
  field: "text" | "defaultText";
  message: string;
}

export type ReviewChoice = "keep" | "replace" | "discard";

export class TranslationDrafts {
  #latest = new Map<string, TranslationTarget>();
  #receivedSnapshot = false;
  #gaps: readonly TranslationTarget[] = [];
  #latestDefaultLanguage: string;
  readonly #targets: Map<string, TranslationTarget>;
  readonly #values = new Map<string, { text: string; defaultText: string }>();
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
    if (!this.count) this.defaultLanguage = defaultLanguage;
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
  }
  get count(): number {
    return this.submission().edits.length;
  }
  edit(ref: TranslationRef, field: "text" | "defaultText", text: string): void {
    const key = translationKey(ref);
    const row = this.#targets.get(key);
    if (!row?.eligible || (field === "defaultText" && !this.needsDefault(row))) return;
    if (!this.isEdited(ref) && this.count >= 100) return;
    this.#values.set(key, {
      text: this.value(row, "text"),
      defaultText: this.value(row, "defaultText"),
      [field]: text,
    });
  }
  needsDefault(row: TranslationTarget): boolean {
    return this.language !== this.defaultLanguage && row.defaultRequired;
  }
  value(ref: TranslationRef, field: "text" | "defaultText"): string {
    return (
      this.#values.get(translationKey(ref))?.[field] ??
      (field === "text" ? (this.#targets.get(translationKey(ref))?.selectedText ?? "") : "")
    );
  }
  isEdited(ref: TranslationRef): boolean {
    const row = this.#targets.get(translationKey(ref));
    if (!row) return false;
    const text = this.value(row, "text").trim();
    const companion = this.value(row, "defaultText").trim();
    if (!text && !companion) return false;
    return text !== (row.selectedText ?? "").trim() || companion !== "";
  }
  submission(): TranslationBatch {
    return {
      edits: this.rows
        .filter((row) => this.isEdited(row))
        .map((row) => ({
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
      if (!this.isEdited(row)) continue;
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
  }
}

export function translationKey(ref: TranslationRef): string {
  return `${ref.kind}:${ref.id}`;
}
