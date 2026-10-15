import type { TranslationGapKind } from "./content-translation-report-types.js";

export interface SuggestionResult {
  ref: string;
  names: Record<string, string>;
  placeholder: boolean;
  corrections: { field: string; wrong: string; right: string }[];
}
export interface SuggestionResults {
  state: "done" | "partly_done";
  results: SuggestionResult[];
  failed: string[];
  /** Copied by the runner from the status reply; collect's reply carries no reason. */
  reason?: "limit_reached" | "provider_failed";
}

/** One item of a job's `items` (contract, "Submit"); a context head has `missing: []`. */
export interface SuggestionItem {
  ref: string;
  kind: TranslationGapKind;
  family: string;
  category: string | null;
  staffName: string;
  existing: Record<string, string>;
  missing: string[];
}

/** One saved name of the job's `houseStyle`. */
export interface HouseStyleExample {
  kind: TranslationGapKind;
  staffName: string;
  names: Record<string, string>;
}
