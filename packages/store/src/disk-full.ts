import { AppError, DISK_FULL_RESULT_CODE, sqliteFailureOf } from "@waitron/shared";

/** `error` as `storage.disk_full` when the engine refused it for a full disk, else `undefined`. */
export function asDiskFull(error: unknown): AppError<"storage.disk_full"> | undefined {
  if (error instanceof AppError && error.code === "storage.disk_full") {
    return error as AppError<"storage.disk_full">;
  }
  if (sqliteFailureOf(error)?.errcode === DISK_FULL_RESULT_CODE) {
    return new AppError("storage.disk_full", {}, { reason: "sqlite errcode 13" });
  }
  return undefined;
}
