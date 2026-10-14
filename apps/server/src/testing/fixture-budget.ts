import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";

export interface FixtureBudget {
  reserveUpload: (bytes: number, role: string) => void;
  reserveObjects: (count: number) => void;
}

function nonNegativeInteger(value: number, what: string, refuse: (detail: string) => Error): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw refuse(`${what} must be a non-negative integer`);
  }
}

/**
 * The byte and object budgets of {@link AWS_REHEARSAL_LIMITS}, used by both the AWS rehearsal and
 * the local S3 fixture. A reservation over budget is recorded, then thrown as `refuse(detail)`; a
 * value that is not a non-negative integer is thrown without a record. A refusal spends nothing.
 */
export function fixtureBudget(
  record: (event: object) => void,
  refuse: (detail: string) => Error,
): FixtureBudget {
  let uploaded = 0;
  let objects = 0;
  return {
    reserveUpload: (bytes, role) => {
      nonNegativeInteger(bytes, "bytes", refuse);
      const overTotal = uploaded + bytes > AWS_REHEARSAL_LIMITS.uploadedBytes;
      const overArchive = role === "archive" && bytes > AWS_REHEARSAL_LIMITS.archiveBytes;
      if (overTotal || overArchive) {
        record({
          scenario: "lifecycle",
          phase: "fixture-limit",
          objectRole: role,
          bytes,
          outcome: "refused",
        });
        throw refuse(
          overArchive ? "an archive fixture is over its byte limit" : "the upload budget is spent",
        );
      }
      uploaded += bytes;
    },
    reserveObjects: (count) => {
      nonNegativeInteger(count, "count", refuse);
      if (objects + count > AWS_REHEARSAL_LIMITS.deleteObjects) {
        record({ scenario: "lifecycle", phase: "fixture-limit", count, outcome: "refused" });
        throw refuse("the object budget is spent");
      }
      objects += count;
    },
  };
}
