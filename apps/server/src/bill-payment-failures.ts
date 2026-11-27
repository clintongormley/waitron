import { isUniqueViolation } from "@waitron/db";
import { IssuanceRefusedError } from "@waitron/fiscal";
import { ChargeNotSavedError } from "@waitron/payments";
import type { Logger } from "./logger.js";
import { AppError, diskFullIn, firstCodeInCauseChain } from "@waitron/shared";
import "./errors.js";

/** A post-capture refusal must not describe a completed charge as declined. */
export async function afterCardCharged<T>(
  deps: { sayCardChargedNotRecorded?: boolean; log?: Logger },
  workingOrderId: string,
  work: () => Promise<T>,
): Promise<T> {
  if (deps.sayCardChargedNotRecorded !== true) return work();
  try {
    return await work();
  } catch (error) {
    const reason = notRecordedReason(error);
    if (reason === null) throw error;
    const recoveryUrl =
      error instanceof IssuanceRefusedError
        ? (error.params as Record<string, unknown>).recoveryUrl
        : undefined;
    throw chargedNotRecorded(
      deps.log,
      workingOrderId,
      reason,
      typeof recoveryUrl === "string" ? recoveryUrl : undefined,
    );
  }
}

export function clockUnconfirmedRefusal(error: unknown): boolean {
  return error instanceof AppError && error.code === "clock.unconfirmed";
}
function notRecordedReason(error: unknown): NotRecordedReason | null {
  if (error instanceof IssuanceRefusedError || isUniqueViolation(error)) return "issuance_refused";
  if (diskFullIn(error) || firstCodeInCauseChain(error, (code) => code === "ENOSPC") !== null)
    return "disk_full";
  if (error instanceof AppError && error.code === "clock.unusable") return "clock_unusable";
  if (clockUnconfirmedRefusal(error)) return "clock_unconfirmed";
  return null;
}
/**
 * What a failed `collect` is answered with. When `deps` opts in, a charge the provider could not
 * save for a full disk ({@link ChargeNotSavedError}) becomes `sale.charged_not_recorded`; any
 * other failure, a full disk before the charge among them, passes through unchanged.
 */
export function collectFailure(
  deps: { sayCardChargedNotRecorded?: boolean; log?: Logger },
  workingOrderId: string,
  error: unknown,
): unknown {
  if (deps.sayCardChargedNotRecorded !== true || !(error instanceof ChargeNotSavedError)) {
    return error;
  }
  return chargedNotRecorded(deps.log, workingOrderId, "disk_full");
}
type NotRecordedReason = "disk_full" | "clock_unusable" | "clock_unconfirmed" | "issuance_refused";
/** Carries no cause: the error boundary answers `storage.disk_full` for any full disk in the chain. */
function chargedNotRecorded(
  log: Logger | undefined,
  workingOrderId: string,
  reason: NotRecordedReason,
  recoveryUrl?: string,
): AppError {
  log?.("error", "sale.charged_not_recorded", { workingOrderId });
  return new AppError("sale.charged_not_recorded", {
    workingOrderId,
    reason,
    ...(recoveryUrl === undefined ? {} : { recoveryUrl }),
  });
}
