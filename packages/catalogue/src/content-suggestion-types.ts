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

export type SuggestionRunState =
  "sending" | "running" | "done" | "partly_done" | "failed" | "expired" | "refused";

export interface SuggestionRunView {
  state: SuggestionRunState;
  /** Items with languages to write across the run; context heads are never counted. */
  total: number;
  /** `done + failed`, summed over the run's jobs. */
  progress: number;
  done: number;
  failed: number;
  code: string | null;
  fits: number | null;
  /** Suggestions with text waiting in the table. */
  waiting: number;
  finishedAt: string | null;
  opened: boolean;
}

export interface ContentSuggestionView {
  id: string;
  kind: TranslationGapKind;
  itemId: string;
  language: string | null;
  text: string | null;
  placeholder: boolean;
  fix: { field: string; wrong: string; right: string } | null;
  stale: boolean;
}

export interface ContentSuggestionPage {
  language: string;
  run: SuggestionRunView | null;
  suggestions: ContentSuggestionView[];
  next: string | null;
}

/** The GET route's reply; the server fills the two fields the catalogue cannot know. */
export interface ContentSuggestionRead extends ContentSuggestionPage {
  service: "on" | "off" | "not_connected";
  cloudOrigin: string | null;
}
