import { describe, expect, it } from "vitest";
import {
  CORE_CONFIGURATION_TRANSFER,
  validateCoreConfiguration,
} from "./configuration-transfer.js";

const refusal = expect.objectContaining({
  code: "setup.request_invalid",
  params: { field: "table_service_statuses.color" },
});

function status(color?: unknown): Record<string, unknown> {
  const row: Record<string, unknown> = { id: "s1", label: "Bill requested" };
  if (color !== undefined) row.color = color;
  return row;
}

describe("validateCoreConfiguration", () => {
  it("refuses a status colour a save would refuse", () => {
    expect(() =>
      validateCoreConfiguration({ table_service_statuses: [status("red;position:fixed")] }),
    ).toThrowError(refusal);
  });

  it("refuses a status with no colour, which the column cannot store", () => {
    expect(() => validateCoreConfiguration({ table_service_statuses: [status()] })).toThrowError(
      refusal,
    );
  });

  it("accepts a named colour and a hex", () => {
    expect(() =>
      validateCoreConfiguration({ table_service_statuses: [status("amber"), status("#ef4444")] }),
    ).not.toThrow();
  });

  it("accepts a bundle with no statuses", () => {
    expect(() => validateCoreConfiguration({})).not.toThrow();
  });

  it("is the core transfer's validate", () => {
    expect(validateCoreConfiguration).toBeTypeOf("function");
    expect(CORE_CONFIGURATION_TRANSFER.validate).toBe(validateCoreConfiguration);
  });
});
