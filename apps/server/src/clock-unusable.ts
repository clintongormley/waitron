import type { FiscalBackend, TrustedReading } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";

/** Whether the seat would refuse any record stamped with `reading` as `clock.unusable` (before
 * 28-10-2024); any other refusal is thrown. */
export function clockUnusableAt(
  backend: Pick<FiscalBackend, "assertRecordableAt">,
  reading: Pick<TrustedReading, "instant" | "offsetMinutes">,
): boolean {
  try {
    backend.assertRecordableAt(reading);
    return false;
  } catch (error) {
    if (codeOf(error) === "clock.unusable") return true;
    throw error;
  }
}
