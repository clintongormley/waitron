export type ValidationFailureReason = "empty" | "format" | "checksum" | "unsupported";

export type ValidationResult<Kind extends string> =
  | { readonly valid: true; readonly normalized: string; readonly kind: Kind }
  | { readonly valid: false; readonly reason: ValidationFailureReason };

export interface ValueValidator<Kind extends string> {
  readonly label?: string;
  validate(value: string): ValidationResult<Kind>;
}

export interface AdministrativeArea {
  readonly code: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly postalPrefixes: readonly string[];
  readonly defaultLocale?: string;
  readonly timeZone?: string;
}

export interface FiscalModules {
  readonly filing: string;
  readonly tax: string;
}

export interface FiscalJurisdiction {
  readonly id: string;
  readonly areaCodes: readonly string[];
  readonly supported: boolean;
  readonly modules?: FiscalModules;
}

export interface CountryPack {
  readonly countryCode: string;
  readonly name: string;
  readonly defaultLocale: string;
  readonly defaultTimeZone: string;
  readonly invoiceLocales: readonly string[];
  readonly moduleIds: readonly string[];
  /** Whether this pack has enough validated fiscal behavior to create a venue in the setup wizard. */
  readonly availableForVenueSetup: boolean;
  readonly administrativeAreas: readonly AdministrativeArea[];
  readonly fiscalJurisdictions: readonly FiscalJurisdiction[];
  readonly defaultFiscalJurisdictionId?: string;
  readonly taxIdentifier?: ValueValidator<string>;
  readonly postalCode?: ValueValidator<"postal-code">;
  readonly telephone?: ValueValidator<string>;
}

export interface AddressSuggestion {
  readonly id: string;
  readonly label: string;
  readonly secondaryLabel?: string;
}

export interface ResolvedAddress {
  readonly lines: readonly string[];
  readonly locality: string;
  readonly administrativeAreaCode?: string;
  readonly postalCode: string;
  readonly countryCode: string;
}

/** A browser-facing seam; provider credentials stay behind whichever implementation supplies it. */
export interface AddressAutocompleteProvider {
  suggest(input: {
    readonly query: string;
    readonly countryCode: string;
    readonly sessionToken: string;
  }): Promise<readonly AddressSuggestion[]>;
  resolve(input: {
    readonly suggestionId: string;
    readonly sessionToken: string;
  }): Promise<ResolvedAddress>;
}

function comparisonKey(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]/g, "");
}

export function findAdministrativeArea(
  pack: CountryPack,
  value: string,
): AdministrativeArea | undefined {
  const key = comparisonKey(value);
  if (key === "") return undefined;
  return pack.administrativeAreas.find((area) =>
    [area.code, area.name, ...(area.aliases ?? [])].some(
      (candidate) => comparisonKey(candidate) === key,
    ),
  );
}

export function findAdministrativeAreaByPostalCode(
  pack: CountryPack,
  postalCode: string,
): AdministrativeArea | undefined {
  const normalized = postalCode.trim();
  let match: { readonly area: AdministrativeArea; readonly prefixLength: number } | undefined;
  for (const area of pack.administrativeAreas) {
    for (const prefix of area.postalPrefixes) {
      if (normalized.startsWith(prefix) && prefix.length > (match?.prefixLength ?? -1)) {
        match = { area, prefixLength: prefix.length };
      }
    }
  }
  return match?.area;
}

export function resolveFiscalJurisdiction(
  pack: CountryPack,
  areaCode: string | null | undefined,
): FiscalJurisdiction | undefined {
  const areaJurisdiction =
    areaCode == null
      ? undefined
      : pack.fiscalJurisdictions.find(({ areaCodes }) => areaCodes.includes(areaCode));
  if (areaJurisdiction !== undefined) return areaJurisdiction;
  return pack.fiscalJurisdictions.find(({ id }) => id === pack.defaultFiscalJurisdictionId);
}

export function resolveCountryLocale<Locale extends string>(
  pack: CountryPack,
  availableLocales: readonly Locale[],
  input: {
    readonly override?: string | null;
    readonly area?: string | null;
    readonly fallback: Locale;
  },
): Locale {
  const area = input.area == null ? undefined : findAdministrativeArea(pack, input.area);
  const candidates = [
    input.override ?? undefined,
    area?.defaultLocale,
    pack.defaultLocale,
    input.fallback,
  ];
  return (
    candidates.find((candidate): candidate is Locale =>
      candidate === undefined ? false : (availableLocales as readonly string[]).includes(candidate),
    ) ??
    availableLocales[0] ??
    input.fallback
  );
}
