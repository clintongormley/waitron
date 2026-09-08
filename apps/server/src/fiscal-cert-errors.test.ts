import { describe, it, expect } from "vitest";
import { AppError } from "@waitron/shared";
import "./errors.js";

describe("fiscal-cert error codes", () => {
  it("constructs each new code with its params", () => {
    expect(new AppError("fiscal.certificate_dormant_missing", { tenantId: "t" }).code).toBe(
      "fiscal.certificate_dormant_missing",
    );
    expect(new AppError("fiscal.certificate_unlock_failed", { tenantId: "t" }).code).toBe(
      "fiscal.certificate_unlock_failed",
    );
    expect(new AppError("restore.credentials_key_external", {}).code).toBe(
      "restore.credentials_key_external",
    );
    expect(new AppError("server.credentials_key_conflict", {}).code).toBe(
      "server.credentials_key_conflict",
    );
  });
});
