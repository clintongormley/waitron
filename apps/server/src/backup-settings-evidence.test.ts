import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  ARCHIVE_SETTINGS_REASONS,
  CONFIG_VARIABLES,
  attachRecordMeta,
  recordMetaOf,
  safeLoadDetail,
} from "./backup-settings-evidence.js";

describe("safeLoadDetail", () => {
  it("keeps every listed reason of an unreadable saved record", () => {
    for (const reason of ARCHIVE_SETTINGS_REASONS) {
      expect(safeLoadDetail(new AppError("backup.archive_settings_invalid", { reason }))).toEqual({
        reason,
      });
    }
  });

  it("drops a reason that is not on the list", () => {
    expect(
      safeLoadDetail(new AppError("backup.archive_settings_invalid", { reason: "sk_live_secret" })),
    ).toBeNull();
  });

  it("keeps the record's key number only when it is a whole number", () => {
    expect(
      safeLoadDetail(
        new AppError("credentials.key_version_unknown", {
          purpose: "backup.archive",
          keyVersion: 3,
        }),
      ),
    ).toEqual({ keyVersion: 3 });
    expect(
      safeLoadDetail(
        new AppError("credentials.key_version_unknown", {
          purpose: "backup.archive",
          keyVersion: "3" as unknown as number,
        }),
      ),
    ).toBeNull();
  });

  it("keeps the recovery key's minimum length only when it is a whole number", () => {
    expect(safeLoadDetail(new AppError("backup.recovery_key_too_short", { min: 20 }))).toEqual({
      min: 20,
    });
    expect(
      safeLoadDetail(
        new AppError("backup.recovery_key_too_short", { min: 20.5 as unknown as number }),
      ),
    ).toBeNull();
  });

  it("keeps a configuration variable only when it is on the list", () => {
    for (const variable of CONFIG_VARIABLES) {
      expect(
        safeLoadDetail(
          new AppError("server.config_invalid", { variable, reason: "not_a_positive_integer" }),
        ),
      ).toEqual({ variable });
    }
    expect(
      safeLoadDetail(
        new AppError("server.config_invalid", {
          variable: "WAITRON_CREDENTIALS_KEY",
          reason: "not_a_positive_integer",
        }),
      ),
    ).toBeNull();
  });

  it("answers nothing for any other code, a plain error or a thrown non-error", () => {
    expect(
      safeLoadDetail(new AppError("credentials.decrypt_failed", { purpose: "backup.archive" })),
    ).toBeNull();
    expect(safeLoadDetail(new AppError("backup.recovery_key_missing", {}))).toBeNull();
    const plain = Object.assign(new Error("secret-bearing message"), {
      code: "backup.archive_settings_invalid",
      params: { reason: "retention" },
    });
    expect(safeLoadDetail(plain)).toBeNull();
    expect(safeLoadDetail("backup.archive_settings_invalid")).toBeNull();
  });
});

describe("the failing record's metadata on a thrown error", () => {
  const meta = { keyVersion: 1, writtenAt: "2026-10-29T10:00:00.000Z", digest: "0123456789abcdef" };

  it("travels on the error without reaching its params, keys or JSON", () => {
    const error = new AppError("credentials.key_version_unknown", {
      purpose: "backup.archive",
      keyVersion: 1,
    });
    attachRecordMeta(error, meta);
    expect(recordMetaOf(error)).toEqual(meta);
    expect(error.params).toEqual({ purpose: "backup.archive", keyVersion: 1 });
    // A spread copies enumerable symbol keys too, so this fails if the property is enumerable.
    expect(Object.getOwnPropertySymbols({ ...error })).toEqual([]);
    expect(JSON.stringify(error)).not.toContain(meta.digest);
  });

  it("is absent from an error nothing attached it to, and from a thrown non-object", () => {
    expect(recordMetaOf(new Error("x"))).toBeNull();
    attachRecordMeta("thrown text", meta);
    expect(recordMetaOf("thrown text")).toBeNull();
    expect(recordMetaOf(null)).toBeNull();
  });
});
