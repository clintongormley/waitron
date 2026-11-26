import type { PrintJobRow, PrintJobStatus } from "../api/printing-api.js";
import { holdReason } from "../i18n/a4-holds.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import { pageFailureReason } from "../widgets/page-test-pages.js";

type DisplayStatus = PrintJobStatus | "held";

export const JOB_STATUSES: readonly DisplayStatus[] = [
  "queued",
  "printing",
  "held",
  "done",
  "failed",
  "unknown",
];

export function jobStatus(job: PrintJobRow): DisplayStatus {
  return job.printerHold == null ? job.status : "held";
}

/** The `last_error` codes of a job the server ended itself, setting its attempts to the cap. */
export const ENDED_BY_SERVER = new Set([
  "printer.deleted",
  "print_job.moved",
  "receipt.out_of_date",
]);

const LOCALIZED_JOB_REASONS = new Set([
  ...ENDED_BY_SERVER,
  "print_job.drawer_expired",
  "print_job.drawer_outcome_unknown",
]);

export const jobReason = (lastError: string): string =>
  LOCALIZED_JOB_REASONS.has(lastError) ? codeMessage(lastError) : lastError;

export function jobWaitMessage(job: PrintJobRow): string | undefined {
  if (job.waitReason !== undefined) return codeMessage(job.waitReason);
  if (job.printerHold == null) return undefined;
  if (job.printerHold === "paper_out")
    return fill("printers.job_paper_out", { printer: job.printerName });
  const reason = holdReason(job.printerHold);
  return reason === undefined
    ? undefined
    : fill("printers.job_held", { printer: job.printerName, reason });
}

export function jobErrorMessage(job: PrintJobRow): string | undefined {
  if (job.lastError === null) return undefined;
  if (job.kind === "a4" && job.lastError === "switched")
    return t("printers.job_switched_to_receipt");
  return job.kind === "a4" ? pageFailureReason(job.lastError) : jobReason(job.lastError);
}
