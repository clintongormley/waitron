export type ReceiptText = Readonly<Record<string, string>>;

export interface DepartmentReceiptConfig {
  logo?: string;
  phone?: string;
  email?: string;
  headerSubtitle?: ReceiptText;
  footerMessage?: ReceiptText;
}

export interface PrintedReceiptTrim {
  logo?: string;
  phone?: string;
  email?: string;
  headerSubtitle?: string;
  footerMessage?: string;
}

export interface VenueReceiptSettings {
  logo?: string;
  headerSubtitle?: string;
  footerMessage?: string;
  printAddress?: boolean;
}

export interface VenueReceiptConfig extends VenueReceiptSettings {
  phone?: string;
  email?: string;
}

export interface ReceiptPresentation {
  receiptTrim: PrintedReceiptTrim;
  venueAddress: readonly string[];
  venueReceiptSettings: VenueReceiptSettings;
}

function writtenText(text: ReceiptText | undefined, language: string): string | undefined {
  if (text === undefined || !Object.hasOwn(text, language)) return undefined;
  const value = text[language];
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

export function resolveReceiptText(
  text: ReceiptText | undefined,
  printedLanguage: string,
  currentReceiptLanguage: string,
): string | undefined {
  return writtenText(text, printedLanguage) ?? writtenText(text, currentReceiptLanguage);
}

export function receiptLogoSource(
  department: DepartmentReceiptConfig | null,
  venue: VenueReceiptConfig,
): "department" | "venue" | null {
  if (department?.logo) return "department";
  return venue.logo ? "venue" : null;
}

/** Null renders venue-only; an empty department inherits only its logo and optional texts. */
export function resolveReceiptTrim(
  department: DepartmentReceiptConfig | null,
  venue: VenueReceiptConfig,
  printedLanguage: string,
  currentReceiptLanguage: string,
): PrintedReceiptTrim {
  const result: PrintedReceiptTrim = {};
  const contact = department ?? venue;
  for (const field of ["phone", "email"] as const) {
    if (contact[field] !== undefined) result[field] = contact[field];
  }
  const logo = department?.logo || venue.logo;
  if (logo) result.logo = logo;
  for (const field of ["headerSubtitle", "footerMessage"] as const) {
    const text =
      resolveReceiptText(department?.[field], printedLanguage, currentReceiptLanguage) ??
      venue[field];
    if (text !== undefined) result[field] = text;
  }
  return result;
}

export function untranslatedLanguages(
  texts: readonly (ReceiptText | undefined)[],
  languages: readonly string[],
): string[] {
  const written = texts.filter((text) =>
    languages.some((language) => writtenText(text, language) !== undefined),
  );
  return languages.filter((language) =>
    written.some((text) => writtenText(text, language) === undefined),
  );
}
