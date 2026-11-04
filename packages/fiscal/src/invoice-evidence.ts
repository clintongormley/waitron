export interface InvoiceEvidenceScope {
  taxpayerId: string;
  environment: string;
  series: string;
}

/** A receipt observation only; it cannot reserve or reactivate an invoice series. */
export interface InvoiceEvidence extends InvoiceEvidenceScope {
  invoiceNumber: string;
  issuedDate: string;
  fingerprint: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evidenceFrom(value: unknown): InvoiceEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const { taxpayerId, environment, series, invoiceNumber, issuedDate, fingerprint } = value;
  if (
    typeof taxpayerId !== "string" ||
    taxpayerId === "" ||
    typeof environment !== "string" ||
    environment === "" ||
    typeof series !== "string" ||
    series === "" ||
    typeof invoiceNumber !== "string" ||
    !invoiceNumber.startsWith(`${series}/`) ||
    !/^[1-9][0-9]*$/.test(invoiceNumber.slice(series.length + 1)) ||
    typeof issuedDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(issuedDate) ||
    typeof fingerprint !== "string" ||
    fingerprint === ""
  )
    return undefined;
  const date = new Date(`${issuedDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== issuedDate)
    return undefined;
  return { taxpayerId, environment, series, invoiceNumber, issuedDate, fingerprint };
}

function key(scope: InvoiceEvidenceScope): string {
  return `waitron.invoiceEvidence.v1:${JSON.stringify([scope.taxpayerId, scope.environment, scope.series])}`;
}

export function readInvoiceEvidence(scope: InvoiceEvidenceScope): InvoiceEvidence | undefined {
  try {
    const stored = localStorage.getItem(key(scope));
    const value = evidenceFrom(stored === null ? undefined : JSON.parse(stored));
    return value?.taxpayerId === scope.taxpayerId &&
      value.environment === scope.environment &&
      value.series === scope.series
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function rememberInvoiceEvidence(answer: unknown): void {
  if (!isRecord(answer)) return;
  const ticket = isRecord(answer.ticket)
    ? answer.ticket
    : isRecord(answer.invoice)
      ? answer.invoice
      : answer;
  const value = evidenceFrom(ticket.invoiceEvidence);
  if (value === undefined) return;
  const previous = readInvoiceEvidence(value);
  if (
    previous !== undefined &&
    BigInt(previous.invoiceNumber.slice(previous.series.length + 1)) >
      BigInt(value.invoiceNumber.slice(value.series.length + 1))
  )
    return;
  try {
    localStorage.setItem(key(value), JSON.stringify(value));
  } catch {
    /* Optional evidence cannot refuse a completed sale. */
  }
}

export function readInvoiceEvidenceReport(
  scope: Pick<InvoiceEvidenceScope, "taxpayerId" | "environment">,
): InvoiceEvidence[] {
  const observations: InvoiceEvidence[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const storedKey = localStorage.key(index);
      if (storedKey === null || !storedKey.startsWith("waitron.invoiceEvidence.v1:")) continue;
      try {
        const stored = localStorage.getItem(storedKey);
        const value = evidenceFrom(stored === null ? undefined : JSON.parse(stored));
        if (
          value !== undefined &&
          value.taxpayerId === scope.taxpayerId &&
          value.environment === scope.environment &&
          storedKey === key(value)
        )
          observations.push(value);
      } catch {
        // One damaged observation must not hide the other series.
      }
    }
  } catch {
    return [];
  }
  return observations.sort((a, b) => a.series.localeCompare(b.series));
}
