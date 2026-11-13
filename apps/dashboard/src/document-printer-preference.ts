export type PrintedDocument = "receipt" | "invoice";
const prefix = "waitron-dashboard-document-printer:";
const session: Partial<Record<PrintedDocument, string>> = {};

export function readDocumentPrinter(document: PrintedDocument): string | null {
  try {
    return session[document] ?? (window.localStorage.getItem(`${prefix}${document}`) || null);
  } catch {
    return session[document] ?? null;
  }
}

export function rememberDocumentPrinter(document: PrintedDocument, printerId: string): void {
  try {
    window.localStorage.setItem(`${prefix}${document}`, printerId);
    delete session[document];
  } catch {
    session[document] = printerId;
  }
}
