import type { TranslationBatch, TranslationRef, TranslationTarget } from "../api/client.js";

export interface FieldFault {
  target: TranslationRef;
  field: "text" | "defaultText";
  message: string;
}

export class TranslationDrafts {
  readonly #targets: Map<string, TranslationTarget>;
  readonly #values = new Map<string, { text: string; defaultText: string }>();
  constructor(
    readonly language: string,
    readonly defaultLanguage: string,
    readonly rows: readonly TranslationTarget[],
  ) {
    this.#targets = new Map(rows.map((row) => [translationKey(row), row]));
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
