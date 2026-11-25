export type { AllergenDeclaration as AllergenEntry } from "@waitron/shared";
import type { VenueThemeAnswer } from "@waitron/ui";
export type { MenuDefaults } from "@waitron/menu/src/settings-types.js";

export type { Setting, CombinedOffer, ValueSource, Place } from "@waitron/shared";

import type { FreshSignInGate } from "./fresh-sign-in.js";

import {
  createRequest,
  LiveData,
  type DashboardRequest,
  type FetchLike,
} from "@waitron/dashboard-kit";
export type {
  Product,
  ProductEditorValue,
  ProductVariantInput as ProductEditorVariant,
  ProductEditorBody as ProductEditorInput,
} from "@waitron/shared";
export type { DepartmentReceiptModel as DepartmentReceiptSettings } from "./department-receipts.js";

export type {
  HomeTile,
  IncludeFolder,
  IncludeFolderInput,
  IncludeFolderOverrides,
  MenuHome,
  SectionDetails,
  MemberRef,
  SectionInput,
  SectionMember,
} from "@waitron/shared";
export type {
  LanguageTranslationGaps,
  LanguageTranslationGapCount,
  TranslationGap,
  TranslationGapKind,
  TranslationGapReason,
} from "@waitron/shared";
export type {
  TranslationBatch,
  TranslationCellRef,
  TranslationCellPage,
  TranslationRef,
  TranslationQuery,
} from "@waitron/menu/src/content-translation-types.js";
export type {
  ContentSuggestionQuery,
  ContentSuggestionRead,
  ContentSuggestionView,
  SuggestionRunView,
} from "@waitron/menu/src/content-suggestion-types.js";

import type { MenuReadRevision } from "./menu-api.js";
import type { ThemeLogoPrint } from "./email-theme-api.js";
import type { VenueClockPreview, BusinessDayStartPreview } from "./venue-api.js";
import { StaffApi } from "./staff-api.js";
export type { MenuPriceRow, MenuPriceVariant } from "@waitron/shared";
export type {
  MenuPatchChange,
  MenuPatchResult,
  MenuPatchTarget,
  PatchDraftAnswer,
} from "@waitron/menu/src/menu-patch-types.js";
export type {
  DocumentMember,
  FrozenOffer,
  HomeOrder,
  LocalTime,
  MenuChange,
  MenuDocument,
  MenuPreview,
  MenuPublicationsAnswer,
  MenuStatus,
  ProductChangeField,
  PublishedMenuVersion,
  QueuedEdition,
  SectionChangeField,
} from "@waitron/shared";

export type {
  ExtraList,
  ExtraListDependants,
  ExtraListInput,
  ExtraListItem,
  ExtraListItemInput,
  ExtraListRow,
  OptionLabel,
  OptionLabelInput,
  OptionList,
  OptionListDependants,
  OptionListInput,
  OptionListSaveBody,
  OptionListRow,
} from "@waitron/shared";

export { DIETARY_LABELS, DIETARY_SUITABILITY } from "@waitron/shared";
export type { DietaryLabel, DietarySuitability, ContainsTag, DietOverride } from "@waitron/shared";

export type { DashboardMenuSummary, SetMenuDetails } from "@waitron/menu";
export type { SetMenuLine } from "@waitron/shared";

export type { PlanPlacement, PlanShape } from "@waitron/ui";

export class DashboardApi extends StaffApi {
  readonly liveData = new LiveData();
  #menuRevision: { value?: MenuReadRevision } = {};
  get menuWriteRevision(): MenuReadRevision | undefined {
    return this.#menuRevision.value;
  }
  #background?: DashboardApi;
  #onError?: (code: string, generation?: number) => void;

  get background(): DashboardApi {
    if (this.#background) return this.#background;
    this.#background = new DashboardApi(
      this.#baseUrl,
      this.#fetch,
      this.#onError,
      undefined,
      true,
      this.options,
    );
    this.#background.#menuRevision = this.#menuRevision;
    return this.#background;
  }
  readonly #request: DashboardRequest;
  /** The same request without the fresh sign-in gate's prompt and resend. */
  readonly #requestWithoutPrompt: DashboardRequest;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  #localesPromise?: Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
    loginDefault: string;
    venueName: string;
    onboardingIntent?: "demo" | "prepare" | "live";
  }>;

  constructor(
    baseUrl = "",
    fetchImpl: FetchLike = fetch,
    onError?: (code: string, generation?: number) => void,
    onSuccess?: (path: string, generation?: number) => void,
    passive = false,
    private readonly options: {
      sessionGeneration?: () => number;
      freshSignIn?: FreshSignInGate;
    } = {},
  ) {
    super(<T>(...args: Parameters<DashboardRequest>) => this.#request<T>(...args));
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
    this.#onError = onError;
    const observedFetch: FetchLike = async (path, init) => {
      const response = await fetchImpl(path, init);
      if (init.method !== "GET" && response.ok) {
        let revision: unknown;
        try {
          revision = JSON.parse(response.headers.get("x-waitron-menu-revision") ?? "null");
        } catch {
          revision = null;
        }
        if (
          revision !== null &&
          typeof revision === "object" &&
          "epoch" in revision &&
          typeof revision.epoch === "string" &&
          "sequence" in revision &&
          typeof revision.sequence === "number" &&
          Number.isSafeInteger(revision.sequence) &&
          revision.sequence >= 0
        ) {
          const previous = this.#menuRevision.value;
          if (previous?.epoch !== revision.epoch || previous.sequence < revision.sequence)
            this.#menuRevision.value = { epoch: revision.epoch, sequence: revision.sequence };
        } else this.#menuRevision.value = undefined;
      }
      return response;
    };
    const request = createRequest({
      baseUrl,
      fetchImpl: observedFetch,
      onError,
      onSuccess,
      passive,
      sessionGeneration: options.sessionGeneration,
    });
    this.#requestWithoutPrompt = request;
    this.#request = options.freshSignIn?.wrap(request, passive) ?? request;
  }

  getLocales(): Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
    loginDefault: string;
    venueName: string;
    onboardingIntent?: "demo" | "prepare" | "live";
  }> {
    this.#localesPromise ??= this.#request<{
      locales: Array<{ code: string; label: string }>;
      venueDefault: string;
      loginDefault: string;
      venueName: string;
      onboardingIntent?: "demo" | "prepare" | "live";
    }>("/management-api/locales", "GET").catch((err) => {
      this.#localesPromise = undefined;
      throw err;
    });
    return this.#localesPromise;
  }

  forgetLocales(): void {
    this.#localesPromise = undefined;
  }

  getVenueTheme(): Promise<VenueThemeAnswer> {
    return this.background.#request<VenueThemeAnswer>("/api/theme", "GET");
  }

  getThemeLogoPrint(image: string): Promise<ThemeLogoPrint> {
    const query = new URLSearchParams({ image });
    return this.background.#request<ThemeLogoPrint>(
      `/management-api/theme-logo-print?${query}`,
      "GET",
    );
  }

  get imageLibraryRequest(): DashboardRequest {
    return this.#request;
  }

  getVenueClockPreview(clock: {
    timeZone: string;
    dayCutover: string;
  }): Promise<VenueClockPreview> {
    const query = new URLSearchParams(clock);
    return this.background.#request(`/management-api/venue-details/clock-preview?${query}`, "GET");
  }

  previewBusinessDayStart(input: {
    dayCutover: string;
    expectedClockRevision: number;
  }): Promise<BusinessDayStartPreview> {
    const query = new URLSearchParams({
      dayCutover: input.dayCutover,
      expectedClockRevision: String(input.expectedClockRevision),
    });
    return this.background.#request(
      `/management-api/venue-details/business-day-start/preview?${query}`,
      "GET",
    );
  }

  /** The browser downloads this address itself, so the file never passes through the page. */
  taxOfficeMonthFileUrl(id: string): string {
    return `${this.#baseUrl}/management-api/tax-office/month-download/${encodeURIComponent(id)}/file`;
  }

  /** With `askForSignIn: false` a stale sign-in is refused as it is, opening no prompt. */
  approveBoxJoin(requestId: string, { askForSignIn = true } = {}): Promise<void> {
    return (askForSignIn ? this.#request : this.#requestWithoutPrompt)(
      `/management-api/box-joins/${encodeURIComponent(requestId)}/approve`,
      "POST",
    );
  }
}
