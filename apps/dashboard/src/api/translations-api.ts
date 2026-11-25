import type { DashboardRequest } from "@waitron/dashboard-kit";
import type {
  TranslationCellRef,
  TranslationCellPage,
  TranslationQuery,
  TranslationItemPage,
  SuggestionRunView,
  ContentSuggestionQuery,
  ContentSuggestionRead,
  TranslationBatch,
  TranslationCell,
} from "@waitron/menu";
import type {
  ContentLanguages,
  ContentLanguageRules,
  LanguageTranslationGapCount,
} from "@waitron/shared";
import { CatalogApi } from "./catalog-api.js";

export class TranslationsApi extends CatalogApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  getContentLanguages(): Promise<ContentLanguages> {
    return this.#request<ContentLanguages>("/api/content-languages", "GET");
  }
  getContentLanguageRules(): Promise<ContentLanguageRules> {
    return this.#request<ContentLanguageRules>("/management-api/content-language-rules", "GET");
  }
  getContentTranslationGaps(): Promise<LanguageTranslationGapCount[]> {
    return this.#request<LanguageTranslationGapCount[]>(
      "/management-api/content-translation-gaps",
      "GET",
    );
  }
  getContentTranslationCells(cells: readonly TranslationCellRef[]): Promise<TranslationCellPage> {
    const params = new URLSearchParams(
      cells.map(({ kind, id, language, field }) => [
        "cell",
        JSON.stringify([kind, id, language, field]),
      ]),
    );
    return this.#request(`/management-api/content-translations/cells?${params}`, "GET");
  }
  getContentTranslationTargets(query: TranslationQuery): Promise<TranslationItemPage> {
    const params = new URLSearchParams();
    for (const code of query.languages) params.append("language", code);
    if ("targets" in query) {
      for (const ref of query.targets) params.append("target", `${ref.kind}:${ref.id}`);
    } else {
      params.append("missing", query.missing.mode);
      if (query.missing.mode === "language")
        params.append("missingLanguage", query.missing.language);
      if (query.kind !== undefined) params.append("kind", query.kind);
      if (query.search !== undefined) params.append("search", query.search);
      if (query.after !== undefined) params.append("after", query.after);
      if (query.waitingFixes) params.append("waitingFixes", "1");
    }
    return this.#request(`/management-api/content-translations?${params}`, "GET");
  }
  startContentSuggestions(): Promise<{ run: SuggestionRunView | null }> {
    return this.#request("/management-api/content-suggestions/jobs", "POST", {});
  }
  getContentSuggestions(query: ContentSuggestionQuery = {}): Promise<ContentSuggestionRead> {
    const params = new URLSearchParams();
    if (query.after !== undefined) params.append("after", query.after);
    if (query.configuration !== undefined) params.append("configuration", query.configuration);
    if (query.fixesOnly) params.append("fixesOnly", "1");
    const suffix = params.size ? `?${params}` : "";
    return this.#request(`/management-api/content-suggestions${suffix}`, "GET");
  }
  discardContentSuggestion(id: string): Promise<{ deleted: string }> {
    return this.#request(
      `/management-api/content-suggestions/${encodeURIComponent(id)}`,
      "DELETE",
      undefined,
      { timeLimitMs: 30_000 },
    );
  }
  saveContentTranslations(batch: TranslationBatch): Promise<{ saved: TranslationCell[] }> {
    return this.#request("/management-api/content-translations", "PUT", batch);
  }
  updateContentLanguages(config: ContentLanguages): Promise<void> {
    return this.#request<void>("/management-api/content-languages", "PUT", config);
  }
}
