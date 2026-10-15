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
