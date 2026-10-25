import type { Transaction } from "@waitron/db";
import { readPrintedThemeLogo, readThemeInUse, type PrintedThemeLogo } from "@waitron/layouts";
import type { PrintedDepartmentReceipt } from "@waitron/module";
import type { PaperWidth } from "@waitron/printing";
import type { ReceiptLogoRaster, VenueReceiptConfig } from "@waitron/shared";

export type ReceiptReadDiagnostic = (event: { operation: string; code: string }) => void;

function report(diagnostic: ReceiptReadDiagnostic, operation: string): void {
  try {
    diagnostic({ operation, code: "receipt.read_failed" });
  } catch {
    /* Diagnostics must not turn an optional read failure into a sale failure. */
  }
}

export function venueLogoMayPrint(department: PrintedDepartmentReceipt | null): boolean {
  if (department === null) return true;
  return department.unreadable !== true && department.receipt.logo === undefined;
}

/** The theme in use's logo for one paper, or `null`; a failed read reports and answers `null`. */
export async function readVenueLogo(
  tx: Transaction,
  paperWidth: PaperWidth,
  diagnostic: ReceiptReadDiagnostic,
): Promise<PrintedThemeLogo | null> {
  try {
    return await readPrintedThemeLogo(tx, paperWidth);
  } catch {
    report(diagnostic, "readPrintedThemeLogo");
    return null;
  }
}

/** What a printed document takes: the venue side for `resolveReceiptTrim`, and the dots to print. */
export async function resolvePrintedLogo(
  tx: Transaction,
  department: PrintedDepartmentReceipt | null,
  paperWidth: PaperWidth,
  diagnostic: ReceiptReadDiagnostic,
): Promise<{ venue: VenueReceiptConfig; logo: ReceiptLogoRaster | null }> {
  if (!venueLogoMayPrint(department)) return { venue: {}, logo: department?.logo ?? null };
  const theme = await readVenueLogo(tx, paperWidth, diagnostic);
  return theme === null
    ? { venue: {}, logo: null }
    : { venue: { logo: theme.name }, logo: theme.picture };
}

/** The ticket view's venue side: the theme in use's light name, when it may print. */
export async function readVenueLogoName(
  tx: Transaction,
  department: PrintedDepartmentReceipt | null,
  diagnostic: ReceiptReadDiagnostic,
): Promise<VenueReceiptConfig> {
  if (!venueLogoMayPrint(department)) return {};
  try {
    const light = (await readThemeInUse(tx))?.choices?.logo?.light;
    return light === undefined ? {} : { logo: light };
  } catch {
    report(diagnostic, "readThemeInUse");
    return {};
  }
}
